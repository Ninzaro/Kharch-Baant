import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react';
import { useUser, useClerk, useSession } from '@clerk/clerk-react';
import { ensureUserExists } from '../services/supabaseApiService';
import { getClerkSupabaseToken, setRealtimeAuth, setClerkTokenGetter } from '../lib/supabase';
import { queryClient } from '../lib/queryClient';
import { useAppStore } from '../store/appStore';
import { Person } from '../types';
import { clearNativeClerkSession } from '../services/nativeAuthBridge';

/**
 * Clerk JWTs default to a 60s TTL. We re-push the token into Supabase Realtime
 * slightly before expiry so the long-lived WS connection never loses its RLS
 * context. Clerk's `getToken()` caches internally and returns a fresh JWT once
 * the old one is within ~10s of expiry.
 */
const REALTIME_AUTH_REFRESH_MS = 50_000;

interface AuthContextType {
  user: any | null; // Clerk User
  person: Person | null;
  session: any | null; // Clerk Session
  loading: boolean;
  isSyncing: boolean;
  authError: Error | null;
  retryAuth: () => void;
  signOut: () => Promise<void>;
  updateLocalPerson: (updated: Person) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const SupabaseAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoaded: isUserLoaded } = useUser();
  const { session, isLoaded: isSessionLoaded } = useSession();
  const { signOut: clerkSignOut } = useClerk();
  
  const [person, setPerson] = useState<Person | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [authError, setAuthError] = useState<Error | null>(null);
  const [syncAttempt, setSyncAttempt] = useState(0);
  const hadWebSessionRef = useRef(false);
  const nativeSignOutHandledRef = useRef(false);
  
  const loading = !isUserLoaded || !isSessionLoaded;

  const clearSignedOutClientState = useCallback(() => {
    queryClient.clear();
    localStorage.removeItem('pendingInviteToken');
    useAppStore.getState().setSelectedGroupId(null);
    setPerson(null);
    setAuthError(null);
    setIsSyncing(false);
  }, []);

  useEffect(() => {
    if (!session) {
      setClerkTokenGetter(null);
      return undefined;
    }
    setClerkTokenGetter((opts) => session.getToken({ skipCache: opts?.skipCache }));
    return () => setClerkTokenGetter(null);
  }, [session]);

  useEffect(() => {
    if (!isSessionLoaded) return;

    if (session) {
      hadWebSessionRef.current = true;
      nativeSignOutHandledRef.current = false;
      return;
    }

    if (!hadWebSessionRef.current) return;

    clearSignedOutClientState();

    if (nativeSignOutHandledRef.current) return;

    nativeSignOutHandledRef.current = true;
    clearNativeClerkSession().catch((error) => {
      nativeSignOutHandledRef.current = false;
      console.error('Native Clerk sign-out error:', error);
    });
  }, [session, isSessionLoaded, clearSignedOutClientState]);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;

    const syncUser = async () => {
      if (user) {
        setIsSyncing(true);
        setAuthError(null);
        try {
          // 1. Prime Supabase Realtime with the Clerk JWT BEFORE resolving the
          //    Person. App.tsx mounts realtime bridges keyed on `personId`;
          //    if we resolved the Person first, those bridges could open
          //    unauthenticated WS channels and miss events. Order matters.
          const token = await getClerkSupabaseToken();
          if (cancelled) return;
          await setRealtimeAuth(token);

          // 2. Upsert the Clerk user into the Supabase `people` table.
          const primaryEmail = user.primaryEmailAddress?.emailAddress || '';
          const fullName = user.fullName || primaryEmail.split('@')[0];
          const userProfile = await ensureUserExists(
            user.id,
            fullName,
            primaryEmail
          );
          if (cancelled) return;
          setPerson(userProfile);

          // 3. Refresh the Realtime JWT before Clerk's 60s TTL expires so the
          //    WS connection's RLS context stays valid. The timer is owned by
          //    this effect and cleared on re-run or unmount.
          refreshTimer = setInterval(async () => {
            try {
              const freshToken = await getClerkSupabaseToken();
              await setRealtimeAuth(freshToken);
            } catch (err) {
              console.warn('Failed to refresh Realtime auth token:', err);
            }
          }, REALTIME_AUTH_REFRESH_MS);
        } catch (error) {
          console.error('Error syncing user profile:', error);
          if (!cancelled) {
            const authFailure = error instanceof Error
              ? error
              : new Error('Unable to authenticate your account.');
            setPerson(null);
            setAuthError(authFailure);
            Sentry.captureException(authFailure);
          }
        } finally {
          if (!cancelled) setIsSyncing(false);
        }
      } else if (isUserLoaded) {
        // No user — drop Realtime back to anonymous and clear local state.
        await setRealtimeAuth(null);
        if (cancelled) return;
        setPerson(null);
        setAuthError(null);
        setIsSyncing(false);
      }
    };

    syncUser();

    return () => {
      cancelled = true;
      if (refreshTimer) clearInterval(refreshTimer);
    };
  }, [user, isUserLoaded, syncAttempt]);

  const retryAuth = () => setSyncAttempt((attempt) => attempt + 1);

  const signOut = async () => {
    try {
      // Drop Realtime auth first (fail-closed): if Clerk sign-out fails
      // downstream, we still don't want the old JWT driving WS subscriptions.
      await setRealtimeAuth(null);

      try {
        await clearNativeClerkSession();
        nativeSignOutHandledRef.current = true;
      } catch (error) {
        // WebView logout must still complete. The session-transition effect
        // gets one more opportunity to clear the persisted native session.
        nativeSignOutHandledRef.current = false;
        console.error('Native Clerk sign-out error:', error);
      }

      await clerkSignOut();
      clearSignedOutClientState();
      window.location.replace('/');
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  const updateLocalPerson = (updated: Person) => {
    setPerson(updated);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        person,
        session,
        loading,
        isSyncing,
        authError,
        retryAuth,
        signOut,
        updateLocalPerson,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within a SupabaseAuthProvider');
  }
  return context;
};

