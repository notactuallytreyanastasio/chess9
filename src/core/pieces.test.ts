import { describe, expect, it } from 'vitest';
import { forwardDir, isCrossingType, opposite, pieceValue } from './pieces';

describe('pieces', () => {
  it('opposite flips color', () => {
    expect(opposite('white')).toBe('black');
    expect(opposite('black')).toBe('white');
  });

  it('material values are ordered sensibly', () => {
    expect(pieceValue('pawn')).toBeLessThan(pieceValue('knight'));
    expect(pieceValue('bishop')).toBeGreaterThan(pieceValue('knight'));
    expect(pieceValue('rook')).toBeLessThan(pieceValue('queen'));
    expect(pieceValue('king')).toBeGreaterThan(pieceValue('queen'));
  });

  it('forwardDir is board-independent by color', () => {
    expect(forwardDir('white')).toBe(-1);
    expect(forwardDir('black')).toBe(1);
  });

  it('isCrossingType excludes the king only', () => {
    expect(isCrossingType('king')).toBe(false);
    expect(isCrossingType('pawn')).toBe(true);
    expect(isCrossingType('queen')).toBe(true);
  });
});
