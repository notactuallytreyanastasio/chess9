// Public API of the pure functional core.
export { initialState } from './setup';
export { legalMoves, movesLandingOn, movesTouching, findLegalMove } from './legal';
export { applyMove, movesMatch } from './reducer';
export { inCheck, isCheckmate, kingSquare } from './check';
export { boardsWon, gameOver, winner } from './scoring';
export { chooseMove, DEFAULT_DEPTH } from './bot';
export { evaluate, MATE_SCORE } from './eval';
export { makeRng } from './rng';
export {
  boardOf,
  toBoardSquare,
  toGlobal,
  squareAt,
  cellIndex,
  allCells,
  mkGlobal,
  sameSquare,
} from './coords';
export { pieceAt } from './plane';
export { creditCount, hasCredit } from './ledger';
export { isFrozenBoard } from './moveGen';
export { opposite } from './pieces';
export { BOARD_SIZE, GRID, PLANE, SQUARES, BOARDS } from './constants';

export type {
  GameState,
  GlobalSquare,
  BoardSquare,
  BoardIndex,
  Move,
  MoveError,
  Piece,
  PieceType,
  PromotionType,
  Color,
  BoardStatus,
  Ledger,
  Rng,
} from './types';
export type { Result } from './result';
