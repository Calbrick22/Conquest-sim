import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const fx = (n: string) => path.join(import.meta.dirname, '../src/import/__fixtures__', n);

async function importList(page: Page, file: string) {
  await page.goto('/#lists');
  await page.getByTestId('list-file').setInputFiles(fx(file));
  await expect(page.getByTestId('list-review')).toBeVisible();
  await page.getByTestId('save-list').click();
}

test('Sorcerer Kings: the Court picker, then choosing a Ritual in the Supremacy Phase starts it with Elemental Discharge (sk p.5)', async ({ page }) => {
  await page.goto('/#lists');
  await page.getByTestId('list-file').setInputFiles(fx('synthetic-sk-list.txt'));
  // The Characters' Court is read from the list and shown on the review screen.
  await expect(page.getByTestId('court-Sorcerer').getByLabel('Fire')).toBeChecked();
  await page.getByTestId('save-list').click();
  await importList(page, 'synthetic-list-2.txt');

  await page.goto('/#play');
  await page.getByTestId('my-list').selectOption({ label: 'Ember Court (Sorcerer Kings)' });
  await page.getByTestId('their-list').selectOption({ label: 'Redfield (The Redfield Union)' });
  await page.getByTestId('game-scenario').selectOption('forlorn-hope');
  await page.getByLabel('Seed').fill('2468');
  await page.getByTestId('mode').selectOption('hotseat');
  await page.getByTestId('terrain').selectOption('none');
  await page.getByTestId('roll-sides').click();
  await page.getByTestId('choose-p1').click();
  await page.getByTestId('start-battle').click();

  await page.getByTestId('reinforce-P1').click();
  await page.getByTestId('reinforce-P2').click();
  await page.getByTestId('stack-P1').click();
  await page.getByTestId('stack-P2').click();
  const bar = page.getByTestId('ritual-bar');
  await expect(bar).toContainText('No Ritual Being Prepared');
  await page.getByTestId('ritual-choose-P1').selectOption('Intrusive Thoughts');
  await expect(bar).toContainText('Will Prepare Intrusive Thoughts');
  await page.getByTestId('supremacy-roll').click();
  const first = page.getByTestId('first-P1');
  await first.click();
  // Round 1: Elemental Discharge adds 1 Ritual Marker (sk p.5).
  await expect(bar).toContainText('Intrusive Thoughts');
  await expect(bar).toContainText('1/7');
});
