import { describe, expect, it } from 'vitest';
import { MATE_SCORE, evaluate } from './eval';
import { initialState } from './setup';
import { pc, planeOf, sq, stateOf } from './testkit';
import type { BoardStatus } from './types';

describe('evaluate', () => {
  it('is symmetric (zero-sum) on the initial position', () => {
    const s = initialState();
    expect(evaluate(s, 'white')).toBe(-evaluate(s, 'black'));
    expect(evaluate(s, 'white')).toBe(0); // mirror-image armies cancel exactly
  });

  it('reflects a material advantage', () => {
    const plane = planeOf([
      [sq(0, 0), pc('king', 'white')],
      [sq(7, 7), pc('king', 'black')],
      [sq(3, 3), pc('queen', 'white')],
    ]);
    const s = stateOf({ plane });
    expect(evaluate(s, 'white')).toBeGreaterThan(0);
    expect(evaluate(s, 'black')).toBeLessThan(0);
  });

  it('lets a checkmated board dominate a material deficit', () => {
    const status: BoardStatus[] = Array.from({ length: 9 }, (): BoardStatus => ({ kind: 'active' }));
    status[0] = { kind: 'checkmate', loser: 'black', winner: 'white' };
    // White is down a queen but has mated a board.
    const plane = planeOf([
      [sq(0, 0), pc('king', 'white')],
      [sq(7, 7), pc('king', 'black')],
      [sq(3, 3), pc('queen', 'black')],
    ]);
    const s = stateOf({ plane, status });
    expect(evaluate(s, 'white')).toBeGreaterThan(MATE_SCORE - 1000);
  });

  it('stays zero-sum with credits on the board', () => {
    const plane = planeOf([
      [sq(0, 0), pc('king', 'white')],
      [sq(7, 7), pc('king', 'black')],
    ]);
    const s = stateOf({ plane });
    expect(evaluate(s, 'white')).toBe(-evaluate(s, 'black'));
  });
});
