/**
 * Read env values in a Vite-safe way.
 *
 * IMPORTANT: Vite only statically replaces *literal* property access like
 * `import.meta.env.VITE_FOO`. Dynamic access `import.meta.env[key]` does NOT
 * receive injected values and returns undefined — which previously blanked
 * the app when Supabase credentials were loaded via getEnvValue().
 *
 * Keep known keys as static property reads below.
 */

const viteEnv = import.meta.env as ImportMetaEnv & Record<string, string | undefined>;

/** Static map so Vite can inline each key at build/dev time. */
const KNOWN: Record<string, string | undefined> = {
  VITE_SUPABASE_URL: viteEnv.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: viteEnv.VITE_SUPABASE_ANON_KEY,
  VITE_CLERK_PUBLISHABLE_KEY: viteEnv.VITE_CLERK_PUBLISHABLE_KEY,
  VITE_API_MODE: viteEnv.VITE_API_MODE,
  VITE_GEMINI_API_KEY: viteEnv.VITE_GEMINI_API_KEY,
  VITE_MAILERSEND_API_KEY: viteEnv.VITE_MAILERSEND_API_KEY,
  VITE_MAILERSEND_FROM_EMAIL: viteEnv.VITE_MAILERSEND_FROM_EMAIL,
  VITE_DEBUG_ENABLED: viteEnv.VITE_DEBUG_ENABLED,
  VITE_DEV_MODE: viteEnv.VITE_DEV_MODE,
  // Legacy React CRA-style aliases still present in some .env files
  REACT_APP_SUPABASE_URL: viteEnv.REACT_APP_SUPABASE_URL,
  REACT_APP_SUPABASE_ANON_KEY: viteEnv.REACT_APP_SUPABASE_ANON_KEY,
  REACT_APP_API_MODE: viteEnv.REACT_APP_API_MODE,
  GEMINI_API_KEY: viteEnv.GEMINI_API_KEY,
};

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  // Vite define may stringify missing keys as the literal "undefined"
  if (value === 'undefined' || value === 'null') return undefined;
  return value;
}

export const getEnvValue = (...keys: string[]): string | undefined => {
  for (const key of keys) {
    const fromKnown = nonEmpty(KNOWN[key]);
    if (fromKnown) return fromKnown;

    // Fallback for keys not listed above (still may fail under Vite dynamic access)
    const fromMeta = nonEmpty(viteEnv[key]);
    if (fromMeta) return fromMeta;
  }

  if (typeof process !== 'undefined' && process.env) {
    for (const key of keys) {
      const fromProcess = nonEmpty(process.env[key]);
      if (fromProcess) return fromProcess;
    }
  }

  return undefined;
};
