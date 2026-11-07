import { expect, test, installApiMocks } from './fixtures.js';

test('login error is shown and parent navigation is role-limited', async ({ page }) => {
  await installApiMocks(page, 'parent', { authenticated: false });
  await page.goto('/login');
  await page.getByLabel('Email address').fill('parent@example.test');
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password');

  const parentPage = await page.context().newPage();
  await installApiMocks(parentPage, 'parent');
  await parentPage.goto('/');
  await expect(parentPage.getByRole('heading', { name: 'Hello, E2E' })).toBeVisible();
  await expect(parentPage.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Fee ledger' })).toBeVisible();
  await expect(parentPage.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Reminder centre' })).toHaveCount(0);
  await expect(parentPage.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Refund calculator' })).toHaveCount(0);
});

test('accounts dashboard renders metrics and charts at desktop and mobile widths', async ({ page }) => {
  const { releaseDashboard } = await installApiMocks(page, 'accounts', { holdDashboard: true });
  await page.goto('/');
  await expect(page.getByLabel('Loading dashboard')).toBeVisible();
  releaseDashboard();
  await expect(page.getByRole('heading', { name: 'Fee overview' })).toBeVisible();
  await expect(page.getByText('Active students', { exact: true })).toBeVisible();
  await expect(page.getByText('Risk assessed', { exact: true })).toBeVisible();
  await expect(page.getByText('Pending refunds', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AI risk distribution' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Reminder status' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test('dashboard API failure is announced accessibly', async ({ page }) => {
  await installApiMocks(page, 'accounts', { dashboardError: true });
  await page.goto('/');
  await expect(page.getByRole('alert')).toHaveText('Dashboard unavailable for this test');
});
