import { expect, test } from '@playwright/test';
import { playActions } from './helpers';

test('a full Round: reinforcements, stacks, supremacy, draw, march on, end round', async ({ page }) => {
  await page.goto('/#play');
  await page.getByLabel('Seed').fill('777');
  await page.getByTestId('mode').selectOption('hotseat');
  await page.getByTestId('roll-sides').click();
  await page.getByTestId('choose-p1').click();
  await page.getByTestId('start-battle').click();

  // Reinforcement Phase: each side picks its Light Copper Slingers to arrive automatically.
  for (const p of ['P1', 'P2']) {
    await page.getByTestId(`auto-${p}-w0-r1`).click();
    await page.getByTestId(`reinforce-${p}`).click();
  }
  await page.getByTestId('stack-P1').click();
  await page.getByTestId('stack-P2').click();
  await page.getByTestId('supremacy-roll').click();
  await page.getByTestId('first-P1').click();

  await playActions(page);
  await expect(page.getByTestId('log')).toContainText('marches on');
  await page.getByTestId('end-round').click();
  await expect(page.getByTestId('log')).toContainText('Round 2 begins');

  // Undo goes back a step.
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('log')).not.toContainText('Round 2 begins');
});
