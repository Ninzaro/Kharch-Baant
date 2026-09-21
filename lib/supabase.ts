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
export type ClerkTokenOpts = { skipCache?: boolean };

type ClerkTokenGetter = (opts?: ClerkTokenOpts) => Promise<string | null | undefined>;

let clerkTokenGetter: ClerkTokenGetter | null = null;

export class ClerkTokenError extends Error {
  constructor() {
    super('Unable to authenticate with Clerk.');
    this.name = 'ClerkTokenError';
  }
}

export const isClerkTokenError = (error: unknown): error is ClerkTokenError =>
  error instanceof ClerkTokenError;

/** Register Clerk `session.getToken` from React so REST/Realtime do not depend on `window.Clerk`. */
export const setClerkTokenGetter = (getter: ClerkTokenGetter | null): void => {
  clerkTokenGetter = getter;
};

export const getClerkSupabaseToken = async (opts?: ClerkTokenOpts): Promise<string> => {
  try {
    if (clerkTokenGetter) {
      const fromSession = await clerkTokenGetter(opts);
      if (fromSession) return fromSession;
      throw new ClerkTokenError();
    }
    const clerk = (window as any).Clerk;
    if (!clerk?.session) return '';
    const fromWindow = await clerk?.session?.getToken?.(opts?.skipCache ? { skipCache: true } : undefined);
    if (fromWindow) return fromWindow;
    throw new ClerkTokenError();
  } catch (error) {
    if (isClerkTokenError(error)) throw error;
    throw new ClerkTokenError();
  }
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
 * The HTTP path uses supabase-js `accessToken` + fetchWithAuth (Authorization
 * once per request). This helper exists because Realtime is a long-lived
 * WebSocket that needs JWT refresh independently of REST.
 *
 * Invoked from `contexts/SupabaseAuthContext.tsx` on session load, on a 50s
 * refresh interval (Clerk JWT TTL is 60s by default), and on sign-out.
 */
export const setRealtimeAuth = async (token?: string | null): Promise<void> => {
  const authToken = token === undefined ? await getClerkSupabaseToken() : token
  // supabase-js v2's setAuth accepts string | null; its type surface isn't
  // re-exported cleanly, hence the cast.
  try {
    await (supabase.realtime as any).setAuth(authToken || null)
  } catch (error) {
    console.error('setRealtimeAuth failed', error)
  }
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
