/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_MODE?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string
  readonly VITE_GEMINI_API_KEY?: string
  readonly VITE_MAILERSEND_API_KEY?: string
  readonly VITE_MAILERSEND_FROM_EMAIL?: string
  readonly REACT_APP_SUPABASE_URL?: string
  readonly REACT_APP_SUPABASE_ANON_KEY?: string
  readonly REACT_APP_API_MODE?: string
  readonly GEMINI_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}