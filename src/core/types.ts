import type { Brand } from './brand';

// ---- Branded coordinate scalars (minted only by coords.ts smart constructors) ----
export type GX = Brand<number, 'GX'>; // 0..23 — global column
export type GY = Brand<number, 'GY'>; // 0..23 — global row
export type File = Brand<number, 'File'>; // 0..7 — column within a board
export type Rank = Brand<number, 'Rank'>; // 0..7 — row within a board
export type BoardIndex = Brand<number, 'BoardIndex'>; // 0..8, row-major: by = idx/3, bx = idx%3
export type CellIndex = Brand<number, 'CellIndex'>; // 0..575 = gy*24 + gx

export type CoordError = {
  readonly kind: 'out-of-range';
  readonly axis: 'gx' | 'gy' | 'file' | 'rank' | 'board';
  readonly value: number;
};

/** Primary spatial coordinate. All geometry is computed in this space. */
export interface GlobalSquare {
  readonly gx: GX;
  readonly gy: GY;
}

/** Derived per-board view of a GlobalSquare. */
export interface BoardSquare {
  readonly board: BoardIndex;
  readonly file: File;
  readonly rank: Rank;
}

// ---- Pieces ----
export type Color = 'white' | 'black';
export type PieceType = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
export type CrossingType = Exclude<PieceType, 'king'>; // kings never cross board boundaries
export type PromotionType = Exclude<PieceType, 'pawn' | 'king'>; // legal promotion targets

export interface Piece {
  readonly type: PieceType;
  readonly color: Color;
  /** Pawn double-step / future castling eligibility. */
  readonly hasMoved: boolean;
}

/** Plane occupancy: flat, length 576, indexed by CellIndex; null = empty. */
export type Plane = ReadonlyArray<Piece | null>;

// ---- Capture-credit ledger ----
// credits[board][color][type] = number of times `color` may cross a `type`
// piece INTO `board`. Granted to the OWNER of a piece captured on `board`.
export type CreditCounts = Readonly<Record<CrossingType, number>>;
export type BoardCredits = Readonly<Record<Color, CreditCounts>>;
export type Ledger = ReadonlyArray<BoardCredits>; // length 9, indexed by BoardIndex

// ---- Per-board lifecycle status ----
export type DrawReason = 'fifty-move' | 'insufficient-material';

export type BoardStatus =
  | { readonly kind: 'active' }
  | { readonly kind: 'check'; readonly inCheck: Color } // transient; not frozen
  | { readonly kind: 'checkmate'; readonly loser: Color; readonly winner: Color } // frozen + scored
  | { readonly kind: 'stalemate' } // frozen, unscored
  | { readonly kind: 'draw'; readonly reason: DrawReason }; // frozen, unscored
export type BoardStatuses = ReadonlyArray<BoardStatus>; // length 9

// ---- Moves (discriminated union; geometry lives in global space) ----
export interface BoundaryCrossing {
  readonly fromBoard: BoardIndex;
  readonly toBoard: BoardIndex; // board ENTERED; ledger[toBoard] is debited
  readonly creditType: CrossingType; // === piece.type
}

interface MoveBase {
  readonly from: GlobalSquare;
  readonly to: GlobalSquare;
  readonly piece: Piece; // piece standing at `from`
  readonly captured: Piece | null; // piece removed at `to` (null for en-passant)
  readonly crossing: BoundaryCrossing | null; // non-null iff exactly one boundary is crossed
}

export type CastleSide = 'king' | 'queen';

export type Move =
  | (MoveBase & { readonly kind: 'normal' })
  | (MoveBase & { readonly kind: 'double-pawn'; readonly crossing: null })
  | (MoveBase & {
      readonly kind: 'en-passant';
      readonly capturedSquare: GlobalSquare;
      readonly capturedPawn: Piece;
    })
  | (MoveBase & { readonly kind: 'promotion'; readonly promoteTo: PromotionType })
  | (MoveBase & {
      readonly kind: 'castle';
      readonly side: CastleSide;
      readonly rookFrom: GlobalSquare;
      readonly rookTo: GlobalSquare;
      readonly crossing: null; // castling is always within a single board
    });

// ---- Immutable game state ----
export interface GameState {
  readonly plane: Plane; // length 576
  readonly toMove: Color;
  readonly ledger: Ledger; // length 9
  readonly status: BoardStatuses; // length 9
  readonly clocks: ReadonlyArray<number>; // length 9 — per-board halfmoves since last pawn move/capture
  readonly enPassant: GlobalSquare | null; // valid for the current ply only
  readonly ply: number; // half-move counter (also turn parity)
}

// ---- Reducer error channel ----
export type MoveError =
  | { readonly kind: 'not-your-turn' }
  | { readonly kind: 'empty-source' }
  | { readonly kind: 'wrong-color' }
  | { readonly kind: 'frozen-board'; readonly board: BoardIndex }
  | { readonly kind: 'illegal-geometry' }
  | { readonly kind: 'path-blocked' }
  | { readonly kind: 'two-boundaries' }
  | { readonly kind: 'no-credit'; readonly crossing: BoundaryCrossing }
  | { readonly kind: 'king-cannot-cross' }
  | { readonly kind: 'leaves-king-in-check'; readonly board: BoardIndex }
  | { readonly kind: 'not-in-legal-set' };

/** Deterministic RNG injected into the bot to keep the core pure. */
export interface Rng {
  next(): number; // [0, 1)
}
