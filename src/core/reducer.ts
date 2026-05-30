import { isSquareAttacked } from './attack';
import { FIFTY_MOVE_PLIES, GRID } from './constants';
import { boardOf, mkBoardIndex, mkGlobal, offset } from './coords';
import { insufficientMaterial, isFrozenStatus } from './draws';
import { debitCredit, grantCredit, hasCredit } from './ledger';
import { isFrozenBoard, pseudoLegalMoves } from './moveGen';
import { boardStatusAfter, kingSquare } from './check';
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
    clocks: state.clocks,
    enPassant,
    ply: state.ply + 1,
  };
};

/** A move resets a board's 50-move clock if it is a pawn move or a capture. */
const isProgress = (move: Move): boolean =>
  move.piece.type === 'pawn' || move.captured !== null || move.kind === 'en-passant';

const nextClocks = (
  state: GameState,
  move: Move,
  touched: ReadonlySet<BoardIndex>,
): ReadonlyArray<number> => {
  const progress = isProgress(move);
  return state.clocks.map((c, b) => {
    const status = state.status[b];
    if (status !== undefined && isFrozenStatus(status)) return c; // frozen boards stop counting
    const bi = mkBoardIndexUnsafe(b);
    return progress && touched.has(bi) ? 0 : c + 1;
  });
};

const mkBoardIndexUnsafe = (n: number): BoardIndex => {
  const r = mkBoardIndex(n);
  if (!r.ok) throw new Error(`invalid board index ${n}`);
  return r.value;
};

const recomputeStatus = (
  next: GameState,
  clocks: ReadonlyArray<number>,
  touched: ReadonlySet<BoardIndex>,
): GameState['status'] => {
  const status: BoardStatus[] = next.status.slice();
  for (let i = 0; i < status.length; i++) {
    const cur = status[i];
    if (cur === undefined || isFrozenStatus(cur)) continue; // frozen — never recompute
    const b = mkBoardIndexUnsafe(i);
    if ((clocks[i] ?? 0) >= FIFTY_MOVE_PLIES) {
      status[i] = { kind: 'draw', reason: 'fifty-move' };
      continue;
    }
    if (touched.has(b)) {
      status[i] = insufficientMaterial(next.plane, b)
        ? { kind: 'draw', reason: 'insufficient-material' }
        : boardStatusAfter(next, b);
    }
  }
  return status;
};

const touchedBoards = (move: Move): ReadonlySet<BoardIndex> => {
  const set = new Set<BoardIndex>([boardOf(move.from), boardOf(move.to)]);
  if (move.kind === 'en-passant') set.add(boardOf(move.capturedSquare));
  return set;
};

const boardGrid = (b: BoardIndex): readonly [number, number] => [b % GRID, Math.floor(b / GRID)];

/** True if a straight (rook/bishop/queen) line from `from` to `to` is obstructed. */
const pathBlocked = (state: GameState, from: GlobalSquare, to: GlobalSquare): boolean => {
  const sx = Math.sign(to.gx - from.gx);
  const sy = Math.sign(to.gy - from.gy);
  const adx = Math.abs(to.gx - from.gx);
  const ady = Math.abs(to.gy - from.gy);
  const straight = sx === 0 || sy === 0 || adx === ady;
  if (!straight) return false;
  let gx = from.gx + sx;
  let gy = from.gy + sy;
  while (gx !== to.gx || gy !== to.gy) {
    const sq = mkGlobal(gx, gy);
    if (sq.ok && pieceAt(state.plane, sq.value) !== null) return true;
    gx += sx;
    gy += sy;
  }
  return false;
};

/** Which touched board (if any) leaves the mover's king in check after the move. */
const selfCheckBoard = (state: GameState, move: Move): BoardIndex | null => {
  const next = applyUnchecked(state, move);
  const mover = move.piece.color;
  for (const b of touchedBoards(move)) {
    const ks = kingSquare(next.plane, b, mover);
    if (ks !== null && isSquareAttacked(next.plane, ks, opposite(mover))) return b;
  }
  return null;
};

/** Diagnose the precise reason a (possibly forged) move is illegal, or null if it is legal. */
const diagnose = (state: GameState, move: Move): MoveError | null => {
  if (move.piece.color !== state.toMove) return { kind: 'not-your-turn' };
  const src = pieceAt(state.plane, move.from);
  if (src === null) return { kind: 'empty-source' };
  if (src.color !== state.toMove) return { kind: 'wrong-color' };
  if (isFrozenBoard(state, boardOf(move.from))) return { kind: 'frozen-board', board: boardOf(move.from) };

  const fromBoard = boardOf(move.from);
  const toBoard = boardOf(move.to);
  if (fromBoard !== toBoard) {
    if (!isCrossingType(move.piece.type)) return { kind: 'king-cannot-cross' };
    const [fx, fy] = boardGrid(fromBoard);
    const [tx, ty] = boardGrid(toBoard);
    if (Math.abs(fx - tx) > 1 || Math.abs(fy - ty) > 1) return { kind: 'two-boundaries' };
    if (!hasCredit(state.ledger, toBoard, move.piece.color, move.piece.type)) {
      return { kind: 'no-credit', crossing: { fromBoard, toBoard, creditType: move.piece.type } };
    }
  }

  // Geometry/legality: is it generated at all, and is it self-check-free?
  const pseudo = pseudoLegalMoves(state, state.toMove);
  if (!pseudo.some((m) => movesMatch(m, move))) {
    return pathBlocked(state, move.from, move.to)
      ? { kind: 'path-blocked' }
      : { kind: 'illegal-geometry' };
  }
  const checkBoard = selfCheckBoard(state, move);
  if (checkBoard !== null) return { kind: 'leaves-king-in-check', board: checkBoard };

  return null;
};

/**
 * The ONLY public state transition. Diagnoses illegality with a precise error,
 * otherwise applies the canonical legal move (so caller metadata can't corrupt
 * state) and recomputes status for the up-to-two boards the move touched.
 */
export const applyMove = (state: GameState, move: Move): Result<GameState, MoveError> => {
  const problem = diagnose(state, move);
  if (problem !== null) return err(problem);

  const canonical = legalMoves(state).find((m) => movesMatch(m, move));
  if (canonical === undefined) return err({ kind: 'not-in-legal-set' });

  const applied = applyUnchecked(state, canonical);
  const touched = touchedBoards(canonical);
  const clocks = nextClocks(state, canonical, touched);
  const status = recomputeStatus({ ...applied, clocks }, clocks, touched);
  return ok({ ...applied, clocks, status });
};
