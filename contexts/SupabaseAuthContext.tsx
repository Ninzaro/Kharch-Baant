import React, { createContext, useContext, useEffect, useState } from 'react';
import { useUser, useClerk, useSession } from '@clerk/clerk-react';
import { ensureUserExists } from '../services/supabaseApiService';
import { supabase, getClerkSupabaseToken } from '../lib/supabase';
import { Person } from '../types';

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
    const syncUser = async () => {
      if (user) {
        setIsSyncing(true);
        try {
          const primaryEmail = user.primaryEmailAddress?.emailAddress || '';
          const fullName = user.fullName || primaryEmail.split('@')[0];
          console.log('Syncing user profile for:', primaryEmail);
          const userProfile = await ensureUserExists(
            user.id,
            fullName,
            primaryEmail
          );
          setPerson(userProfile);
          console.log('✅ User profile synced:', userProfile);

          // Authenticate the Supabase Realtime WebSocket with the Clerk JWT.
          // global.fetch only covers HTTP — WebSocket connections need setAuth().
          const token = await getClerkSupabaseToken();
          if (token) {
            supabase.realtime.setAuth(token);
          }
        } catch (error) {
          console.error('Error syncing user profile:', error);
          setPerson(null);
        } finally {
          setIsSyncing(false);
        }
      } else if (isUserLoaded) {
        setPerson(null);
        // Clear Realtime auth on sign-out so the next user starts clean
        supabase.realtime.setAuth(null);
        setIsSyncing(false);
      }
    };

    syncUser();
  }, [user, isUserLoaded]);

  const signOut = async () => {
    try {
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

