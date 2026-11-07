import { expect, openAs, test } from './fixtures.js';

test('parent creates an order, handles failure, settles mock payment, and sees receipt', async ({ page }) => {
  await openAs(page, 'parent');
  await page.getByRole('link', { name: /Pay now/ }).click();
  await expect(page.getByRole('heading', { name: 'Instalment 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(page.getByRole('heading', { name: 'Mock payment checkout' })).toBeVisible();
  await page.getByRole('button', { name: 'Simulate failure' }).click();
  await expect(page.getByRole('status')).toContainText('No payment was recorded');
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await page.getByRole('button', { name: 'Simulate success' }).click();
  await expect(page.getByRole('heading', { name: 'Payment successful' })).toBeVisible();
  await expect(page.getByText('₹800.00').first()).toBeVisible();
  await page.getByRole('link', { name: 'Download receipt' }).click();
});
