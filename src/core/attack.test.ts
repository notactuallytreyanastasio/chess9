import { describe, expect, it } from 'vitest';
import { isSquareAttacked } from './attack';
import { boardOf } from './coords';
import { emptyLedger, grantCredit } from './ledger';
import { pc, planeOf, sq } from './testkit';

const noCredit = emptyLedger();

describe('isSquareAttacked', () => {
  it('detects a same-board rook on the rank (no credit needed)', () => {
    const plane = planeOf([[sq(0, 0), pc('rook', 'white')]]);
    expect(isSquareAttacked(plane, noCredit, sq(5, 0), 'white')).toBe(true);
    expect(isSquareAttacked(plane, noCredit, sq(5, 1), 'white')).toBe(false);
  });

  it('detects an aligned slider across a seam ONLY when a crossing credit is held', () => {
    // White rook on board 1 (gx 8) aligned with target on board 0 (gx 5) along
    // rank 0. Un-clipped the ray reaches across the seam, but the cross-board
    // attack is credit-backed: it only checks when white holds a rook credit
    // INTO the target's board (board 0).
    const plane = planeOf([[sq(8, 0), pc('rook', 'white')]]);
    const targetBoard = boardOf(sq(5, 0));

    // Without a credit: ray crosses the seam but no credit -> no check.
    expect(isSquareAttacked(plane, noCredit, sq(5, 0), 'white')).toBe(false);

    // Toggle the credit on: now the cross-board rook gives check.
    const withRook = grantCredit(emptyLedger(), targetBoard, 'white', 'rook');
    expect(isSquareAttacked(plane, withRook, sq(5, 0), 'white')).toBe(true);

    // Wrong credit type (knight) does not back a rook's crossing.
    const wrongType = grantCredit(emptyLedger(), targetBoard, 'white', 'knight');
    expect(isSquareAttacked(plane, wrongType, sq(5, 0), 'white')).toBe(false);
  });

  it('detects a piece that has physically crossed onto the board (no credit needed)', () => {
    // Same rook now standing ON board 0 (gx 6) -> ordinary same-board attack.
    const plane = planeOf([[sq(6, 0), pc('rook', 'white')]]);
    expect(isSquareAttacked(plane, noCredit, sq(5, 0), 'white')).toBe(true);
  });

  it('detects a same-board knight without a credit', () => {
    const onBoard = planeOf([[sq(3, 3), pc('knight', 'black')]]);
    expect(isSquareAttacked(onBoard, noCredit, sq(5, 4), 'black')).toBe(true);
  });

  it('detects a knight across a seam only with a knight credit', () => {
    // Knight on board 0 at (6,6); target on board 1 at (8,5) is one knight hop
    // away across the vertical seam (gx 7|8).
    const knight = planeOf([[sq(6, 6), pc('knight', 'black')]]);
    const target = sq(8, 5);
    const targetBoard = boardOf(target);
    expect(isSquareAttacked(knight, noCredit, target, 'black')).toBe(false);
    const withKnight = grantCredit(emptyLedger(), targetBoard, 'black', 'knight');
    expect(isSquareAttacked(knight, withKnight, target, 'black')).toBe(true);
  });

  it('pawns attack diagonally forward by color (same board, no credit)', () => {
    // White pawn at (4,4) attacks (3,3) and (5,3) (forward = -y).
    const plane = planeOf([[sq(4, 4), pc('pawn', 'white')]]);
    expect(isSquareAttacked(plane, noCredit, sq(3, 3), 'white')).toBe(true);
    expect(isSquareAttacked(plane, noCredit, sq(5, 3), 'white')).toBe(true);
    expect(isSquareAttacked(plane, noCredit, sq(4, 3), 'white')).toBe(false); // not straight ahead
    expect(isSquareAttacked(plane, noCredit, sq(3, 5), 'white')).toBe(false); // not backward
  });

  it('detects an adjacent enemy king (same board, no credit)', () => {
    const plane = planeOf([[sq(10, 10), pc('king', 'black')]]);
    expect(isSquareAttacked(plane, noCredit, sq(11, 10), 'black')).toBe(true);
  });

  it('a king never gives check across a seam (kings cannot cross)', () => {
    // Black king on board 0 at (7,10); target on board 1 at (8,10) is adjacent
    // across the seam. Even with every credit toggled, a king cannot cross.
    const plane = planeOf([[sq(7, 10), pc('king', 'black')]]);
    const target = sq(8, 10);
    const full = grantCredit(emptyLedger(), boardOf(target), 'black', 'queen');
    expect(isSquareAttacked(plane, full, target, 'black')).toBe(false);
  });
});
