import './styles.css';
import {
  DEFAULT_DEPTH,
  chooseMove,
  findLegalMove,
  gameOver,
  legalMoves,
  makeRng,
  pieceAt,
  sameSquare,
  type Color,
  type GameState,
  type GlobalSquare,
  type Move,
  type PromotionType,
} from '../core/index';
import { render, type Handlers, type ViewModel } from './render';
import { createStore } from './store';

const HUMAN: Color = 'white';
const BOT_THINK_MS = 180;

const root = document.getElementById('app');
if (root === null) throw new Error('Missing #app mount point');
const mount = root;

const store = createStore();
const rng = makeRng((Date.now() & 0xffffffff) >>> 0); // shell may use Date; the core stays pure

let selected: GlobalSquare | null = null;
let targets: ReadonlyArray<GlobalSquare> = [];
let lastMove: Move | null = null;
let pendingPromotion: { readonly from: GlobalSquare; readonly to: GlobalSquare } | null = null;
let thinking = false;

const movesFrom = (state: GameState, from: GlobalSquare): readonly Move[] =>
  legalMoves(state).filter((m) => sameSquare(m.from, from));

const clearSelection = (): void => {
  selected = null;
  targets = [];
};

const view = (): void => {
  const vm: ViewModel = { selected, targets, lastMove, pendingPromotion, thinking };
  render(mount, store.getState(), vm, handlers);
};

const runBotIfNeeded = (): void => {
  const state = store.getState();
  if (gameOver(state) || state.toMove === HUMAN) return;
  thinking = true;
  view();
  // Defer so the "thinking" frame paints before the (synchronous) search runs.
  window.setTimeout(() => {
    const current = store.getState();
    if (gameOver(current) || current.toMove === HUMAN) {
      thinking = false;
      view();
      return;
    }
    const move = chooseMove(current, DEFAULT_DEPTH, rng);
    thinking = false;
    if (move !== null && store.dispatch(move)) lastMove = move;
    view();
    runBotIfNeeded(); // safe no-op once it is the human's turn
  }, BOT_THINK_MS);
};

const commit = (move: Move): void => {
  if (store.dispatch(move)) {
    lastMove = move;
    clearSelection();
    pendingPromotion = null;
  }
  view();
  runBotIfNeeded();
};

const onCell = (sq: GlobalSquare): void => {
  const state = store.getState();
  if (thinking || pendingPromotion !== null || gameOver(state) || state.toMove !== HUMAN) return;

  if (selected !== null) {
    const toSquare = movesFrom(state, selected).filter((m) => sameSquare(m.to, sq));
    const first = toSquare[0];
    if (first !== undefined) {
      if (toSquare.some((m) => m.kind === 'promotion')) {
        pendingPromotion = { from: selected, to: sq };
        view();
        return;
      }
      commit(first);
      return;
    }
  }

  const piece = pieceAt(state.plane, sq);
  if (piece !== null && piece.color === HUMAN) {
    selected = sq;
    targets = movesFrom(state, sq).map((m) => m.to);
  } else {
    clearSelection();
  }
  view();
};

const onPromote = (choice: PromotionType | null): void => {
  const pending = pendingPromotion;
  pendingPromotion = null;
  if (choice === null || pending === null) {
    clearSelection();
    view();
    return;
  }
  const move = findLegalMove(store.getState(), pending.from, pending.to, choice);
  if (move !== null) {
    commit(move);
  } else {
    clearSelection();
    view();
  }
};

const onReset = (): void => {
  store.reset();
  clearSelection();
  lastMove = null;
  pendingPromotion = null;
  thinking = false;
  view();
};

const handlers: Handlers = { onCell, onPromote, onReset };

view();
