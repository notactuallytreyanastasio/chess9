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
 * Would an attacker of `byColor`/`type` standing on `attackerBoard` actually be
 * able to capture onto the target's board? Rays are NOT clipped at seams, but a
 * cross-board capture is a real (checking) threat only when the mover could
 * legally make it under the crossing rules — i.e. it holds a same-type crossing
 * credit for EVERY board its capturing move enters: the target's board plus each
 * intermediate board (every board on the path other than the attacker's own).
 * A same-board attacker needs no credit; kings can never cross a seam.
 *
 * `entered` is the path's boards as seen tracing from the target outward (so it
 * excludes the target board and ends on the attacker's board).
 */
const threatens = (
  ledger: Ledger,
  targetBoard: BoardIndex,
  attackerBoard: BoardIndex,
  byColor: Color,
  type: PieceType,
  entered: ReadonlyArray<BoardIndex>,
): boolean => {
  if (attackerBoard === targetBoard) return true; // same-board attack needs no credit
  if (!isCrossingType(type)) return false; // kings cannot cross a seam to capture
  for (const b of entered) {
    if (b === attackerBoard) continue; // the mover starts here — not "entered"
    if (!hasCredit(ledger, b, byColor, type)) return false; // intermediate board
  }
  return hasCredit(ledger, targetBoard, byColor, type); // the board it lands on
};

/** First occupant along an unobstructed ray from `target` in `dir`, with the boards crossed to reach it. */
const firstOccupant = (
  plane: Plane,
  target: GlobalSquare,
  dir: Vec,
): { readonly occ: Piece; readonly board: BoardIndex; readonly entered: ReadonlyArray<BoardIndex> } | null => {
  const steps = traceSlider(plane, target, dir);
  const last = steps[steps.length - 1];
  if (last === undefined || last.occupant === null) return null;
  return { occ: last.occupant, board: boardOf(last.square), entered: last.entered };
};

/**
 * Is `target` attacked by any piece of `byColor`? Sliding/jumping rays cross
 * board seams freely, but a CROSS-BOARD attacker only delivers a (credit-backed)
 * check when `byColor` holds the crossing credits its capturing move would need.
 */
export const isSquareAttacked = (
  plane: Plane,
  ledger: Ledger,
  target: GlobalSquare,
  byColor: Color,
): boolean => {
  const targetBoard = boardOf(target);

  // Jumpers/pawns enter at most the target's board directly (no intermediate boards).
  const jumperFound = (occ: Piece | null, type: PieceType, square: GlobalSquare): boolean =>
    occ !== null &&
    occ.color === byColor &&
    occ.type === type &&
    threatens(ledger, targetBoard, boardOf(square), byColor, type, []);

  for (const dir of BISHOP_DIRS) {
    const hit = firstOccupant(plane, target, dir);
    if (
      hit !== null &&
      hit.occ.color === byColor &&
      (hit.occ.type === 'bishop' || hit.occ.type === 'queen') &&
      threatens(ledger, targetBoard, hit.board, byColor, hit.occ.type, hit.entered)
    ) {
      return true;
    }
  }
  for (const dir of ROOK_DIRS) {
    const hit = firstOccupant(plane, target, dir);
    if (
      hit !== null &&
      hit.occ.color === byColor &&
      (hit.occ.type === 'rook' || hit.occ.type === 'queen') &&
      threatens(ledger, targetBoard, hit.board, byColor, hit.occ.type, hit.entered)
    ) {
      return true;
    }
  }

  for (const t of knightTargets(target)) {
    if (jumperFound(pieceAt(plane, t.square), 'knight', t.square)) return true;
  }

  for (const t of kingTargets(target)) {
    if (jumperFound(pieceAt(plane, t.square), 'king', t.square)) return true;
  }

  // A byColor pawn capturing INTO target advances by forwardDir(byColor); it
  // therefore stands one step "behind" the target diagonally (possibly across a
  // seam, gated by a pawn crossing credit into the target's board).
  const fdy = forwardDir(byColor);
  for (const dx of [-1, 1] as const) {
    const from = offset(target, dx, -fdy);
    if (from !== null && jumperFound(pieceAt(plane, from), 'pawn', from)) return true;
  }

  return false;
};
