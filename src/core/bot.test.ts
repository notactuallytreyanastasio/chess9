import { describe, expect, it } from 'vitest';
import { chooseMove } from './bot';
import { legalMoves } from './legal';
import { applyMove } from './reducer';
import { initialState } from './setup';
import { makeRng } from './rng';
import { pc, planeOf, sq, stateOf } from './testkit';
import type { Move } from './types';

const matchesMove = (a: Move, b: Move): boolean =>
  a.from.gx === b.from.gx && a.from.gy === b.from.gy && a.to.gx === b.to.gx && a.to.gy === b.to.gy;

describe('chooseMove', () => {
  it('returns a move that is in the legal set', () => {
    const s = initialState();
    const move = chooseMove(s, 2, makeRng(1));
    expect(move).not.toBeNull();
    if (move === null) return;
    expect(legalMoves(s).some((m) => matchesMove(m, move))).toBe(true);
    expect(applyMove(s, move).ok).toBe(true);
  });

  it('is deterministic under a fixed seed', () => {
    const s = initialState();
    const a = chooseMove(s, 2, makeRng(42));
    const b = chooseMove(s, 2, makeRng(42));
    expect(a).toEqual(b);
  });

  it('prefers a mate-in-1 over grabbing a free queen', () => {
    // Two-rook ladder mate available on board 0; a hanging black queen sits on
    // board 8 where a white bishop could capture it for free.
    const plane = planeOf([
      [sq(0, 0), pc('king', 'black')],
      [sq(7, 1), pc('rook', 'white')], // controls all of rank 1
      [sq(3, 7), pc('rook', 'white')], // will swing to (3,0) for the mate
      [sq(7, 7), pc('king', 'white')],
      [sq(16, 16), pc('queen', 'black')], // free queen on board 8
      [sq(18, 18), pc('bishop', 'white')], // can capture the queen
    ]);
    const s = stateOf({ plane, toMove: 'white' });

    const move = chooseMove(s, 2, makeRng(7));
    expect(move).not.toBeNull();
    if (move === null) return;

    // The mating move delivers checkmate on board 0.
    const after = applyMove(s, move);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.status[0]).toEqual({ kind: 'checkmate', loser: 'black', winner: 'white' });
  });

  it('returns null when the side to move has no legal moves', () => {
    const plane = planeOf([
      [sq(0, 7), pc('king', 'white')],
      [sq(1, 5), pc('queen', 'black')],
      [sq(2, 6), pc('king', 'black')],
    ]);
    // White king on (0,7): (1,7) & (1,6) covered by queen, (0,6) covered by queen -> stalemate, no moves.
    const s = stateOf({ plane, toMove: 'white' });
    expect(chooseMove(s, 2, makeRng(0))).toBeNull();
  });
});
