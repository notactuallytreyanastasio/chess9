// Drives the Temper engine through the shim using only the TS-shaped core API the UI uses.
// If this prints plain strings, numbers, and {ok} results (not ColorWhite / GX / Applied),
// the shim is doing its job and the existing UI could import it unchanged.

import * as core from './core.mjs';

const ok = (label, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);

let state = core.initialState();
ok('initialState.toMove is the string "white"', state.toMove === 'white');
ok('plane is a 576-length array', Array.isArray(state.plane) && state.plane.length === 576);
ok('288 pieces on the board', state.plane.filter(Boolean).length === 288);
ok('status[0] is a plain {kind:"active"}', state.status[0].kind === 'active');

const moves = core.legalMoves(state);
ok('180 legal opening moves', moves.length === 180);
const m0 = moves[0];
ok('a move has a string kind', typeof m0.kind === 'string');
ok('a move.from.gx is a number', typeof m0.from.gx === 'number');
ok('a piece.color is a string', m0.piece.color === 'white');

// UI flow: pick a double-pawn push and apply it through the {ok} result.
const dbl = moves.find((m) => m.kind === 'double-pawn');
let r = core.applyMove(state, dbl);
ok('applyMove returns {ok:true, value}', r.ok === true && r.value);
ok('turn flipped to black', r.value.toMove === 'black');
ok('ply advanced to 1', r.value.ply === 1);
ok('en-passant square set after a double push', r.value.enPassant != null);
state = r.value;

// findLegalMove the way the UI resolves a click (from/to plain squares).
const resolved = core.findLegalMove(state, { gx: dbl.from.gx, gy: 1 }, { gx: dbl.from.gx, gy: 3 });
ok('findLegalMove resolves a black reply', resolved != null);

// Bot turn, deterministic under a seed (like main.ts).
const bm = core.chooseMove(state, 2, core.makeRng(42));
ok('chooseMove returns a TS-shaped move', bm != null && typeof bm.kind === 'string');
r = core.applyMove(state, bm);
ok('bot move applies cleanly', r.ok === true);
state = r.value;

// Play a handful of alternating plies through the bot.
let plies = 2;
for (let i = 0; i < 12 && !core.gameOver(state); i++) {
  const mv = core.chooseMove(state, 2, core.makeRng(i + 7));
  if (!mv) break;
  const res = core.applyMove(state, mv);
  if (!res.ok) break;
  state = res.value;
  plies++;
}
ok('played a multi-ply game without a rejected move', plies > 6);

// Read helpers the renderer leans on.
const sq = core.mkGlobal(12, 15);
ok('mkGlobal returns {ok, value:{gx,gy}}', sq.ok && sq.value.gx === 12);
ok('boardOf maps the center board to 4', core.boardOf({ gx: 12, gy: 12 }) === 4);
ok('pieceAt + cellIndex read the plane', core.pieceAt(state.plane, { gx: 0, gy: 0 }) !== undefined);
ok('sameSquare compares plain squares', core.sameSquare({ gx: 1, gy: 2 }, { gx: 1, gy: 2 }));
ok('isFrozenBoard reads a status kind', typeof core.isFrozenBoard(state, 4) === 'boolean');

const w = core.winner(state);
console.log(`\nafter ${state.ply} plies: gameOver=${core.gameOver(state)} winner=${w}` +
  ` boardsWon(white)=${core.boardsWon(state, 'white')} boardsWon(black)=${core.boardsWon(state, 'black')}`);
console.log('\nthe Temper engine ran the whole game through the TypeScript-shaped core API.');
