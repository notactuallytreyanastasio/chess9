import { describe, expect, it } from 'vitest';
import { mkBoardIndex } from './coords';
import { creditCount, emptyLedger, grantCredit } from './ledger';
import { findLegalMove, legalMoves } from './legal';
import { pieceAt } from './plane';
import { applyMove } from './reducer';
import { makeRng } from './rng';
import { initialState } from './setup';
import { pc, planeOf, sq, stateOf } from './testkit';
import type { BoardIndex, GameState, Move, PieceType } from './types';

const board = (n: number): BoardIndex => {
  const r = mkBoardIndex(n);
  if (!r.ok) throw new Error('bad board');
  return r.value;
};
const need = <T>(v: T | null): T => {
  if (v === null) throw new Error('expected non-null');
  return v;
};
const step = (s: GameState, m: Move): GameState => {
  const r = applyMove(s, m);
  if (!r.ok) throw new Error(`move rejected: ${r.error.kind}`);
  return r.value;
};

describe('end-to-end earned crossing', () => {
  it('a captured piece on a board grants its owner a same-type crossing into that board', () => {
    // Black captures a WHITE bishop on the center board (board 4) -> white earns
    // a bishop credit into board 4. White then crosses a different bishop in.
    const plane = planeOf([
      [sq(0, 7), pc('king', 'white')],
      [sq(16, 16), pc('king', 'black')],
      [sq(8, 8), pc('bishop', 'white')], // victim, board 4
      [sq(10, 10), pc('bishop', 'black')], // will capture it
      [sq(7, 7), pc('bishop', 'white')], // board 0, will cross in afterwards
    ]);
    let s = stateOf({ plane, toMove: 'black' });

    s = step(s, need(findLegalMove(s, sq(10, 10), sq(8, 8)))); // black x white bishop on board 4
    expect(creditCount(s.ledger, board(4), 'white', 'bishop')).toBe(1);
    expect(s.toMove).toBe('white');

    const crossing = need(findLegalMove(s, sq(7, 7), sq(8, 8))); // white bishop crosses board 0 -> 4
    expect(crossing.crossings.map((c) => c.toBoard)).toEqual([4]);
    s = step(s, crossing);

    expect(pieceAt(s.plane, sq(8, 8))).toEqual({ type: 'bishop', color: 'white', hasMoved: true });
    expect(creditCount(s.ledger, board(4), 'white', 'bishop')).toBe(0); // spent
    expect(creditCount(s.ledger, board(4), 'black', 'bishop')).toBe(1); // black's bishop just captured there
  });

  it('a 2-board bishop slide debits a credit on BOTH entered boards', () => {
    // White bishop on board 0 slides NE through board 4 onto board 8, landing at
    // (16,16). It enters boards 4 and 8, so it requires — and spends — a bishop
    // credit on EACH.
    const plane = planeOf([
      [sq(0, 7), pc('king', 'white')],
      [sq(7, 7), pc('bishop', 'white')],
      [sq(23, 0), pc('king', 'black')],
    ]);
    let ledger = grantCredit(emptyLedger(), board(4), 'white', 'bishop');
    ledger = grantCredit(ledger, board(8), 'white', 'bishop');
    const s = stateOf({ plane, toMove: 'white', ledger });

    const slide = need(findLegalMove(s, sq(7, 7), sq(16, 16)));
    expect(slide.crossings.map((c) => c.toBoard)).toEqual([4, 8]);

    const after = step(s, slide);
    expect(pieceAt(after.plane, sq(16, 16))).toEqual({ type: 'bishop', color: 'white', hasMoved: true });
    expect(creditCount(after.ledger, board(4), 'white', 'bishop')).toBe(0); // pass-through credit spent
    expect(creditCount(after.ledger, board(8), 'white', 'bishop')).toBe(0); // landing credit spent
  });

  it('the same 2-board slide is rejected when EITHER required credit is missing', () => {
    const plane = planeOf([
      [sq(0, 7), pc('king', 'white')],
      [sq(7, 7), pc('bishop', 'white')],
      [sq(23, 0), pc('king', 'black')],
    ]);
    // Missing the board-8 (landing) credit: no legal slide reaches (16,16).
    const only4 = grantCredit(emptyLedger(), board(4), 'white', 'bishop');
    expect(findLegalMove(stateOf({ plane, toMove: 'white', ledger: only4 }), sq(7, 7), sq(16, 16))).toBeNull();

    // Missing the board-4 (pass-through) credit: the slide cannot even reach board 8.
    const only8 = grantCredit(emptyLedger(), board(8), 'white', 'bishop');
    expect(findLegalMove(stateOf({ plane, toMove: 'white', ledger: only8 }), sq(7, 7), sq(16, 16))).toBeNull();
  });
});

describe('forged illegal moves are rejected by the reducer', () => {
  const base = initialState();

  it('rejects a king attempting to cross a boundary', () => {
    const forged: Move = {
      kind: 'normal',
      from: sq(12, 15),
      to: sq(8, 15),
      piece: pc('king', 'white', true),
      captured: null,
      crossings: [{ fromBoard: board(7), toBoard: board(6), creditType: 'rook' }],
    };
    expect(applyMove(base, forged).ok).toBe(false);
  });

  it('rejects a multi-board slide when the mover lacks the required credits', () => {
    // Crossing two boundaries is now legal geometry, but from the opening position
    // no credits exist, so a queen slide entering boards 4 and 8 is still rejected
    // (no-credit on the first entered board).
    const forged: Move = {
      kind: 'normal',
      from: sq(7, 7),
      to: sq(16, 16),
      piece: pc('queen', 'white', true),
      captured: null,
      crossings: [
        { fromBoard: board(0), toBoard: board(4), creditType: 'queen' },
        { fromBoard: board(0), toBoard: board(8), creditType: 'queen' },
      ],
    };
    expect(applyMove(base, forged).ok).toBe(false);
  });

  it('rejects any move that originates on a frozen board', () => {
    const plane = planeOf([
      [sq(0, 7), pc('king', 'white')],
      [sq(3, 3), pc('rook', 'white')],
      [sq(16, 16), pc('king', 'black')],
    ]);
    const status = base.status.slice();
    status[0] = { kind: 'checkmate', loser: 'black', winner: 'white' };
    const s = stateOf({ plane, toMove: 'white', status });
    const forged: Move = { kind: 'normal', from: sq(3, 3), to: sq(3, 4), piece: pc('rook', 'white', true), captured: null, crossings: [] };
    const r = applyMove(s, forged);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('frozen-board');
  });
});

describe('en passant target expires after one ply', () => {
  it('clears the en-passant square once another move is played', () => {
    let s = initialState();
    s = step(s, need(findLegalMove(s, sq(4, 6), sq(4, 4)))); // white double push -> sets en-passant
    expect(s.enPassant).not.toBeNull();
    s = step(s, need(findLegalMove(s, sq(4, 1), sq(4, 3)))); // black replies elsewhere
    expect(s.enPassant).not.toBeNull(); // black's own double push sets a new one
    s = step(s, need(findLegalMove(s, sq(0, 6), sq(0, 5)))); // a quiet white move
    expect(s.enPassant).toBeNull();
  });
});

describe('seeded random game keeps the reducer consistent', () => {
  it('plays 80 legal plies without violating any invariant', () => {
    const rng = makeRng(123456);
    let s = initialState();
    const types: readonly PieceType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen'];

    for (let ply = 0; ply < 80; ply++) {
      const moves = legalMoves(s);
      if (moves.length === 0) break;
      const move = moves[Math.floor(rng.next() * moves.length)];
      if (move === undefined) break;

      const before = s;
      s = step(s, move);

      // Invariants after every move.
      expect(s.toMove).not.toBe(before.toMove); // turn alternates
      expect(s.ply).toBe(before.ply + 1);
      expect(s.status).toHaveLength(9);
      expect(s.plane).toHaveLength(576);
      for (let b = 0; b < 9; b++) {
        for (const color of ['white', 'black'] as const) {
          for (const t of types) {
            if (t === 'king') continue;
            const c = creditCount(s.ledger, board(b), color, t);
            expect(c).toBeGreaterThanOrEqual(0); // never negative (no double-spend)
            expect(Number.isInteger(c)).toBe(true);
          }
        }
      }
    }
  });
});
