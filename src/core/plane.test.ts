import { describe, expect, it } from 'vitest';
import { SQUARES } from './constants';
import { mkGlobal } from './coords';
import { emptyPlane, pieceAt, withPiece, withPieces } from './plane';
import type { GlobalSquare, Piece } from './types';

const sq = (gx: number, gy: number): GlobalSquare => {
  const r = mkGlobal(gx, gy);
  if (!r.ok) throw new Error('bad square');
  return r.value;
};

const wk: Piece = { type: 'king', color: 'white', hasMoved: false };
const bn: Piece = { type: 'knight', color: 'black', hasMoved: true };

describe('plane', () => {
  it('emptyPlane is all null and full length', () => {
    const p = emptyPlane();
    expect(p).toHaveLength(SQUARES);
    expect(p.every((c) => c === null)).toBe(true);
  });

  it('pieceAt reads back a written piece', () => {
    const p = withPiece(emptyPlane(), sq(5, 5), wk);
    expect(pieceAt(p, sq(5, 5))).toEqual(wk);
    expect(pieceAt(p, sq(6, 5))).toBeNull();
  });

  it('withPiece is copy-on-write (original untouched)', () => {
    const base = emptyPlane();
    const next = withPiece(base, sq(0, 0), wk);
    expect(pieceAt(base, sq(0, 0))).toBeNull();
    expect(pieceAt(next, sq(0, 0))).toEqual(wk);
  });

  it('withPieces applies a batch of writes', () => {
    const p = withPieces(emptyPlane(), [
      [sq(1, 1), wk],
      [sq(2, 2), bn],
      [sq(1, 1), null],
    ]);
    expect(pieceAt(p, sq(1, 1))).toBeNull();
    expect(pieceAt(p, sq(2, 2))).toEqual(bn);
  });
});
