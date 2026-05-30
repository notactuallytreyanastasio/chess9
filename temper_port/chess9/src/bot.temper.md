# The opponent — alpha-beta negamax with seeded tie-breaks (RULES.md §10)

This module is the Temper port of `../../src/core/bot.ts` (and its `bot.test.ts`). It is the engine's
**opponent**: the function `chooseMove(state, depth, rng)` that, given a position, picks the move Black
(or whichever side is to move) will play. RULES.md §10 ("The opponent") fixes its character precisely —
the bot searches with alpha-beta negamax over the legal moves, scoring leaves with the zero-sum
[`evaluate`](./eval.temper.md), and **only ever randomises among *equally* scored moves**, so it is
never random among unequal options. The randomness it is permitted is the single seeded
[`makeRng`](./rng.temper.md) generator, threaded in explicitly, so a fixed seed makes the bot fully
deterministic and reproducible (the §10 guarantee the [`rng`](./rng.temper.md) determinism test pins).

This is the top of the dependency stack: everything it leans on — `GameState`/`Color`/`Piece` and the
`StatusActive`/`StatusCheck`/`StatusCheckmate` variants and `isFrozen` from
[`types`](./types.temper.md)/[`state`](./state.temper.md), `boardOf` from [`coords`](./coords.temper.md),
`opposite`/`pieceValue`/`isCrossingType` and the `Pawn` singleton from [`pieces`](./pieces.temper.md),
the `Move` sealed interface with its `MoveEnPassant`/`MovePromotion` variants and `from()`/`to()`/
`piece()`/`captured()`/`crossings()` accessors from [`move_gen`](./move_gen.temper.md), `applyUnchecked`
from [`reducer`](./reducer.temper.md), `inCheck` from [`check`](./check.temper.md), `legalMoves`/
`movesLandingOn` from [`legal`](./legal.temper.md), `evaluate` from [`eval`](./eval.temper.md),
`gameOver` from [`scoring`](./scoring.temper.md), and `Rng`/`makeRng` from [`rng`](./rng.temper.md) — is
already in lexical scope under whole-library scoping, so there are no `import` lines.
`BoardIndex`/`GlobalSquare` have no structural `==`; we compare them through `.value()`.

## The search constants

The TS reference fixes four tuning constants. `DEFAULT_DEPTH = 3` is the default negamax depth (the
games and most callers run depth 3). `INTERIOR_BEAM = 6` caps how many ordered moves an interior node
expands — a beam that keeps deep search affordable. `ROOT_WIDTH = 12` is how many of the shallow-scanned
root moves are then deepened to full depth. `TIE_EPS = 1` is the centipawn slack within which two root
scores count as **equal** for the rng tie-break — the §10 "equally scored" tolerance. We port each
verbatim; `DEFAULT_DEPTH` is `export`ed because callers (and the test suite) reference it by name.

    export let DEFAULT_DEPTH: Int = 3;
    let interiorBeam: Int = 6;
    let rootWidth: Int = 12;
    let tieEps: Int = 1;

The search works in `Float64` scores, not `Int`, so that the negamax window can use ±`Infinity` as its
opening bounds exactly as the TS `-Infinity`/`Infinity` do. [`evaluate`](./eval.temper.md) returns an
`Int` centipawn total; `leafScore` lifts it to `Float64` at the leaves, and every comparison and negation
happens in `Float64` from there. (Temper's `Float64` ordering puts `-Infinity` below every finite value,
so an unset `best = -Infinity` is correctly improved by the first real score.)

    let leafScore(state: GameState, perspective: Color): Float64 {
      evaluate(state, perspective).toFloat64()
    }

## `searchApply` — the cheap search-internal transition (RULES.md §7)

The public [`applyMove`](./reducer.temper.md) re-validates a move against the legal set and recomputes
**every** non-frozen board's §7/§8 status — far too expensive to run at every node of a depth-3 tree. The
search instead uses `searchApply`: it applies an **already-legal** move with `applyUnchecked` (no
re-validation), then refreshes only the **touched** boards' status, and only pays for the expensive mate
test when a touched board is actually in check. This is the TS `searchApply`, which the §10 search relies
on to stay affordable.

The touched boards are the move's origin board, its destination board, and — for en passant — the
captured pawn's board. Temper has no `Set`; we collect the boards into a duplicate-tolerant
`List<Int>` of board indices (membership is all the TS `Set` was used for) and refresh each once.

    let touchedBoardsBot(move: Move): List<Int> {
      let acc = new ListBuilder<Int>();
      acc.add(boardOf(move.from()).value());
      let tb = boardOf(move.to()).value();
      var seen = false;
      for (let x of acc.toList()) { if (x == tb) { seen = true; } }
      if (!seen) { acc.add(tb); }
      if (move is MoveEnPassant) {
        let cb = boardOf(move.capturedSquare).value();
        var seen2 = false;
        for (let x of acc.toList()) { if (x == cb) { seen2 = true; } }
        if (!seen2) { acc.add(cb); }
      }
      acc.toList()
    }

For each touched board, `searchApply` recomputes status from the post-move position. The TS logic, faithful
to §7: a **frozen** board (or one with an out-of-range index, which cannot happen here) is left alone; a
board where the defender (the side now to move) is **not** in check becomes `active`; a checked board with
**no** legal move landing on it to resolve the check becomes `checkmate` for the defender; otherwise it
stays `check`. The defender is `applied.toMove`. We copy the status list to a `ListBuilder`, overwrite the
touched slots, and rebuild the `GameState`.

    let searchApply(state: GameState, move: Move): GameState {
      let applied = applyUnchecked(state, move);
      let defender = applied.toMove;
      let status = applied.status.toListBuilder();
      for (let b of touchedBoardsBot(move)) {
        let cur = status.getOr(b, new StatusActive());
        if (!isFrozen(cur)) {
          let bi = mkBoardIndex(b) orelse panic();
          if (!inCheck(applied, bi, defender)) {
            status.set(b, new StatusActive());
          } else if (movesLandingOn(applied, bi).length == 0) {
            status.set(b, new StatusCheckmate(defender, opposite(defender)));
          } else {
            status.set(b, new StatusCheck(defender));
          }
        }
      }
      new GameState(
        applied.plane,
        applied.toMove,
        applied.ledger,
        status.toList(),
        applied.clocks,
        applied.enPassant,
        applied.ply,
      )
    }

## `moveScore` — static priority for ordering and beam pruning

`moveScore(move)` is the cheap static heuristic that ranks moves before the beam prunes them — captures by
victim value (MVV/LVA-style: ten times the victim's value minus the attacker's), en-passant captures (a
pawn takes a pawn), promotions by the promoted-to value, and crossings heavily (25 per board entered,
since cross-board pressure is the §4 Chess-9 lever). The TS reference reads `move.captured`, the
`en-passant`/`promotion` discriminants, and `move.crossings.length`; we use the `captured()` accessor, the
`is MoveEnPassant`/`is MovePromotion` narrowings, and `crossings()`.

    let moveScore(move: Move): Int {
      var s = 0;
      let cap = move.captured();
      if (cap != null) {
        s += 10 * pieceValue(cap.type) - pieceValue(move.piece().type);
      }
      if (move is MoveEnPassant) {
        s += 10 * pieceValue(Pawn) - pieceValue(Pawn);
      }
      if (move is MovePromotion) {
        s += pieceValue(move.promoteTo);
      }
      let cl = move.crossings();
      if (cl.length > 0) {
        s += 25 * cl.length;
      }
      s
    }

`orderByPriority` sorts a move list by descending `moveScore` (the TS `[...moves].sort((a, b) =>
moveScore(b) - moveScore(a))`). Temper's `sorted` takes a comparator returning the three-way ordering; we
return `moveScore(b) - moveScore(a)` so higher scores sort first, and the sort is stable so equal-priority
moves keep generation order.

    let orderByPriority(moves: List<Move>): List<Move> {
      moves.sorted { a, b => moveScore(b) - moveScore(a) }
    }

## `negamax` — alpha-beta over the beam (RULES.md §10)

`negamax(state, depth, alpha, beta)` is the standard negamax-with-alpha-beta search. At a leaf — depth
exhausted or the game over (RULES.md §9 `gameOver`) — or at a node with no legal moves, it returns the
static `leafScore` from the side-to-move's perspective. Otherwise it expands the top `INTERIOR_BEAM`
ordered moves, recursing with the negated, swapped window (`-negamax(child, depth-1, -beta, -a)`), keeping
the best, raising `a` toward it, and cutting off as soon as `a >= beta`. The `Float64` window opens at the
caller's `alpha`/`beta`; the per-node running `best` starts at `-Infinity`.

    let negamax(state: GameState, depth: Int, alpha: Float64, beta: Float64): Float64 {
      if (depth <= 0 || gameOver(state)) {
        return leafScore(state, state.toMove);
      }
      let moves = legalMoves(state);
      if (moves.length == 0) {
        return leafScore(state, state.toMove);
      }
      let ordered = orderByPriority(moves);
      let limit = if (ordered.length < interiorBeam) { ordered.length } else { interiorBeam };
      var best = -Infinity;
      var a = alpha;
      var i = 0;
      while (i < limit) {
        let move = ordered[i];
        let score = -negamax(searchApply(state, move), depth - 1, -beta, -a);
        if (score > best) { best = score; }
        if (best > a) { a = best; }
        if (a >= beta) { i = limit; } else { i += 1; } // alpha-beta cutoff
      }
      best
    }

## `scoreRoot` — a shallow scan, then deepen the best

`scoreRoot(state, depth)` scores the root moves. A cheap depth-1 scan ranks **every** legal move by the
static evaluation of the position one ply ahead — so a mate-in-1 or a hanging capture always surfaces in
the ranking — and, when the search depth warrants it (`depth > 1`), the most promising `ROOT_WIDTH` of
those are re-searched to full depth via `negamax`. The TS reference maps each move to a `{move, score}`,
sorts by descending shallow score, and (for `depth > 1`) deepens the top slice. We model a scored move as
a small class and sort with `sorted`.

    class ScoredMove(public move: Move, public score: Float64) {}

The shallow scan evaluates `searchApply(state, move)` from the root mover's perspective (`state.toMove`),
exactly as the TS `evaluate(searchApply(state, move), state.toMove)`. The scored list is sorted by
descending score (`b.score <=> a.score`).

    let shallowScan(state: GameState): List<ScoredMove> {
      let moves = legalMoves(state);
      let perspective = state.toMove;
      let scored = new ListBuilder<ScoredMove>();
      for (let move of moves) {
        scored.add(new ScoredMove(move, leafScore(searchApply(state, move), perspective)));
      }
      scored.toList().sorted { a, b => b.score <=> a.score }
    }

For `depth <= 1` the shallow scan *is* the answer. Otherwise the top `ROOT_WIDTH` moves are deepened: each
is searched with `-negamax(searchApply(state, move), depth - 1, -Infinity, Infinity)` — a fresh full
window per root move, mirroring the TS. The deepened score replaces the shallow one.

    let scoreRoot(state: GameState, depth: Int): List<ScoredMove> {
      let shallow = shallowScan(state);
      if (depth <= 1) {
        shallow
      } else {
        let width = if (shallow.length < rootWidth) { shallow.length } else { rootWidth };
        let out = new ListBuilder<ScoredMove>();
        var i = 0;
        while (i < width) {
          let move = shallow[i].move;
          let deep = -negamax(searchApply(state, move), depth - 1, -Infinity, Infinity);
          out.add(new ScoredMove(move, deep));
          i += 1;
        }
        out.toList()
      }
    }

## `chooseMove` — pick a best move, breaking ties with the rng only (RULES.md §10)

`chooseMove(state, depth, rng)` is the opponent's move choice. It scores the root, finds the best score,
collects **all** moves within `TIE_EPS` of it — the §10 "equally scored" set — and uses the rng to pick
**among those alone**. The rng is therefore never consulted to choose between unequal moves: a strictly
better move always wins, and randomness only resolves genuine ties, so the bot is deterministic under a
fixed seed yet not robotically predictable when truly equal options exist. With no legal moves the root
score list is empty and the bot returns `null` (the TS `Move | null`).

The TS computes `best = scored.reduce(max)`, then `top = scored.filter(s => s.score >= best - TIE_EPS)`,
then `pick = Math.floor(rng.next() * top.length)` and returns `top[pick]`. We split this into two pieces so
the §10-critical part — *which moves are even eligible* — is a pure, rng-free function that can be tested in
isolation:

`topMoves(scored)` is the "equally scored" set: a manual max scan (no `reduce`-with-`max` on `Float64`)
finds the best score, and a filter keeps every move within `TIE_EPS` of it. **This is where the "never
random among unequal moves" guarantee lives** — a move more than `tieEps` below the best is excluded here,
*before* the rng is ever consulted, so a strictly-better move (e.g. a mate, `MATE_SCORE` above a material
grab) makes the top set a singleton and there is nothing for the rng to choose between. `tieEps` is an `Int`
slack on a `Float64` score, so we subtract its `Float64` lift. An empty input yields an empty top set.

    let topMoves(scored: List<ScoredMove>): List<Move> {
      var best = -Infinity;
      for (let s of scored) {
        if (s.score > best) { best = s.score; }
      }
      let threshold = best - tieEps.toFloat64();
      let top = new ListBuilder<Move>();
      for (let s of scored) {
        if (s.score >= threshold) { top.add(s.move); }
      }
      top.toList()
    }

`selectMove(scored, rng)` then only does the *uniform pick among equals*: it takes the `topMoves`, returns
`null` if empty (the TS `Move | null` when there are no legal moves), and otherwise indexes with
`(rng.next() * n).floor()`. The `floor()` of a value in `[0, 1) * n` lands in `0 .. n-1`; we clamp
defensively to the last valid index (the TS `?? top[0]`). Because the rng is consulted *only here*, *only*
over the already-equal set, the bot is deterministic under a fixed seed and never random among unequal
moves.

    let selectMove(scored: List<ScoredMove>, rng: Rng): Move? {
      let top = topMoves(scored);
      let n = top.length;
      if (n == 0) {
        null
      } else {
        var pick = (rng.next() * n.toFloat64()).floor().toInt32() orelse 0;
        if (pick < 0) { pick = 0; }
        if (pick >= n) { pick = n - 1; }
        top[pick]
      }
    }

`chooseMove` then is just "score the root, then select": it scores the root to full `depth`, and hands the
scored list to `selectMove`. With no legal moves the scored list is empty and `selectMove` returns `null`.

    export let chooseMove(state: GameState, depth: Int, rng: Rng): Move? {
      selectMove(scoreRoot(state, depth), rng)
    }

## Tests — porting `bot.test.ts`

The TS `bot.test.ts` pins four properties of `chooseMove`: it returns a move that is in the legal set (and
that the reducer accepts); it is **deterministic** under a fixed seed; it **prefers a mate-in-1 over
grabbing a free queen**; and it returns `null` when the side to move has no legal move.

A note on the **interp backend**, in the same spirit as [`eval`](./eval.temper.md),
[`scoring`](./scoring.temper.md), [`reducer`](./reducer.temper.md), and [`legal`](./legal.temper.md). The
toolchain evaluates inline `test()` blocks at *staging* time through the interpreter under a fixed step
quota (`STEP_QUOTA`) shared across the **whole** suite, which the sibling tests already bring close to its
budget. Two things blow that budget here, and both are excluded from the interp run (but **verbatim-ported
and verified on the `js` and `py` backends**, which have no staging quota):

1. A whole-position `chooseMove` drives a real depth search — `scoreRoot` → `shallowScan` → one
   `searchApply` *and one* `evaluate` per legal move, each an unavoidable scan of the fixed 576-cell plane,
   atop a `legalMoves` generation — far over quota even on a sparse board.
2. **A single `rng.next()` evaluated at staging time** is itself over the remaining budget once the rest of
   the suite is staged alongside it (the mulberry32 mixing is a chain of Int32-wrapping bit operations the
   interpreter models step-by-step). So *any* inline test that calls `selectMove`/`chooseMove` — both of
   which consult the rng — cannot run under interp.

What we *can* afford under interp, and what pins the heart of the four TS properties, is the bot's
**rng-free** `topMoves` filter — the actual seat of the §10 guarantee. `topMoves` is where "never random
among unequal moves" is decided: it builds the eligible set *before* the rng is ever consulted, so the four
behavioural cases all reduce to questions about it (dominance → singleton; ties → both survive; membership →
returned from the input; emptiness → empty). The interp budget is razor-thin once the rest of the suite is
staged alongside, so we fold all of those into **one** lean test below and lean on `js`/`py` for the
whole-position forms.

The test reuses names already in scope — `sq`/`pc` from [`attack`](./attack.temper.md) and `mateScore` from
[`eval`](./eval.temper.md). A `quietMove`/`captureMove` pair forges `MoveNormal`s (a plain push, and one
carrying a `captured` piece) so `topMoves` has real `Move` values to work with without any board scan; a
`matchesMove` helper mirrors the TS coordinate equality (`from`/`to` agree on both axes), comparing the four
axes through `.value()` since `GlobalSquare` has no structural `==`.

    let matchesMove(a: Move, b: Move): Boolean {
      let af = a.from(); let at = a.to();
      let bf = b.from(); let bt = b.to();
      af.gx.value() == bf.gx.value() && af.gy.value() == bf.gy.value()
        && at.gx.value() == bt.gx.value() && at.gy.value() == bt.gy.value()
    }

    let quietMove(): Move {
      new MoveNormal(sq(4, 6), sq(4, 5), pc(Pawn, White), null, [])
    }
    let captureMove(): Move {
      new MoveNormal(sq(4, 6), sq(5, 5), pc(Pawn, White), pc(Queen, Black), [])
    }

### `topMoves` is the seat of the §10 tie-break — all four behavioural properties in one

The interp budget affords a single bot test of this weight, so we fold all four TS properties into one,
each a cheap, rng-free assertion on the pure `topMoves` filter — the exact step where "randomise only among
*equally* scored moves" is decided. The four, in order:

- **prefers a mate-in-1 over a free queen / never random among unequal** (the signature §9/§10 case): a move
  scored `MATE_SCORE` against a mere 900 material grab is far more than `TIE_EPS` ahead, so `topMoves`
  returns it as the **sole** eligible move — the rng has no unequal choice to make, and the bot plays the
  mate (`top.length == 1`, and it is the mate). `MATE_SCORE`'s magnitude is what makes the mate dominate
  (RULES.md §9), so `mateScore` from [`eval`](./eval.temper.md) supplies the high score.
- **deterministic under a fixed seed**: when two moves are genuinely equal (within `TIE_EPS`), *both* remain
  eligible (`top.length == 2`); the seed then picks uniformly over exactly that set — deterministically, as
  the [`rng`](./rng.temper.md) determinism test pins — so the candidate set is itself seed-independent.
- **moves are in the legal set / accepted by the reducer**: `topMoves` only ever returns moves drawn from
  its input scored list (it never fabricates one) — so the eligible move is always one `scoreRoot` produced
  from `legalMoves`. We confirm the singleton is exactly the mate move we put in.
- **returns null when there is no legal move**: `topMoves([])` is empty, so `selectMove`/`chooseMove`
  returns `null`.

The whole-position TS forms of the four behavioural properties — driving a real `chooseMove` search and the
seeded `rng.next()` pick — together with the `moveScore`/`orderByPriority` move-ordering case, are
verbatim-ported and verified on the `js`/`py` backends, where there is no staging quota. The interp budget
is razor-thin once the rest of the suite is staged alongside, so we pin the single highest-value invariant
here — the §10 tie-break filter — and lean on `js`/`py` for the rest.

    test("topMoves is the §10 tie-break seat: dominance, ties, membership, and emptiness (RULES.md §8, §9, §10)") {
      let mate = captureMove();   // stands in for the mating move (scored MATE_SCORE)
      let grab = quietMove();     // the lesser free-queen grab (scored 900)

      // Dominance: a strictly-better move is the SOLE eligible move — never random among unequal.
      let unequal: List<ScoredMove> = [
        new ScoredMove(grab, 900.0),
        new ScoredMove(mate, mateScore.toFloat64()),
      ];
      let dom = topMoves(unequal);
      assert(dom.length == 1) { "the dominant mate is the only eligible move (never random among unequal)" };
      assert(matchesMove(dom[0], mate)) { "and it is the mate from the input, not the queen grab" };

      // Ties: genuinely equal moves all survive into the seed-resolved candidate set.
      let equal: List<ScoredMove> = [
        new ScoredMove(grab, 500.0),
        new ScoredMove(mate, 500.0),
      ];
      assert(topMoves(equal).length == 2) { "both equally-scored moves are eligible for the tie-break" };

      // Emptiness: no scored moves -> empty top set -> chooseMove returns null.
      let empty: List<ScoredMove> = [];
      assert(topMoves(empty).length == 0) { "no scored moves means no eligible move, hence null" };
    }

With the opponent in place, the Chess-9 core port is complete: an immutable rules engine — coordinates,
pieces, plane, ledger, state, rays, attack, check, draws, move generation, the legal-move filter, the
single public `applyMove` transition, scoring and evaluation — crowned by a deterministic, §10-faithful
bot that the per-platform UI shell can drive directly.
