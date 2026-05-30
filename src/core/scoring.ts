import { MAX_PLY } from './constants';
import { isFrozenStatus } from './draws';
import { legalMoves } from './legal';
import type { Color, GameState } from './types';

export const boardsWon = (state: GameState, color: Color): number =>
  state.status.filter((s) => s.kind === 'checkmate' && s.winner === color).length;

const allFrozen = (state: GameState): boolean => state.status.every(isFrozenStatus);

/**
 * The game is over when every board is frozen, the side to move has no move at
 * all, or the hard ply cap is reached (a guaranteed-termination backstop).
 */
export const gameOver = (state: GameState): boolean =>
  state.ply >= MAX_PLY || allFrozen(state) || legalMoves(state).length === 0;

/** Final result once the game is over; null while still in progress. */
export const winner = (state: GameState): Color | 'draw' | null => {
  if (!gameOver(state)) return null;
  const w = boardsWon(state, 'white');
  const b = boardsWon(state, 'black');
  if (w > b) return 'white';
  if (b > w) return 'black';
  return 'draw';
};
