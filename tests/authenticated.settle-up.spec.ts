/**
 * Settle-up flow — authenticated Playwright specs.
 *
 * Requires TEST_USER_EMAIL + TEST_USER_PASSWORD and a group with 2+ members.
 */
import { test, expect } from '@playwright/test';
import { openFirstGroup } from './helpers/group';

test.describe('Settle-up flow', () => {
  test.beforeEach(async ({ page }) => {
    await openFirstGroup(page);
  });

  test('Settle Up button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /settle.?up/i })).toBeVisible();
  });

  test('Settle Up opens the modal', async ({ page }) => {
    await page.getByRole('button', { name: /settle.?up/i }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 8_000 });
    await expect(modal.getByRole('heading', { name: /settle.?up/i })).toBeVisible();
  });

  test('modal has payer and receiver selects', async ({ page }) => {
    await page.getByRole('button', { name: /settle.?up/i }).click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByLabel(/^payer$/i)).toBeVisible({ timeout: 5_000 });
    await expect(modal.getByLabel(/^receiver$/i)).toBeVisible({ timeout: 5_000 });
  });

  test('submit is disabled when payer equals receiver', async ({ page }) => {
    await page.getByRole('button', { name: /settle.?up/i }).click();
    const modal = page.getByRole('dialog');
    const payerSelect = modal.getByLabel(/^payer$/i);
    const receiverSelect = modal.getByLabel(/^receiver$/i);

    await payerSelect.waitFor();
    const options = payerSelect.locator('option:not([disabled])');
    const firstValue = await options.nth(0).getAttribute('value');
    if (!firstValue) {
      test.skip(true, 'No members to select');
      return;
    }
    await payerSelect.selectOption(firstValue);
    await receiverSelect.selectOption(firstValue);

    await expect(modal.getByText(/cannot be the same person/i)).toBeVisible();
    await expect(modal.getByRole('button', { name: /record settlement/i })).toBeDisabled();
  });

  test('submit is disabled when amount is blank or zero', async ({ page }) => {
    await page.getByRole('button', { name: /settle.?up/i }).click();
    const modal = page.getByRole('dialog');
    const amountInput = modal.getByLabel(/settlement amount/i);
    await amountInput.fill('0');
    await expect(modal.getByRole('button', { name: /record settlement/i })).toBeDisabled();
  });

  test('modal can be closed without submitting', async ({ page }) => {
    await page.getByRole('button', { name: /settle.?up/i }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: /cancel/i }).click();
    await expect(modal).not.toBeVisible({ timeout: 3_000 });
  });
});
