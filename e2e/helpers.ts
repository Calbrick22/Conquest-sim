import type { Page } from '@playwright/test';

let entries = 0;

/** Plays the Action Phase: every arriving Regiment marches on 3″, everything else just ends. */
export async function playActions(page: Page, special?: (name: string) => Promise<boolean>) {
  for (let i = 0; i < 30; i++) {
    if (await page.getByTestId('end-round').isVisible()) return;
    await closeCallout(page);
    await page.getByTestId('draw-card').click();
    const btn = page.getByTestId('activate-drawn').first();
    const name = (await btn.innerText()).replace(/^Activate /, '');
    await btn.click();
    if (special && (await special(name))) continue;
    if (await page.getByTestId('march-on').isVisible()) {
      await page.getByTestId('march-on').click();
      entries += 1;
      await page.getByLabel('Along').fill(String(8 + ((entries * 13) % 56)));
      // One wide rank, so the whole Regiment is on the table after a single 3″ March.
      const files = page.getByLabel('Files');
      const last = await files.locator('option').last().getAttribute('value');
      await files.selectOption(last!);
      await page.getByTestId('move-text').fill('forward 3');
      await page.getByRole('button', { name: 'Set' }).click();
      await page.getByTestId('commit-move').click();
    }
    await page.getByTestId('end-activation').click();
  }
}


/** Closes a finished on-table action callout and any unit card, if showing. */
export async function closeCallout(page: Page) {
  for (const id of ['action-callout', 'unit-callout']) {
    const c = page.getByTestId(id).getByRole('button', { name: 'Close' });
    if (await c.isVisible().catch(() => false)) await c.click();
  }
}
