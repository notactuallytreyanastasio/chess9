import { boardOf, offset } from './coords';
import { pieceAt } from './plane';
import type { GlobalSquare, Piece, Plane } from './types';

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

/** One reachable square along a ray, with how many board boundaries were crossed to get there. */
export interface RayStep {
  readonly square: GlobalSquare;
  readonly crossings: number; // 0 or 1; a step that would make it 2 halts the ray instead
  readonly occupant: Piece | null;
}

/** A single jumper (knight/king) target with its crossing count (0 or 1). */
export interface JumpTarget {
  readonly square: GlobalSquare;
  readonly crossings: number;
}

/**
 * Walk a sliding ray from `from` in direction `dir`. Crossings are counted by
 * board-index CHANGE per step (a corner diagonal that leaves board A onto board
 * B is one crossing). The ray halts at: the plane wall, the first occupied
 * square (included as a potential capture), or the step that would be the 2nd
 * board change (excluded — only single-boundary moves are legal).
 */
export const traceSlider = (plane: Plane, from: GlobalSquare, dir: Vec): readonly RayStep[] => {
  const [dx, dy] = dir;
  const steps: RayStep[] = [];
  let prevBoard = boardOf(from);
  let crossings = 0;
  let cur = from;
  for (;;) {
    const next = offset(cur, dx, dy);
    if (next === null) break; // outer plane wall
    const nb = boardOf(next);
    if (nb !== prevBoard) {
      crossings += 1;
      if (crossings >= 2) break; // a single move may cross at most one boundary
    }
    prevBoard = nb;
    const occupant = pieceAt(plane, next);
    steps.push({ square: next, crossings, occupant });
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
