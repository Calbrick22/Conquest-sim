import { expect, test } from '@playwright/test';

test('choosing the computer difficulty at setup: shown in the HUD and kept for the next game', async ({ page }) => {
  await page.goto('/#play');
  await expect(page.getByTestId('difficulty')).toBeVisible();
  await page.getByTestId('difficulty-expert').check();
  await page.getByLabel('Seed').fill('31');
  await page.getByTestId('terrain').selectOption('none');
  await page.getByTestId('roll-sides').click();
  await page.getByTestId('choose-p1').click();
  await page.getByTestId('start-battle').click();
  await expect(page.getByTestId('hud-difficulty')).toHaveText('Computer · Expert');
  // The choice is remembered on this device for the next game.
  await page.goto('/#home');
  await page.goto('/#play');
  await expect(page.getByTestId('difficulty-expert')).toBeChecked();
  // Hotseat games have no computer, so no difficulty.
  await page.getByTestId('mode').selectOption('hotseat');
  await expect(page.getByTestId('difficulty')).toBeHidden();
});
