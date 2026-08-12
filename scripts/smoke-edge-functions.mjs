/**
 * Smoke-test deployed Edge Functions (send-email, suggest-tag).
 *
 * Usage:
 *   node scripts/smoke-edge-functions.mjs
 *
 * Optional authenticated probe (Clerk user JWT for Supabase template):
 *   SMOKE_SUPABASE_JWT=<token> node scripts/smoke-edge-functions.mjs
 *
 * Loads VITE_SUPABASE_* from .env / .env.local (same as the app).
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

for (const file of ['.env', '.env.local']) {
  const p = path.resolve(process.cwd(), file);
  if (fs.existsSync(p)) dotenv.config({ path: p, override: file === '.env.local' });
}

const url = process.env.VITE_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
const userJwt = process.env.SMOKE_SUPABASE_JWT || '';

if (!url || !anon) {
  console.error('[EDGE SMOKE] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const base = `${url.replace(/\/$/, '')}/functions/v1`;
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}: ${detail}`);
}

async function rawPost(fn, { headers = {}, body }) {
  const res = await fetch(`${base}/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json, text: text.slice(0, 300) };
}

async function run() {
  console.log(`[EDGE SMOKE] target=${base}`);
  console.log(`[EDGE SMOKE] userJwt=${userJwt ? 'set' : 'not set'}`);

  // 1) Completely unauthenticated
  {
    const r = await rawPost('suggest-tag', { body: { description: 'uber ride' } });
    const ok = r.status === 401;
    record(
      'suggest-tag no Authorization',
      ok,
      `status=${r.status} body=${JSON.stringify(r.json).slice(0, 120)}`
    );
  }
  {
    const r = await rawPost('send-email', {
      body: { type: 'welcome', data: { userName: 'Smoke', userEmail: 'smoke@example.com' } },
    });
    const ok = r.status === 401;
    record(
      'send-email no Authorization',
      ok,
      `status=${r.status} body=${JSON.stringify(r.json).slice(0, 120)}`
    );
  }

  // 2) Anon key as Bearer (must NOT be treated as a user) — our function returns 401
  {
    const r = await rawPost('suggest-tag', {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      body: { description: 'uber to airport' },
    });
    const ok = r.status === 401;
    record(
      'suggest-tag anon-key-as-bearer rejected',
      ok,
      `status=${r.status} body=${JSON.stringify(r.json).slice(0, 120)}`
    );
  }
  {
    const r = await rawPost('send-email', {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      body: { type: 'welcome', data: { userName: 'Smoke', userEmail: 'smoke@example.com' } },
    });
    const ok = r.status === 401;
    record(
      'send-email anon-key-as-bearer rejected',
      ok,
      `status=${r.status} body=${JSON.stringify(r.json).slice(0, 120)}`
    );
  }

  // 3) Garbage JWT
  {
    const r = await rawPost('suggest-tag', {
      headers: { apikey: anon, Authorization: 'Bearer not.a.real.jwt' },
      body: { description: 'coffee' },
    });
    const ok = r.status === 401;
    record(
      'suggest-tag garbage JWT rejected',
      ok,
      `status=${r.status} body=${JSON.stringify(r.json).slice(0, 120)}`
    );
  }

  // 4) Authenticated path (optional)
  if (userJwt) {
    const client = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${userJwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const tag = await client.functions.invoke('suggest-tag', {
      body: { description: 'uber to airport for trip' },
    });
    // Success: 200 with tag or 503 if GEMINI not configured (still proves auth worked)
    const tagStatus = tag.error
      ? (tag.error.context?.status ?? tag.error.status ?? 'error')
      : 200;
    const tagBody = tag.data ?? tag.error?.message ?? tag.error;
    const tagOk =
      !tag.error ||
      String(tagBody).includes('GEMINI') ||
      tagStatus === 503 ||
      (tag.data && 'tag' in tag.data);
    // functions.invoke surfaces non-2xx as error — check context
    let authTagPass = false;
    let authTagDetail = '';
    if (!tag.error && tag.data) {
      authTagPass = true;
      authTagDetail = `ok data=${JSON.stringify(tag.data).slice(0, 120)}`;
    } else {
      // Re-fetch raw to see status
      const raw = await rawPost('suggest-tag', {
        headers: { apikey: anon, Authorization: `Bearer ${userJwt}` },
        body: { description: 'uber to airport for trip' },
      });
      authTagPass = raw.status === 200 || raw.status === 503;
      authTagDetail = `status=${raw.status} body=${JSON.stringify(raw.json).slice(0, 160)}`;
    }
    record('suggest-tag with user JWT', authTagPass, authTagDetail);

    const rawEmail = await rawPost('send-email', {
      headers: { apikey: anon, Authorization: `Bearer ${userJwt}` },
      body: {
        type: 'welcome',
        data: { userName: 'Smoke', userEmail: 'smoke-do-not-send@example.invalid' },
      },
    });
    // 200 = MailerSend configured; 503 = secrets missing but auth passed; 401 = auth failed
    const emailOk = rawEmail.status === 200 || rawEmail.status === 503 || rawEmail.status === 400;
    record(
      'send-email with user JWT (auth gate)',
      emailOk && rawEmail.status !== 401,
      `status=${rawEmail.status} body=${JSON.stringify(rawEmail.json).slice(0, 160)}`
    );
  } else {
    record(
      'authenticated probes',
      true,
      'SKIPPED — set SMOKE_SUPABASE_JWT to a Clerk session JWT (template: supabase) to test signed-in path'
    );
  }

  // 5) App-shaped client without user token (mirrors logged-out SPA)
  {
    const client = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.functions.invoke('suggest-tag', {
      body: { description: 'lunch with friends' },
    });
    // Expect failure / unauthorized when no session
    const failed = Boolean(error) || !data?.tag;
    record(
      'app client invoke without session',
      failed || data?.tag === '',
      error
        ? `error=${error.message}`
        : `data=${JSON.stringify(data).slice(0, 120)}`
    );
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n[EDGE SMOKE SUMMARY]', {
    passed: results.filter((r) => r.ok).length,
    failed: failed.length,
    total: results.length,
  });
  if (failed.length) {
    process.exit(1);
  }
  console.log('[EDGE SMOKE] All checks passed');
}

run().catch((e) => {
  console.error('[EDGE SMOKE] fatal', e);
  process.exit(1);
});
