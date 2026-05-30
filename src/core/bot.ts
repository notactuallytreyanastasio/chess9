import { boardOf } from './coords';
import { inCheck } from './check';
import { isFrozenStatus } from './draws';
import { evaluate } from './eval';
import { legalMoves, movesLandingOn } from './legal';
import { opposite, pieceValue } from './pieces';
import { applyUnchecked } from './reducer';
import { gameOver } from './scoring';
import type { BoardIndex, BoardStatus, GameState, Move, Rng } from './types';

export const DEFAULT_DEPTH = 3;
const INTERIOR_BEAM = 6; // moves expanded at interior nodes
const ROOT_WIDTH = 12; // moves deepened after the shallow root scan
const TIE_EPS = 1; // centipawns treated as equal for rng tie-breaks

/**
 * Search-internal transition: applies an already-legal move and refreshes the
 * touched boards' status. Unlike the public applyMove it does NOT re-validate
 * against legalMoves, and it only pays for the expensive mate check when a
 * touched board is actually in check — keeping deep search affordable.
 */
const searchApply = (state: GameState, move: Move): GameState => {
  const applied = applyUnchecked(state, move);
  const touched = new Set<BoardIndex>([boardOf(move.from), boardOf(move.to)]);
  if (move.kind === 'en-passant') touched.add(boardOf(move.capturedSquare));

  const status: BoardStatus[] = applied.status.slice();
  const defender = applied.toMove;
  for (const b of touched) {
    const cur = status[b];
    if (cur === undefined || isFrozenStatus(cur)) continue;
    if (!inCheck(applied, b, defender)) {
      status[b] = { kind: 'active' };
    } else if (movesLandingOn(applied, b).length === 0) {
      status[b] = { kind: 'checkmate', loser: defender, winner: opposite(defender) };
    } else {
      status[b] = { kind: 'check', inCheck: defender };
    }
  }
  return { ...applied, status };
};

/** Static priority for ordering / beam pruning. */
const moveScore = (move: Move): number => {
  let s = 0;
  if (move.captured !== null) s += 10 * pieceValue(move.captured.type) - pieceValue(move.piece.type);
  if (move.kind === 'en-passant') s += 10 * pieceValue('pawn') - pieceValue('pawn');
  if (move.kind === 'promotion') s += pieceValue(move.promoteTo);
  if (move.crossing !== null) s += 25;
  return s;
};

const orderByPriority = (moves: readonly Move[]): readonly Move[] =>
  [...moves].sort((a, b) => moveScore(b) - moveScore(a));

const negamax = (state: GameState, depth: number, alpha: number, beta: number): number => {
  if (depth <= 0 || gameOver(state)) return evaluate(state, state.toMove);
  const moves = legalMoves(state);
  if (moves.length === 0) return evaluate(state, state.toMove);

  const candidates = orderByPriority(moves).slice(0, INTERIOR_BEAM);
  let best = -Infinity;
  let a = alpha;
  for (const move of candidates) {
    const score = -negamax(searchApply(state, move), depth - 1, -beta, -a);
    if (score > best) best = score;
    if (best > a) a = best;
    if (a >= beta) break; // alpha-beta cutoff
  }
  return best;
};

interface ScoredMove {
  readonly move: Move;
  readonly score: number;
}

/**
 * Score the root moves. A cheap depth-1 scan ranks every legal move (so tactics
 * like mate-in-1 and hanging captures always surface); the most promising
 * ROOT_WIDTH are then searched to full depth.
 */
const scoreRoot = (state: GameState, depth: number): readonly ScoredMove[] => {
  const moves = legalMoves(state);
  const shallow = moves
    .map((move) => ({ move, score: evaluate(searchApply(state, move), state.toMove) }))
    .sort((a, b) => b.score - a.score);
  if (depth <= 1) return shallow;

  return shallow.slice(0, ROOT_WIDTH).map(({ move }) => ({
    move,
    score: -negamax(searchApply(state, move), depth - 1, -Infinity, Infinity),
  }));
};

/**
 * Choose a move for the side to move. The rng only breaks ties among
 * equally-best moves, so the bot is never random among unequal options.
 * Returns null when there are no legal moves.
 */
export const chooseMove = (state: GameState, depth: number, rng: Rng): Move | null => {
  const scored = scoreRoot(state, depth);
  if (scored.length === 0) return null;

  const best = scored.reduce((m, s) => Math.max(m, s.score), -Infinity);
  const top = scored.filter((s) => s.score >= best - TIE_EPS).map((s) => s.move);
  const pick = Math.floor(rng.next() * top.length);
  return top[pick] ?? top[0] ?? null;
};
