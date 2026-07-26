import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        nodePolyfills({
          // Whether to polyfill `node:` protocol imports.
          protocolImports: true,
        }),
        VitePWA({
          // Dev: do not register SW (stale caches caused blank screens + old CDN html2canvas)
          devOptions: { enabled: false },
          // Avoid unexpected auto-refreshes by not forcing immediate activation
          // We'll switch to a prompt-based update flow
          registerType: 'prompt',
          includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
          manifest: {
            name: 'Kharch Baant - Expense Tracker',
            short_name: 'KharchBaant',
            description: 'Track and split expenses with friends and family',
            theme_color: '#3b82f6',
            background_color: '#ffffff',
            display: 'standalone',
            scope: '/',
            start_url: '/',
            orientation: 'portrait',
            icons: [
              {
                src: 'pwa-192x192.svg',
                sizes: '192x192',
                type: 'image/svg+xml'
              },
              {
                src: 'pwa-512x512.svg',
                sizes: '512x512',
                type: 'image/svg+xml'
              },
              {
                src: 'pwa-512x512.svg',
                sizes: '512x512',
                type: 'image/svg+xml',
                purpose: 'any maskable'
              }
            ]
          },
          workbox: {
            globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
            cleanupOutdatedCaches: true,
            // Do not claim clients or skip waiting automatically to prevent auto page reloads
            clientsClaim: false,
            skipWaiting: false,
            runtimeCaching: [
              {
                urlPattern: /^https:\/\/api\.supabase\.co\/.*/i,
                handler: 'NetworkFirst',
                options: {
                  cacheName: 'supabase-api-cache',
                  expiration: {
                    maxEntries: 100,
                    maxAgeSeconds: 60 * 60 * 24 // 24 hours
                  }
                }
              }
            ]
          }
        })
      ],
      envPrefix: ['VITE_', 'REACT_APP_'],
      build: {
        // Optimize for production - use esbuild for faster builds
        minify: 'esbuild',
        sourcemap: false,
        chunkSizeWarningLimit: 600, // Increase slightly from default 500kb
        rollupOptions: {
          output: {
            manualChunks(id) {
              // React and Clerk must share the same chunk — Clerk accesses React
              // internals at module initialisation time, so splitting them causes
              // "Cannot set properties of undefined (setting 'Activity')" when the
              // browser loads vendor-clerk before vendor-react is fully executed.
              if (
                id.includes('node_modules/react/') ||
                id.includes('node_modules/react-dom/') ||
                id.includes('@clerk/clerk-react') ||
                id.includes('@clerk/shared') ||
                id.includes('@clerk/types')
              )
                return 'vendor-react-clerk';
              if (id.includes('@supabase/supabase-js') || id.includes('@supabase/'))
                return 'vendor-supabase';
              if (id.includes('@google/genai'))
                return 'vendor-gemini';
              if (id.includes('@sentry/'))
                return 'vendor-sentry';
              if (id.includes('html2canvas'))
                return 'vendor-html2canvas';
            },
          }
        }
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      define: {
        // Prefer loadEnv(.env.local) over bare process.env so local dev always
        // picks up file-based secrets. Never JSON.stringify(undefined) — that
        // breaks define and can blank import.meta.env.* at runtime.
        'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify(
          env.VITE_CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY || ''
        ),
        'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(
          env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
        ),
        'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(
          env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
        ),
        'import.meta.env.VITE_API_MODE': JSON.stringify(
          env.VITE_API_MODE || process.env.VITE_API_MODE || 'supabase'
        ),
        'import.meta.env.REACT_APP_SUPABASE_URL': JSON.stringify(
          env.REACT_APP_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || ''
        ),
        'import.meta.env.REACT_APP_SUPABASE_ANON_KEY': JSON.stringify(
          env.REACT_APP_SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || ''
        ),
        // Gemini API key shims for process.env access in geminiService.ts
        'process.env.API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY || ''),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY || ''),
        // Polyfills for Node.js modules
        global: 'globalThis',
      }
    };
});
