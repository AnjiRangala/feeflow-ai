import { expect, openAs, test } from './fixtures.js';

test('accounts can navigate reminders, calculate a refund, and review a risk task', async ({ page }) => {
  await openAs(page, 'accounts');
  await page.getByRole('link', { name: 'Reminder centre' }).click();
  await expect(page.getByRole('heading', { name: 'Reminder centre' })).toBeVisible();
  await expect(page.locator('details')).toHaveJSProperty('open', false);
  await page.getByText('Preview message', { exact: true }).click();
  await expect(page.getByText('A mock reminder for the E2E student.')).toBeVisible();

  await page.getByRole('link', { name: 'Refund calculator' }).click();
  await expect(page.getByRole('heading', { name: 'Refund calculator' })).toBeVisible();
  await page.getByLabel('Course start date').fill('2026-09-01');
  await page.getByLabel('Withdrawal date').fill('2026-10-01');
  await page.getByRole('button', { name: 'Generate calculation report' }).click();
  await expect(page.getByText('Calculation report saved for accounts review. No refund has been issued.')).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Refund calculation approved. Disbursement was not initiated.')).toBeVisible();

  await page.getByRole('link', { name: 'AI Risk Monitor' }).click();
  await expect(page.getByRole('heading', { name: 'AI Risk Monitor' })).toBeVisible();
  await page.getByRole('button', { name: 'Assess student' }).click();
  await expect(page.getByText('Assessment saved as a counsellor follow-up task. No fee or reminder records were changed.')).toBeVisible();
});

test('counsellor can review a follow-up task but cannot access financial navigation', async ({ page }) => {
  await openAs(page, 'counsellor', '/ai-risk');
  await expect(page.getByRole('heading', { name: 'AI Risk Monitor' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'E2E Student' })).toBeVisible();
  await page.getByRole('button', { name: 'Mark valid' }).click();
  await expect(page.getByText('Counsellor feedback saved: valid flag.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Fee ledger' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Refund calculator' })).toHaveCount(0);
});
