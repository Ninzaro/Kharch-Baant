/**
 * Expense flow — authenticated Playwright specs.
 *
 * Requires TEST_USER_EMAIL + TEST_USER_PASSWORD (see .env.test.example)
 * and at least one group on that account.
 */
import { test, expect } from '@playwright/test';
import { openFirstGroup } from './helpers/group';

test.describe('Expense flow', () => {
  test.beforeEach(async ({ page }) => {
    await openFirstGroup(page);
  });

  test('group screen shows Add Expense', async ({ page }) => {
    await expect(page.getByRole('button', { name: /add expense/i })).toBeVisible();
  });

  test('Add Expense opens the form', async ({ page }) => {
    await page.getByRole('button', { name: /add expense/i }).click();
    await expect(page.getByRole('heading', { name: /add expense/i })).toBeVisible({ timeout: 8_000 });
  });

  test('Add Expense amount starts empty or zero', async ({ page }) => {
    await page.getByRole('button', { name: /add expense/i }).click();
    const amountInput = page.getByLabel(/^amount$/i);
    await expect(amountInput).toBeVisible();
    const value = await amountInput.inputValue();
    expect(value === '' || value === '0').toBeTruthy();
  });

  test('Save stays disabled until amount and description are set', async ({ page }) => {
    await page.getByRole('button', { name: /add expense/i }).click();
    await expect(page.getByRole('heading', { name: /add expense/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  test('Add Expense after closing an edit does not pre-fill previous amount', async ({ page }) => {
    const editBtn = page.getByRole('button', { name: /^edit$/i }).first();
    if ((await editBtn.count()) === 0) {
      test.skip(true, 'No existing expense to edit');
      return;
    }

    await editBtn.click();
    await expect(page.getByRole('heading', { name: /edit expense/i })).toBeVisible();
    const amountInput = page.getByLabel(/^amount$/i);
    const editedAmount = await amountInput.inputValue();

    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByRole('heading', { name: /edit expense/i })).toHaveCount(0);

    await page.getByRole('button', { name: /add expense/i }).click();
    await expect(page.getByRole('heading', { name: /add expense/i })).toBeVisible();
    const newAmount = await page.getByLabel(/^amount$/i).inputValue();
    expect(newAmount).not.toBe(editedAmount);
    expect(newAmount === '' || newAmount === '0').toBeTruthy();
  });
});
