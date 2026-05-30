import type { Piece, PieceType } from '../core/index';

const GLYPHS: Readonly<Record<PieceType, string>> = {
  king: '♚',
  queen: '♛',
  rook: '♜',
  bishop: '♝',
  knight: '♞',
  pawn: '♟',
};

export const glyphFor = (piece: Piece): string => GLYPHS[piece.type];
