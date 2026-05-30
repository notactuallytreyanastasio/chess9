import { describe, expect, it, vi } from 'vitest';
import { findLegalMove, mkGlobal } from '../core/index';
import { createStore } from './store';

const sq = (gx: number, gy: number) => {
  const r = mkGlobal(gx, gy);
  if (!r.ok) throw new Error('bad square');
  return r.value;
};

describe('store', () => {
  it('commits a legal move and notifies subscribers', () => {
    const store = createStore();
    const listener = vi.fn();
    store.subscribe(listener);

    const move = findLegalMove(store.getState(), sq(4, 6), sq(4, 4));
    expect(move).not.toBeNull();
    if (move === null) return;

    expect(store.dispatch(move)).toBe(true);
    expect(store.getState().ply).toBe(1);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('rejects an illegal move without changing state', () => {
    const store = createStore();
    const move = findLegalMove(store.getState(), sq(4, 6), sq(4, 4));
    if (move === null) throw new Error('no move');
    store.dispatch(move); // now black to move

    // Replaying white's move is illegal (out of turn).
    expect(store.dispatch(move)).toBe(false);
    expect(store.getState().ply).toBe(1);
  });

  it('reset returns to the initial position', () => {
    const store = createStore();
    const move = findLegalMove(store.getState(), sq(4, 6), sq(4, 4));
    if (move === null) throw new Error('no move');
    store.dispatch(move);
    store.reset();
    expect(store.getState().ply).toBe(0);
    expect(store.getState().toMove).toBe('white');
  });
});
