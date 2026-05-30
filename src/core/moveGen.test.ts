import { describe, expect, it } from 'vitest';
import { boardOf, mkBoardIndex } from './coords';
import { emptyLedger, grantCredit } from './ledger';
import { pseudoLegalMoves } from './moveGen';
import { pc, planeOf, sq, stateOf } from './testkit';
import type { BoardIndex, BoardStatus, Move } from './types';

const board = (n: number): BoardIndex => {
  const r = mkBoardIndex(n);
  if (!r.ok) throw new Error('bad board');
  return r.value;
};

const crossings = (moves: readonly Move[]): readonly Move[] =>
  moves.filter((m) => m.crossings.length > 0);

describe('boundary crossing gating', () => {
  it('emits a bishop crossing ONLY when a bishop credit exists on the destination board', () => {
    const plane = planeOf([[sq(7, 7), pc('bishop', 'white')]]);

    const noCredit = pseudoLegalMoves(stateOf({ plane }), 'white');
    expect(crossings(noCredit)).toHaveLength(0);

    const ledger = grantCredit(emptyLedger(), board(4), 'white', 'bishop');
    const withCredit = pseudoLegalMoves(stateOf({ plane, ledger }), 'white');
    const crossed = crossings(withCredit);
    expect(crossed.length).toBeGreaterThan(0);
    expect(crossed.every((m) => boardOf(m.to) === 4)).toBe(true);
  });

  it('a 2-board bishop slide is generated ONLY when credits exist on BOTH entered boards', () => {
    // Bishop on board 0 at (7,7) sliding NE enters board 4 (pass-through) then
    // board 8, landing at (16,16). Reaching (16,16) requires a bishop credit on
    // BOTH board 4 (passed through) and board 8 (landed on).
    const plane = planeOf([[sq(7, 7), pc('bishop', 'white')]]);
    const lands8 = (moves: readonly Move[]): boolean =>
      moves.some((m) => m.to.gx === 16 && m.to.gy === 16);

    // Neither credit: the slide halts at the board-4 seam, never reaching board 8.
    expect(lands8(pseudoLegalMoves(stateOf({ plane }), 'white'))).toBe(false);

    // Only board 8 credit (missing the board-4 pass-through credit): still illegal.
    const only8 = grantCredit(emptyLedger(), board(8), 'white', 'bishop');
    expect(lands8(pseudoLegalMoves(stateOf({ plane, ledger: only8 }), 'white'))).toBe(false);

    // Only board 4 credit (missing the board-8 landing credit): reaches board 4
    // squares but not (16,16) on board 8.
    const only4 = grantCredit(emptyLedger(), board(4), 'white', 'bishop');
    const m4 = pseudoLegalMoves(stateOf({ plane, ledger: only4 }), 'white');
    expect(m4.some((m) => boardOf(m.to) === 4)).toBe(true);
    expect(lands8(m4)).toBe(false);

    // Both credits: the 2-board slide to (16,16) is generated, carrying [4, 8].
    const both = grantCredit(only4, board(8), 'white', 'bishop');
    const mBoth = pseudoLegalMoves(stateOf({ plane, ledger: both }), 'white');
    const slide = mBoth.find((m) => m.to.gx === 16 && m.to.gy === 16);
    expect(slide).toBeDefined();
    expect(slide?.crossings.map((c) => c.toBoard)).toEqual([4, 8]);
  });

  it('gates a knight L-jump by a knight credit on the destination board', () => {
    const plane = planeOf([[sq(7, 7), pc('knight', 'white')]]);
    expect(crossings(pseudoLegalMoves(stateOf({ plane }), 'white'))).toHaveLength(0);

    const ledger = grantCredit(emptyLedger(), board(4), 'white', 'knight');
    const crossed = crossings(pseudoLegalMoves(stateOf({ plane, ledger }), 'white'));
    expect(crossed.length).toBe(2); // (8,9) and (9,8) land on board 4
    expect(crossed.every((m) => boardOf(m.to) === 4)).toBe(true);
  });
});

describe('pawn rules', () => {
  it('a pawn never pushes across a board seam', () => {
    // White pawn on board 4 top edge; a forward push would cross into board 1.
    const plane = planeOf([[sq(8, 8), pc('pawn', 'white')]]);
    const moves = pseudoLegalMoves(stateOf({ plane }), 'white');
    expect(moves).toHaveLength(0); // push blocked (crosses), captures need credit
  });

  it('a pawn DOES capture diagonally across a seam with a pawn credit', () => {
    const plane = planeOf([
      [sq(8, 8), pc('pawn', 'white')],
      [sq(7, 7), pc('rook', 'black')],
    ]);
    const ledger = grantCredit(emptyLedger(), board(0), 'white', 'pawn');
    const moves = pseudoLegalMoves(stateOf({ plane, ledger }), 'white');
    const capture = moves.find((m) => m.to.gx === 7 && m.to.gy === 7);
    expect(capture).toBeDefined();
    expect(capture?.crossings.map((c) => c.toBoard)).toEqual([0]);
    expect(capture?.captured?.type).toBe('rook');
  });

  it('emits four promotion moves on reaching the last rank', () => {
    const plane = planeOf([[sq(4, 1), pc('pawn', 'white', false)]]);
    const moves = pseudoLegalMoves(stateOf({ plane }), 'white');
    const promos = moves.filter((m) => m.kind === 'promotion');
    expect(promos).toHaveLength(4);
    expect(new Set(promos.map((m) => (m.kind === 'promotion' ? m.promoteTo : '')))).toEqual(
      new Set(['queen', 'rook', 'bishop', 'knight']),
    );
  });

  it('offers a double-step from the home rank', () => {
    const plane = planeOf([[sq(4, 6), pc('pawn', 'white', false)]]);
    const moves = pseudoLegalMoves(stateOf({ plane }), 'white');
    expect(moves.some((m) => m.kind === 'double-pawn' && m.to.gy === 4)).toBe(true);
  });
});

describe('king is board-bound', () => {
  it('never emits a king move onto another board', () => {
    const plane = planeOf([[sq(7, 7), pc('king', 'white')]]);
    const moves = pseudoLegalMoves(stateOf({ plane }), 'white');
    expect(moves.every((m) => m.crossings.length === 0)).toBe(true);
    expect(moves.every((m) => boardOf(m.to) === 0)).toBe(true);
  });
});

describe('frozen boards', () => {
  const frozen = (idx: number): GameStateStatus =>
    Array.from({ length: 9 }, (_u, i): BoardStatus =>
      i === idx ? { kind: 'checkmate', loser: 'black', winner: 'white' } : { kind: 'active' },
    );
  type GameStateStatus = readonly BoardStatus[];

  it('excludes pieces standing on a frozen board', () => {
    const plane = planeOf([[sq(3, 3), pc('rook', 'white')]]);
    const moves = pseudoLegalMoves(stateOf({ plane, status: frozen(0) }), 'white');
    expect(moves).toHaveLength(0);
  });

  it('excludes crossing INTO a frozen board even with a credit', () => {
    const plane = planeOf([[sq(8, 7), pc('rook', 'white')]]); // board 1, can slide toward board 0
    const ledger = grantCredit(emptyLedger(), board(0), 'white', 'rook');
    const moves = pseudoLegalMoves(stateOf({ plane, ledger, status: frozen(0) }), 'white');
    expect(moves.every((m) => boardOf(m.to) !== 0)).toBe(true);
  });
});
