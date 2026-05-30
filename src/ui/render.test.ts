// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { initialState, legalMoves, mkGlobal, type BoardStatus, type GlobalSquare } from '../core/index';
import { pc, planeOf, sq as coreSq, stateOf } from '../core/testkit';
import { render, type Handlers, type ViewModel } from './render';

const sq = (gx: number, gy: number): GlobalSquare => {
  const r = mkGlobal(gx, gy);
  if (!r.ok) throw new Error('bad square');
  return r.value;
};

const emptyVm: ViewModel = {
  selected: null,
  targets: [],
  lastMove: null,
  pendingPromotion: null,
  thinking: false,
  botMove: null,
  focused: false,
};

const noopHandlers = (): Handlers => ({
  onCell: vi.fn(),
  onPromote: vi.fn(),
  onReset: vi.fn(),
  onDismissFocus: vi.fn(),
});

const botMoveTo = (from: GlobalSquare, to: GlobalSquare): NonNullable<ViewModel['botMove']> => ({
  kind: 'normal',
  from,
  to,
  piece: { type: 'rook', color: 'black', hasMoved: true },
  captured: null,
  crossings: [],
});

describe('render', () => {
  it('paints 9 board-groups and 576 squares with the full starting army', () => {
    const root = document.createElement('div');
    render(root, initialState(), emptyVm, noopHandlers());
    expect(root.querySelectorAll('.board-group')).toHaveLength(9);
    expect(root.querySelectorAll('.sq')).toHaveLength(576);
    expect(root.querySelectorAll('.piece')).toHaveLength(9 * 32); // 32 pieces per board
  });

  it('routes a square click to the onCell handler', () => {
    const root = document.createElement('div');
    const handlers = noopHandlers();
    render(root, initialState(), emptyVm, handlers);
    // First square in the DOM is board 0, local (file 0, rank 0) = global (0,0).
    const firstCell = root.querySelector('.sq');
    expect(firstCell).not.toBeNull();
    (firstCell as HTMLButtonElement).click();
    expect(handlers.onCell).toHaveBeenCalledWith(sq(0, 0));
  });

  it('marks legal move targets', () => {
    const state = initialState();
    const from = sq(4, 6); // a white pawn
    const targets = legalMoves(state)
      .filter((m) => m.from.gx === from.gx && m.from.gy === from.gy)
      .map((m) => m.to);
    const root = document.createElement('div');
    render(root, state, { ...emptyVm, selected: from, targets }, noopHandlers());
    expect(root.querySelectorAll('.move-target').length).toBe(targets.length);
    expect(root.querySelector('.selected')).not.toBeNull();
  });

  it('rings the bot move and, when focused, zooms the board with a dismiss button', () => {
    const root = document.createElement('div');
    const handlers = noopHandlers();
    const bm = botMoveTo(sq(10, 10), sq(12, 12));
    render(root, initialState(), { ...emptyVm, botMove: bm, lastMove: bm, focused: true }, handlers);

    expect(root.querySelector('.sq.bot-to')).not.toBeNull();
    const viewport = root.querySelector('.board-viewport');
    expect(viewport?.classList.contains('is-focused')).toBe(true);

    const board = root.querySelector('.board');
    expect((board as HTMLElement | null)?.style.getPropertyValue('--z')).not.toBe('');

    const zoomOut = root.querySelector('.zoom-out');
    expect(zoomOut).not.toBeNull();
    (zoomOut as HTMLButtonElement).click();
    expect(handlers.onDismissFocus).toHaveBeenCalledOnce();
  });

  it('shows a checkmate overlay and flags a king that is in check', () => {
    const status: BoardStatus[] = Array.from({ length: 9 }, () => ({ kind: 'active' }));
    status[0] = { kind: 'checkmate', loser: 'black', winner: 'white' };
    status[4] = { kind: 'check', inCheck: 'white' };
    const plane = planeOf([[coreSq(12, 12), pc('king', 'white')]]); // a white king on board 4
    const root = document.createElement('div');
    render(root, stateOf({ plane, status }), emptyVm, noopHandlers());

    expect(root.querySelector('.board-overlay.mate-win')).not.toBeNull();
    expect(root.querySelector('.board-overlay .overlay-label')?.textContent).toBe('Checkmate');
    expect(root.querySelector('.sq.king-check')).not.toBeNull();
  });

  it('shows the promotion picker when a promotion is pending', () => {
    const root = document.createElement('div');
    render(
      root,
      initialState(),
      { ...emptyVm, pendingPromotion: { from: sq(4, 6), to: sq(4, 7) } },
      noopHandlers(),
    );
    expect(root.querySelector('.overlay')).not.toBeNull();
    expect(root.querySelectorAll('.promo-btn')).toHaveLength(4);
  });
});
