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
  it('does NOT push straight across a seam without a pawn credit', () => {
    // White pawn at (8,8) on board 4; a forward push (gy 8 -> 7) crosses into board 1.
    const plane = planeOf([[sq(8, 8), pc('pawn', 'white')]]);
    const moves = pseudoLegalMoves(stateOf({ plane }), 'white');
    expect(moves).toHaveLength(0); // no credit: push not generated, no captures either
  });

  it('pushes straight across a seam with a pawn credit and ALWAYS promotes on the entered board', () => {
    // White pawn at (8,8) on board 4; forward push lands on board 1 at (8,7).
    const plane = planeOf([[sq(8, 8), pc('pawn', 'white')]]);
    const ledger = grantCredit(emptyLedger(), board(1), 'white', 'pawn');
    const moves = pseudoLegalMoves(stateOf({ plane, ledger }), 'white');
    const push = moves.filter((m) => m.to.gx === 8 && m.to.gy === 7);
    expect(push).toHaveLength(4); // four promotion variants
    expect(push.every((m) => m.kind === 'promotion')).toBe(true);
    expect(push.every((m) => m.crossings.map((c) => c.toBoard).join() === '1')).toBe(true); // crosses into board 1
    expect(push.every((m) => m.captured === null)).toBe(true);
    expect(new Set(push.map((m) => (m.kind === 'promotion' ? m.promoteTo : '')))).toEqual(
      new Set(['queen', 'rook', 'bishop', 'knight']),
    );
  });

  it('a diagonal cross-capture ALWAYS promotes', () => {
    // White pawn at (8,8) capturing diagonally to (7,7) on board 0.
    const plane = planeOf([
      [sq(8, 8), pc('pawn', 'white')],
      [sq(7, 7), pc('rook', 'black')],
    ]);
    const ledger = grantCredit(emptyLedger(), board(0), 'white', 'pawn');
    const moves = pseudoLegalMoves(stateOf({ plane, ledger }), 'white');
    const cap = moves.filter((m) => m.to.gx === 7 && m.to.gy === 7);
    expect(cap).toHaveLength(4); // four promotion variants
    expect(cap.every((m) => m.kind === 'promotion')).toBe(true);
    expect(cap.every((m) => m.crossings.map((c) => c.toBoard).join() === '0')).toBe(true);
    expect(cap.every((m) => m.captured?.type === 'rook')).toBe(true);
  });

  it('promotes on a straight push to the plane outer edge (no seam crossed)', () => {
    // White pawn at (4,1) on board 0; push to gy=0 stays on board 0 but reaches the plane edge.
    const plane = planeOf([[sq(4, 1), pc('pawn', 'white')]]);
    const moves = pseudoLegalMoves(stateOf({ plane }), 'white');
    const push = moves.filter((m) => m.to.gx === 4 && m.to.gy === 0);
    expect(push).toHaveLength(4);
    expect(push.every((m) => m.kind === 'promotion' && m.crossings.length === 0)).toBe(true);
  });

  it('a within-board push that crosses no seam and is not at the plane edge does NOT promote', () => {
    // White pawn at (4,2) on board 0; push to (4,1) is interior — a plain move.
    const plane = planeOf([[sq(4, 2), pc('pawn', 'white')]]);
    const moves = pseudoLegalMoves(stateOf({ plane }), 'white');
    const push = moves.filter((m) => m.to.gx === 4 && m.to.gy === 1);
    expect(push).toHaveLength(1);
    expect(push[0]?.kind).toBe('normal');
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
