/** Geometry of the 3x3 super-board. */
export const BOARD_SIZE = 8 as const; // squares per side of one chess board
export const GRID = 3 as const; // boards per side of the 3x3 super-grid
export const PLANE = BOARD_SIZE * GRID; // 24 — squares per side of the continuous plane
export const SQUARES = PLANE * PLANE; // 576 — cells in the plane
export const BOARDS = GRID * GRID; // 9 — number of boards

// Termination rules.
export const FIFTY_MOVE_PLIES = 100; // 50 full moves with no pawn move/capture on a board -> drawn
export const MAX_PLY = 600; // hard backstop so a game always terminates
