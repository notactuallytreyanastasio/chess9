import { BOARDS } from './constants';
import { err, ok, type Result } from './result';
import type { BoardCredits, BoardIndex, Color, CreditCounts, CrossingType, Ledger } from './types';

const zeroCounts = (): CreditCounts => ({ pawn: 0, knight: 0, bishop: 0, rook: 0, queen: 0 });

const zeroBoardCredits = (): BoardCredits => ({ white: zeroCounts(), black: zeroCounts() });

export const emptyLedger = (): Ledger => Array.from({ length: BOARDS }, () => zeroBoardCredits());

export const creditCount = (
  ledger: Ledger,
  board: BoardIndex,
  color: Color,
  type: CrossingType,
): number => ledger[board]?.[color][type] ?? 0;

export const hasCredit = (
  ledger: Ledger,
  board: BoardIndex,
  color: Color,
  type: CrossingType,
): boolean => creditCount(ledger, board, color, type) > 0;

const replaceBoard = (ledger: Ledger, board: BoardIndex, next: BoardCredits): Ledger => {
  const copy = ledger.slice();
  copy[board] = next;
  return copy;
};

const withCount = (
  bc: BoardCredits,
  color: Color,
  type: CrossingType,
  value: number,
): BoardCredits => ({
  ...bc,
  [color]: { ...bc[color], [type]: value },
});

/** Grant one crossing credit (a piece of `type` owned by `color` was captured on `board`). */
export const grantCredit = (
  ledger: Ledger,
  board: BoardIndex,
  color: Color,
  type: CrossingType,
): Ledger => {
  const bc = ledger[board] ?? zeroBoardCredits();
  return replaceBoard(ledger, board, withCount(bc, color, type, bc[color][type] + 1));
};

/** Spend one crossing credit; fails if none available. */
export const debitCredit = (
  ledger: Ledger,
  board: BoardIndex,
  color: Color,
  type: CrossingType,
): Result<Ledger, 'no-credit'> => {
  const bc = ledger[board] ?? zeroBoardCredits();
  const current = bc[color][type];
  if (current <= 0) return err('no-credit');
  return ok(replaceBoard(ledger, board, withCount(bc, color, type, current - 1)));
};
