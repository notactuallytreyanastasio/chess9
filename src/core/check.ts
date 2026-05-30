import { isSquareAttacked } from './attack';
import { BOARD_SIZE } from './constants';
import { allCells, boardOrigin, offset, squareAt } from './coords';
import { movesLandingOn } from './legal';
import { opposite } from './pieces';
import { pieceAt } from './plane';
import type { BoardIndex, Color, GameState, GlobalSquare, Plane } from './types';

/** Locate `color`'s king on `board`, or null if it isn't there. */
export const kingSquare = (plane: Plane, board: BoardIndex, color: Color): GlobalSquare | null => {
  const origin = boardOrigin(board);
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let f = 0; f < BOARD_SIZE; f++) {
      const s = offset(origin, f, r);
      if (s === null) continue;
      const p = pieceAt(plane, s);
      if (p !== null && p.type === 'king' && p.color === color) return s;
    }
  }
  return null;
};

/** Is `color`'s king on `board` currently in check? */
export const inCheck = (state: GameState, board: BoardIndex, color: Color): boolean => {
  const ks = kingSquare(state.plane, board, color);
  return ks !== null && isSquareAttacked(state.plane, state.ledger, ks, opposite(color));
};

/**
 * Is ANY of `color`'s kings — anywhere on the plane — currently in check? Used
 * for king-safety after a move: since attack rays cross board seams, a move can
 * expose a king on a board it never touched, so all of the mover's kings must
 * be scanned (not just the touched boards).
 */
export const ownKingsInCheck = (state: GameState, color: Color): boolean => {
  const enemy = opposite(color);
  for (const cell of allCells()) {
    const p = state.plane[cell];
    if (p === null || p === undefined || p.type !== 'king' || p.color !== color) continue;
    if (isSquareAttacked(state.plane, state.ledger, squareAt(cell), enemy)) return true;
  }
  return false;
};

/**
 * Checkmate for the side to move on `board`: in check, and no legal move LANDS
 * on the board (legal moves are already self-check-free, so any move landing
 * here resolves the check; if none exists it's mate). Credited cross-board
 * defenders are included automatically because they land on the board.
 */
export const isCheckmate = (state: GameState, board: BoardIndex): boolean =>
  inCheck(state, board, state.toMove) && movesLandingOn(state, board).length === 0;
