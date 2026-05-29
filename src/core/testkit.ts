// Shared test helpers (excluded from coverage). Not part of the shipped core.
import { BOARDS } from './constants';
import { mkGlobal } from './coords';
import { emptyLedger } from './ledger';
import { emptyPlane, withPieces } from './plane';
import type { BoardStatus, Color, GameState, GlobalSquare, Piece, PieceType, Plane } from './types';

export const sq = (gx: number, gy: number): GlobalSquare => {
  const r = mkGlobal(gx, gy);
  if (!r.ok) throw new Error(`bad square ${gx},${gy}`);
  return r.value;
};

export const pc = (type: PieceType, color: Color, hasMoved = true): Piece => ({
  type,
  color,
  hasMoved,
});

export const planeOf = (writes: ReadonlyArray<readonly [GlobalSquare, Piece]>): Plane =>
  withPieces(emptyPlane(), writes);

interface StateOverrides {
  readonly plane: Plane;
  readonly toMove?: Color;
  readonly enPassant?: GlobalSquare | null;
  readonly ply?: number;
  readonly status?: GameState['status'];
  readonly ledger?: GameState['ledger'];
}

export const stateOf = (o: StateOverrides): GameState => ({
  plane: o.plane,
  toMove: o.toMove ?? 'white',
  ledger: o.ledger ?? emptyLedger(),
  status: o.status ?? Array.from({ length: BOARDS }, (): BoardStatus => ({ kind: 'active' })),
  enPassant: o.enPassant ?? null,
  ply: o.ply ?? 0,
});
