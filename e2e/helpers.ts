import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';

// file:// URLs of the two single-file builds. TEMPER is the UI running on the Temper-generated
// engine via the shim; TS is the original hand-written core, for parity comparisons.
const fileUrl = (rel: string): string => 'file://' + fileURLToPath(new URL(rel, import.meta.url));
export const TEMPER = fileUrl('../dist-temper/index.html');
export const TS = fileUrl('../dist/index.html');

/** CSS selector for a board cell by global coordinates, e.g. cell(4, 6) === '[data-sq="4-6"]'. */
export const cell = (gx: number, gy: number): string => `[data-sq="${gx}-${gy}"]`;

/** A piece glyph inside a given cell. */
export const pieceAt = (page: Page, gx: number, gy: number): Locator =>
  page.locator(`${cell(gx, gy)} .piece`);

/** After a human move the bot replies on a timer; resolve once it is the human's turn again. */
export async function waitForHumanTurn(page: Page, timeout = 20000): Promise<void> {
  await page.locator('.turn', { hasText: 'Your move' }).waitFor({ timeout });
}

/** Collect uncaught page errors for an assertion that the engine ran clean. */
export function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

/** Make one human (White) move: select a square, then click its destination. */
export async function move(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.locator(cell(...from)).click();
  await page.locator(cell(...to)).click();
}
