import { BOARD_SIZE, BOARDS, GRID } from './constants';
import { mkGlobal } from './coords';
import { emptyLedger } from './ledger';
import { emptyPlane, withPieces } from './plane';
import type { BoardStatus, GameState, GlobalSquare, Piece, PieceType, Plane } from './types';

const BACK_RANK: readonly PieceType[] = [
  'rook',
  'knight',
  'bishop',
  'queen',
  'king',
  'bishop',
  'knight',
  'rook',
];

const piece = (type: PieceType, color: Piece['color']): Piece => ({ type, color, hasMoved: false });

/**
 * Standard 8x8 army laid into every one of the 9 boards. Within each board,
 * local rank 0 (top) holds black, local rank 7 (bottom) holds white. White
 * advances toward gy=0, black toward gy=23 (see `forwardDir`).
 */
const buildPlane = (): Plane => {
  const writes: Array<readonly [GlobalSquare, Piece]> = [];
  for (let board = 0; board < BOARDS; board++) {
    const bx = board % GRID;
    const by = Math.floor(board / GRID);
    for (let file = 0; file < BOARD_SIZE; file++) {
      const gx = bx * BOARD_SIZE + file;
      const gy0 = by * BOARD_SIZE;
      const back = BACK_RANK[file] ?? 'pawn';
      const placements: ReadonlyArray<readonly [number, Piece]> = [
        [gy0 + 0, piece(back, 'black')],
        [gy0 + 1, piece('pawn', 'black')],
        [gy0 + 6, piece('pawn', 'white')],
        [gy0 + 7, piece(back, 'white')],
      ];
      for (const [gy, p] of placements) {
        const sq = mkGlobal(gx, gy);
        if (sq.ok) writes.push([sq.value, p]);
      }
    }
  }
  return withPieces(emptyPlane(), writes);
};

export const initialState = (): GameState => ({
  plane: buildPlane(),
  toMove: 'white',
  ledger: emptyLedger(),
  status: Array.from({ length: BOARDS }, (): BoardStatus => ({ kind: 'active' })),
  clocks: Array.from({ length: BOARDS }, () => 0),
  enPassant: null,
  ply: 0,
});
