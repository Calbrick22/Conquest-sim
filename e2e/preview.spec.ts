import { expect, test } from '@playwright/test';
import { playActions } from './helpers';

test('odds for each target while choosing a Volley, and the Reach / Threats overlays (roadmap 2.1, 2.2)', async ({ page }) => {
  await page.goto('/#play');
  await page.getByLabel('Seed').fill('777');
  await page.getByTestId('mode').selectOption('hotseat');
  await page.getByTestId('roll-sides').click();
  await page.getByTestId('choose-p1').click();
  await page.getByTestId('start-battle').click();
  for (const p of ['P1', 'P2']) {
    await page.getByTestId(`auto-${p}-w0-r1`).click();
    await page.getByTestId(`reinforce-${p}`).click();
  }
  await page.getByTestId('stack-P1').click();
  await page.getByTestId('stack-P2').click();
  await page.getByTestId('supremacy-roll').click();
  await page.getByTestId('first-P1').click();
  await playActions(page);
  await page.getByTestId('end-round').click();

  // Round 2: the Slingers are on the table; open the Volley target picker.
  for (const p of ['P1', 'P2']) await page.getByTestId(`reinforce-${p}`).click();
  await page.getByTestId('stack-P1').click();
  await page.getByTestId('stack-P2').click();
  await page.getByTestId('supremacy-roll').click();
  await page.getByTestId('first-P1').click();
  let checked = false;
  await playActions(page, async (name) => {
    if (checked || !name.startsWith('Copper Slingers') || !(await page.getByTestId('volley').isVisible())) return false;
    await page.getByTestId('reach').click();
    await page.getByTestId('threats').click();
    await page.getByTestId('volley').click();
    const list = page.getByTestId('previews');
    await expect(list).toBeVisible();
    await expect(list).not.toContainText('Working out the odds', { timeout: 20_000 });
    await expect(list).toContainText(/Wounds|No legal target/);
    await page.getByTestId('target-card').getByRole('button', { name: 'Cancel' }).click();
    await page.getByTestId('reach').click();
    await page.getByTestId('threats').click();
    checked = true;
    await page.getByTestId('end-activation').click();
    return true;
  });
  expect(checked).toBe(true);
});
