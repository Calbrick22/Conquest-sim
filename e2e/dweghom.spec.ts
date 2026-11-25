import path from 'node:path';
import { expect, test } from '@playwright/test';

const fx = (n: string) => path.join(import.meta.dirname, '../src/import/__fixtures__', n);

test('Dweghom: the Elemental Power pool shows its Creed and Markers in battle (dw p.4)', async ({ page }) => {
  for (const f of ['synthetic-dw-list.txt', 'synthetic-list-2.txt']) {
    await page.goto('/#lists');
    await page.getByTestId('list-file').setInputFiles(fx(f));
    await expect(page.getByTestId('list-review')).toBeVisible();
    await page.getByTestId('save-list').click();
  }
  await page.goto('/#play');
  await page.getByTestId('my-list').selectOption({ label: 'Anvil Hold (Dweghom)' });
  await page.getByTestId('their-list').selectOption({ label: 'Redfield (The Redfield Union)' });
  await page.getByLabel('Seed').fill('97');
  await page.getByTestId('mode').selectOption('hotseat');
  await page.getByTestId('terrain').selectOption('none');
  await page.getByTestId('roll-sides').click();
  await page.getByTestId('choose-p1').click();
  await page.getByTestId('start-battle').click();
  const bar = page.getByTestId('dw-bar');
  await expect(bar).toContainText('Tempered Creed');
  await expect(bar).toContainText('0/10');
});
