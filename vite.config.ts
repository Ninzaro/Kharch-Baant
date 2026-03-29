import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
// Diagnostic plugin (temporary) to trace Vite startup phases
const diagPlugin = () => ({
  name: 'diag-startup',
  config(config) {
    // eslint-disable-next-line no-console
    console.log('[VITE DIAG] initial config hook');
    return config;
  },
  configResolved(resolved) {
    // eslint-disable-next-line no-console
    console.log('[VITE DIAG] config resolved: root=%s mode=%s plugins=%d', resolved.root, resolved.mode, resolved.plugins.length);
  },
  buildStart() {
    // eslint-disable-next-line no-console
    console.log('[VITE DIAG] buildStart (dev server bootstrap)');
  },
});

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const isProduction = mode === 'production';
    
    // Log environment variables during build (for debugging)
    console.log('[VITE] Building with mode:', mode);
    console.log('[VITE] process.env.VITE_CLERK_PUBLISHABLE_KEY:', !!process.env.VITE_CLERK_PUBLISHABLE_KEY);
    console.log('[VITE] env.VITE_CLERK_PUBLISHABLE_KEY:', !!env.VITE_CLERK_PUBLISHABLE_KEY);
    console.log('[VITE] process.env.VITE_SUPABASE_URL:', !!process.env.VITE_SUPABASE_URL);
    console.log('[VITE] env.VITE_SUPABASE_URL:', !!env.VITE_SUPABASE_URL);
    
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        // Only add diag plugin in development
        ...(isProduction ? [] : [diagPlugin()]),
        react(),
        nodePolyfills({
          // Whether to polyfill `node:` protocol imports.
          protocolImports: true,
        }),
        VitePWA({
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
            // Native chunking preferred to prevent bundle undefined errors
          }
        }
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      define: {
        // Explicitly define import.meta.env variables for Vercel compatibility (prioritize process.env)
        'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify(process.env.VITE_CLERK_PUBLISHABLE_KEY || env.VITE_CLERK_PUBLISHABLE_KEY),
        'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL),
        'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY),
        'import.meta.env.VITE_API_MODE': JSON.stringify(process.env.VITE_API_MODE || env.VITE_API_MODE || 'supabase'),
        // Support both VITE_ and REACT_APP_ prefixes for compatibility
        'process.env.API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY),
        'process.env.REACT_APP_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL || env.REACT_APP_SUPABASE_URL),
        'process.env.REACT_APP_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY || env.REACT_APP_SUPABASE_ANON_KEY),
        'process.env.REACT_APP_API_MODE': JSON.stringify(env.VITE_API_MODE || env.REACT_APP_API_MODE || 'mock'),
        // Polyfills for Node.js modules
        global: 'globalThis',
      }
    };
});
