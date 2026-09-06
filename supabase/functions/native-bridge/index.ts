/**
 * Supabase Edge Function: native Clerk session → one-time Sign-in Token.
 *
 * Verifies the Android clerk-android session JWT (Authorization: Bearer)
 * with Clerk verifyToken() (Bearer session JWT, no browser handshake),
 * then creates a short-lived Sign-in Token
 * for the same Clerk userId. The WebView redeems it with strategy: 'ticket'.
 *
 * Secrets (function only — never VITE_*):
 *   CLERK_SECRET_KEY
 *   CLERK_PUBLISHABLE_KEY  (same instance as the app; used by createClerkClient)
 *
 * Deploy:
 *   supabase secrets set CLERK_SECRET_KEY=sk_live_... CLERK_PUBLISHABLE_KEY=pk_live_...
 *   supabase secrets set ALLOWED_ORIGINS=https://www.motamaati.in,https://motamaati.in
 *   supabase functions deploy native-bridge --no-verify-jwt
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  createClerkClient,
  verifyToken,
} from 'https://esm.sh/@clerk/backend@2.16.0';
import { jsonResponse, rateLimit } from '../_shared/auth.ts';

const SIGN_IN_TOKEN_TTL_SECONDS = 60;
const CAPACITOR_ORIGIN = 'https://www.motamaati.in';
const DEFAULT_ALLOWED_ORIGINS = [
  CAPACITOR_ORIGIN,
  'https://motamaati.in',
];

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const fromEnv = (Deno.env.get('ALLOWED_ORIGINS') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed = new Set([...DEFAULT_ALLOWED_ORIGINS, ...fromEnv]);
  const allowOrigin = allowed.has(origin) ? origin : CAPACITOR_ORIGIN;

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function bearerToken(req: Request): string | null {
  const auth = req.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(\S+)/i);
  if (!match) return null;
  const token = match[1].trim();
  return token.length >= 20 ? token : null;
}

function clerkUserIdFromVerified(verified: unknown): string | null {
  if (!verified || typeof verified !== 'object') return null;
  const direct = (verified as { sub?: unknown }).sub;
  if (typeof direct === 'string' && direct.startsWith('user_')) return direct;
  const nested = (verified as { data?: { sub?: unknown } }).data?.sub;
  if (typeof nested === 'string' && nested.startsWith('user_')) return nested;
  return null;
}

function verifyErrors(verified: unknown): string {
  if (!verified || typeof verified !== 'object') return '';
  const errors = (verified as { errors?: Array<{ reason?: string; code?: string }> }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return '';
  const first = errors[0];
  return String(first?.reason || first?.code || 'verify_failed');
}

serve(async (req) => {
  const cors = corsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, cors);
  }

  const secretKey = Deno.env.get('CLERK_SECRET_KEY') || '';
  const publishableKey = Deno.env.get('CLERK_PUBLISHABLE_KEY') || '';

  if (!secretKey.startsWith('sk_')) {
    return jsonResponse({ error: 'Native auth bridge is not configured' }, 503, cors);
  }

  const token = bearerToken(req);
  if (!token) {
    return jsonResponse({ error: 'Unauthorized' }, 401, cors);
  }

  try {
    // Native clerk-android getToken() is a session JWT on Authorization.
    // authenticateRequest() is for browser cookie/handshake (WebView Origin on
    // supabase.co looks signed-out). verifyToken() checks the JWT only.
    const verified = await verifyToken(token, {
      secretKey,
      clockSkewInMs: 10_000,
    });

    const verifyFailed = verifyErrors(verified);
    if (verifyFailed) {
      console.error('Native auth bridge verify failed:', verifyFailed);
      return jsonResponse({ error: 'Unauthorized' }, 401, cors);
    }

    const userId = clerkUserIdFromVerified(verified);
    if (!userId) {
      console.error('Native auth bridge verify failed: missing_sub');
      return jsonResponse({ error: 'Unauthorized' }, 401, cors);
    }

    const clerk = createClerkClient({
      secretKey,
      publishableKey: publishableKey.startsWith('pk_') ? publishableKey : undefined,
    });

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
    const name = err instanceof Error ? err.name : 'unknown';
    const reason =
      err && typeof err === 'object' && 'reason' in err
        ? String((err as { reason?: unknown }).reason || '')
        : '';
    console.error('Native auth bridge failed:', name, reason);
    return jsonResponse({ error: 'Unauthorized' }, 401, cors);
  }
});
