import { isSquareAttacked } from './attack';
import { kingSquare } from './check';
import { boardOf } from './coords';
import { pseudoLegalMoves } from './moveGen';
import { withPieces } from './plane';
import { opposite, pieceValue } from './pieces';
import type { Color, CrossingType, GameState, Move, Plane } from './types';

export const MATE_SCORE = 1_000_000; // dominates all material so "most checkmates" drives play
const CHECK_BONUS = 40;
const MOBILITY_WEIGHT = 2;
const CREDIT_BONUS = 8; // latent optionality of merely holding a crossing credit
const CROSS_OPTION = 6; // an actually-playable crossing move
const CROSS_CHECK = 70; // a crossing that delivers check on the destination board
const CROSS_CAPTURE_DIV = 8; // share of captured material credited to a crossing threat
const CREDIT_TYPES: readonly CrossingType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen'];

const signFor = (color: Color): 1 | -1 => (color === 'white' ? 1 : -1);

/** Does this crossing move land a piece that attacks the enemy king on the destination board? */
const crossingChecks = (plane: Plane, move: Move, color: Color): boolean => {
  const moved = { type: move.piece.type, color, hasMoved: true };
  const sim = withPieces(plane, [
    [move.from, null],
    [move.to, moved],
  ]);
  const ks = kingSquare(sim, boardOf(move.to), opposite(color));
  return ks !== null && isSquareAttacked(sim, ks, color);
};

/**
 * Cross-board pressure for `color`: rewards credits that translate into real
 * crossing moves — especially those that check the enemy king or win material
 * on the board they enter. Crossing moves are rare (gated by credits), so the
 * per-move simulation here is cheap in practice.
 */
const crossThreat = (state: GameState, color: Color, moves: readonly Move[]): number => {
  let bonus = 0;
  for (const move of moves) {
    if (move.crossings.length === 0) continue;
    bonus += CROSS_OPTION * move.crossings.length;
    if (move.captured !== null) bonus += pieceValue(move.captured.type) / CROSS_CAPTURE_DIV;
    if (crossingChecks(state.plane, move, color)) bonus += CROSS_CHECK;
  }
  return bonus;
};

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

  const whiteMoves = pseudoLegalMoves(state, 'white');
  const blackMoves = pseudoLegalMoves(state, 'black');
  white += MOBILITY_WEIGHT * (whiteMoves.length - blackMoves.length);
  white += crossThreat(state, 'white', whiteMoves) - crossThreat(state, 'black', blackMoves);

  for (const board of state.ledger) {
    for (const color of ['white', 'black'] as const) {
      for (const type of CREDIT_TYPES) {
        white += signFor(color) * CREDIT_BONUS * board[color][type];
      }
    }
  }

  return signFor(perspective) * white;
};
