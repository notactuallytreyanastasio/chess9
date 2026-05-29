import { describe, expect, it } from 'vitest';
import { PLANE, SQUARES } from './constants';
import {
  allCells,
  boardOf,
  cellIndex,
  inBounds,
  mkBoardIndex,
  mkFile,
  mkGlobal,
  mkGX,
  offset,
  squareAt,
  toBoardSquare,
  toGlobal,
} from './coords';

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error('expected ok');
  return r.value;
};

describe('coordinate smart constructors', () => {
  it('reject out-of-range and non-integer values', () => {
    expect(mkGX(-1).ok).toBe(false);
    expect(mkGX(24).ok).toBe(false);
    expect(mkGX(1.5).ok).toBe(false);
    expect(mkFile(8).ok).toBe(false);
    expect(mkBoardIndex(9).ok).toBe(false);
  });

  it('accept boundary-valid values', () => {
    expect(mkGX(0).ok).toBe(true);
    expect(mkGX(23).ok).toBe(true);
    expect(mkFile(7).ok).toBe(true);
    expect(mkBoardIndex(8).ok).toBe(true);
  });
});

describe('plane <-> cell bijection', () => {
  it('round-trips every one of the 576 cells', () => {
    const cells = allCells();
    expect(cells).toHaveLength(SQUARES);
    for (const cell of cells) {
      expect(cellIndex(squareAt(cell))).toBe(cell);
    }
  });
});

describe('global <-> board-square round trip', () => {
  it('toGlobal(toBoardSquare(s)) === s for all squares', () => {
    for (let gy = 0; gy < PLANE; gy++) {
      for (let gx = 0; gx < PLANE; gx++) {
        const sq = unwrap(mkGlobal(gx, gy));
        const back = toGlobal(toBoardSquare(sq));
        expect(back).toEqual(sq);
      }
    }
  });
});

describe('boardOf', () => {
  it('maps the four-board corner cells correctly', () => {
    // Boards laid row-major: 0 1 2 / 3 4 5 / 6 7 8.
    expect(boardOf(unwrap(mkGlobal(7, 7)))).toBe(0); // last cell of board 0
    expect(boardOf(unwrap(mkGlobal(8, 8)))).toBe(4); // first cell of center board
    expect(boardOf(unwrap(mkGlobal(8, 7)))).toBe(1); // right neighbor, same band
    expect(boardOf(unwrap(mkGlobal(7, 8)))).toBe(3); // below neighbor
    expect(boardOf(unwrap(mkGlobal(23, 23)))).toBe(8);
    expect(boardOf(unwrap(mkGlobal(0, 0)))).toBe(0);
  });
});

describe('offset', () => {
  it('returns null when stepping off the plane', () => {
    expect(offset(unwrap(mkGlobal(0, 0)), -1, 0)).toBeNull();
    expect(offset(unwrap(mkGlobal(23, 23)), 1, 0)).toBeNull();
  });

  it('returns the stepped square in-bounds', () => {
    const s = offset(unwrap(mkGlobal(7, 7)), 1, 1);
    expect(s).not.toBeNull();
    expect(s && boardOf(s)).toBe(4);
  });

  it('inBounds guards the plane edges', () => {
    expect(inBounds(0, 0)).toBe(true);
    expect(inBounds(23, 23)).toBe(true);
    expect(inBounds(24, 0)).toBe(false);
    expect(inBounds(0, -1)).toBe(false);
  });
});
