import path from 'node:path';
import { expect, test } from '@playwright/test';

const fixture = path.join(import.meta.dirname, '../src/import/__fixtures__/synthetic-list.txt');

test('import a list file, review it, save it, and see it listed', async ({ page }) => {
  await page.goto('/#lists');
  await page.getByTestId('list-file').setInputFiles(fixture);
  const review = page.getByTestId('list-review');
  await expect(review).toBeVisible();
  await expect(review).toContainText('Everything was read cleanly');
  await expect(review).toContainText('Glass Pikes');
  await page.getByTestId('save-list').click();
  await expect(page.getByText('Testland', { exact: true })).toBeVisible();
});

test('scenario preview draws Forlorn Hope', async ({ page }) => {
  await page.goto('/#scenarios');
  await page.getByTestId('scenario-select').selectOption('forlorn-hope');
  await expect(page.locator('svg.map circle.zone')).toHaveCount(4);
  await expect(page.locator('svg.map rect.marker')).toHaveCount(2);
  await expect(page.locator('svg.map line.noreinf')).toHaveCount(2);
});
