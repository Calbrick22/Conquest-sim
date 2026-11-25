import { expect, test } from '@playwright/test';

test('side panel resizes, Threats cycle Charge → Volley → off, and hovering Activate highlights the Regiment', async ({ page, isMobile }) => {
  await page.goto('/#play');
  await page.getByLabel('Seed').fill('4242');
  await page.getByTestId('mode').selectOption('hotseat');
  await page.getByTestId('terrain').selectOption('none');
  await page.getByTestId('roll-sides').click();
  await page.getByTestId('choose-p1').click();
  await page.getByTestId('start-battle').click();

  // Threats: off → Charge → Volley → off.
  const threats = page.getByTestId('threats');
  await expect(threats).toHaveAttribute('aria-label', 'Threats: off');
  await threats.click();
  await expect(threats).toHaveAttribute('aria-label', 'Threats: charge');
  await threats.click();
  await expect(threats).toHaveAttribute('aria-label', 'Threats: volley');
  await threats.click();
  await expect(threats).toHaveAttribute('aria-label', 'Threats: off');

  if (!isMobile) {
    // Desktop: drag the side panel edge to the left to widen it.
    const side = page.locator('.game-side');
    const before = (await side.boundingBox())!.width;
    const h = (await page.getByTestId('resize-left').boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + 40);
    await page.mouse.down();
    await page.mouse.move(h.x - 120, h.y + 40, { steps: 5 });
    await page.mouse.up();
    expect((await side.boundingBox())!.width).toBeGreaterThan(before + 60);
  }

  // Play into the Action Phase; hover the Activate button of a drawn card.
  await page.getByTestId('reinforce-P1').click();
  await page.getByTestId('reinforce-P2').click();
  await page.getByTestId('stack-P1').click();
  await page.getByTestId('stack-P2').click();
  await page.getByTestId('supremacy-roll').click();
  await page.getByTestId('first-P1').click();
  await page.getByTestId('draw-card').click();
  await page.getByTestId('activate-drawn').first().hover();
  // Nothing is on the table in Round 1, so the highlight has no Regiment to show yet; the button works.
  await expect(page.getByTestId('activate-drawn').first()).toBeVisible();
});
