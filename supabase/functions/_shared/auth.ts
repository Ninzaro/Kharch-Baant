/**
 * Shared Edge Function auth helpers (Clerk JWT via Supabase client).
 *
 * SUPABASE_URL + SUPABASE_ANON_KEY are injected automatically by the platform.
 * Optional: SUPABASE_JWT_SECRET (or JWT_SECRET) for HS256 verification fallback.
 * Optional: ALLOWED_ORIGINS=https://app.example.com,https://www.example.com
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import * as jose from 'https://deno.land/x/jose@v5.9.6/index.ts';

export function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // When unset, allow any origin (local / early beta). Set ALLOWED_ORIGINS for production.
  let allowOrigin = '*';
  if (allowed.length > 0) {
    allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function jsonResponse(
  body: unknown,
  status: number,
  cors: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// ── In-isolate rate limit (best-effort; resets per cold start) ──────────────

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

/** Returns true if the request is allowed. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateBuckets.get(key);
  if (!entry || now >= entry.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count += 1;
  return true;
}

// ── JWT / identity ──────────────────────────────────────────────────────────

/**
 * Verifies the Authorization bearer and returns the JWT `sub` (Clerk user id).
 * Returns null when missing or invalid.
 */
export async function requireAuthSub(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(\S+)/i);
  if (!match) return null;
  const token = match[1].trim();
  if (token.length < 20) return null;

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

  if (supabaseUrl && anonKey) {
    try {
      const client = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });

      // Prefer getClaims (third-party / Clerk JWT) when available
      const authAny = client.auth as {
        getClaims?: (jwt?: string) => Promise<{
          data?: { claims?: { sub?: string } };
          error?: unknown;
        }>;
        getUser: (jwt?: string) => Promise<{
          data: { user: { id: string } | null };
          error: unknown;
        }>;
      };

      if (typeof authAny.getClaims === 'function') {
        const claimsResult = await authAny.getClaims(token);
        const sub = claimsResult?.data?.claims?.sub;
        if (sub) return String(sub);
      }

      const { data, error } = await authAny.getUser(token);
      if (!error && data?.user?.id) return data.user.id;
    } catch (e) {
      console.warn('Supabase auth verify failed:', e);
    }
  }

  // Fallback: HS256 with project JWT secret (set as Edge secret if needed)
  const jwtSecret =
    Deno.env.get('SUPABASE_JWT_SECRET') || Deno.env.get('JWT_SECRET') || '';
  if (jwtSecret) {
    try {
      const { payload } = await jose.jwtVerify(
        token,
        new TextEncoder().encode(jwtSecret),
        { algorithms: ['HS256'] }
      );
      if (payload.sub) return String(payload.sub);
    } catch {
      // invalid signature / expired
    }
  }

  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  return s.length >= 5 && s.length <= 254 && EMAIL_RE.test(s);
}
