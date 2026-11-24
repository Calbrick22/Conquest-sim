import { expect, test } from '@playwright/test';

// M1 smoke test: the app loads, the engine rolls dice, and the PWA manifest is served.
// Milestone 5 replaces this with the full import → scenario → move → score flow.
test('app loads and rolls dice', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Conquest Sim' })).toBeVisible();
  await page.getByTestId('roll').click();
  await expect(page.getByTestId('dice').locator('.die')).toHaveCount(6);
});

test('serves a web app manifest', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const res = await request.get(href!);
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.display).toBe('standalone');
});
