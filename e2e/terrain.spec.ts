import { expect, test } from '@playwright/test';

test('terrain: a 2026 scenario uses its own layout; random layouts can be rerolled and are drawn on the table', async ({ page }) => {
  await page.goto('/#play');
  await page.getByTestId('game-scenario').selectOption('wheel-of-war');
  const preview = page.getByTestId('terrain-preview');
  await expect(preview).toContainText('Wheel of War layout: 7 pieces');
  await page.getByTestId('terrain').selectOption('random');
  await expect(preview).toContainText(/Random \(seed \d+\): [67] pieces/);
  const before = await preview.innerText();
  await page.getByTestId('reroll-terrain').click();
  await expect(preview).not.toHaveText(before);
  await page.getByTestId('terrain').selectOption('scenario');
  await page.getByTestId('mode').selectOption('hotseat');
  await page.getByTestId('roll-sides').click();
  await page.getByTestId('choose-p1').click();
  await expect(page.getByTestId('terrain-c0')).toBeVisible();
  await expect(page.locator('[data-testid^="terrain-t"]')).toHaveCount(6);
});
