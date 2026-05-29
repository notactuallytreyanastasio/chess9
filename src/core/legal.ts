import { boardOf } from './coords';
import { kingSquare } from './check';
import { pseudoLegalMoves } from './moveGen';
import { opposite } from './pieces';
import { isSquareAttacked } from './attack';
import { applyUnchecked } from './reducer';
import type { BoardIndex, Color, GameState, GlobalSquare, Move, PromotionType } from './types';

/** Boards whose occupancy a move changes (and thus where the mover's king safety may change). */
const touchedBoards = (move: Move): readonly BoardIndex[] => {
  const set = new Set<BoardIndex>([boardOf(move.from), boardOf(move.to)]);
  if (move.kind === 'en-passant') set.add(boardOf(move.capturedSquare));
  return [...set];
};

/** Does `move` leave any of the mover's own kings (on a touched board) in check? */
const leavesOwnKingInCheck = (state: GameState, move: Move): boolean => {
  const mover: Color = move.piece.color;
  const next = applyUnchecked(state, move);
  for (const board of touchedBoards(move)) {
    const ks = kingSquare(next.plane, board, mover);
    if (ks !== null && isSquareAttacked(next.plane, ks, opposite(mover))) return true;
  }
  return false;
};

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
