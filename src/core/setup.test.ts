import { describe, expect, it } from 'vitest';
import { BOARDS, SQUARES } from './constants';
import { creditCount } from './ledger';
import { pieceAt } from './plane';
import { mkBoardIndex, mkGlobal } from './coords';
import { initialState } from './setup';
import type { Color, GameState, PieceType } from './types';

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error('expected ok');
  return r.value;
};

const countPieces = (s: GameState): Record<Color, number> => {
  const counts: Record<Color, number> = { white: 0, black: 0 };
  for (const cell of s.plane) {
    if (cell) counts[cell.color]++;
  }
  return counts;
};

describe('initialState', () => {
  const state = initialState();

  it('has the right scalar fields', () => {
    expect(state.toMove).toBe('white');
    expect(state.ply).toBe(0);
    expect(state.enPassant).toBeNull();
    expect(state.plane).toHaveLength(SQUARES);
    expect(state.status).toHaveLength(BOARDS);
    expect(state.status.every((s) => s.kind === 'active')).toBe(true);
  });

  it('places 9 complete armies (16 per side per board)', () => {
    const counts = countPieces(state);
    expect(counts.white).toBe(9 * 16);
    expect(counts.black).toBe(9 * 16);
  });

  it('has an empty ledger', () => {
    const types: readonly PieceType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen'];
    for (let b = 0; b < BOARDS; b++) {
      const board = unwrap(mkBoardIndex(b));
      for (const color of ['white', 'black'] as const) {
        for (const t of types) {
          if (t === 'pawn' || t === 'knight' || t === 'bishop' || t === 'rook' || t === 'queen') {
            expect(creditCount(state.ledger, board, color, t)).toBe(0);
          }
        }
      }
    }
  });

  it('places white king at e1 and black king at e8 on the center board', () => {
    // Center board (index 4) spans gx/gy 8..15. King file = 4 -> gx 12.
    const whiteKing = pieceAt(state.plane, unwrap(mkGlobal(12, 15)));
    const blackKing = pieceAt(state.plane, unwrap(mkGlobal(12, 8)));
    expect(whiteKing).toEqual({ type: 'king', color: 'white', hasMoved: false });
    expect(blackKing).toEqual({ type: 'king', color: 'black', hasMoved: false });
  });
});
