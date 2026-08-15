import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.test'), override: true });

const hasAuthCreds = Boolean(process.env.TEST_USER_EMAIL && process.env.TEST_USER_PASSWORD);

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL for all page.goto() calls without an explicit origin. */
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',

    /* Screenshot on failure to ease debugging. */
    screenshot: 'only-on-failure',

    /* Collect trace when retrying the failed test. */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    // ─── Auth setup ──────────────────────────────────────────────────────────
    // Runs once before any authenticated test projects.
    // Writes Clerk session cookies to tests/.auth/user.json.
    // Skipped automatically when TEST_USER_EMAIL / TEST_USER_PASSWORD are absent.
    ...(hasAuthCreds
      ? [
          {
            name: 'auth setup',
            testMatch: /auth\.setup\.ts/,
          },
        ]
      : []),

    // ─── Unauthenticated tests ─────────────────────────────────────────────
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /authenticated|auth\.setup/,
    },

    ...(hasAuthCreds
      ? [
          {
            name: 'chromium-auth',
            use: {
              ...devices['Desktop Chrome'],
              storageState: 'tests/.auth/user.json',
            },
            testMatch: /authenticated/,
            dependencies: ['auth setup'],
          },
        ]
      : []),

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Spin up the dev server automatically when running locally or in CI.
     Set PLAYWRIGHT_BASE_URL to override (e.g. point at a preview deployment). */
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
