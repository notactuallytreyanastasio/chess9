import { pseudoLegalMoves } from './moveGen';
import { pieceValue } from './pieces';
import type { Color, CrossingType, GameState } from './types';

export const MATE_SCORE = 1_000_000; // dominates all material so "most checkmates" drives play
const CHECK_BONUS = 40;
const MOBILITY_WEIGHT = 2;
const CREDIT_BONUS = 12; // latent optionality of a held crossing credit
const CREDIT_TYPES: readonly CrossingType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen'];

const signFor = (color: Color): 1 | -1 => (color === 'white' ? 1 : -1);

/**
 * Static evaluation from `perspective`'s point of view. Computed white-centric
 * then negated, so evaluate(s, 'white') === -evaluate(s, 'black') (zero-sum) —
 * a requirement for negamax to behave.
 */
export const evaluate = (state: GameState, perspective: Color): number => {
  let white = 0;

  for (const s of state.status) {
    if (s.kind === 'checkmate') white += signFor(s.winner) * MATE_SCORE;
    else if (s.kind === 'check') white += signFor(s.inCheck === 'white' ? 'black' : 'white') * CHECK_BONUS;
  }

  for (const cell of state.plane) {
    if (cell !== null) white += signFor(cell.color) * pieceValue(cell.type);
  }

  white +=
    MOBILITY_WEIGHT *
    (pseudoLegalMoves(state, 'white').length - pseudoLegalMoves(state, 'black').length);

  for (const board of state.ledger) {
    for (const color of ['white', 'black'] as const) {
      for (const type of CREDIT_TYPES) {
        white += signFor(color) * CREDIT_BONUS * board[color][type];
      }
    }
  }

  return signFor(perspective) * white;
};
