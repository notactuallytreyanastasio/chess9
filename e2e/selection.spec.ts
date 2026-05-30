import { test, expect } from '@playwright/test';
import { TEMPER, cell, pieceAt, trackPageErrors } from './helpers';

test.describe('Temper build — selection and illegal interaction', () => {
  test('clicking a White piece selects it and lights its legal targets', async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto(TEMPER);
    await expect(page.locator('.turn')).toContainText('Your move');

    // Select a White pawn on board 0 (e2 = 4,6).
    await page.locator(cell(4, 6)).click();

    // The pawn's own square gains 'selected'.
    await expect(page.locator(cell(4, 6))).toHaveClass(/selected/);
    await expect(page.locator('.sq.selected')).toHaveCount(1);

    // Its two legal pawn-push targets are empty squares marked 'move-target'.
    await expect(page.locator(cell(4, 5))).toHaveClass(/move-target/);
    await expect(page.locator(cell(4, 4))).toHaveClass(/move-target/);
    await expect(page.locator('.sq.move-target')).toHaveCount(2);

    // No move occurred: still White's turn, piece counts unchanged.
    await expect(page.locator('.turn')).toContainText('Your move');
    await expect(pieceAt(page, 4, 6)).toBeVisible();
    await expect(page.locator('.piece.white')).toHaveCount(144);
    await expect(page.locator('.piece.black')).toHaveCount(144);

    expect(errors).toEqual([]);
  });

  test('clicking the selected piece again keeps it selected and makes no move', async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto(TEMPER);

    await page.locator(cell(4, 6)).click();
    await expect(page.locator(cell(4, 6))).toHaveClass(/selected/);
    await expect(page.locator('.sq.move-target')).toHaveCount(2);

    // Click the same (selected) White pawn again. A square is never its own legal
    // target, so no move fires; clicking your own piece simply re-selects it, leaving
    // exactly one 'selected' square and the same two 'move-target' highlights.
    await page.locator(cell(4, 6)).click();

    await expect(page.locator(cell(4, 6))).toHaveClass(/selected/);
    await expect(page.locator('.sq.selected')).toHaveCount(1);
    await expect(page.locator('.sq.move-target')).toHaveCount(2);
    await expect(page.locator('.sq.capture-target')).toHaveCount(0);

    // No move happened: still White's turn, pawn still on its square, counts intact.
    await expect(page.locator('.turn')).toContainText('Your move');
    await expect(pieceAt(page, 4, 6)).toBeVisible();
    await expect(page.locator('.piece.white')).toHaveCount(144);
    await expect(page.locator('.piece.black')).toHaveCount(144);

    expect(errors).toEqual([]);
  });

  test('clicking an empty non-target square clears the selection', async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto(TEMPER);

    await page.locator(cell(4, 6)).click();
    await expect(page.locator(cell(4, 6))).toHaveClass(/selected/);
    await expect(page.locator('.sq.move-target')).toHaveCount(2);

    // (1,3) is an empty square on board 0 that is NOT a legal target of the e2 pawn.
    await expect(pieceAt(page, 1, 3)).toHaveCount(0);
    await expect(page.locator(cell(1, 3))).not.toHaveClass(/move-target/);

    await page.locator(cell(1, 3)).click();

    // Selection and all target highlights are gone everywhere.
    await expect(page.locator('.sq.selected')).toHaveCount(0);
    await expect(page.locator('.sq.move-target')).toHaveCount(0);
    await expect(page.locator('.sq.capture-target')).toHaveCount(0);

    // No move occurred.
    await expect(page.locator('.turn')).toContainText('Your move');
    await expect(pieceAt(page, 4, 6)).toBeVisible();
    await expect(page.locator('.piece.white')).toHaveCount(144);
    await expect(page.locator('.piece.black')).toHaveCount(144);

    expect(errors).toEqual([]);
  });

  test('clicking a Black (opponent) piece on White\'s turn does not select it or move', async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto(TEMPER);
    await expect(page.locator('.turn')).toContainText('Your move');

    // Black pieces sit at local ranks 0..1. On board 0, (4,1) is a Black pawn.
    await expect(page.locator(`${cell(4, 1)} .piece.black`)).toBeVisible();

    await page.locator(cell(4, 1)).click();

    // Not selected, no targets lit, nothing highlighted.
    await expect(page.locator(cell(4, 1))).not.toHaveClass(/selected/);
    await expect(page.locator('.sq.selected')).toHaveCount(0);
    await expect(page.locator('.sq.move-target')).toHaveCount(0);
    await expect(page.locator('.sq.capture-target')).toHaveCount(0);

    // No move occurred: still White's turn and piece counts unchanged.
    await expect(page.locator('.turn')).toContainText('Your move');
    await expect(page.locator('.piece.white')).toHaveCount(144);
    await expect(page.locator('.piece.black')).toHaveCount(144);

    expect(errors).toEqual([]);
  });
});
