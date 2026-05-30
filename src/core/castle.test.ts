import { describe, expect, it } from 'vitest';
import { findLegalMove } from './legal';
import { pieceAt } from './plane';
import { applyMove } from './reducer';
import { pc, planeOf, sq, stateOf } from './testkit';
import type { GameState, Piece } from './types';

const need = <T>(v: T | null): T => {
  if (v === null) throw new Error('expected non-null');
  return v;
};

// White king on e1 (4,7) with both rooks home on board 0; black king parked far away.
const baseSetup = (extra: ReadonlyArray<readonly [ReturnType<typeof sq>, Piece]> = []): GameState =>
  stateOf({
    plane: planeOf([
      [sq(4, 7), pc('king', 'white', false)],
      [sq(0, 7), pc('rook', 'white', false)],
      [sq(7, 7), pc('rook', 'white', false)],
      [sq(16, 16), pc('king', 'black', false)],
      ...extra,
    ]),
    toMove: 'white',
  });

const kingSide = (s: GameState) => findLegalMove(s, sq(4, 7), sq(6, 7));
const queenSide = (s: GameState) => findLegalMove(s, sq(4, 7), sq(2, 7));

describe('castling — happy path', () => {
  it('offers both sides and moves king + rook correctly (king-side)', () => {
    const s = baseSetup();
    const move = need(kingSide(s));
    expect(move.kind).toBe('castle');
    const r = applyMove(s, move);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(pieceAt(r.value.plane, sq(6, 7))?.type).toBe('king');
    expect(pieceAt(r.value.plane, sq(5, 7))?.type).toBe('rook');
    expect(pieceAt(r.value.plane, sq(4, 7))).toBeNull();
    expect(pieceAt(r.value.plane, sq(7, 7))).toBeNull();
  });

  it('moves king + rook correctly (queen-side)', () => {
    const s = baseSetup();
    const r = applyMove(s, need(queenSide(s)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(pieceAt(r.value.plane, sq(2, 7))?.type).toBe('king');
    expect(pieceAt(r.value.plane, sq(3, 7))?.type).toBe('rook');
  });
});

describe('castling — forbidden cases', () => {
  it('cannot castle out of check', () => {
    const s = baseSetup([[sq(4, 0), pc('rook', 'black')]]); // checks the king down the e-file
    expect(kingSide(s)).toBeNull();
    expect(queenSide(s)).toBeNull();
  });

  it('cannot castle THROUGH an attacked square', () => {
    const s = baseSetup([[sq(5, 0), pc('rook', 'black')]]); // attacks f1 (king-side transit)
    expect(kingSide(s)).toBeNull();
    expect(queenSide(s)).not.toBeNull(); // queen-side path is clear
  });

  it('cannot castle INTO an attacked square', () => {
    const s = baseSetup([[sq(6, 0), pc('rook', 'black')]]); // attacks g1 (king-side landing)
    expect(kingSide(s)).toBeNull();
  });

  it('is blocked by a piece that just crossed onto the board', () => {
    // A black bishop now standing ON board 0 attacks g1 along the a7-g1 diagonal.
    const s = baseSetup([[sq(4, 5), pc('bishop', 'black')]]);
    expect(kingSide(s)).toBeNull();
  });

  it('cannot castle when the king has moved', () => {
    const s = baseSetup();
    const moved = stateOf({
      plane: planeOf([
        [sq(4, 7), pc('king', 'white', true)],
        [sq(0, 7), pc('rook', 'white', false)],
        [sq(7, 7), pc('rook', 'white', false)],
        [sq(16, 16), pc('king', 'black', false)],
      ]),
      toMove: 'white',
    });
    void s;
    expect(kingSide(moved)).toBeNull();
    expect(queenSide(moved)).toBeNull();
  });

  it('cannot castle to a side whose rook has moved', () => {
    const s = stateOf({
      plane: planeOf([
        [sq(4, 7), pc('king', 'white', false)],
        [sq(0, 7), pc('rook', 'white', false)],
        [sq(7, 7), pc('rook', 'white', true)], // king-side rook has moved
        [sq(16, 16), pc('king', 'black', false)],
      ]),
      toMove: 'white',
    });
    expect(kingSide(s)).toBeNull();
    expect(queenSide(s)).not.toBeNull();
  });

  it('is blocked by a piece between king and rook', () => {
    const s = baseSetup([[sq(5, 7), pc('knight', 'white')]]); // f1 occupied
    expect(kingSide(s)).toBeNull();
    expect(queenSide(s)).not.toBeNull();
  });
});
