/**
 * Clerk auth setup for Playwright authenticated tests.
 *
 * Runs before any spec that lives in a file matching "authenticated".
 * Logs in once and saves the Clerk session cookies to tests/.auth/user.json
 * so subsequent test projects can reuse the session without re-authenticating.
 *
 * Required environment variables (set in .env.test or CI secrets):
 *   TEST_USER_EMAIL     – email address of a Clerk test account
 *   TEST_USER_PASSWORD  – password of that account
 *
 * If either variable is absent the setup is skipped (all authenticated
 * tests will then also be skipped via the storageState fixture).
 */
import { test as setup, expect } from '@playwright/test';
import path from 'path';

const AUTH_FILE = path.join(__dirname, '.auth/user.json');

setup('authenticate', async ({ page }) => {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;

  if (!email || !password) {
    // Skip gracefully — authenticated specs will show as "skipped" rather
    // than failing with a confusing error.
    setup.skip(true, 'TEST_USER_EMAIL / TEST_USER_PASSWORD not set — skipping auth setup');
    return;
  }

  await page.goto('/');

  // Wait for Clerk's sign-in form to be visible
  await page.getByLabel(/email/i).waitFor({ timeout: 15_000 });
  await page.getByLabel(/email/i).fill(email);
  await page.getByRole('button', { name: /continue/i }).click();

  // Password field appears on the next step
  await page.getByLabel(/password/i).waitFor({ timeout: 10_000 });
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|continue/i }).click();

  // Wait until we land on the authenticated app shell
  await expect(page.getByRole('heading', { name: /kharch.?baant|home|groups/i }))
    .toBeVisible({ timeout: 20_000 });

  // Persist cookies + localStorage for reuse
  await page.context().storageState({ path: AUTH_FILE });
});
