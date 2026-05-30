import { describe, expect, it } from 'vitest';
import { mkBoardIndex } from './coords';
import { applyMove } from './reducer';
import { pc, planeOf, sq, stateOf } from './testkit';
import type { BoardIndex, GameState, Move, MoveError } from './types';

const board = (n: number): BoardIndex => {
  const r = mkBoardIndex(n);
  if (!r.ok) throw new Error('bad board');
  return r.value;
};

const errorOf = (s: GameState, m: Move): MoveError => {
  const r = applyMove(s, m);
  if (r.ok) throw new Error('expected rejection');
  return r.error;
};

const whiteKings = [
  [sq(16, 16), pc('king', 'black', true)] as const,
];

describe('precise MoveError reasons', () => {
  it('king-cannot-cross', () => {
    const s = stateOf({ plane: planeOf([[sq(7, 7), pc('king', 'white', true)], ...whiteKings]), toMove: 'white' });
    const move: Move = { kind: 'normal', from: sq(7, 7), to: sq(8, 8), piece: pc('king', 'white', true), captured: null, crossing: { fromBoard: board(0), toBoard: board(4), creditType: 'queen' } };
    expect(errorOf(s, move).kind).toBe('king-cannot-cross');
  });

  it('two-boundaries', () => {
    const s = stateOf({ plane: planeOf([[sq(7, 7), pc('queen', 'white', true)], [sq(0, 0), pc('king', 'white', true)], ...whiteKings]), toMove: 'white' });
    const move: Move = { kind: 'normal', from: sq(7, 7), to: sq(16, 16), piece: pc('queen', 'white', true), captured: null, crossing: { fromBoard: board(0), toBoard: board(8), creditType: 'queen' } };
    expect(errorOf(s, move).kind).toBe('two-boundaries');
  });

  it('no-credit', () => {
    const s = stateOf({ plane: planeOf([[sq(7, 7), pc('bishop', 'white', true)], [sq(0, 0), pc('king', 'white', true)], ...whiteKings]), toMove: 'white' });
    const move: Move = { kind: 'normal', from: sq(7, 7), to: sq(8, 8), piece: pc('bishop', 'white', true), captured: null, crossing: { fromBoard: board(0), toBoard: board(4), creditType: 'bishop' } };
    expect(errorOf(s, move).kind).toBe('no-credit');
  });

  it('path-blocked', () => {
    const s = stateOf({ plane: planeOf([[sq(0, 0), pc('rook', 'white', true)], [sq(1, 0), pc('pawn', 'white')], ...whiteKings]), toMove: 'white' });
    const move: Move = { kind: 'normal', from: sq(0, 0), to: sq(3, 0), piece: pc('rook', 'white', true), captured: null, crossing: null };
    expect(errorOf(s, move).kind).toBe('path-blocked');
  });

  it('illegal-geometry', () => {
    const s = stateOf({ plane: planeOf([[sq(3, 3), pc('bishop', 'white', true)], ...whiteKings]), toMove: 'white' });
    const move: Move = { kind: 'normal', from: sq(3, 3), to: sq(3, 5), piece: pc('bishop', 'white', true), captured: null, crossing: null }; // bishop moving straight
    expect(errorOf(s, move).kind).toBe('illegal-geometry');
  });

  it('leaves-king-in-check (pinned piece)', () => {
    const s = stateOf({
      plane: planeOf([
        [sq(0, 0), pc('king', 'white', true)],
        [sq(1, 0), pc('rook', 'white', true)], // pinned along rank 0
        [sq(5, 0), pc('rook', 'black', true)],
        ...whiteKings,
      ]),
      toMove: 'white',
    });
    const move: Move = { kind: 'normal', from: sq(1, 0), to: sq(1, 3), piece: pc('rook', 'white', true), captured: null, crossing: null };
    const e = errorOf(s, move);
    expect(e.kind).toBe('leaves-king-in-check');
    if (e.kind === 'leaves-king-in-check') expect(e.board).toBe(0);
  });
});
