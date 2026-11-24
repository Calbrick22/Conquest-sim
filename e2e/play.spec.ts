import { expect, test } from '@playwright/test';

test('set up a demo game, march a Regiment on, move it, and end the Round', async ({ page }) => {
  await page.goto('/#play');
  await page.getByTestId('roll-sides').click();
  await expect(page.getByTestId('rolloff-result')).toBeVisible();
  await page.getByTestId('choose-p1').click();
  await page.getByTestId('start-battle').click();

  await page.getByTestId('arrive-P1-w0-r0').check();
  await page.getByRole('button', { name: 'P1 Glass Pikes' }).click();
  await page.getByTestId('activate').click();
  await page.getByTestId('march-on').click();
  await page.getByTestId('move-text').fill('forward 4');
  await page.getByRole('button', { name: 'Set' }).click();
  await page.getByTestId('commit-move').click();
  await expect(page.getByTestId('regiment-P1-w0-r0')).toBeVisible();

  // Over-long move is refused with a page reference.
  await page.getByTestId('march').click();
  await page.getByTestId('move-text').fill('forward 9');
  await page.getByRole('button', { name: 'Set' }).click();
  await expect(page.getByText(/exceeds March .* \(core p\.28\)/)).toBeVisible();
  await expect(page.getByTestId('commit-move')).toBeDisabled();
  await page.getByTestId('move-text').fill('forward 2');
  await page.getByRole('button', { name: 'Set' }).click();
  await page.getByTestId('commit-move').click();

  await page.getByTestId('end-activation').click();
  await page.getByTestId('end-round').click();
  await expect(page.getByTestId('log')).toContainText('Round 2 begins.');

  // Undo goes back a step.
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('log')).not.toContainText('Round 2 begins.');
});
