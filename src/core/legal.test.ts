import { describe, expect, it } from 'vitest';
import { legalMoves } from './legal';
import { applyMove } from './reducer';
import { initialState } from './setup';

describe('legal moves on the initial position', () => {
  const s = initialState();
  const moves = legalMoves(s);

  it('produces 20 opening moves per board (9 independent standard games)', () => {
    // No credits exist yet, so there are zero cross-board moves; each board is a
    // standard chess start with exactly 20 legal moves. 20 * 9 = 180.
    expect(moves).toHaveLength(180);
    expect(moves.every((m) => m.crossing === null)).toBe(true);
  });

  it('every generated legal move is accepted by the reducer (generator/reducer agreement)', () => {
    for (const m of moves) {
      expect(applyMove(s, m).ok).toBe(true);
    }
  });
});
