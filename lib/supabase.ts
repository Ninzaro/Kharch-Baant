import { createClient } from '@supabase/supabase-js'
import { Database } from './database.types'
import { getEnvValue } from '../utils/env'

const supabaseUrl = getEnvValue('VITE_SUPABASE_URL', 'REACT_APP_SUPABASE_URL')
const supabaseAnonKey = getEnvValue('VITE_SUPABASE_ANON_KEY', 'REACT_APP_SUPABASE_ANON_KEY')

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase credentials are missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or their REACT_APP_ equivalents).')
}

// Helper to get the Clerk JWT for Supabase (used by both HTTP and Realtime)
export const getClerkSupabaseToken = async (): Promise<string> => {
  const clerk = (window as any).Clerk;
  if (clerk?.session) {
    try {
      const token = await clerk.session.getToken({ template: 'supabase' });
      return token || '';
    } catch (e) {
      console.warn('Failed to get Clerk Supabase token:', e);
    }
  }
  return '';
};

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    // We manage auth via Clerk, not Supabase Auth
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    // Intercept every fetch (including realtime WebSocket upgrade headers)
    // to inject the Clerk JWT as Authorization header
    fetch: async (url, options = {}) => {
      const token = await getClerkSupabaseToken();
      const headers = new Headers((options as RequestInit).headers);
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      // Always send the anon key as apikey header
      headers.set('apikey', supabaseAnonKey!);
      return fetch(url, { ...(options as RequestInit), headers });
    },
  },
  realtime: {
    params: {
      apikey: supabaseAnonKey!,
    },
  },
})

/**
 * Pushes a Clerk JWT into the Supabase Realtime WebSocket so RLS policies that
 * depend on `auth.jwt()` can see the authenticated user. Pass `null` on sign-out
 * to drop back to anonymous.
 *
 * The HTTP path is handled separately by the `global.fetch` override above —
 * this helper only exists because Realtime maintains a long-lived connection
 * that needs its auth context refreshed independently of per-request headers.
 *
 * Invoked from `contexts/SupabaseAuthContext.tsx` on session load, on a 50s
 * refresh interval (Clerk JWT TTL is 60s by default), and on sign-out.
 */
export const setRealtimeAuth = async (token?: string | null): Promise<void> => {
  const authToken = token === undefined ? await getClerkSupabaseToken() : token
  // supabase-js v2's setAuth accepts string | null; its type surface isn't
  // re-exported cleanly, hence the cast.
  ;(supabase.realtime as any).setAuth(authToken || null)
}

// Types for our database
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type Inserts<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type Updates<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']

// Specific table types
export type DbGroup = Tables<'groups'>
export type DbTransaction = Tables<'transactions'>
export type DbPaymentSource = Tables<'payment_sources'>
export type DbPerson = Tables<'people'>
export type DbGroupMember = Tables<'group_members'>
