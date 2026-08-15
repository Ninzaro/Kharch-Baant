import { expect, type Page } from '@playwright/test';

/** Land on dashboard, then open the first group so Add Expense / Settle Up exist. */
export async function openFirstGroup(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible({ timeout: 25_000 });

  const empty = page.getByText(/no groups yet/i);
  if (await empty.isVisible().catch(() => false)) {
    throw new Error('Test account has no groups. Create one group (with 2+ members) then re-run.');
  }

  await page.locator('main').getByRole('button').filter({ has: page.getByRole('heading', { level: 3 }) }).first().click();
  await expect(page.getByRole('button', { name: /add expense/i })).toBeVisible({ timeout: 15_000 });
}
