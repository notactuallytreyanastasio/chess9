import {
  BOARD_SIZE,
  boardOf,
  boardsWon,
  cellIndex,
  gameOver,
  isFrozenBoard,
  mkGlobal,
  pieceAt,
  winner,
  type BoardStatus,
  type GameState,
  type GlobalSquare,
  type Move,
  type PromotionType,
} from '../core/index';
import { glyphFor } from './glyphs';

export interface ViewModel {
  readonly selected: GlobalSquare | null;
  readonly targets: ReadonlyArray<GlobalSquare>;
  readonly lastMove: Move | null;
  readonly pendingPromotion: { readonly from: GlobalSquare; readonly to: GlobalSquare } | null;
  readonly thinking: boolean;
  /** The bot's most recent move — gets a pulsing ring (and a mobile zoom when focused). */
  readonly botMove: Move | null;
  /** Whether to pan-and-zoom to the bot move (mobile). */
  readonly focused: boolean;
}

export interface Handlers {
  readonly onCell: (sq: GlobalSquare) => void;
  readonly onPromote: (choice: PromotionType | null) => void;
  readonly onReset: () => void;
  readonly onDismissFocus: () => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const STATUS_SYMBOL: Readonly<Record<BoardStatus['kind'], string>> = {
  active: '',
  check: '+',
  checkmate: '#',
  draw: '½',
};

const renderBoardMap = (state: GameState): HTMLElement => {
  const map = el('div', 'board-map');
  state.status.forEach((s) => {
    const cell = el('div', 'board-map-cell');
    if (s.kind === 'checkmate') {
      cell.classList.add(s.winner === 'white' ? 'won-white' : 'won-black');
    } else if (s.kind === 'draw') {
      cell.classList.add('drawn');
    } else if (s.kind === 'check') {
      cell.classList.add('in-check');
    }
    cell.textContent = STATUS_SYMBOL[s.kind];
    map.appendChild(cell);
  });
  return map;
};

const renderHeader = (state: GameState, vm: ViewModel, handlers: Handlers): HTMLElement => {
  const header = el('header', 'scoreboard');

  const title = el('div', 'titles');
  title.appendChild(el('h1', undefined, 'Chess-9'));
  title.appendChild(el('p', 'tagline', 'Nine boards, one continuous plane. Most checkmates wins.'));
  header.appendChild(title);

  const scores = el('div', 'scores');
  scores.appendChild(el('span', 'score score-white', `You ${boardsWon(state, 'white')}`));
  scores.appendChild(el('span', 'score score-black', `Bot ${boardsWon(state, 'black')}`));
  header.appendChild(scores);

  const over = gameOver(state);
  const w = winner(state);
  const statusText = over
    ? w === 'draw'
      ? 'Game over — drawn'
      : `Game over — ${w === 'white' ? 'you win!' : 'the bot wins'}`
    : vm.thinking
      ? 'Bot is thinking…'
      : state.toMove === 'white'
        ? 'Your move (White)'
        : "Bot's move (Black)";
  header.appendChild(el('div', 'turn', statusText));

  header.appendChild(renderBoardMap(state));

  const reset = el('button', 'reset', over ? 'Play again' : 'Restart');
  reset.addEventListener('click', () => handlers.onReset());
  header.appendChild(reset);

  return header;
};

const GRID_SIDE = 3;
const PLANE_SPAN = GRID_SIDE * BOARD_SIZE; // 24
const FOCUS_ZOOM = 2.4;

const renderBoard = (state: GameState, vm: ViewModel, handlers: Handlers): HTMLElement => {
  const board = el('div', 'board');
  const targetSet = new Set<number>(vm.targets.map((t) => cellIndex(t)));
  const selectedIdx = vm.selected !== null ? cellIndex(vm.selected) : -1;
  const lastFrom = vm.lastMove !== null ? cellIndex(vm.lastMove.from) : -1;
  const lastTo = vm.lastMove !== null ? cellIndex(vm.lastMove.to) : -1;
  const botFrom = vm.botMove !== null ? cellIndex(vm.botMove.from) : -1;
  const botTo = vm.botMove !== null ? cellIndex(vm.botMove.to) : -1;

  for (let b = 0; b < GRID_SIDE * GRID_SIDE; b++) {
    const bx = b % GRID_SIDE;
    const by = Math.floor(b / GRID_SIDE);
    const group = el('div', 'board-group');
    const groupStatus = state.status[b];

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let f = 0; f < BOARD_SIZE; f++) {
        const made = mkGlobal(bx * BOARD_SIZE + f, by * BOARD_SIZE + r);
        if (!made.ok) continue;
        const sq: GlobalSquare = made.value;
        const idx = cellIndex(sq);
        const cell = el('button', (sq.gx + sq.gy) % 2 === 0 ? 'sq light' : 'sq dark');
        cell.type = 'button';

        if (isFrozenBoard(state, boardOf(sq))) cell.classList.add('frozen');
        if (idx === selectedIdx) cell.classList.add('selected');
        if (idx === lastFrom || idx === lastTo) cell.classList.add('lastmove');
        if (idx === botFrom) cell.classList.add('bot-from');
        if (idx === botTo) cell.classList.add('bot-to');

        const piece = pieceAt(state.plane, sq);
        if (piece !== null) {
          cell.appendChild(el('span', `piece ${piece.color}`, glyphFor(piece)));
          // Flag the king under fire so its danger is visible at a glance.
          if (groupStatus?.kind === 'check' && piece.type === 'king' && piece.color === groupStatus.inCheck) {
            cell.classList.add('king-check');
          }
        }
        if (targetSet.has(idx)) cell.classList.add(piece !== null ? 'capture-target' : 'move-target');

        cell.addEventListener('click', () => handlers.onCell(sq));
        group.appendChild(cell);
      }
    }

    // A frozen board gets a clear "this game is over" overlay.
    if (groupStatus !== undefined) {
      const overlay = boardOverlay(groupStatus);
      if (overlay !== null) group.appendChild(overlay);
    }
    board.appendChild(group);
  }
  return board;
};

/** Centered overlay label for a frozen (checkmate / draw) board, or null. */
const boardOverlay = (status: BoardStatus): HTMLElement | null => {
  if (status.kind === 'checkmate') {
    const won = status.winner === 'white';
    const o = el('div', `board-overlay ${won ? 'mate-win' : 'mate-loss'}`);
    o.appendChild(el('div', 'overlay-symbol', '♚'));
    o.appendChild(el('div', 'overlay-label', 'Checkmate'));
    o.appendChild(el('div', 'overlay-sub', won ? 'You win' : 'Bot wins'));
    return o;
  }
  if (status.kind === 'draw') {
    const o = el('div', 'board-overlay drawn-overlay');
    o.appendChild(el('div', 'overlay-symbol', '½'));
    o.appendChild(el('div', 'overlay-label', 'Draw'));
    o.appendChild(el('div', 'overlay-sub', status.reason === 'fifty-move' ? '50-move' : 'Material'));
    return o;
  }
  return null;
};

const PROMO_CHOICES: ReadonlyArray<{ readonly type: PromotionType; readonly glyph: string }> = [
  { type: 'queen', glyph: '♛' },
  { type: 'rook', glyph: '♜' },
  { type: 'bishop', glyph: '♝' },
  { type: 'knight', glyph: '♞' },
];

const renderPromotion = (handlers: Handlers): HTMLElement => {
  const overlay = el('div', 'overlay');
  const dialog = el('div', 'promo-dialog');
  dialog.appendChild(el('p', 'promo-title', 'Promote to'));
  const row = el('div', 'promo-row');
  for (const choice of PROMO_CHOICES) {
    const btn = el('button', 'promo-btn', choice.glyph);
    btn.addEventListener('click', () => handlers.onPromote(choice.type));
    row.appendChild(btn);
  }
  dialog.appendChild(row);
  const cancel = el('button', 'promo-cancel', 'Cancel');
  cancel.addEventListener('click', () => handlers.onPromote(null));
  dialog.appendChild(cancel);
  overlay.appendChild(dialog);
  return overlay;
};

const renderViewport = (state: GameState, vm: ViewModel, handlers: Handlers): HTMLElement => {
  const viewport = el('div', 'board-viewport');
  const board = renderBoard(state, vm, handlers);

  if (vm.focused && vm.botMove !== null) {
    viewport.classList.add('is-focused');
    const fx = (vm.botMove.to.gx + 0.5) / PLANE_SPAN;
    const fy = (vm.botMove.to.gy + 0.5) / PLANE_SPAN;
    board.style.setProperty('--fx', String(fx));
    board.style.setProperty('--fy', String(fy));
    board.style.setProperty('--z', String(FOCUS_ZOOM));

    const zoomOut = el('button', 'zoom-out', 'Zoom out ⤢');
    zoomOut.addEventListener('click', () => handlers.onDismissFocus());
    viewport.appendChild(zoomOut);
  }

  viewport.appendChild(board);
  return viewport;
};

export const render = (
  root: HTMLElement,
  state: GameState,
  vm: ViewModel,
  handlers: Handlers,
): void => {
  root.replaceChildren();
  const app = el('div', 'app');
  app.appendChild(renderHeader(state, vm, handlers));
  app.appendChild(renderViewport(state, vm, handlers));
  root.appendChild(app);
  if (vm.pendingPromotion !== null) root.appendChild(renderPromotion(handlers));
};
