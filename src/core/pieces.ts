import type { Color, CrossingType, PieceType } from './types';

export const opposite = (color: Color): Color => (color === 'white' ? 'black' : 'white');

/** Centipawn material values used by the evaluator and move ordering. */
const VALUES: Readonly<Record<PieceType, number>> = {
  pawn: 100,
  knight: 320,
  bishop: 330,
  rook: 500,
  queen: 900,
  king: 20000,
};

export const pieceValue = (type: PieceType): number => VALUES[type];

export const isCrossingType = (type: PieceType): type is CrossingType => type !== 'king';

/**
 * Forward direction in GLOBAL-Y for a pawn of `color`, board-independent so a
 * pawn that crossed boards is never confused. White advances toward gy=0 (-1),
 * black toward gy=23 (+1).
 */
export const forwardDir = (color: Color): -1 | 1 => (color === 'white' ? -1 : 1);
