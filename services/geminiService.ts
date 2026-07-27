/**
 * Expense category helpers.
 *
 * AI suggestions never use a client-side Gemini key. If the Edge Function
 * `suggest-tag` is deployed with GEMINI_API_KEY, novel descriptions are
 * classified server-side. Otherwise keywords + cache still work offline.
 *
 * Cute-icon mapping is pure local data — no network.
 */

import { TAGS, Tag } from '../types';
import { supabase } from '../lib/supabase';

/**
 * True when the app can attempt AI (Edge Function). Always true if Supabase
 * is configured — missing secrets just no-op on the server.
 */
export const isAiTaggingConfigured = (): boolean => {
  const url = import.meta.env.VITE_SUPABASE_URL;
  return typeof url === 'string' && url.length > 0;
};

/**
 * Ask the server-side suggest-tag function for a category.
 * Returns '' when the function is missing, unconfigured, or errors.
 */
export const suggestTagForDescription = async (description: string): Promise<Tag | ''> => {
  const trimmed = description?.trim();
  if (!trimmed || !isAiTaggingConfigured()) {
    return '';
  }

  try {
    const { data, error } = await supabase.functions.invoke('suggest-tag', {
      body: { description: trimmed },
    });

    if (error) {
      // Function not deployed or network — fall back to keywords only
      if (import.meta.env.DEV) {
        console.info('[AI tags] Edge suggest-tag unavailable:', error.message);
      }
      return '';
    }

    const suggested = (data?.tag ?? data?.category ?? '').toString().trim();
    if (!suggested) return '';

    if (TAGS.includes(suggested as Tag)) {
      return suggested as Tag;
    }

    const normalized = TAGS.find((t) => t.toLowerCase() === suggested.toLowerCase());
    return normalized ?? '';
  } catch (err) {
    if (import.meta.env.DEV) {
      console.info('[AI tags] suggest-tag failed:', err);
    }
    return '';
  }
};

/** Category → emoji for “Cute Icons” on save. Local only. */
export const getIconForCategory = (tag: Tag): string => {
  const icons: Record<Tag, string> = {
    Food: '🍔',
    Groceries: '🛒',
    Transport: '🚕',
    Travel: '✈️',
    Housing: '🏠',
    Utilities: '💡',
    Entertainment: '🎬',
    Shopping: '🛍️',
    Health: '💊',
    Other: '📝',
  };
  return icons[tag] || '📝';
};
