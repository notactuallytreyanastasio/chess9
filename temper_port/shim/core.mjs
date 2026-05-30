// Shim: exposes the TypeScript Chess-9 core API on top of the Temper-generated JS engine.
//
// The UI imports the same names it always did (initialState, legalMoves, applyMove,
// chooseMove, ...) and reads TS-shaped plain objects. The heavy logic runs in the Temper
// engine underneath. Shapes are translated at the boundary; the big Temper objects ride
// along by handle in a WeakMap so we never reconstruct an engine value from a UI value.

import * as T from '../chess9/temper.out/js/chess9/index.js';

const temperOf = new WeakMap(); // ts-view object -> underlying Temper object
const unwrap = (v) => temperOf.get(v);

// Temper field access: class fields compile to JS properties (or getters), interface
// getters compile to JS methods. This reads either uniformly.
const g = (o, k) => {
  const v = o[k];
  return typeof v === 'function' ? v.call(o) : v;
};
const coordVal = (c) => (typeof c.value === 'function' ? c.value() : c.value);

// --- enum singletons <-> strings ---
const colorToStr = (c) => (c === T.White ? 'white' : 'black');
const strToColor = (s) => (s === 'white' ? T.White : T.Black);
const TYPES = [
  ['pawn', T.Pawn], ['knight', T.Knight], ['bishop', T.Bishop],
  ['rook', T.Rook], ['queen', T.Queen], ['king', T.King],
];
const typeToStr = (t) => {
  for (const [s, v] of TYPES) if (t === v) return s;
  throw new Error('unknown piece type');
};
const strToType = (s) => {
  for (const [str, v] of TYPES) if (str === s) return v;
  throw new Error('unknown piece type ' + s);
};

// --- Temper -> TS-shaped converters ---
const convSquare = (sq) =>
  sq == null ? null : { gx: coordVal(g(sq, 'gx')), gy: coordVal(g(sq, 'gy')) };

const convPiece = (p) =>
  p == null ? null : { type: typeToStr(g(p, 'type')), color: colorToStr(g(p, 'color')), hasMoved: g(p, 'hasMoved') };

const convCrossing = (c) => ({
  fromBoard: coordVal(g(c, 'fromBoard')),
  toBoard: coordVal(g(c, 'toBoard')),
  creditType: typeToStr(g(c, 'creditType')),
});

const convStatus = (s) => {
  if (s instanceof T.StatusCheckmate) {
    return { kind: 'checkmate', loser: colorToStr(g(s, 'loser')), winner: colorToStr(g(s, 'winner')) };
  }
  if (s instanceof T.StatusCheck) return { kind: 'check', inCheck: colorToStr(g(s, 'inCheck')) };
  if (s instanceof T.StatusDraw) {
    return { kind: 'draw', reason: g(s, 'byInsufficientMaterial') ? 'insufficient-material' : 'fifty-move' };
  }
  return { kind: 'active' };
};

const moveKind = (m) =>
  m instanceof T.MovePromotion ? 'promotion'
    : m instanceof T.MoveCastle ? 'castle'
      : m instanceof T.MoveEnPassant ? 'en-passant'
        : m instanceof T.MoveDoublePawn ? 'double-pawn'
          : 'normal';

const wrapMove = (m) => {
  if (m == null) return null;
  const view = {
    kind: moveKind(m),
    from: convSquare(g(m, 'from')),
    to: convSquare(g(m, 'to')),
    piece: convPiece(g(m, 'piece')),
    captured: convPiece(g(m, 'captured')),
    crossings: (g(m, 'crossings') ?? []).map(convCrossing),
  };
  if (m instanceof T.MovePromotion) view.promoteTo = typeToStr(g(m, 'promoteTo'));
  temperOf.set(view, m);
  return view;
};

const wrapState = (st) => {
  const view = {
    plane: g(st, 'plane').map(convPiece),
    toMove: colorToStr(g(st, 'toMove')),
    status: g(st, 'status').map(convStatus),
    ledger: g(st, 'ledger'), // opaque to the UI
    clocks: g(st, 'clocks'), // opaque to the UI
    enPassant: convSquare(g(st, 'enPassant')),
    ply: g(st, 'ply'),
  };
  temperOf.set(view, st);
  return view;
};

const wrapRng = (r) => {
  const v = { __rng: true };
  temperOf.set(v, r);
  return v;
};

// --- public API (mirrors src/core/index.ts) ---
export const initialState = () => wrapState(T.initialState());
export const legalMoves = (state) => T.legalMoves(unwrap(state)).map(wrapMove);
export const chooseMove = (state, depth, rng) => wrapMove(T.chooseMove(unwrap(state), depth, unwrap(rng)));
export const makeRng = (seed) => wrapRng(T.makeRng(seed));
export const gameOver = (state) => T.gameOver(unwrap(state));
export const boardsWon = (state, color) => T.boardsWon(unwrap(state), strToColor(color));

export const winner = (state) => {
  const r = T.winner(unwrap(state));
  if (r instanceof T.ResultWin) return colorToStr(g(r, 'color'));
  if (r instanceof T.ResultDraw) return 'draw';
  return null;
};

export const applyMove = (state, move) => {
  const r = T.applyMove(unwrap(state), unwrap(move));
  return r instanceof T.Applied
    ? { ok: true, value: wrapState(g(r, 'state')) }
    : { ok: false, error: { kind: 'rejected' } };
};

export const findLegalMove = (state, from, to, promoteTo) => {
  const tf = T.mkGlobal(from.gx, from.gy);
  const tt = T.mkGlobal(to.gx, to.gy);
  const m = T.findLegalMove(unwrap(state), tf, tt, promoteTo == null ? null : strToType(promoteTo));
  return wrapMove(m);
};

// --- pure read helpers over TS-shaped data (trivial geometry, no engine round-trip) ---
export const BOARD_SIZE = 8;
export const GRID = 3;
export const PLANE = 24;
export const BOARDS = 9;
export const SQUARES = 576;
export const DEFAULT_DEPTH = 3;

export const boardOf = (sq) => Math.floor(sq.gy / BOARD_SIZE) * GRID + Math.floor(sq.gx / BOARD_SIZE);
export const cellIndex = (sq) => sq.gy * PLANE + sq.gx;
export const pieceAt = (plane, sq) => plane[cellIndex(sq)] ?? null;
export const sameSquare = (a, b) => a.gx === b.gx && a.gy === b.gy;
export const opposite = (c) => (c === 'white' ? 'black' : 'white');

export const mkGlobal = (gx, gy) => {
  const ok = Number.isInteger(gx) && Number.isInteger(gy) && gx >= 0 && gx < PLANE && gy >= 0 && gy < PLANE;
  return ok ? { ok: true, value: { gx, gy } } : { ok: false, error: { kind: 'out-of-range', axis: 'gx', value: gx } };
};

const FROZEN_KINDS = new Set(['checkmate', 'draw']);
export const isFrozenBoard = (state, board) => FROZEN_KINDS.has(state.status[board]?.kind);
