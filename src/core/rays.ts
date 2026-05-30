import { boardOf, offset } from './coords';
import { pieceAt } from './plane';
import type { BoardIndex, GlobalSquare, Piece, Plane } from './types';

export type Vec = readonly [number, number];

const DIAGONALS: readonly Vec[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const ORTHOGONALS: readonly Vec[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const BISHOP_DIRS = DIAGONALS;
export const ROOK_DIRS = ORTHOGONALS;
export const QUEEN_DIRS: readonly Vec[] = [...DIAGONALS, ...ORTHOGONALS];

const KNIGHT_DELTAS: readonly Vec[] = [
  [1, 2],
  [2, 1],
  [-1, 2],
  [-2, 1],
  [1, -2],
  [2, -1],
  [-1, -2],
  [-2, -1],
];
const KING_DELTAS: readonly Vec[] = [...DIAGONALS, ...ORTHOGONALS];

/**
 * One reachable square along a ray, with the ORDERED list of boards ENTERED to
 * reach it (each board on the path different from the ray's origin board, in the
 * order first stepped onto). Empty while the ray is still on its origin board.
 */
export interface RayStep {
  readonly square: GlobalSquare;
  readonly entered: ReadonlyArray<BoardIndex>;
  readonly occupant: Piece | null;
}

/** A single jumper (knight/king) target with its crossing count (0 or 1). */
export interface JumpTarget {
  readonly square: GlobalSquare;
  readonly crossings: number;
}

/**
 * Walk a sliding ray from `from` in direction `dir`. A board boundary is crossed
 * whenever a step lands on a board index different from the previous square's
 * (a corner diagonal that leaves board A onto board B is one crossing). The ray
 * may cross AS MANY boundaries as the path allows: it halts only at the plane
 * wall or at the first occupied square (included as a potential capture). Each
 * reachable square carries the ordered list of boards entered so far (every
 * board distinct from the origin board, first-seen order).
 */
export const traceSlider = (plane: Plane, from: GlobalSquare, dir: Vec): readonly RayStep[] => {
  const [dx, dy] = dir;
  const steps: RayStep[] = [];
  const originBoard = boardOf(from);
  let prevBoard = originBoard;
  let entered: ReadonlyArray<BoardIndex> = [];
  let cur = from;
  for (;;) {
    const next = offset(cur, dx, dy);
    if (next === null) break; // outer plane wall
    const nb = boardOf(next);
    if (nb !== prevBoard && nb !== originBoard) {
      // Stepped onto a board we have not yet recorded for this ray. Because a
      // straight slide visits each board contiguously, nb is necessarily new.
      entered = [...entered, nb];
    }
    prevBoard = nb;
    const occupant = pieceAt(plane, next);
    steps.push({ square: next, entered, occupant });
    if (occupant !== null) break; // capture candidate or blocker — ray stops here
    cur = next;
  }
  return steps;
};

export const sliderSteps = (
  plane: Plane,
  from: GlobalSquare,
  dirs: readonly Vec[],
): readonly RayStep[] => dirs.flatMap((d) => traceSlider(plane, from, d));

const jumpTargets = (from: GlobalSquare, deltas: readonly Vec[]): readonly JumpTarget[] => {
  const fromBoard = boardOf(from);
  const out: JumpTarget[] = [];
  for (const [dx, dy] of deltas) {
    const sq = offset(from, dx, dy);
    if (sq === null) continue;
    out.push({ square: sq, crossings: boardOf(sq) === fromBoard ? 0 : 1 });
  }
  return out;
};

export const knightTargets = (from: GlobalSquare): readonly JumpTarget[] =>
  jumpTargets(from, KNIGHT_DELTAS);

export const kingTargets = (from: GlobalSquare): readonly JumpTarget[] =>
  jumpTargets(from, KING_DELTAS);
