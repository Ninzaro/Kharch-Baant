/**
 * Supabase Edge Function: native Clerk session → one-time Sign-in Token.
 *
 * Verifies the Android clerk-android session JWT (Authorization: Bearer)
 * with Clerk authenticateRequest(), then creates a short-lived Sign-in Token
 * for the same Clerk userId. The WebView redeems it with strategy: 'ticket'.
 *
 * Secrets (function only — never VITE_*):
 *   CLERK_SECRET_KEY
 *   CLERK_PUBLISHABLE_KEY  (public, required by authenticateRequest)
 *
 * Deploy:
 *   supabase secrets set CLERK_SECRET_KEY=sk_live_... CLERK_PUBLISHABLE_KEY=pk_live_...
 *   supabase secrets set ALLOWED_ORIGINS=https://www.motamaati.in,https://motamaati.in
 *   supabase functions deploy native-bridge
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClerkClient } from 'https://esm.sh/@clerk/backend@2.16.0';
import {
  corsHeadersFor,
  jsonResponse,
  rateLimit,
} from '../_shared/auth.ts';

const SIGN_IN_TOKEN_TTL_SECONDS = 60;

function bearerToken(req: Request): string | null {
  const auth = req.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(\S+)/i);
  if (!match) return null;
  const token = match[1].trim();
  return token.length >= 20 ? token : null;
}

serve(async (req) => {
  const cors = corsHeadersFor(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, cors);
  }

  const secretKey = Deno.env.get('CLERK_SECRET_KEY') || '';
  const publishableKey = Deno.env.get('CLERK_PUBLISHABLE_KEY') || '';

  if (!secretKey.startsWith('sk_')) {
    return jsonResponse({ error: 'Native auth bridge is not configured' }, 503, cors);
  }

  if (!bearerToken(req)) {
    return jsonResponse({ error: 'Unauthorized' }, 401, cors);
  }

  try {
    const clerk = createClerkClient({
      secretKey,
      publishableKey: publishableKey.startsWith('pk_') ? publishableKey : undefined,
    });

    const requestState = await clerk.authenticateRequest(req, {
      secretKey,
      publishableKey: publishableKey.startsWith('pk_') ? publishableKey : undefined,
      acceptsToken: 'session_token',
    });

    const authenticated =
      requestState.isAuthenticated === true || requestState.isSignedIn === true;
    if (!authenticated) {
      return jsonResponse({ error: 'Unauthorized' }, 401, cors);
    }

    const auth =
      typeof requestState.toAuth === 'function'
        ? requestState.toAuth()
        : requestState.auth;
    const userId = auth?.userId;
    if (!userId || typeof userId !== 'string') {
      return jsonResponse({ error: 'Unauthorized' }, 401, cors);
    }

    if (!rateLimit(`native-bridge:${userId}`, 10, 60_000)) {
      return jsonResponse({ error: 'Rate limit exceeded' }, 429, cors);
    }

    const signInToken = await clerk.signInTokens.createSignInToken({
      userId,
      expiresInSeconds: SIGN_IN_TOKEN_TTL_SECONDS,
    });

    const ticket = signInToken?.token;
    if (!ticket || typeof ticket !== 'string') {
      return jsonResponse({ error: 'Failed to create sign-in token' }, 502, cors);
    }

    console.log('Native session verified; sign-in token created');
    return jsonResponse({ ticket }, 200, cors);
  } catch (err) {
    console.error('Native auth bridge failed:', err instanceof Error ? err.name : 'unknown');
    return jsonResponse({ error: 'Unauthorized' }, 401, cors);
  }
});
