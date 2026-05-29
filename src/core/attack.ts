import { boardOf, offset } from './coords';
import { pieceAt } from './plane';
import { forwardDir } from './pieces';
import { knightTargets, kingTargets, BISHOP_DIRS, ROOK_DIRS, type Vec } from './rays';
import type { Color, GlobalSquare, Piece, Plane } from './types';

/** First occupant along a direction, clipped at the target square's board boundary. */
const clippedRay = (plane: Plane, from: GlobalSquare, dir: Vec, board: number): Piece | null => {
  let cur = from;
  for (;;) {
    const next = offset(cur, dir[0], dir[1]);
    if (next === null) return null;
    if (boardOf(next) !== board) return null; // clip: standing pieces on other boards don't threaten
    const occ = pieceAt(plane, next);
    if (occ !== null) return occ;
    cur = next;
  }
};

const isEnemy = (occ: Piece | null, byColor: Color, type: Piece['type']): boolean =>
  occ !== null && occ.color === byColor && occ.type === type;

/**
 * Is `target` attacked by any piece of `byColor`? Attackers are restricted to
 * the SAME board as `target`, and sliding rays are clipped at the board
 * boundary — a piece must physically stand on the king's board to threaten it.
 */
export const isSquareAttacked = (plane: Plane, target: GlobalSquare, byColor: Color): boolean => {
  const board = boardOf(target);

  for (const dir of BISHOP_DIRS) {
    const occ = clippedRay(plane, target, dir, board);
    if (occ !== null && occ.color === byColor && (occ.type === 'bishop' || occ.type === 'queen')) {
      return true;
    }
  }
  for (const dir of ROOK_DIRS) {
    const occ = clippedRay(plane, target, dir, board);
    if (occ !== null && occ.color === byColor && (occ.type === 'rook' || occ.type === 'queen')) {
      return true;
    }
  }

  for (const t of knightTargets(target)) {
    if (t.crossings === 0 && isEnemy(pieceAt(plane, t.square), byColor, 'knight')) return true;
  }

  for (const t of kingTargets(target)) {
    if (t.crossings === 0 && isEnemy(pieceAt(plane, t.square), byColor, 'king')) return true;
  }

  // A byColor pawn capturing INTO target advances by forwardDir(byColor); it
  // therefore stands one step "behind" the target diagonally.
  const fdy = forwardDir(byColor);
  for (const dx of [-1, 1] as const) {
    const sq = offset(target, dx, -fdy);
    if (sq !== null && boardOf(sq) === board && isEnemy(pieceAt(plane, sq), byColor, 'pawn')) {
      return true;
    }
  }

  return false;
};
