import { test, expect, type Page } from '@playwright/test';
import { TEMPER, TS, cell, trackPageErrors } from './helpers';

// Deterministic parity: the Temper-generated engine and the hand-written TypeScript core
// must agree on (a) the initial board and (b) legal-move generation, observed purely through
// the rendered UI. The bot is non-deterministic, so we never let it move here: we only read
// the freshly-loaded position and the highlight overlay produced by selecting a piece.

/** For every cell holding a piece, map its data-sq -> "white|black:<glyph>" signature. */
async function boardSignature(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const sig: Record<string, string> = {};
    for (const cell of Array.from(document.querySelectorAll('.sq'))) {
      const sq = cell.getAttribute('data-sq');
      const piece = cell.querySelector('.piece');
      if (!sq || !piece) continue;
      const color = piece.classList.contains('white')
        ? 'white'
        : piece.classList.contains('black')
          ? 'black'
          : 'unknown';
      sig[sq] = `${color}:${(piece.textContent ?? '').trim()}`;
    }
    return sig;
  });
}

/** The SET of highlighted destination cells after selecting one square, as sorted data-sq[]. */
async function targetsFor(page: Page, gx: number, gy: number): Promise<string[]> {
  await page.locator(cell(gx, gy)).click();
  await expect(page.locator(cell(gx, gy))).toHaveClass(/selected/);
  const targets = await page.evaluate(() => {
    const out: string[] = [];
    for (const c of Array.from(document.querySelectorAll('.move-target, .capture-target'))) {
      const sq = c.getAttribute('data-sq');
      if (sq) out.push(sq);
    }
    return out;
  });
  // Deselect so the next probe starts clean.
  await page.locator(cell(gx, gy)).click();
  return targets.sort();
}

test('Temper and TS engines agree on initial setup and legal-move generation via the UI', async ({ browser }) => {
  const temperPage = await browser.newPage();
  const tsPage = await browser.newPage();
  const temperErrors = trackPageErrors(temperPage);
  const tsErrors = trackPageErrors(tsPage);

  await temperPage.goto(TEMPER);
  await tsPage.goto(TS);

  // Both builds finished their initial render before we read anything.
  for (const p of [temperPage, tsPage]) {
    await expect(p.locator('.board-group')).toHaveCount(9);
    await expect(p.locator('.sq')).toHaveCount(576);
    await expect(p.locator('.piece')).toHaveCount(288);
    await expect(p.locator('.turn')).toContainText('Your move');
  }

  // (1) Identical initial board signatures, cell-by-cell.
  const temperSig = await boardSignature(temperPage);
  const tsSig = await boardSignature(tsPage);
  expect(Object.keys(temperSig)).toHaveLength(288);
  expect(temperSig).toEqual(tsSig);

  // (2) Identical legal-move highlight sets for several White pieces.
  // White pawns sit at local rank 6; White back rank at local rank 7 (knights at file 1 and 6).
  const probes: Array<[number, number]> = [
    [4, 6], // king's pawn, board 0
    [0, 6], // a-pawn, board 0
    [1, 7], // queenside knight, board 0
    [4, 14], // a pawn on board 3 (gy 8..15 -> board row 1)
  ];

  for (const [gx, gy] of probes) {
    // Sanity: it really is a White piece on both builds before probing its moves.
    await expect(temperPage.locator(`${cell(gx, gy)} .piece.white`)).toBeVisible();
    await expect(tsPage.locator(`${cell(gx, gy)} .piece.white`)).toBeVisible();

    const temperTargets = await targetsFor(temperPage, gx, gy);
    const tsTargets = await targetsFor(tsPage, gx, gy);
    expect(temperTargets, `targets for ${gx}-${gy}`).toEqual(tsTargets);
    // A genuine probe: every selected White piece has at least one legal move here.
    expect(temperTargets.length, `non-empty targets for ${gx}-${gy}`).toBeGreaterThan(0);
  }

  expect(temperErrors).toEqual([]);
  expect(tsErrors).toEqual([]);

  await temperPage.close();
  await tsPage.close();
});
