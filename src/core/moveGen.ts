import { isSquareAttacked } from './attack';
import { PLANE } from './constants';
import { isFrozenStatus } from './draws';
import { allCells, boardOf, boardOrigin, offset, squareAt } from './coords';
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

/** The plane's outer-edge rank a pawn of `color` promotes on (white gy=0, black gy=23). */
const planeEdgeRank = (color: Color): number => (color === 'white' ? 0 : PLANE - 1);

/**
 * A pawn move promotes when it lands on a DIFFERENT board than it left (crossing
 * a seam — straight push or diagonal capture) OR when it reaches the plane's
 * outer-edge rank without crossing (standard terminal). Within-board moves that
 * reach neither do not promote.
 */
const pawnPromotes = (color: Color, fromBoard: BoardIndex, to: GlobalSquare): boolean =>
  boardOf(to) !== fromBoard || to.gy === planeEdgeRank(color);

/**
 * Resolve the boundary crossing (if any) for a non-king piece move, returning:
 *  - { ok:false } if the move crosses but is not permitted (king, or no credit)
 *  - { ok:true, crossing } otherwise (crossing is null for same-board moves)
 */
const resolveCrossing = (
  state: GameState,
  color: Color,
  piece: Piece,
  from: GlobalSquare,
  to: GlobalSquare,
): { readonly ok: true; readonly crossing: BoundaryCrossing | null } | { readonly ok: false } => {
  const fromBoard = boardOf(from);
  const toBoard = boardOf(to);
  if (fromBoard === toBoard) return { ok: true, crossing: null };
  if (!isCrossingType(piece.type)) return { ok: false }; // kings never cross
  if (!hasCredit(state.ledger, toBoard, color, piece.type)) return { ok: false };
  return { ok: true, crossing: { fromBoard, toBoard, creditType: piece.type } };
};

/** Emit a normal/promotion move (and capture variants) for a slider/knight/king step. */
const emitStep = (
  out: Move[],
  state: GameState,
  color: Color,
  piece: Piece,
  from: GlobalSquare,
  to: GlobalSquare,
  occupant: Piece | null,
): void => {
  if (occupant !== null && occupant.color === color) return; // cannot capture own
  if (isFrozenBoard(state, boardOf(to))) return; // cannot enter a frozen board
  const cross = resolveCrossing(state, color, piece, from, to);
  if (!cross.ok) return;
  out.push({ kind: 'normal', from, to, piece, captured: occupant, crossing: cross.crossing });
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
    emitStep(out, state, color, piece, from, step.square, step.occupant);
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
    emitStep(out, state, color, piece, from, t.square, pieceAt(state.plane, t.square));
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
    out.push({ kind: 'castle', side: 'king', from, to: g, piece: king, captured: null, crossing: null, rookFrom: hRook, rookTo: f });
  }

  // Queen-side: king e->c, rook a->d. Transit/land squares d(3), c(2); b(1) only needs to be empty.
  const d = at(3);
  const c = at(2);
  const b = at(1);
  const aRook = at(0);
  if (cornerRook(aRook) && empty(d) && empty(c) && empty(b) && safe(d) && safe(c) && c !== null && aRook !== null && d !== null) {
    out.push({ kind: 'castle', side: 'queen', from, to: c, piece: king, captured: null, crossing: null, rookFrom: aRook, rookTo: d });
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
    emitStep(out, state, color, piece, from, t.square, pieceAt(state.plane, t.square));
  }
  genCastle(out, state, color, piece, from);
};

/**
 * Emit a forward push or diagonal capture, promoting (Q/R/B/N variants) when the
 * destination crosses a seam or reaches the plane's outer edge, else a normal move.
 */
const emitPawnAdvance = (
  out: Move[],
  color: Color,
  piece: Piece,
  from: GlobalSquare,
  to: GlobalSquare,
  fromBoard: BoardIndex,
  captured: Piece | null,
  crossing: BoundaryCrossing | null,
): void => {
  if (pawnPromotes(color, fromBoard, to)) {
    for (const promoteTo of PROMOTIONS) {
      out.push({ kind: 'promotion', from, to, piece, captured, crossing, promoteTo });
    }
  } else {
    out.push({ kind: 'normal', from, to, piece, captured, crossing });
  }
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

  // Forward push. May cross a single seam (gated by a pawn credit for the entered
  // board); any seam crossing — or reaching the plane edge — promotes.
  const one = offset(from, 0, fdy);
  if (one !== null && pieceAt(state.plane, one) === null && !isFrozenBoard(state, boardOf(one))) {
    const cross = resolveCrossing(state, color, piece, from, one);
    if (cross.ok) {
      emitPawnAdvance(out, color, piece, from, one, fromBoard, null, cross.crossing);
      // Double push stays within the home board (never crosses, never promotes).
      const two = offset(from, 0, 2 * fdy);
      if (
        cross.crossing === null &&
        !piece.hasMoved &&
        !pawnPromotes(color, fromBoard, one) &&
        two !== null &&
        boardOf(two) === fromBoard &&
        pieceAt(state.plane, two) === null
      ) {
        out.push({ kind: 'double-pawn', from, to: two, piece, captured: null, crossing: null });
      }
    }
  }

  // Diagonal captures (may cross exactly one boundary, gated by a pawn credit).
  for (const dx of [-1, 1] as const) {
    const to = offset(from, dx, fdy);
    if (to === null) continue;
    if (isFrozenBoard(state, boardOf(to))) continue;
    const cross = resolveCrossing(state, color, piece, from, to);
    if (!cross.ok) continue;

    const occ = pieceAt(state.plane, to);
    if (occ !== null && occ.color !== color) {
      emitPawnAdvance(out, color, piece, from, to, fromBoard, occ, cross.crossing);
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
            crossing: cross.crossing,
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
