import { isSquareAttacked } from './attack';
import { isFrozenStatus } from './draws';
import { allCells, boardOf, boardOrigin, offset, squareAt, toBoardSquare } from './coords';
import { hasCredit } from './ledger';
import { pieceAt } from './plane';
import { forwardDir, isCrossingType, opposite } from './pieces';
import {
  BISHOP_DIRS,
  QUEEN_DIRS,
  ROOK_DIRS,
  knightTargets,
  kingTargets,
  sliderSteps,
} from './rays';
import type {
  BoardIndex,
  BoundaryCrossing,
  Color,
  GameState,
  GlobalSquare,
  Move,
  Piece,
  PromotionType,
} from './types';

const PROMOTIONS: readonly PromotionType[] = ['queen', 'rook', 'bishop', 'knight'];

export const isFrozenBoard = (state: GameState, board: BoardIndex): boolean => {
  const s = state.status[board];
  return s !== undefined && isFrozenStatus(s);
};

const isPromotionSquare = (color: Color, to: GlobalSquare): boolean =>
  toBoardSquare(to).rank === (color === 'white' ? 0 : 7);

/**
 * Boards ENTERED by a single jump/step from `from` to `to` (knights, kings, and
 * pawn diagonals all move to a directly adjacent board at most): either empty
 * (same board) or the single destination board.
 */
const enteredFor = (from: GlobalSquare, to: GlobalSquare): ReadonlyArray<BoardIndex> => {
  const toBoard = boardOf(to);
  return boardOf(from) === toBoard ? [] : [toBoard];
};

/**
 * Resolve the boundary crossings for a non-king piece move that enters the given
 * ordered list of boards (each distinct from the origin board). Returns:
 *  - { ok:false } if the move enters a board it may not (king; a frozen board; or
 *    a board for which the mover holds no same-type credit).
 *  - { ok:true, crossings } otherwise — one BoundaryCrossing per entered board
 *    (empty list for a same-board move).
 */
const resolveCrossings = (
  state: GameState,
  color: Color,
  piece: Piece,
  from: GlobalSquare,
  entered: ReadonlyArray<BoardIndex>,
): { readonly ok: true; readonly crossings: ReadonlyArray<BoundaryCrossing> } | { readonly ok: false } => {
  if (entered.length === 0) return { ok: true, crossings: [] };
  if (!isCrossingType(piece.type)) return { ok: false }; // kings never cross
  const fromBoard = boardOf(from);
  const crossings: BoundaryCrossing[] = [];
  for (const toBoard of entered) {
    if (isFrozenBoard(state, toBoard)) return { ok: false }; // may not enter a frozen board
    if (!hasCredit(state.ledger, toBoard, color, piece.type)) return { ok: false };
    crossings.push({ fromBoard, toBoard, creditType: piece.type });
  }
  return { ok: true, crossings };
};

/**
 * Emit a normal/promotion move (and capture variants) for a slider/knight step.
 * `entered` is the ordered list of boards the path enters (every board distinct
 * from the origin, pass-through included); the move is gated on a credit per
 * entered board and rejected if any entered board is frozen.
 */
const emitStep = (
  out: Move[],
  state: GameState,
  color: Color,
  piece: Piece,
  from: GlobalSquare,
  to: GlobalSquare,
  entered: ReadonlyArray<BoardIndex>,
  occupant: Piece | null,
): void => {
  if (occupant !== null && occupant.color === color) return; // cannot capture own
  const cross = resolveCrossings(state, color, piece, from, entered);
  if (!cross.ok) return;
  out.push({ kind: 'normal', from, to, piece, captured: occupant, crossings: cross.crossings });
};

const genSlider = (
  out: Move[],
  state: GameState,
  color: Color,
  piece: Piece,
  from: GlobalSquare,
  dirs: readonly (readonly [number, number])[],
): void => {
  for (const step of sliderSteps(state.plane, from, dirs)) {
    emitStep(out, state, color, piece, from, step.square, step.entered, step.occupant);
  }
};

const genKnight = (
  out: Move[],
  state: GameState,
  color: Color,
  piece: Piece,
  from: GlobalSquare,
): void => {
  for (const t of knightTargets(from)) {
    const entered = enteredFor(from, t.square);
    emitStep(out, state, color, piece, from, t.square, entered, pieceAt(state.plane, t.square));
  }
};

const HOME_RANK: Readonly<Record<Color, number>> = { white: 7, black: 0 };
const KING_HOME_FILE = 4;

/**
 * Castling (within a single board — kings never cross). Requires an unmoved
 * king and the corner rook unmoved, the squares between them empty, the king
 * not currently in check, and the two squares the king transits/lands on not
 * attacked (incl. by a piece that just crossed onto this board).
 */
const genCastle = (
  out: Move[],
  state: GameState,
  color: Color,
  king: Piece,
  from: GlobalSquare,
): void => {
  if (king.hasMoved) return;
  const origin = boardOrigin(boardOf(from));
  const localFile = from.gx - origin.gx;
  const localRank = from.gy - origin.gy;
  if (localFile !== KING_HOME_FILE || localRank !== HOME_RANK[color]) return;

  const enemy = opposite(color);
  if (isSquareAttacked(state.plane, from, enemy)) return; // cannot castle out of check

  const at = (file: number): GlobalSquare | null => offset(origin, file, localRank);
  const empty = (sq: GlobalSquare | null): boolean => sq !== null && pieceAt(state.plane, sq) === null;
  const safe = (sq: GlobalSquare | null): boolean =>
    sq !== null && !isSquareAttacked(state.plane, sq, enemy);
  const cornerRook = (sq: GlobalSquare | null): boolean => {
    if (sq === null) return false;
    const p = pieceAt(state.plane, sq);
    return p !== null && p.type === 'rook' && p.color === color && !p.hasMoved;
  };

  // King-side: king e->g, rook h->f. Transit/land squares f(5), g(6).
  const f = at(5);
  const g = at(6);
  const hRook = at(7);
  if (cornerRook(hRook) && empty(f) && empty(g) && safe(f) && safe(g) && g !== null && hRook !== null && f !== null) {
    out.push({ kind: 'castle', side: 'king', from, to: g, piece: king, captured: null, crossings: [], rookFrom: hRook, rookTo: f });
  }

  // Queen-side: king e->c, rook a->d. Transit/land squares d(3), c(2); b(1) only needs to be empty.
  const d = at(3);
  const c = at(2);
  const b = at(1);
  const aRook = at(0);
  if (cornerRook(aRook) && empty(d) && empty(c) && empty(b) && safe(d) && safe(c) && c !== null && aRook !== null && d !== null) {
    out.push({ kind: 'castle', side: 'queen', from, to: c, piece: king, captured: null, crossings: [], rookFrom: aRook, rookTo: d });
  }
};

const genKing = (
  out: Move[],
  state: GameState,
  color: Color,
  piece: Piece,
  from: GlobalSquare,
): void => {
  for (const t of kingTargets(from)) {
    if (t.crossings !== 0) continue; // kings are board-bound
    emitStep(out, state, color, piece, from, t.square, [], pieceAt(state.plane, t.square));
  }
  genCastle(out, state, color, piece, from);
};

const genPawn = (
  out: Move[],
  state: GameState,
  color: Color,
  piece: Piece,
  from: GlobalSquare,
): void => {
  const fdy = forwardDir(color);
  const fromBoard = boardOf(from);

  // Forward push (never crosses a boundary).
  const one = offset(from, 0, fdy);
  if (one !== null && boardOf(one) === fromBoard && pieceAt(state.plane, one) === null) {
    if (!isFrozenBoard(state, fromBoard)) {
      if (isPromotionSquare(color, one)) {
        for (const promoteTo of PROMOTIONS) {
          out.push({ kind: 'promotion', from, to: one, piece, captured: null, crossings: [], promoteTo });
        }
      } else {
        out.push({ kind: 'normal', from, to: one, piece, captured: null, crossings: [] });
        // Double push from the home rank.
        const two = offset(from, 0, 2 * fdy);
        if (
          !piece.hasMoved &&
          two !== null &&
          boardOf(two) === fromBoard &&
          pieceAt(state.plane, two) === null
        ) {
          out.push({ kind: 'double-pawn', from, to: two, piece, captured: null, crossings: [] });
        }
      }
    }
  }

  // Diagonal captures (may cross exactly one boundary, gated by a pawn credit).
  // Pawn move-gen is unchanged in scope: a pawn diagonal reaches a directly
  // adjacent board at most, so it enters either zero or one board.
  for (const dx of [-1, 1] as const) {
    const to = offset(from, dx, fdy);
    if (to === null) continue;
    const cross = resolveCrossings(state, color, piece, from, enteredFor(from, to));
    if (!cross.ok) continue;

    const occ = pieceAt(state.plane, to);
    if (occ !== null && occ.color !== color) {
      if (isPromotionSquare(color, to)) {
        for (const promoteTo of PROMOTIONS) {
          out.push({ kind: 'promotion', from, to, piece, captured: occ, crossings: cross.crossings, promoteTo });
        }
      } else {
        out.push({ kind: 'normal', from, to, piece, captured: occ, crossings: cross.crossings });
      }
      continue;
    }

    // En passant: the target square is empty but matches the recorded en-passant square.
    if (occ === null && state.enPassant !== null && state.enPassant.gx === to.gx && state.enPassant.gy === to.gy) {
      const capturedSquare = offset(to, 0, -fdy);
      if (capturedSquare !== null) {
        const capturedPawn = pieceAt(state.plane, capturedSquare);
        if (capturedPawn !== null && capturedPawn.type === 'pawn' && capturedPawn.color !== color) {
          out.push({
            kind: 'en-passant',
            from,
            to,
            piece,
            captured: null,
            crossings: cross.crossings,
            capturedSquare,
            capturedPawn,
          });
        }
      }
    }
  }
};

/** All pseudo-legal moves for `color` (king-safety NOT yet enforced). */
export const pseudoLegalMoves = (state: GameState, color: Color): readonly Move[] => {
  const out: Move[] = [];
  for (const cell of allCells()) {
    const piece = state.plane[cell];
    if (!piece || piece.color !== color) continue;
    const from = squareAt(cell);
    if (isFrozenBoard(state, boardOf(from))) continue;
    switch (piece.type) {
      case 'pawn':
        genPawn(out, state, color, piece, from);
        break;
      case 'knight':
        genKnight(out, state, color, piece, from);
        break;
      case 'bishop':
        genSlider(out, state, color, piece, from, BISHOP_DIRS);
        break;
      case 'rook':
        genSlider(out, state, color, piece, from, ROOK_DIRS);
        break;
      case 'queen':
        genSlider(out, state, color, piece, from, QUEEN_DIRS);
        break;
      case 'king':
        genKing(out, state, color, piece, from);
        break;
    }
  }
  return out;
};
