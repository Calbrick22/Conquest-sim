import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { playActions } from './helpers';

const fx = (n: string) => path.join(import.meta.dirname, '../src/import/__fixtures__', n);

async function importList(page: Page, file: string) {
  await page.goto('/#lists');
  await page.getByTestId('list-file').setInputFiles(fx(file));
  await expect(page.getByTestId('list-review')).toContainText('Everything was read cleanly');
  await page.getByTestId('save-list').click();
}

test('import two lists, play Forlorn Hope, move a Regiment onto a zone, end the Round and check the score', async ({ page }) => {
  await importList(page, 'synthetic-list.txt');
  await importList(page, 'synthetic-list-2.txt');

  await page.goto('/#play');
  await page.getByTestId('my-list').selectOption({ label: 'Testland (The Testland Compact)' });
  await page.getByTestId('their-list').selectOption({ label: 'Redfield (The Redfield Union)' });
  await page.getByTestId('game-scenario').selectOption('forlorn-hope');
  await page.getByLabel('Seed').fill('12345');
  await page.getByTestId('mode').selectOption('hotseat');
  await page.getByTestId('roll-sides').click();
  await page.getByTestId('choose-p1').click();
  await page.getByTestId('start-battle').click();

  // Round 1: roll for everything.
  await page.getByTestId('reinforce-P1').click();
  await page.getByTestId('reinforce-P2').click();
  await page.getByTestId('stack-P1').click();
  await page.getByTestId('stack-P2').click();
  await page.getByTestId('supremacy-roll').click();
  await page.getByTestId('first-P1').click();
  await playActions(page);
  await page.getByTestId('end-round').click();
  await expect(page.getByTestId('score')).toHaveText('P1 0 – 0 P2');

  // Round 2: the Medium Glass Pikes arrive automatically and march on.
  await page.getByTestId('reinforce-choice-P1').selectOption({ label: 'Glass Pikes (Medium) arrives' });
  await page.getByTestId('reinforce-P1').click();
  await page.getByTestId('reinforce-P2').click();
  await page.getByTestId('stack-P1').click();
  await page.getByTestId('stack-P2').click();
  await page.getByTestId('supremacy-roll').click();
  await page.getByTestId('first-P1').click();
  await playActions(page);

  // Move the Pikes by hand into the 9″ zone at (24, 18) (logged as an override).
  await page.getByTestId('regiment-P1-w0-r0').click();
  await page.getByTestId('manual-tools').locator('summary').click();
  await page.getByRole('button', { name: 'Move by hand' }).click();
  const reg = page.getByTestId('regiment-P1-w0-r0');
  const box = (await reg.boundingBox())!;
  const target = await page.getByTestId('table').evaluate((svg: SVGSVGElement) => {
    const pt = svg.createSVGPoint();
    pt.x = 24;
    pt.y = 48 - 18;
    const q = pt.matrixTransform(svg.getScreenCTM()!);
    return { x: q.x, y: q.y };
  });
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + ((target.x - from.x) * i) / 12, from.y + ((target.y - from.y) * i) / 12);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Place here' }).click();

  await expect(page.getByTestId('phase-panel')).toContainText(/Zone sw9 9″: P1/);
  await page.getByTestId('end-round').click();
  await expect(page.getByTestId('score')).toHaveText('P1 2 – 0 P2');
  await expect(page.getByTestId('scoreboard')).toBeVisible();
  await expect(page.getByTestId('log')).toContainText('P1 scores 2 VP in Round 2');

  // The game was saved: it can be resumed from the setup screen.
  await page.getByRole('button', { name: 'Quit' }).click();
  await page.getByTestId('resume-game').first().click();
  await expect(page.getByTestId('score')).toHaveText('P1 2 – 0 P2');
});
