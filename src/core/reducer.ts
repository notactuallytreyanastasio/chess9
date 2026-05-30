import { isSquareAttacked } from './attack';
import { FIFTY_MOVE_PLIES } from './constants';
import { allCells, boardOf, mkBoardIndex, mkGlobal, offset, squareAt } from './coords';
import { insufficientMaterial, isFrozenStatus } from './draws';
import { debitCredit, grantCredit, hasCredit } from './ledger';
import { isFrozenBoard, pseudoLegalMoves } from './moveGen';
import { inCheck } from './check';
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
  for (const crossing of move.crossings) {
    const debited = debitCredit(ledger, crossing.toBoard, move.piece.color, crossing.creditType);
    if (debited.ok) ledger = debited.value; // validated moves always hold every credit
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
    if (!touched.has(mkBoardIndexUnsafe(b))) return c; // a board no move touched does not tick
    return progress ? 0 : c + 1; // touched: reset on a pawn move/capture, else tick
  });
};

const mkBoardIndexUnsafe = (n: number): BoardIndex => {
  const r = mkBoardIndex(n);
  if (!r.ok) throw new Error(`invalid board index ${n}`);
  return r.value;
};

const recomputeStatus = (next: GameState, clocks: ReadonlyArray<number>): GameState['status'] => {
  const status: BoardStatus[] = next.status.slice();
  const legal = legalMoves(next);
  const defender = next.toMove;
  for (let i = 0; i < status.length; i++) {
    const cur = status[i];
    if (cur === undefined || isFrozenStatus(cur)) continue; // frozen — never recompute
    const b = mkBoardIndexUnsafe(i);

    // Check / checkmate is recomputed for EVERY non-frozen board: because attacks
    // cross seams, a move can mate (or check) a king on a board it never touched.
    // Checkmate is evaluated BEFORE the draw rules so a mating move is never
    // mislabeled a draw.
    if (inCheck(next, b, defender)) {
      status[i] = legal.some((m) => boardOf(m.to) === b)
        ? { kind: 'check', inCheck: defender }
        : { kind: 'checkmate', loser: defender, winner: opposite(defender) };
      continue;
    }

    // Draws apply to any non-frozen board.
    if (insufficientMaterial(next.plane, b)) {
      status[i] = { kind: 'draw', reason: 'insufficient-material' };
      continue;
    }
    if ((clocks[i] ?? 0) >= FIFTY_MOVE_PLIES) {
      status[i] = { kind: 'draw', reason: 'fifty-move' };
      continue;
    }

    // No per-board stalemate freeze: a board stays active until a real checkmate
    // or draw rule fires, keeping the arena contestable. A true no-legal-move
    // position (none anywhere, not in check) ends the whole game via gameOver().
    status[i] = { kind: 'active' };
  }
  return status;
};

const touchedBoards = (move: Move): ReadonlySet<BoardIndex> => {
  const set = new Set<BoardIndex>([boardOf(move.from), boardOf(move.to)]);
  if (move.kind === 'en-passant') set.add(boardOf(move.capturedSquare));
  return set;
};

/**
 * Ordered list of boards ENTERED walking the straight line from `from` to `to`
 * (every square's board distinct from the origin board, first-seen order). For a
 * jump (knight) or non-straight geometry the line walk still visits only the
 * endpoints conceptually, but callers guard geometry separately; here we walk the
 * grid line and, for a jump, fall back to the destination board. Returns the
 * ordered entered boards (empty for a same-board move).
 */
const enteredAlongMove = (from: GlobalSquare, to: GlobalSquare): readonly BoardIndex[] => {
  const originBoard = boardOf(from);
  const sx = Math.sign(to.gx - from.gx);
  const sy = Math.sign(to.gy - from.gy);
  const adx = Math.abs(to.gx - from.gx);
  const ady = Math.abs(to.gy - from.gy);
  const straight = (sx === 0 || sy === 0 || adx === ady) && (sx !== 0 || sy !== 0);
  // Non-straight (knight jump or forged garbage): only the destination matters.
  if (!straight) {
    const toBoard = boardOf(to);
    return toBoard === originBoard ? [] : [toBoard];
  }
  const entered: BoardIndex[] = [];
  let prevBoard = originBoard;
  let gx = from.gx + sx;
  let gy = from.gy + sy;
  for (;;) {
    const sq = mkGlobal(gx, gy);
    if (!sq.ok) break;
    const b = boardOf(sq.value);
    if (b !== prevBoard && b !== originBoard) entered.push(b);
    prevBoard = b;
    if (gx === to.gx && gy === to.gy) break;
    gx += sx;
    gy += sy;
  }
  return entered;
};

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

/**
 * Which board (if any) holds a mover's king left in check after the move. Rays
 * cross seams (un-clipped), so a move can expose ANY of the mover's kings — not
 * just one on a touched board — hence every own king on the plane is scanned.
 */
const selfCheckBoard = (state: GameState, move: Move): BoardIndex | null => {
  const next = applyUnchecked(state, move);
  const mover = move.piece.color;
  const enemy = opposite(mover);
  for (const cell of allCells()) {
    const p = next.plane[cell];
    if (p === null || p === undefined || p.type !== 'king' || p.color !== mover) continue;
    const ks = squareAt(cell);
    if (isSquareAttacked(next.plane, next.ledger, ks, enemy)) return boardOf(ks);
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
  const entered = enteredAlongMove(move.from, move.to);
  if (entered.length > 0) {
    if (!isCrossingType(move.piece.type)) return { kind: 'king-cannot-cross' };
    // A move may not enter (pass through OR land on) a frozen board.
    for (const board of entered) {
      if (isFrozenBoard(state, board)) return { kind: 'frozen-board', board };
    }
    // Every entered board needs a same-type credit; report the FIRST that lacks one.
    for (const toBoard of entered) {
      if (!hasCredit(state.ledger, toBoard, move.piece.color, move.piece.type)) {
        return { kind: 'no-credit', crossing: { fromBoard, toBoard, creditType: move.piece.type } };
      }
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
  const status = recomputeStatus({ ...applied, clocks }, clocks);
  return ok({ ...applied, clocks, status });
};
