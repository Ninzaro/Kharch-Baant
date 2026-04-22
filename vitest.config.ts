/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Exclude Playwright specs (tests/**) and stale parallel-session worktrees
    // (.claude/worktrees/**). Defaults include node_modules, dist, .{idea,git,cache}.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/.claude/**',
      'tests/**',
      'android/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'src/test/**',
        'tests/**',
        'android/**',
        'scripts/**',
        '.claude/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/*.spec.*',
        '**/*.test.*',
        '**/*.mjs',
        '**/coverage/**',
        '**/dist/**',
        '**/build/**',
      ],
      // Thresholds reflect current test-suite reality (measured 2026-04-22):
      //   statements 10.76%  branches 68.94%  functions 31.29%  lines 10.76%
      // Set 2–3 pts below actual so CI fails only on genuine regression.
      // Raise these as unit-test backfill covers App, supabaseApiService, and components.
      thresholds: {
        lines: 8,
        branches: 65,
        functions: 28,
        statements: 8
      }
    }
  }
})
