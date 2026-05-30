import { test, expect } from '@playwright/test';
import { TEMPER, cell, pieceAt, waitForHumanTurn, trackPageErrors } from './helpers';

test('Temper-backed game loads, renders the 9 boards, and plays a move with a bot reply', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto(TEMPER);

  // The Temper engine drove the initial render.
  await expect(page.locator('.board-group')).toHaveCount(9);
  await expect(page.locator('.sq')).toHaveCount(576);
  await expect(page.locator('.piece')).toHaveCount(288);
  await expect(page.locator('.turn')).toContainText('Your move');

  // Select a white pawn (board 0, e2 = 4,6) and confirm its legal targets light up.
  await page.locator(cell(4, 6)).click();
  await expect(page.locator(cell(4, 6))).toHaveClass(/selected/);
  await expect(page.locator(cell(4, 5))).toHaveClass(/move-target/);
  await expect(page.locator(cell(4, 4))).toHaveClass(/move-target/);

  // Push it two squares; the piece moves and the source empties.
  await page.locator(cell(4, 4)).click();
  await expect(pieceAt(page, 4, 4)).toBeVisible();
  await expect(pieceAt(page, 4, 6)).toHaveCount(0);

  // The bot (Black) replies on a timer and hands the turn back, with its move ringed.
  await waitForHumanTurn(page);
  await expect(page.locator('.sq.bot-to')).toBeVisible();

  expect(errors).toEqual([]);
});
