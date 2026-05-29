import { SQUARES } from './constants';
import { cellIndex } from './coords';
import type { GlobalSquare, Piece, Plane } from './types';

export const emptyPlane = (): Plane => Array.from({ length: SQUARES }, () => null);

export const pieceAt = (plane: Plane, sq: GlobalSquare): Piece | null => {
  const cell = plane[cellIndex(sq)];
  return cell ?? null;
};

/** Copy-on-write: returns a new Plane with `sq` set to `piece` (or cleared). */
export const withPiece = (plane: Plane, sq: GlobalSquare, piece: Piece | null): Plane => {
  const next = plane.slice();
  next[cellIndex(sq)] = piece;
  return next;
};

/** Apply several (square, piece) writes at once, copy-on-write. */
export const withPieces = (
  plane: Plane,
  writes: ReadonlyArray<readonly [GlobalSquare, Piece | null]>,
): Plane => {
  const next = plane.slice();
  for (const [sq, piece] of writes) next[cellIndex(sq)] = piece;
  return next;
};
