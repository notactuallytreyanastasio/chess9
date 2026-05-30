import { test, expect } from '@playwright/test';
import { TEMPER, cell, pieceAt, waitForHumanTurn, trackPageErrors, move } from './helpers';

test('Temper-backed game restarts to the initial position via the reset button', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto(TEMPER);

  // Initial render: full set of pieces and the human to move.
  await expect(page.locator('.piece')).toHaveCount(288);
  await expect(page.locator('.turn')).toContainText('Your move');

  // Make a human move and let the bot reply.
  await move(page, [4, 6], [4, 4]);
  await expect(pieceAt(page, 4, 4)).toBeVisible();
  await waitForHumanTurn(page);
  await expect(page.locator('.sq.bot-to')).toBeVisible();

  // Restart the game.
  await page.locator('.reset').click();

  // Back to the initial position: full piece count, no leftover board state.
  await expect(page.locator('.piece')).toHaveCount(288);
  await expect(page.locator('.sq.selected')).toHaveCount(0);
  await expect(page.locator('.sq.bot-to')).toHaveCount(0);
  await expect(page.locator('.sq.lastmove')).toHaveCount(0);

  // Turn and scoreboard reset.
  await expect(page.locator('.turn')).toContainText('Your move');
  await expect(page.locator('.score-white')).toHaveText('You 0');
  await expect(page.locator('.score-black')).toHaveText('Bot 0');

  // The White pawn is back on its start square.
  await expect(pieceAt(page, 4, 6)).toBeVisible();

  expect(errors).toEqual([]);
});
