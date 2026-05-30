import { applyMove, initialState, type GameState, type Move } from '../core/index';

export type Listener = (state: GameState) => void;

export interface Store {
  getState(): GameState;
  /** Apply a move; returns true if it was legal and committed. */
  dispatch(move: Move): boolean;
  reset(): void;
  subscribe(listener: Listener): () => void;
}

/** Thin mutable shell around the pure reducer. Holds no game logic. */
export const createStore = (): Store => {
  let state = initialState();
  const listeners = new Set<Listener>();
  const notify = (): void => {
    for (const l of listeners) l(state);
  };
  return {
    getState: () => state,
    dispatch: (move) => {
      const result = applyMove(state, move);
      if (!result.ok) return false;
      state = result.value;
      notify();
      return true;
    },
    reset: () => {
      state = initialState();
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
