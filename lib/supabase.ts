import { createClient } from '@supabase/supabase-js'
import { Database } from './database.types'

// Literal import.meta.env.* paths — Vite only inlines these (not dynamic lookups).
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.REACT_APP_SUPABASE_URL ||
  ''
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.REACT_APP_SUPABASE_ANON_KEY ||
  ''

// Safe fallback if credentials are empty to allow ErrorBoundary/UI to mount
if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    'Supabase credentials are missing. ' +
      `(url=${supabaseUrl ? 'set' : 'missing'} key=${supabaseAnonKey ? 'set' : 'missing'})`
  )
}

/**
 * Clerk session JWT for Supabase (HTTP + Realtime).
 *
 * After migrating off Supabase *legacy* HS256 secrets, PostgREST verifies
 * tokens via JWKS. The old `getToken({ template: 'supabase' })` HS256 token
 * then fails with "No suitable key or wrong key type".
 *
 * Native path: Clerk session token + Clerk added as a Third-party Auth
 * provider in the Supabase dashboard. `sub` remains the Clerk user id
 * (`requesting_user_id()`).
 */
export const getClerkSupabaseToken = async (): Promise<string> => {
  const clerk = (window as any).Clerk;
  if (!clerk?.session) return '';
  try {
    const sessionToken = await clerk.session.getToken();
    if (sessionToken) return sessionToken;
  } catch (e) {
    console.warn('Failed to get Clerk session token:', e);
  }
  return '';
};

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  accessToken: async () => {
    const token = await getClerkSupabaseToken();
    return token || null;
  },
  global: {
    fetch: async (url, options = {}) => {
      const token = await getClerkSupabaseToken();
      const headers = new Headers((options as RequestInit).headers);
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      headers.set('apikey', supabaseAnonKey);
      return fetch(url, { ...(options as RequestInit), headers });
    },
  },
  realtime: {
    params: {
      apikey: supabaseAnonKey,
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
