import { Tag } from '../types';
import { matchKeyword } from './tagKeywords';
import { suggestTagForDescription } from './geminiService';
import { supabase } from '../lib/supabase';

/** Module-level session cache: survives for the lifetime of the browser tab. */
const sessionCache = new Map<string, Tag>();

const normalize = (description: string): string =>
  description.toLowerCase().trim();

// ─── Supabase helpers ────────────────────────────────────────────────────────

// Cast to any: ai_item_cache is not in the generated database.types.ts yet.
// Run `supabase gen types` after applying the schema migration to remove these casts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

async function lookupCache(key: string): Promise<Tag | null> {
  try {
    const { data, error } = await db
      .from('ai_item_cache')
      .select('category')
      .eq('normalized_name', key)
      .maybeSingle();

    if (error || !data) return null;
    return data.category as Tag;
  } catch {
    return null;
  }
}

/** Fire-and-forget — never blocks the response. */
function writeCache(key: string, tag: Tag): void {
  db
    .from('ai_item_cache')
    .insert({ normalized_name: key, category: tag, source: 'gemini' })
    .then(({ error }: { error: { code: string; message: string } | null }) => {
      if (error && error.code !== '23505') {
        // 23505 = unique_violation (another tab already wrote it — harmless)
        console.warn('[tagClassifier] cache write failed:', error.message);
      }
    });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Classifies an expense description into a Tag using four layers in order:
 *   1. Keyword rules  (sync, free)
 *   2. Session cache  (sync, free)
 *   3. Supabase cache (async, cheap read)
 *   4. Gemini API     (async, costs money — only reached for novel inputs)
 */
export const classifyDescription = async (description: string): Promise<Tag | ''> => {
  const key = normalize(description);
  if (key.length <= 3) return '';

  // Layer 1: keyword match
  const keyword = matchKeyword(key);
  if (keyword) {
    sessionCache.set(key, keyword);
    return keyword;
  }

  // Layer 2: session cache
  const session = sessionCache.get(key);
  if (session) return session;

  // Layer 3: Supabase cache
  const cached = await lookupCache(key);
  if (cached) {
    sessionCache.set(key, cached);
    return cached;
  }

  // Layer 4: Gemini
  const tag = await suggestTagForDescription(description);
  if (tag) {
    sessionCache.set(key, tag);
    writeCache(key, tag);
  }
  return tag;
};
