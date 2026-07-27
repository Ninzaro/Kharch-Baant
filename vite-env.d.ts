/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_MODE?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string
  readonly VITE_APP_URL?: string
  readonly REACT_APP_SUPABASE_URL?: string
  readonly REACT_APP_SUPABASE_ANON_KEY?: string
  readonly REACT_APP_API_MODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
