import React, { createContext, useContext, useEffect, useState } from 'react';
import { useUser, useClerk, useSession } from '@clerk/clerk-react';
import { ensureUserExists } from '../services/supabaseApiService';
import { getClerkSupabaseToken, setRealtimeAuth } from '../lib/supabase';
import { Person } from '../types';

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
  
  const loading = !isUserLoaded || !isSessionLoaded;

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;

    const syncUser = async () => {
      if (user) {
        setIsSyncing(true);
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
          if (!cancelled) setPerson(null);
        } finally {
          if (!cancelled) setIsSyncing(false);
        }
      } else if (isUserLoaded) {
        // No user — drop Realtime back to anonymous and clear local state.
        await setRealtimeAuth(null);
        if (cancelled) return;
        setPerson(null);
        setIsSyncing(false);
      }
    };

    syncUser();

    return () => {
      cancelled = true;
      if (refreshTimer) clearInterval(refreshTimer);
    };
  }, [user, isUserLoaded]);

  const signOut = async () => {
    try {
      // Drop Realtime auth first (fail-closed): if Clerk sign-out fails
      // downstream, we still don't want the old JWT driving WS subscriptions.
      await setRealtimeAuth(null);
      await clerkSignOut();
      setPerson(null);
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

