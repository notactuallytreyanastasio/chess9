import { allCells, boardOf, offset, squareAt, toBoardSquare } from './coords';
import { hasCredit } from './ledger';
import { pieceAt } from './plane';
import { forwardDir, isCrossingType } from './pieces';
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
  return s !== undefined && (s.kind === 'checkmate' || s.kind === 'stalemate');
};

const isPromotionSquare = (color: Color, to: GlobalSquare): boolean =>
  toBoardSquare(to).rank === (color === 'white' ? 0 : 7);

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
          out.push({ kind: 'promotion', from, to: one, piece, captured: null, crossing: null, promoteTo });
        }
      } else {
        out.push({ kind: 'normal', from, to: one, piece, captured: null, crossing: null });
        // Double push from the home rank.
        const two = offset(from, 0, 2 * fdy);
        if (
          !piece.hasMoved &&
          two !== null &&
          boardOf(two) === fromBoard &&
          pieceAt(state.plane, two) === null
        ) {
          out.push({ kind: 'double-pawn', from, to: two, piece, captured: null, crossing: null });
        }
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
      if (isPromotionSquare(color, to)) {
        for (const promoteTo of PROMOTIONS) {
          out.push({ kind: 'promotion', from, to, piece, captured: occ, crossing: cross.crossing, promoteTo });
        }
      } else {
        out.push({ kind: 'normal', from, to, piece, captured: occ, crossing: cross.crossing });
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
