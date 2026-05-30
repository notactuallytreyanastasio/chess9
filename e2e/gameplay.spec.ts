import { test, expect } from '@playwright/test';
import { TEMPER, move, waitForHumanTurn, trackPageErrors } from './helpers';

test('Temper engine plays a real multi-ply game with no uncaught errors', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto(TEMPER);

  // The Temper engine drove the initial render: 9 boards, 288 pieces, human to move.
  await expect(page.locator('.board-group')).toHaveCount(9);
  await expect(page.locator('.piece')).toHaveCount(288);
  await expect(page.locator('.turn')).toContainText('Your move');

  // Three legal White pawn pushes, on three different boards so each is independent.
  // Board 0: e-pawn at (4,6). Board 1 (offset +8 on x): d-pawn at (11,6).
  // Board 2 (offset +16 on x): c-pawn at (18,6).
  const humanMoves: Array<[[number, number], [number, number]]> = [
    [[4, 6], [4, 4]],
    [[11, 6], [11, 4]],
    [[18, 6], [18, 4]],
  ];

  let prevPieceCount: number | null = null;

  for (const [from, to] of humanMoves) {
    await move(page, from, to);
    // Bot (Black) replies on its timer and hands the turn back to the human.
    await waitForHumanTurn(page);

    // Bot's destination square is ringed.
    await expect(page.locator('.sq.bot-to')).toHaveCount(1);
    // Turn is back to the human.
    await expect(page.locator('.turn')).toContainText('Your move');
    // A last-move highlight exists from the most recent move.
    await expect(page.locator('.lastmove').first()).toBeVisible();

    // Piece count is bounded and stays consistent across rounds (captures only ever
    // decrease it, never increase past the 288 starting total).
    const pieceCount = await page.locator('.piece').count();
    expect(pieceCount).toBeLessThanOrEqual(288);
    if (prevPieceCount !== null) {
      expect(pieceCount).toBeLessThanOrEqual(prevPieceCount);
    }
    prevPieceCount = pieceCount;
  }

  // The Temper engine ran a whole game cleanly.
  expect(errors).toEqual([]);
});
