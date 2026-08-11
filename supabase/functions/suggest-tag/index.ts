/**
 * Supabase Edge Function: suggest expense category via Gemini.
 *
 * GEMINI_API_KEY is a function secret only — never ship it in VITE_* or the app bundle.
 *
 * Deploy:
 *   supabase secrets set GEMINI_API_KEY=AIza... GEMINI_MODEL=gemini-2.0-flash
 *   supabase secrets set ALLOWED_ORIGINS=https://your-domain.com
 *   supabase functions deploy suggest-tag
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeadersFor,
  jsonResponse,
  rateLimit,
  requireAuthSub,
} from '../_shared/auth.ts';

const TAGS = [
  'Food',
  'Groceries',
  'Transport',
  'Travel',
  'Housing',
  'Utilities',
  'Entertainment',
  'Shopping',
  'Health',
  'Other',
] as const;

serve(async (req) => {
  const cors = corsHeadersFor(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, cors);
  }

  const sub = await requireAuthSub(req);
  if (!sub) {
    return jsonResponse({ error: 'Unauthorized' }, 401, cors);
  }

  // Gemini cost / abuse guard
  if (!rateLimit(`tag:${sub}`, 30, 60_000)) {
    return jsonResponse({ error: 'Rate limit exceeded' }, 429, cors);
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    return jsonResponse({ tag: '', reason: 'GEMINI_API_KEY not set' }, 503, cors);
  }

  try {
    const body = await req.json();
    const description = String(body?.description || '').trim();
    if (description.length <= 3) {
      return jsonResponse({ tag: '' }, 200, cors);
    }
    if (description.length > 200) {
      return jsonResponse({ error: 'description too long' }, 400, cors);
    }

    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.0-flash';
    const prompt = `Categorize this expense into exactly one of: ${TAGS.join(', ')}.
Respond with ONLY the category name.
Expense: "${description.replace(/"/g, "'")}"`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0 },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini error:', errText);
      return jsonResponse({ tag: '', error: 'gemini_failed' }, 502, cors);
    }

    const geminiJson = await geminiRes.json();
    const text =
      geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text?.trim?.() || '';

    const exact = TAGS.find((t) => t === text);
    if (exact) return jsonResponse({ tag: exact }, 200, cors);

    const normalized = TAGS.find((t) => t.toLowerCase() === text.toLowerCase());
    if (normalized) return jsonResponse({ tag: normalized }, 200, cors);

    return jsonResponse({ tag: 'Other' }, 200, cors);
  } catch (error) {
    console.error('suggest-tag error:', error);
    return jsonResponse({ tag: '', error: 'internal' }, 500, cors);
  }
});
