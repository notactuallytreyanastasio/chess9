import { describe, expect, it } from 'vitest';
import { mkBoardIndex } from './coords';
import { creditCount, debitCredit, emptyLedger, grantCredit, hasCredit } from './ledger';
import type { BoardIndex } from './types';

const board = (n: number): BoardIndex => {
  const r = mkBoardIndex(n);
  if (!r.ok) throw new Error('bad board');
  return r.value;
};

describe('ledger', () => {
  it('starts empty', () => {
    const l = emptyLedger();
    expect(hasCredit(l, board(0), 'white', 'bishop')).toBe(false);
    expect(creditCount(l, board(4), 'black', 'queen')).toBe(0);
  });

  it('grants exactly the targeted [board][color][type] slot', () => {
    const l = grantCredit(emptyLedger(), board(4), 'white', 'bishop');
    expect(creditCount(l, board(4), 'white', 'bishop')).toBe(1);
    // isolation: nothing else moves
    expect(creditCount(l, board(4), 'white', 'knight')).toBe(0);
    expect(creditCount(l, board(4), 'black', 'bishop')).toBe(0);
    expect(creditCount(l, board(3), 'white', 'bishop')).toBe(0);
  });

  it('debits down to a real zero', () => {
    const l = grantCredit(emptyLedger(), board(2), 'black', 'rook');
    const d = debitCredit(l, board(2), 'black', 'rook');
    expect(d.ok).toBe(true);
    if (d.ok) expect(creditCount(d.value, board(2), 'black', 'rook')).toBe(0);
  });

  it('refuses to debit when empty', () => {
    const d = debitCredit(emptyLedger(), board(0), 'white', 'pawn');
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toBe('no-credit');
  });

  it('does not mutate the input ledger', () => {
    const l = emptyLedger();
    grantCredit(l, board(0), 'white', 'queen');
    expect(creditCount(l, board(0), 'white', 'queen')).toBe(0);
  });
});
