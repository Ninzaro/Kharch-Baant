/**
 * Vite-safe env reads.
 *
 * Vite only replaces *literal* property chains:
 *   import.meta.env.VITE_FOO   ✅ inlined
 *   const e = import.meta.env; e.VITE_FOO   ❌ often undefined
 *   import.meta.env[key]   ❌ never inlined
 *
 * Always reference import.meta.env.SOME_KEY as a full literal path.
 */

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value === '' || value === 'undefined' || value === 'null') return undefined;
  return value;
}

/** Known keys with literal import.meta.env.* access (required for Vite). */
const KNOWN: Record<string, () => string | undefined> = {
  VITE_SUPABASE_URL: () => nonEmpty(import.meta.env.VITE_SUPABASE_URL),
  VITE_SUPABASE_ANON_KEY: () => nonEmpty(import.meta.env.VITE_SUPABASE_ANON_KEY),
  VITE_CLERK_PUBLISHABLE_KEY: () => nonEmpty(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY),
  VITE_API_MODE: () => nonEmpty(import.meta.env.VITE_API_MODE),
  // VITE_GEMINI_* / VITE_MAILERSEND_* removed — secrets belong on Edge Functions only
  VITE_DEBUG_ENABLED: () => nonEmpty(import.meta.env.VITE_DEBUG_ENABLED),
  VITE_DEV_MODE: () => nonEmpty(import.meta.env.VITE_DEV_MODE),
  REACT_APP_SUPABASE_URL: () => nonEmpty(import.meta.env.REACT_APP_SUPABASE_URL),
  REACT_APP_SUPABASE_ANON_KEY: () => nonEmpty(import.meta.env.REACT_APP_SUPABASE_ANON_KEY),
  REACT_APP_API_MODE: () => nonEmpty(import.meta.env.REACT_APP_API_MODE),
};

export const getEnvValue = (...keys: string[]): string | undefined => {
  for (const key of keys) {
    const reader = KNOWN[key];
    if (reader) {
      const v = reader();
      if (v) return v;
    }
  }

  if (typeof process !== 'undefined' && process.env) {
    for (const key of keys) {
      const v = nonEmpty(process.env[key]);
      if (v) return v;
    }
  }

  return undefined;
};
