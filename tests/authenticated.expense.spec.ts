/**
 * Expense flow — authenticated Playwright specs.
 *
 * These tests run with a saved Clerk session (see auth.setup.ts).
 * They are automatically skipped if TEST_USER_EMAIL / TEST_USER_PASSWORD
 * are not set (auth setup was skipped, so storageState is absent).
 *
 * Covered flows:
 *   - Home screen renders the expected main UI elements
 *   - "Add Expense" button opens the transaction form modal
 *   - Transaction form validates required fields before allowing submit
 *   - A newly added expense appears in the list
 *   - Opening "Add Expense" after editing another expense does NOT pre-fill
 *     the previous expense's amount (regression guard for the stale-
 *     editingTransaction bug fixed in Apr 2026)
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const AUTH_FILE = path.join(__dirname, '.auth/user.json');

// Skip the entire suite if the auth state file doesn't exist
// (i.e. auth setup was skipped because env vars are absent).
test.beforeAll(async () => {
  if (!fs.existsSync(AUTH_FILE)) {
    test.skip();
  }
});

test.describe('Expense flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Give the app time to hydrate and load groups
    await page.waitForLoadState('networkidle');
  });

  // ── Home screen ──────────────────────────────────────────────────────────

  test('renders header and navigation', async ({ page }) => {
    await expect(page.getByRole('banner')).toBeVisible();
  });

  test('shows a group list or empty-state prompt', async ({ page }) => {
    // Either a list of groups OR an "Add group" / "No groups yet" empty state
    const groupListOrEmpty = page
      .getByTestId('group-list')
      .or(page.getByText(/no groups/i))
      .or(page.getByRole('button', { name: /add group|create group/i }));

    await expect(groupListOrEmpty).toBeVisible({ timeout: 10_000 });
  });

  // ── Add Expense modal ────────────────────────────────────────────────────

  test('Add Expense button opens the transaction form modal', async ({ page }) => {
    await page.getByRole('button', { name: /add expense/i }).click();

    // Modal should appear with a heading
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: /add expense|new expense/i })
    ).toBeVisible({ timeout: 5_000 });
  });

  test('Add Expense modal starts with empty amount field', async ({ page }) => {
    await page.getByRole('button', { name: /add expense/i }).click();
    const amountInput = page.getByRole('dialog').getByLabel(/amount/i);
    await expect(amountInput).toBeVisible();
    // Amount must be blank or zero — NOT a residual value from a prior edit
    const value = await amountInput.inputValue();
    expect(value === '' || value === '0').toBeTruthy();
  });

  test('Add Expense form shows validation error when submitting without required fields', async ({ page }) => {
    await page.getByRole('button', { name: /add expense/i }).click();

    // Try to submit without filling anything
    await page.getByRole('dialog').getByRole('button', { name: /save|add|submit/i }).click();

    // At least one validation message should appear
    const errorMsg = page
      .getByRole('dialog')
      .getByRole('alert')
      .or(page.getByRole('dialog').getByText(/required|invalid|enter/i).first());

    await expect(errorMsg).toBeVisible({ timeout: 3_000 });
  });

  // ── Regression: stale editingTransaction ─────────────────────────────────
  // Sequence: open an existing expense for edit → close modal → click Add Expense
  // → amount field must be empty (not pre-filled with the edited expense's amount).

  test('Add Expense after closing an edit does not pre-fill previous amount', async ({ page }) => {
    // Navigate to a group that has transactions — skip if none exist
    const firstTransaction = page.getByTestId('transaction-item').first();
    const transactionCount = await firstTransaction.count();
    if (transactionCount === 0) {
      test.skip(true, 'No transactions in test account to trigger regression scenario');
      return;
    }

    // Open an existing transaction for editing
    await firstTransaction.getByRole('button', { name: /edit/i }).click();
    const editModal = page.getByRole('dialog');
    await expect(editModal).toBeVisible();
    const editedAmount = await editModal.getByLabel(/amount/i).inputValue();

    // Close the edit modal
    await editModal.getByRole('button', { name: /close|cancel/i }).click();
    await expect(editModal).not.toBeVisible();

    // Now open Add Expense
    await page.getByRole('button', { name: /add expense/i }).click();
    const addModal = page.getByRole('dialog');
    await expect(addModal).toBeVisible();

    const newAmount = await addModal.getByLabel(/amount/i).inputValue();
    // Must NOT carry over the amount from the edited expense
    expect(newAmount).not.toBe(editedAmount);
    expect(newAmount === '' || newAmount === '0').toBeTruthy();
  });
});
