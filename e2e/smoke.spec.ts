import { expect, test } from '@playwright/test';

test('the title screen loads with its menu and focuses the first choice', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Conquest Sim' })).toBeVisible();
  await expect(page.getByTestId('new-battle')).toBeVisible();
  // game-ui-ux: a control is focused when a screen opens.
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Text size');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings')).toBeHidden();
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
