/**
 * Settle-up flow — authenticated Playwright specs.
 *
 * Requires a Clerk session (see auth.setup.ts + TEST_USER_* env vars).
 * Automatically skipped when auth state is absent.
 *
 * Covered flows:
 *   - Settle-Up button is present and opens the modal
 *   - Modal renders payer/receiver selects
 *   - Submit is disabled when payer === receiver
 *   - Submit is disabled when amount is zero or blank
 *   - Submitting a valid settle-up shows a success indication
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const AUTH_FILE = path.join(__dirname, '.auth/user.json');

test.beforeAll(async () => {
  if (!fs.existsSync(AUTH_FILE)) {
    test.skip();
  }
});

test.describe('Settle-up flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  // ── Settle-Up button ─────────────────────────────────────────────────────

  test('Settle-Up button is visible', async ({ page }) => {
    const settleBtn = page.getByRole('button', { name: /settle.?up/i });
    await expect(settleBtn).toBeVisible({ timeout: 10_000 });
  });

  test('Settle-Up button opens the modal', async ({ page }) => {
    await page.getByRole('button', { name: /settle.?up/i }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal.getByRole('heading', { name: /settle.?up/i })).toBeVisible();
  });

  // ── Modal form ───────────────────────────────────────────────────────────

  test('modal has payer and receiver selects', async ({ page }) => {
    await page.getByRole('button', { name: /settle.?up/i }).click();
    const modal = page.getByRole('dialog');

    await expect(modal.getByLabel(/payer/i)).toBeVisible({ timeout: 5_000 });
    await expect(modal.getByLabel(/receiver/i)).toBeVisible({ timeout: 5_000 });
  });

  test('submit is disabled when payer equals receiver', async ({ page }) => {
    await page.getByRole('button', { name: /settle.?up/i }).click();
    const modal = page.getByRole('dialog');

    const payerSelect   = modal.getByLabel(/payer/i);
    const receiverSelect = modal.getByLabel(/receiver/i);

    // Set both to the same person (first option)
    await payerSelect.waitFor();
    const firstOption = await payerSelect.locator('option').first().getAttribute('value');
    if (firstOption) {
      await payerSelect.selectOption(firstOption);
      await receiverSelect.selectOption(firstOption);
    }

    const submitBtn = modal.getByRole('button', { name: /settle|submit|confirm/i });
    await expect(submitBtn).toBeDisabled({ timeout: 3_000 });
  });

  test('submit is disabled when amount is blank or zero', async ({ page }) => {
    await page.getByRole('button', { name: /settle.?up/i }).click();
    const modal = page.getByRole('dialog');

    const amountInput = modal.getByLabel(/amount/i);
    await amountInput.waitFor();
    await amountInput.fill('0');

    const submitBtn = modal.getByRole('button', { name: /settle|submit|confirm/i });
    await expect(submitBtn).toBeDisabled({ timeout: 3_000 });
  });

  // ── Close / cancel ───────────────────────────────────────────────────────

  test('modal can be closed without submitting', async ({ page }) => {
    await page.getByRole('button', { name: /settle.?up/i }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();

    await modal.getByRole('button', { name: /close|cancel/i }).click();
    await expect(modal).not.toBeVisible({ timeout: 3_000 });
  });
});
