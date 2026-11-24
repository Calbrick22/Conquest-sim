import { expect, test } from '@playwright/test';

test('play against the computer: it takes its own decisions and explains them', async ({ page }) => {
  await page.goto('/#play');
  await expect(page.getByTestId('mode')).toHaveValue('ai');
  await page.getByLabel('Seed').fill('4242');
  await page.getByTestId('roll-sides').click();
  await page.getByTestId('choose-p1').click();
  await page.getByTestId('start-battle').click();

  // Our Reinforcements; the computer (P2) does its own.
  await page.getByTestId('reinforce-P1').click();
  await expect(page.getByTestId('log')).toContainText('AI: ', { timeout: 15_000 });
  await page.getByTestId('stack-P1').click();
  await page.getByTestId('supremacy-roll').click();
  // Whoever won chooses; if it was us, go first.
  const first = page.getByTestId('first-P1');
  if (await first.isVisible().catch(() => false)) await first.click();

  // Play our activations (march on 3″, else end) until the Round can be ended; the computer plays its own.
  for (let i = 0; i < 40; i++) {
    if (await page.getByTestId('end-round').isVisible()) break;
    if (await page.getByTestId('draw-card').isVisible()) {
      await page.getByTestId('draw-card').click();
      await page.getByTestId('activate-drawn').first().click();
      if (await page.getByTestId('march-on').isVisible()) {
        await page.getByTestId('march-on').click();
        const files = page.getByLabel('Files');
        await files.selectOption((await files.locator('option').last().getAttribute('value'))!);
        await page.getByLabel('Along').fill(String(10 + i * 9));
        await page.getByTestId('move-text').fill('forward 3');
        await page.getByRole('button', { name: 'Set' }).click();
        await page.getByTestId('commit-move').click();
      }
      await page.getByTestId('end-activation').click();
    } else await page.waitForTimeout(400);
  }
  await page.getByTestId('end-round').click();
  await expect(page.getByTestId('log')).toContainText('Round 2 begins');
  await expect(page.getByTestId('log')).toContainText(/AI: .*(marches on|activates|draws)/);
});
