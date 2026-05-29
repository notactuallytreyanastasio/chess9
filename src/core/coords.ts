import { BOARD_SIZE, GRID, PLANE, SQUARES } from './constants';
import { err, ok, type Result } from './result';
import type {
  BoardIndex,
  BoardSquare,
  CellIndex,
  CoordError,
  File,
  GlobalSquare,
  GX,
  GY,
  Rank,
} from './types';

// Internal branding. Only reachable after range validation below, so a branded
// value always satisfies its range invariant.
const brandGX = (n: number): GX => n as GX;
const brandGY = (n: number): GY => n as GY;
const brandFile = (n: number): File => n as File;
const brandRank = (n: number): Rank => n as Rank;
const brandBoard = (n: number): BoardIndex => n as BoardIndex;
const brandCell = (n: number): CellIndex => n as CellIndex;

const inRange = (n: number, max: number): boolean => Number.isInteger(n) && n >= 0 && n < max;

export const mkGX = (n: number): Result<GX, CoordError> =>
  inRange(n, PLANE) ? ok(brandGX(n)) : err({ kind: 'out-of-range', axis: 'gx', value: n });
export const mkGY = (n: number): Result<GY, CoordError> =>
  inRange(n, PLANE) ? ok(brandGY(n)) : err({ kind: 'out-of-range', axis: 'gy', value: n });
export const mkFile = (n: number): Result<File, CoordError> =>
  inRange(n, BOARD_SIZE) ? ok(brandFile(n)) : err({ kind: 'out-of-range', axis: 'file', value: n });
export const mkRank = (n: number): Result<Rank, CoordError> =>
  inRange(n, BOARD_SIZE) ? ok(brandRank(n)) : err({ kind: 'out-of-range', axis: 'rank', value: n });
export const mkBoardIndex = (n: number): Result<BoardIndex, CoordError> =>
  inRange(n, GRID * GRID) ? ok(brandBoard(n)) : err({ kind: 'out-of-range', axis: 'board', value: n });

/** Build a GlobalSquare from raw numbers, validating both axes. */
export const mkGlobal = (gx: number, gy: number): Result<GlobalSquare, CoordError> => {
  const x = mkGX(gx);
  if (!x.ok) return x;
  const y = mkGY(gy);
  if (!y.ok) return y;
  return ok({ gx: x.value, gy: y.value });
};

export const inBounds = (gx: number, gy: number): boolean => inRange(gx, PLANE) && inRange(gy, PLANE);

/** Step from a square by (dx, dy); null if it would leave the plane. */
export const offset = (sq: GlobalSquare, dx: number, dy: number): GlobalSquare | null => {
  const gx = sq.gx + dx;
  const gy = sq.gy + dy;
  return inBounds(gx, gy) ? { gx: brandGX(gx), gy: brandGY(gy) } : null;
};

export const cellIndex = (sq: GlobalSquare): CellIndex => brandCell(sq.gy * PLANE + sq.gx);

export const squareAt = (idx: CellIndex): GlobalSquare => ({
  gx: brandGX(idx % PLANE),
  gy: brandGY(Math.floor(idx / PLANE)),
});

export const boardOf = (sq: GlobalSquare): BoardIndex => {
  const bx = Math.floor(sq.gx / BOARD_SIZE);
  const by = Math.floor(sq.gy / BOARD_SIZE);
  return brandBoard(by * GRID + bx);
};

export const toBoardSquare = (sq: GlobalSquare): BoardSquare => ({
  board: boardOf(sq),
  file: brandFile(sq.gx % BOARD_SIZE),
  rank: brandRank(sq.gy % BOARD_SIZE),
});

export const toGlobal = (bs: BoardSquare): GlobalSquare => {
  const bx = bs.board % GRID;
  const by = Math.floor(bs.board / GRID);
  return { gx: brandGX(bx * BOARD_SIZE + bs.file), gy: brandGY(by * BOARD_SIZE + bs.rank) };
};

/** Top-left global origin (smallest gx, gy) of a board. */
export const boardOrigin = (board: BoardIndex): GlobalSquare => {
  const bx = board % GRID;
  const by = Math.floor(board / GRID);
  return { gx: brandGX(bx * BOARD_SIZE), gy: brandGY(by * BOARD_SIZE) };
};

export const sameSquare = (a: GlobalSquare, b: GlobalSquare): boolean => a.gx === b.gx && a.gy === b.gy;

export const allCells = (): readonly CellIndex[] =>
  Array.from({ length: SQUARES }, (_unused, i) => brandCell(i));
