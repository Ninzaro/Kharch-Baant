/**
 * Supabase Edge Function: suggest expense category via Gemini.
 *
 * GEMINI_API_KEY is a function secret only — never ship it in VITE_* or the app bundle.
 *
 * Deploy:
 *   supabase secrets set GEMINI_API_KEY=AIza... GEMINI_MODEL=gemini-2.0-flash
 *   supabase functions deploy suggest-tag
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ') || auth.length < 20) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    // Not configured — client falls back to keywords/cache
    return json({ tag: '', reason: 'GEMINI_API_KEY not set' }, 503);
  }

  try {
    const body = await req.json();
    const description = String(body?.description || '').trim();
    if (description.length <= 3) {
      return json({ tag: '' });
    }
    // Hard cap to limit abuse / cost
    if (description.length > 200) {
      return json({ error: 'description too long' }, 400);
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
      return json({ tag: '', error: 'gemini_failed' }, 502);
    }

    const geminiJson = await geminiRes.json();
    const text =
      geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text?.trim?.() || '';

    const exact = TAGS.find((t) => t === text);
    if (exact) return json({ tag: exact });

    const normalized = TAGS.find((t) => t.toLowerCase() === text.toLowerCase());
    if (normalized) return json({ tag: normalized });

    return json({ tag: 'Other' });
  } catch (error) {
    console.error('suggest-tag error:', error);
    return json({ tag: '', error: 'internal' }, 500);
  }
});
