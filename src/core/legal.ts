import { boardOf } from './coords';
import { ownKingsInCheck } from './check';
import { pseudoLegalMoves } from './moveGen';
import { applyUnchecked } from './reducer';
import type { BoardIndex, GameState, GlobalSquare, Move, PromotionType } from './types';

/**
 * Does `move` leave ANY of the mover's own kings in check anywhere on the plane?
 * Because attack rays cross seams (un-clipped), a move can open a line onto a
 * king on a DIFFERENT board than the one it touches, so king-safety must scan
 * all of the mover's kings — not just the touched boards.
 */
const leavesOwnKingInCheck = (state: GameState, move: Move): boolean =>
  ownKingsInCheck(applyUnchecked(state, move), move.piece.color);

/** Fully legal moves for the side to move (pseudo-legal minus self-check). */
export const legalMoves = (state: GameState): readonly Move[] =>
  pseudoLegalMoves(state, state.toMove).filter((m) => !leavesOwnKingInCheck(state, m));

/** Legal moves whose destination is `board` (the only moves that can resolve a check there). */
export const movesLandingOn = (state: GameState, board: BoardIndex): readonly Move[] =>
  legalMoves(state).filter((m) => boardOf(m.to) === board);

/** Legal moves that originate on or land on `board`. */
export const movesTouching = (state: GameState, board: BoardIndex): readonly Move[] =>
  legalMoves(state).filter((m) => boardOf(m.from) === board || boardOf(m.to) === board);

/** Look up the canonical legal move matching a from/to (and optional promotion). */
export const findLegalMove = (
  state: GameState,
  from: GlobalSquare,
  to: GlobalSquare,
  promoteTo?: PromotionType,
): Move | null => {
  const matches = legalMoves(state).filter(
    (m) => m.from.gx === from.gx && m.from.gy === from.gy && m.to.gx === to.gx && m.to.gy === to.gy,
  );
  if (promoteTo !== undefined) {
    return matches.find((m) => m.kind === 'promotion' && m.promoteTo === promoteTo) ?? null;
  }
  return matches[0] ?? null;
};
