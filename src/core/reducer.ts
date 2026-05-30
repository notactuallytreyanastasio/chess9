import { boardOf, offset } from './coords';
import { debitCredit, grantCredit } from './ledger';
import { isFrozenBoard } from './moveGen';
import { boardStatusAfter } from './check';
import { legalMoves } from './legal';
import { forwardDir, isCrossingType, opposite } from './pieces';
import { pieceAt, withPieces } from './plane';
import { err, ok, type Result } from './result';
import type {
  BoardIndex,
  BoardStatus,
  GameState,
  GlobalSquare,
  Ledger,
  Move,
  MoveError,
  Piece,
} from './types';

/** Structural identity of a move by its discriminating fields. */
export const movesMatch = (a: Move, b: Move): boolean =>
  a.kind === b.kind &&
  a.from.gx === b.from.gx &&
  a.from.gy === b.from.gy &&
  a.to.gx === b.to.gx &&
  a.to.gy === b.to.gy &&
  (a.kind === 'promotion' && b.kind === 'promotion' ? a.promoteTo === b.promoteTo : true);

const movedPiece = (move: Move): Piece =>
  move.kind === 'promotion'
    ? { type: move.promoteTo, color: move.piece.color, hasMoved: true }
    : { type: move.piece.type, color: move.piece.color, hasMoved: true };

const applyCaptureCredit = (ledger: Ledger, sq: GlobalSquare, captured: Piece): Ledger =>
  isCrossingType(captured.type)
    ? grantCredit(ledger, boardOf(sq), captured.color, captured.type)
    : ledger;

/**
 * Apply a move WITHOUT validating turn / membership / king-safety. Used by the
 * legality filter to simulate moves; never call from inside legalMoves' guard
 * via the public applyMove (would recurse). Status is left untouched here.
 */
export const applyUnchecked = (state: GameState, move: Move): GameState => {
  const moved = movedPiece(move);

  const writes: Array<readonly [GlobalSquare, Piece | null]> = [
    [move.from, null],
    [move.to, moved],
  ];
  if (move.kind === 'en-passant') writes.push([move.capturedSquare, null]);
  if (move.kind === 'castle') {
    writes.push([move.rookFrom, null]);
    writes.push([move.rookTo, { type: 'rook', color: move.piece.color, hasMoved: true }]);
  }
  const plane = withPieces(state.plane, writes);

  let ledger = state.ledger;
  if (move.kind === 'en-passant') {
    ledger = applyCaptureCredit(ledger, move.capturedSquare, move.capturedPawn);
  } else if (move.captured !== null) {
    ledger = applyCaptureCredit(ledger, move.to, move.captured);
  }
  if (move.crossing !== null) {
    const debited = debitCredit(ledger, move.crossing.toBoard, move.piece.color, move.crossing.creditType);
    if (debited.ok) ledger = debited.value; // validated moves always hold the credit
  }

  let enPassant: GlobalSquare | null = null;
  if (move.kind === 'double-pawn') {
    enPassant = offset(move.from, 0, forwardDir(move.piece.color));
  }

  return {
    plane,
    ledger,
    toMove: opposite(state.toMove),
    status: state.status,
    enPassant,
    ply: state.ply + 1,
  };
};

const recomputeTouched = (next: GameState, touched: ReadonlySet<BoardIndex>): GameState['status'] => {
  const status: BoardStatus[] = next.status.slice();
  for (const b of touched) {
    const cur = status[b];
    if (cur === undefined) continue;
    if (cur.kind === 'checkmate' || cur.kind === 'stalemate') continue; // frozen — never recompute
    status[b] = boardStatusAfter(next, b);
  }
  return status;
};

/**
 * The ONLY public state transition. Validates the move against the authoritative
 * legal set, applies the canonical legal move (so caller metadata can't corrupt
 * state), then recomputes status for the up-to-two boards the move touched.
 */
export const applyMove = (state: GameState, move: Move): Result<GameState, MoveError> => {
  if (move.piece.color !== state.toMove) return err({ kind: 'not-your-turn' });
  const src = pieceAt(state.plane, move.from);
  if (src === null) return err({ kind: 'empty-source' });
  if (src.color !== state.toMove) return err({ kind: 'wrong-color' });
  if (isFrozenBoard(state, boardOf(move.from))) {
    return err({ kind: 'frozen-board', board: boardOf(move.from) });
  }

  const canonical = legalMoves(state).find((m) => movesMatch(m, move));
  if (canonical === undefined) return err({ kind: 'not-in-legal-set' });

  const applied = applyUnchecked(state, canonical);
  const touched = new Set<BoardIndex>([boardOf(canonical.from), boardOf(canonical.to)]);
  if (canonical.kind === 'en-passant') touched.add(boardOf(canonical.capturedSquare));

  return ok({ ...applied, status: recomputeTouched(applied, touched) });
};
