import { expect, test } from '@playwright/test';

test('a full Round: reinforcements, stacks, supremacy, draw, march on, end round', async ({ page }) => {
  await page.goto('/#play');
  await page.getByTestId('roll-sides').click();
  await page.getByTestId('choose-p1').click();
  await page.getByTestId('start-battle').click();

  // Reinforcement Phase: each side picks its Light Copper Slingers to arrive automatically.
  for (const p of ['P1', 'P2']) {
    await page.getByTestId(`reinforce-choice-${p}`).selectOption({ label: 'Copper Slingers (Light) arrives' });
    await page.getByTestId(`reinforce-${p}`).click();
  }
  await page.getByTestId('stack-P1').click();
  await page.getByTestId('stack-P2').click();
  await page.getByTestId('supremacy-roll').click();
  await page.getByTestId('first-P1').click();

  // Alternate draws until the Round is over; anything arriving marches on 3″ from its own edge.
  for (let i = 0; i < 20; i++) {
    if (await page.getByTestId('end-round').isVisible()) break;
    await page.getByTestId('draw-card').click();
    await page.getByTestId('activate-drawn').first().click();
    if (await page.getByTestId('march-on').isVisible()) {
      await page.getByTestId('march-on').click();
      await page.getByTestId('move-text').fill('forward 3');
      await page.getByRole('button', { name: 'Set' }).click();
      await page.getByTestId('commit-move').click();
    }
    await page.getByTestId('end-activation').click();
  }
  await expect(page.getByTestId('log')).toContainText('marches on');
  await page.getByTestId('end-round').click();
  await expect(page.getByTestId('log')).toContainText('Round 2 begins');

  // Undo goes back a step.
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('log')).not.toContainText('Round 2 begins');
});
