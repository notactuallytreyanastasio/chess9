import { BOARD_SIZE } from './constants';
import { boardOrigin, offset } from './coords';
import { pieceAt } from './plane';
import type { BoardIndex, BoardStatus, Piece, Plane } from './types';

/** A frozen board takes no further part in the game. */
export const isFrozenStatus = (s: BoardStatus): boolean =>
  s.kind === 'checkmate' || s.kind === 'stalemate' || s.kind === 'draw';

/**
 * Conservative insufficient-material test for one board: true only when neither
 * side can possibly force mate — bare kings, or a lone king vs king + a single
 * minor (knight or bishop). Anything richer (rook, queen, pawn, two minors) is
 * treated as sufficient, so we never declare a draw while a mate is still
 * forceable.
 */
export const insufficientMaterial = (plane: Plane, board: BoardIndex): boolean => {
  const origin = boardOrigin(board);
  const minors: Piece[] = [];
  let whiteKing = false;
  let blackKing = false;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let f = 0; f < BOARD_SIZE; f++) {
      const s = offset(origin, f, r);
      if (s === null) continue;
      const p = pieceAt(plane, s);
      if (p === null) continue;
      if (p.type === 'king') {
        if (p.color === 'white') whiteKing = true;
        else blackKing = true;
      } else if (p.type === 'knight' || p.type === 'bishop') {
        minors.push(p);
      } else {
        return false; // a pawn, rook, or queen exists -> mate is possible
      }
    }
  }
  // Only a genuine endgame (both kings present) with <= 1 minor is a forced draw.
  return whiteKing && blackKing && minors.length <= 1;
};
