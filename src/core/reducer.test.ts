import { describe, expect, it } from 'vitest';
import { mkBoardIndex } from './coords';
import { creditCount, grantCredit, emptyLedger } from './ledger';
import { findLegalMove } from './legal';
import { pieceAt } from './plane';
import { applyMove } from './reducer';
import { initialState } from './setup';
import { pc, planeOf, sq, stateOf } from './testkit';
import type { BoardIndex, Move } from './types';

const board = (n: number): BoardIndex => {
  const r = mkBoardIndex(n);
  if (!r.ok) throw new Error('bad board');
  return r.value;
};

const need = <T>(v: T | null): T => {
  if (v === null) throw new Error('expected non-null');
  return v;
};

describe('applyMove basic legality', () => {
  it('plays a double-pawn push from the initial position', () => {
    const s = initialState();
    const move = need(findLegalMove(s, sq(4, 6), sq(4, 4)));
    const r = applyMove(s, move);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.toMove).toBe('black');
    expect(r.value.ply).toBe(1);
    expect(r.value.enPassant).toEqual(sq(4, 5));
    expect(pieceAt(r.value.plane, sq(4, 4))?.type).toBe('pawn');
    expect(pieceAt(r.value.plane, sq(4, 6))).toBeNull();
  });

  it('rejects moving out of turn and from an empty square', () => {
    const s = initialState();
    const blackPiece = pc('pawn', 'black');
    const forged: Move = { kind: 'normal', from: sq(4, 1), to: sq(4, 2), piece: blackPiece, captured: null, crossings: [] };
    expect(applyMove(s, forged)).toEqual({ ok: false, error: { kind: 'not-your-turn' } });

    const empty: Move = { kind: 'normal', from: sq(4, 4), to: sq(4, 3), piece: pc('pawn', 'white'), captured: null, crossings: [] };
    expect(applyMove(s, empty)).toEqual({ ok: false, error: { kind: 'empty-source' } });
  });
});

describe('capture-credit ledger', () => {
  it('grants exactly one credit to the VICTIM owner on the capture board', () => {
    const plane = planeOf([
      [sq(3, 3), pc('knight', 'white')],
      [sq(4, 5), pc('knight', 'black')],
    ]);
    const s = stateOf({ plane, toMove: 'white' });
    const move = need(findLegalMove(s, sq(3, 3), sq(4, 5)));
    const r = applyMove(s, move);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Victim was a black knight captured on board 0.
    expect(creditCount(r.value.ledger, board(0), 'black', 'knight')).toBe(1);
    expect(creditCount(r.value.ledger, board(0), 'white', 'knight')).toBe(0);
  });

  it('debits exactly one credit when a piece crosses a boundary', () => {
    const plane = planeOf([
      [sq(0, 0), pc('king', 'white')],
      [sq(7, 7), pc('bishop', 'white')],
      [sq(16, 16), pc('king', 'black')],
    ]);
    const ledger = grantCredit(emptyLedger(), board(4), 'white', 'bishop');
    const s = stateOf({ plane, toMove: 'white', ledger });
    expect(creditCount(s.ledger, board(4), 'white', 'bishop')).toBe(1);

    const move = need(findLegalMove(s, sq(7, 7), sq(8, 8)));
    expect(move.crossings.map((c) => c.toBoard)).toEqual([4]);
    const r = applyMove(s, move);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(creditCount(r.value.ledger, board(4), 'white', 'bishop')).toBe(0);
    expect(pieceAt(r.value.plane, sq(8, 8))?.type).toBe('bishop');
  });
});

describe('special moves', () => {
  it('promotes a pawn to a queen', () => {
    const plane = planeOf([
      [sq(3, 1), pc('pawn', 'white', true)],
      [sq(16, 16), pc('king', 'black')],
      [sq(0, 7), pc('king', 'white')],
    ]);
    const s = stateOf({ plane, toMove: 'white' });
    const move = need(findLegalMove(s, sq(3, 1), sq(3, 0), 'queen'));
    const r = applyMove(s, move);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(pieceAt(r.value.plane, sq(3, 0))).toEqual({ type: 'queen', color: 'white', hasMoved: true });
  });

  it('executes en passant: removes the bypassed pawn and grants a pawn credit', () => {
    const plane = planeOf([
      [sq(4, 3), pc('pawn', 'white', true)],
      [sq(5, 3), pc('pawn', 'black', true)],
      [sq(0, 7), pc('king', 'white')],
      [sq(16, 16), pc('king', 'black')],
    ]);
    const s = stateOf({ plane, toMove: 'white', enPassant: sq(5, 2) });
    const move = need(findLegalMove(s, sq(4, 3), sq(5, 2)));
    expect(move.kind).toBe('en-passant');
    const r = applyMove(s, move);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(pieceAt(r.value.plane, sq(5, 2))?.type).toBe('pawn');
    expect(pieceAt(r.value.plane, sq(5, 3))).toBeNull(); // bypassed pawn removed
    expect(pieceAt(r.value.plane, sq(4, 3))).toBeNull();
    expect(creditCount(r.value.ledger, board(0), 'black', 'pawn')).toBe(1);
  });
});

describe('immutability', () => {
  it('does not mutate the input state', () => {
    const s = initialState();
    Object.freeze(s.plane);
    Object.freeze(s.ledger);
    Object.freeze(s.status);
    const move = need(findLegalMove(s, sq(4, 6), sq(4, 4)));
    const r = applyMove(s, move);
    expect(r.ok).toBe(true);
    // Original untouched.
    expect(pieceAt(s.plane, sq(4, 6))?.type).toBe('pawn');
    expect(pieceAt(s.plane, sq(4, 4))).toBeNull();
    expect(s.toMove).toBe('white');
    expect(s.ply).toBe(0);
  });
});
