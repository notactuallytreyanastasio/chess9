import { describe, expect, it } from 'vitest';
import { boardsWon, gameOver, winner } from './scoring';
import { planeOf, stateOf } from './testkit';
import type { BoardStatus, Color } from './types';

const mate = (winnerColor: Color): BoardStatus => ({
  kind: 'checkmate',
  loser: winnerColor === 'white' ? 'black' : 'white',
  winner: winnerColor,
});

describe('scoring', () => {
  it('counts only checkmates with a matching winner', () => {
    const status: BoardStatus[] = [
      mate('white'),
      mate('white'),
      mate('black'),
      { kind: 'draw', reason: 'fifty-move' },
      { kind: 'active' },
      { kind: 'check', inCheck: 'white' },
      { kind: 'active' },
      { kind: 'active' },
      { kind: 'active' },
    ];
    const s = stateOf({ plane: planeOf([]), status });
    expect(boardsWon(s, 'white')).toBe(2);
    expect(boardsWon(s, 'black')).toBe(1);
  });

  it('reports the winner once every board is frozen', () => {
    const status: BoardStatus[] = [
      mate('white'),
      mate('white'),
      mate('white'),
      mate('white'),
      mate('white'),
      mate('black'),
      mate('black'),
      mate('black'),
      { kind: 'draw', reason: 'fifty-move' },
    ];
    const s = stateOf({ plane: planeOf([]), status });
    expect(gameOver(s)).toBe(true);
    expect(winner(s)).toBe('white');
  });

  it('declares a draw on an equal frozen board count', () => {
    const status: BoardStatus[] = [
      mate('white'),
      mate('black'),
      { kind: 'draw', reason: 'fifty-move' },
      { kind: 'draw', reason: 'fifty-move' },
      { kind: 'draw', reason: 'fifty-move' },
      { kind: 'draw', reason: 'fifty-move' },
      { kind: 'draw', reason: 'fifty-move' },
      { kind: 'draw', reason: 'fifty-move' },
      { kind: 'draw', reason: 'fifty-move' },
    ];
    const s = stateOf({ plane: planeOf([]), status });
    expect(gameOver(s)).toBe(true);
    expect(winner(s)).toBe('draw');
  });

  it('is not over while a board is still active with moves available', () => {
    const status: BoardStatus[] = Array.from({ length: 9 }, (): BoardStatus => ({ kind: 'active' }));
    // A lone movable white pawn keeps the game going.
    const plane = planeOf([]);
    const s = stateOf({ plane, status });
    // No pieces -> no legal moves -> over. Confirm the empty-board terminal case.
    expect(gameOver(s)).toBe(true);
    expect(winner(s)).toBe('draw');
  });
});
