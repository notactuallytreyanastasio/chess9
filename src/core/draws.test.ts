import { describe, expect, it } from 'vitest';
import { MAX_PLY } from './constants';
import { mkBoardIndex } from './coords';
import { insufficientMaterial } from './draws';
import { findLegalMove } from './legal';
import { applyMove } from './reducer';
import { gameOver, winner } from './scoring';
import { pc, planeOf, sq, stateOf } from './testkit';
import type { BoardIndex, GameState, Move } from './types';

const board = (n: number): BoardIndex => {
  const r = mkBoardIndex(n);
  if (!r.ok) throw new Error('bad board');
  return r.value;
};
const need = <T>(v: T | null): T => {
  if (v === null) throw new Error('expected non-null');
  return v;
};
const step = (s: GameState, m: Move): GameState => {
  const r = applyMove(s, m);
  if (!r.ok) throw new Error(r.error.kind);
  return r.value;
};

describe('insufficientMaterial', () => {
  it('is true for bare kings and king+single minor, false otherwise', () => {
    const kvk = planeOf([[sq(0, 7), pc('king', 'white')], [sq(7, 0), pc('king', 'black')]]);
    expect(insufficientMaterial(kvk, board(0))).toBe(true);

    const kn = planeOf([[sq(0, 7), pc('king', 'white')], [sq(2, 2), pc('knight', 'white')], [sq(7, 0), pc('king', 'black')]]);
    expect(insufficientMaterial(kn, board(0))).toBe(true);

    const kr = planeOf([[sq(0, 7), pc('king', 'white')], [sq(2, 2), pc('rook', 'white')], [sq(7, 0), pc('king', 'black')]]);
    expect(insufficientMaterial(kr, board(0))).toBe(false);

    const twoMinors = planeOf([[sq(0, 7), pc('king', 'white')], [sq(2, 2), pc('knight', 'white')], [sq(4, 4), pc('bishop', 'white')], [sq(7, 0), pc('king', 'black')]]);
    expect(insufficientMaterial(twoMinors, board(0))).toBe(false);
  });
});

describe('draw on a board', () => {
  it('freezes a board as drawn when a capture leaves only K + minor vs K', () => {
    const plane = planeOf([
      [sq(0, 7), pc('king', 'white')],
      [sq(1, 1), pc('knight', 'white')],
      [sq(2, 3), pc('knight', 'black')], // the last black piece besides the king
      [sq(7, 0), pc('king', 'black')],
    ]);
    const s = stateOf({ plane, toMove: 'white' });
    const next = step(s, need(findLegalMove(s, sq(1, 1), sq(2, 3)))); // Nxn -> K+N vs K
    expect(next.status[0]).toEqual({ kind: 'draw', reason: 'insufficient-material' });
  });

  it('freezes a board as drawn on the 50-move (100-ply) clock', () => {
    const clocks = Array.from({ length: 9 }, (_u, i) => (i === 0 ? 99 : 0));
    const plane = planeOf([
      [sq(0, 0), pc('rook', 'white')],
      [sq(4, 7), pc('king', 'white')],
      [sq(16, 16), pc('king', 'black')],
    ]);
    const s = stateOf({ plane, toMove: 'white', clocks });
    const next = step(s, need(findLegalMove(s, sq(0, 0), sq(0, 3)))); // quiet rook move ticks clock to 100
    expect(next.status[0]).toEqual({ kind: 'draw', reason: 'fifty-move' });
  });
});

describe('hard ply cap guarantees termination', () => {
  it('reports game over at the ply cap and scores by boards won', () => {
    const status = Array.from({ length: 9 }, (_u, i) =>
      i < 3
        ? ({ kind: 'checkmate', loser: 'black', winner: 'white' } as const)
        : ({ kind: 'active' } as const),
    );
    const s = stateOf({ plane: planeOf([[sq(0, 0), pc('king', 'white')]]), status, ply: MAX_PLY });
    expect(gameOver(s)).toBe(true);
    expect(winner(s)).toBe('white');
  });
});
