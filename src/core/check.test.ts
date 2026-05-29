import { describe, expect, it } from 'vitest';
import { inCheck, isCheckmate, isStalemate } from './check';
import { mkBoardIndex } from './coords';
import { grantCredit, emptyLedger } from './ledger';
import { pc, planeOf, sq, stateOf } from './testkit';
import type { BoardIndex } from './types';

const board = (n: number): BoardIndex => {
  const r = mkBoardIndex(n);
  if (!r.ok) throw new Error('bad board');
  return r.value;
};

describe('inCheck', () => {
  it('detects a rook checking the king on the same board', () => {
    const plane = planeOf([
      [sq(0, 7), pc('king', 'white')],
      [sq(7, 7), pc('rook', 'black')],
    ]);
    const s = stateOf({ plane, toMove: 'white' });
    expect(inCheck(s, board(0), 'white')).toBe(true);
  });
});

describe('checkmate', () => {
  // Back-rank mate on board 0: white king cornered, escapes blocked by its own
  // pawns, black rook checking along the back rank with a clear path.
  const matePlane = planeOf([
    [sq(0, 7), pc('king', 'white')],
    [sq(0, 6), pc('pawn', 'white')],
    [sq(1, 6), pc('pawn', 'white')],
    [sq(7, 7), pc('rook', 'black')],
    [sq(16, 16), pc('king', 'black')],
  ]);

  it('recognises a back-rank checkmate', () => {
    const s = stateOf({ plane: matePlane, toMove: 'white' });
    expect(isCheckmate(s, board(0))).toBe(true);
  });

  it('SIGNATURE: not mate when a credited defender can cross in to capture the checker', () => {
    // Add a white rook on board 1 that, given a rook credit into board 0, can
    // slide across the seam and capture the checking rook on (7,7).
    const plane = planeOf([
      [sq(0, 7), pc('king', 'white')],
      [sq(0, 6), pc('pawn', 'white')],
      [sq(1, 6), pc('pawn', 'white')],
      [sq(7, 7), pc('rook', 'black')],
      [sq(8, 7), pc('rook', 'white')], // board 1, same global rank
      [sq(16, 16), pc('king', 'black')],
    ]);

    const noCredit = stateOf({ plane, toMove: 'white' });
    expect(isCheckmate(noCredit, board(0))).toBe(true); // can't cross in -> still mate

    const withCredit = stateOf({
      plane,
      toMove: 'white',
      ledger: grantCredit(emptyLedger(), board(0), 'white', 'rook'),
    });
    expect(isCheckmate(withCredit, board(0))).toBe(false); // crossing defence resolves the check
  });
});

describe('stalemate', () => {
  it('recognises a lone king with no legal move and no check', () => {
    // White king boxed in a corner of board 0 by a black queen + king, not in
    // check, with no legal square.
    const plane = planeOf([
      [sq(0, 7), pc('king', 'white')],
      [sq(2, 6), pc('queen', 'black')],
      [sq(2, 7), pc('king', 'black')],
    ]);
    const s = stateOf({ plane, toMove: 'white' });
    expect(inCheck(s, board(0), 'white')).toBe(false);
    expect(isStalemate(s, board(0))).toBe(true);
    expect(isCheckmate(s, board(0))).toBe(false);
  });
});
