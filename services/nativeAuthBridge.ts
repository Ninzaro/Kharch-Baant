import { Capacitor } from '@capacitor/core';
import ClerkNativeAuth from './clerkNativeAuth';
import { getEnvValue } from '../utils/env';

export function isAndroidNativeApp(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export function nativeBridgeUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/native-bridge`;
}

export interface TicketSignIn {
  create: (params: {
    strategy: 'ticket';
    ticket: string;
  }) => Promise<{ status?: string; createdSessionId?: string | null }>;
}

export type SetActiveFn = (params: { session: string }) => Promise<unknown>;

/**
 * Redeems a Backend Sign-in Token on the existing clerk-react client.
 */
export async function consumeSignInTicket(
  signIn: TicketSignIn,
  setActive: SetActiveFn,
  ticket: string
): Promise<void> {
  if (!ticket) {
    throw new Error('Missing Clerk sign-in ticket.');
  }

  const result = await signIn.create({
    strategy: 'ticket',
    ticket,
  });

  if (result.status === 'complete' && result.createdSessionId) {
    await setActive({ session: result.createdSessionId });
    return;
  }

  throw new Error(
    'Clerk ticket authentication did not complete. Additional verification may be required.'
  );
}

export async function exchangeNativeSessionForTicket(
  nativeSessionToken: string
): Promise<string> {
  const supabaseUrl = getEnvValue('VITE_SUPABASE_URL', 'REACT_APP_SUPABASE_URL');
  const anonKey = getEnvValue('VITE_SUPABASE_ANON_KEY', 'REACT_APP_SUPABASE_ANON_KEY');

  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase is not configured for the native auth bridge.');
  }

  const response = await fetch(nativeBridgeUrl(supabaseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${nativeSessionToken}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error('Backend bridge failed.');
  }

  const body = await response.json();
  const ticket = body?.ticket;
  if (typeof ticket !== 'string' || !ticket) {
    throw new Error('Backend bridge did not return a sign-in ticket.');
  }

  return ticket;
}

/**
 * Android-only: clerk-android oauth_google (SSOManagerActivity) → native session
 * JWT → backend Sign-in Token → clerk-react ticket session.
 */
export async function completeNativeGoogleSignIn(params: {
  signIn: TicketSignIn;
  setActive: SetActiveFn;
}): Promise<void> {
  const { signIn, setActive } = params;
  const publishableKey = getEnvValue('VITE_CLERK_PUBLISHABLE_KEY');
  if (!publishableKey) {
    throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY.');
  }

  const { token: nativeSessionToken } = await ClerkNativeAuth.signInWithGoogle({
    publishableKey,
  });

  if (!nativeSessionToken) {
    throw new Error('Native Clerk session token was empty.');
  }
  console.log('Native Clerk authentication succeeded');
  console.log('Native session token obtained');

  const ticket = await exchangeNativeSessionForTicket(nativeSessionToken);
  console.log('Backend bridge succeeded');

  await consumeSignInTicket(signIn, setActive, ticket);
  console.log('WebView Clerk ticket authentication succeeded');
}
