import { describe, expect, it } from 'vitest';
import { findLegalMove, legalMoves } from './legal';
import { applyMove } from './reducer';
import { boardsWon } from './scoring';
import { pc, planeOf, sq, stateOf } from './testkit';
import type { GameState, Move } from './types';

const need = <T>(v: T | null): T => {
  if (v === null) throw new Error('expected non-null');
  return v;
};
const step = (s: GameState, m: Move): GameState => {
  const r = applyMove(s, m);
  if (!r.ok) throw new Error(r.error.kind);
  return r.value;
};

describe('C1 — kings are never capturable', () => {
  it('generates no move that lands on an enemy king', () => {
    const plane = planeOf([
      [sq(5, 0), pc('rook', 'white')], // could slide along rank 0 toward the black king
      [sq(0, 0), pc('king', 'black')],
      [sq(16, 16), pc('king', 'white')],
    ]);
    const moves = legalMoves(stateOf({ plane, toMove: 'white' }));
    expect(moves.some((m) => m.to.gx === 0 && m.to.gy === 0)).toBe(false);
    expect(moves.some((m) => m.captured?.type === 'king')).toBe(false);
    // It can still approach (the ray stops just before the king).
    expect(moves.some((m) => m.to.gx === 1 && m.to.gy === 0)).toBe(true);
  });
});

describe('H3/C1 — checkmate detected on a board the move never touched', () => {
  it('capturing a cross-board defender on another board mates the king and scores it', () => {
    // Board 0: black king (7,0) checked by a white rook up file 7; escape squares
    // (6,0)/(6,1) covered by a second white rook on file 6, (7,1) by the checking
    // rook. The only defence is a black knight on board 1 that could block file 7.
    // White captures that knight ON BOARD 1 — board 0 is not in the touched set,
    // yet it must now be recognised as checkmate.
    const plane = planeOf([
      [sq(7, 0), pc('king', 'black')],
      [sq(7, 7), pc('rook', 'white')], // checks along file 7
      [sq(6, 7), pc('rook', 'white')], // covers (6,0),(6,1)
      [sq(9, 1), pc('knight', 'black')], // the sole defender, on board 1
      [sq(10, 3), pc('knight', 'white')], // will capture it on board 1
      [sq(16, 16), pc('king', 'white')],
    ]);
    const s = stateOf({ plane, toMove: 'white' });
    const capture = need(findLegalMove(s, sq(10, 3), sq(9, 1))); // Nxn, entirely on board 1
    const next = step(s, capture);
    expect(next.status[0]).toEqual({ kind: 'checkmate', loser: 'black', winner: 'white' });
    expect(boardsWon(next, 'white')).toBe(1);
  });
});

describe('H1 — the 50-move clock only ticks on boards the move touched', () => {
  it('leaves untouched boards’ clocks unchanged', () => {
    const clocks = Array.from({ length: 9 }, () => 10);
    const plane = planeOf([
      [sq(0, 0), pc('rook', 'white')],
      [sq(4, 7), pc('king', 'white')],
      [sq(16, 16), pc('king', 'black')],
    ]);
    const s = stateOf({ plane, toMove: 'white', clocks });
    const next = step(s, need(findLegalMove(s, sq(0, 0), sq(0, 3)))); // quiet rook move on board 0
    expect(next.clocks[0]).toBe(11); // touched, no progress -> ticks
    expect(next.clocks[5]).toBe(10); // untouched -> unchanged
    expect(next.clocks[8]).toBe(10); // untouched -> unchanged
  });
});

describe('H2 — a quiet mating move is scored as mate, not a fifty-move draw', () => {
  it('prefers checkmate over the fifty-move clock reaching the cap', () => {
    // Two-rook ladder mate delivered by a quiet rook move, with board 0 one ply
    // from the fifty-move cap.
    const plane = planeOf([
      [sq(0, 0), pc('king', 'black')],
      [sq(7, 1), pc('rook', 'white')], // controls rank 1
      [sq(5, 7), pc('rook', 'white')], // swings to (5,0) for the mate
      [sq(16, 16), pc('king', 'white')],
    ]);
    const clocks = Array.from({ length: 9 }, (_u, i) => (i === 0 ? 99 : 0));
    const s = stateOf({ plane, toMove: 'white', clocks });
    const next = step(s, need(findLegalMove(s, sq(5, 7), sq(5, 0)))); // quiet, ticks board 0 to 100
    expect(next.status[0]).toEqual({ kind: 'checkmate', loser: 'black', winner: 'white' });
  });
});
