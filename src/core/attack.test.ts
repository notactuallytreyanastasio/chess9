import { describe, expect, it } from 'vitest';
import { isSquareAttacked } from './attack';
import { pc, planeOf, sq } from './testkit';

describe('isSquareAttacked', () => {
  it('detects a same-board rook on the rank', () => {
    const plane = planeOf([[sq(0, 0), pc('rook', 'white')]]);
    expect(isSquareAttacked(plane, sq(5, 0), 'white')).toBe(true);
    expect(isSquareAttacked(plane, sq(5, 1), 'white')).toBe(false);
  });

  it('does NOT detect an aligned piece on a neighbour board (ray clipped at seam)', () => {
    // White rook on board 1 (gx 8) aligned with target on board 0 (gx 5) along rank 0.
    const plane = planeOf([[sq(8, 0), pc('rook', 'white')]]);
    expect(isSquareAttacked(plane, sq(5, 0), 'white')).toBe(false);
  });

  it('detects a piece that has physically crossed onto the board', () => {
    // Same rook now standing ON board 0 (gx 6) -> ordinary same-board attack.
    const plane = planeOf([[sq(6, 0), pc('rook', 'white')]]);
    expect(isSquareAttacked(plane, sq(5, 0), 'white')).toBe(true);
  });

  it('detects knight attacks but not across a seam', () => {
    const onBoard = planeOf([[sq(3, 3), pc('knight', 'black')]]);
    expect(isSquareAttacked(onBoard, sq(5, 4), 'black')).toBe(true);
  });

  it('pawns attack diagonally forward by color', () => {
    // White pawn at (4,4) attacks (3,3) and (5,3) (forward = -y).
    const plane = planeOf([[sq(4, 4), pc('pawn', 'white')]]);
    expect(isSquareAttacked(plane, sq(3, 3), 'white')).toBe(true);
    expect(isSquareAttacked(plane, sq(5, 3), 'white')).toBe(true);
    expect(isSquareAttacked(plane, sq(4, 3), 'white')).toBe(false); // not straight ahead
    expect(isSquareAttacked(plane, sq(3, 5), 'white')).toBe(false); // not backward
  });

  it('detects an adjacent enemy king', () => {
    const plane = planeOf([[sq(10, 10), pc('king', 'black')]]);
    expect(isSquareAttacked(plane, sq(11, 10), 'black')).toBe(true);
  });
});
