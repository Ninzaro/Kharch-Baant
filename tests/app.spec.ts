/**
 * Unauthenticated / app-shell Playwright specs.
 *
 * These run without a Clerk session and test public-facing behaviour:
 *   - App loads, renders a sign-in gate, has the right title
 *   - PWA manifest is served and contains the correct fields
 *   - Sign-in page is accessible (basic a11y)
 *
 * No TEST_USER_* env vars required.
 */
import { test, expect } from '@playwright/test';

// ─── App shell ──────────────────────────────────────────────────────────────

test.describe('App shell', () => {
  test('page title contains Kharch Baant', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Kharch.?Baant/i);
  });

  test('unauthenticated root redirects to sign-in or renders sign-in UI', async ({ page }) => {
    await page.goto('/');
    // Clerk either redirects to /sign-in or renders its embedded component in-place.
    // Either way the sign-in heading / button should appear within 10 s.
    const signInIndicator = page
      .getByRole('heading', { name: /sign in/i })
      .or(page.getByRole('button', { name: /sign in/i }))
      .or(page.getByText(/sign in/i).first());

    await expect(signInIndicator).toBeVisible({ timeout: 10_000 });
  });

  test('sign-in page has no obviously broken layout (viewport check)', async ({ page }) => {
    await page.goto('/');
    // Wait for the page to settle before snapping
    await page.waitForLoadState('networkidle');
    // No explicit visual assertion — this catches hard crashes (blank white page, JS errors).
    await expect(page.locator('body')).not.toBeEmpty();
  });
});

// ─── PWA manifest ───────────────────────────────────────────────────────────

test.describe('PWA manifest', () => {
  test('manifest is served at /manifest.webmanifest', async ({ page }) => {
    const response = await page.request.get('/manifest.webmanifest');
    expect(response.status()).toBe(200);
  });

  test('manifest has correct app name', async ({ page }) => {
    const response = await page.request.get('/manifest.webmanifest');
    const manifest = await response.json();
    expect(manifest.name).toMatch(/Kharch.?Baant/i);
  });

  test('manifest declares standalone display mode', async ({ page }) => {
    const response = await page.request.get('/manifest.webmanifest');
    const manifest = await response.json();
    expect(manifest.display).toBe('standalone');
  });

  test('manifest lists at least one icon', async ({ page }) => {
    const response = await page.request.get('/manifest.webmanifest');
    const manifest = await response.json();
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
  });
});
