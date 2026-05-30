import { boardOf, offset } from './coords';
import { hasCredit } from './ledger';
import { pieceAt } from './plane';
import { forwardDir, isCrossingType } from './pieces';
import {
  knightTargets,
  kingTargets,
  traceSlider,
  BISHOP_DIRS,
  ROOK_DIRS,
  type Vec,
} from './rays';
import type { BoardIndex, Color, GlobalSquare, Ledger, Piece, PieceType, Plane } from './types';

/**
 * Does an attacker of `byColor`/`type` reaching `target` across `crossings`
 * board boundaries actually deliver check?
 *
 * Rays are NOT clipped at seams: a same-board attacker (crossings === 0) always
 * counts. A cross-board attacker (crossings === 1) is one seam away on an
 * adjacent board and only counts when it HOLDS a same-type crossing credit for
 * the board it would ENTER to make the capture (the target's board) — i.e. it
 * could legally make the capturing move under the crossing rules. Kings cannot
 * cross, so a cross-board king never threatens.
 */
const threatens = (
  ledger: Ledger,
  targetBoard: BoardIndex,
  byColor: Color,
  type: PieceType,
  crossings: number,
): boolean => {
  if (crossings === 0) return true; // same-board attack needs no credit
  if (!isCrossingType(type)) return false; // kings cannot cross a seam to capture
  return hasCredit(ledger, targetBoard, byColor, type);
};

/**
 * First occupant along a ray from `target` in `dir`, with how many board
 * boundaries were crossed to reach it (0 or 1). The ray is unobstructed across
 * seams but, like a real move, may cross at most one boundary — `traceSlider`
 * already halts before a second board change and at the first occupant.
 */
const firstOccupant = (
  plane: Plane,
  target: GlobalSquare,
  dir: Vec,
): { readonly occ: Piece; readonly crossings: number } | null => {
  const steps = traceSlider(plane, target, dir);
  const last = steps[steps.length - 1];
  if (last === undefined || last.occupant === null) return null;
  return { occ: last.occupant, crossings: last.crossings };
};

/**
 * Is `target` attacked by any piece of `byColor`? Sliding/jumping rays cross
 * board seams freely, but a CROSS-BOARD attacker only delivers a (credit-backed)
 * check when `byColor` holds a matching crossing credit into the target's board.
 * Same-board attackers need no credit; kings can never cross a seam.
 */
export const isSquareAttacked = (
  plane: Plane,
  ledger: Ledger,
  target: GlobalSquare,
  byColor: Color,
): boolean => {
  const targetBoard = boardOf(target);

  const found = (occ: Piece | null, type: PieceType, crossings: number): boolean =>
    occ !== null &&
    occ.color === byColor &&
    occ.type === type &&
    threatens(ledger, targetBoard, byColor, type, crossings);

  for (const dir of BISHOP_DIRS) {
    const hit = firstOccupant(plane, target, dir);
    if (hit !== null && hit.occ.color === byColor && (hit.occ.type === 'bishop' || hit.occ.type === 'queen')) {
      if (threatens(ledger, targetBoard, byColor, hit.occ.type, hit.crossings)) return true;
    }
  }
  for (const dir of ROOK_DIRS) {
    const hit = firstOccupant(plane, target, dir);
    if (hit !== null && hit.occ.color === byColor && (hit.occ.type === 'rook' || hit.occ.type === 'queen')) {
      if (threatens(ledger, targetBoard, byColor, hit.occ.type, hit.crossings)) return true;
    }
  }

  for (const t of knightTargets(target)) {
    if (found(pieceAt(plane, t.square), 'knight', t.crossings)) return true;
  }

  for (const t of kingTargets(target)) {
    if (found(pieceAt(plane, t.square), 'king', t.crossings)) return true;
  }

  // A byColor pawn capturing INTO target advances by forwardDir(byColor); it
  // therefore stands one step "behind" the target diagonally (possibly across a
  // seam, gated by a pawn crossing credit).
  const fdy = forwardDir(byColor);
  for (const dx of [-1, 1] as const) {
    const from = offset(target, dx, -fdy);
    if (from === null) continue;
    const crossings = boardOf(from) === targetBoard ? 0 : 1;
    if (found(pieceAt(plane, from), 'pawn', crossings)) return true;
  }

  return false;
};
