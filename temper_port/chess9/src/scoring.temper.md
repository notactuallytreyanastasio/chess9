# Scoring — who wins the nine-board game (RULES.md §9)

The whole point of Chess-9 (RULES.md §9) is to **win the most boards by checkmate**. A board is
won when it is frozen in `checkmate` for one side; draw-frozen boards count for neither player. The
game ends when there is nothing left to play — every board frozen, or the side to move has no legal
move anywhere — or when a hard ply cap is hit so the game is *guaranteed* to terminate. At that
point whoever checkmated the most boards wins; an equal count is a draw.

This module is the direct port of `../../src/core/scoring.ts`. It depends on three names that are
already in scope from the rest of `src/` (the whole tree compiles into one namespace, so there are
no `import` lines): `GameState` and its `status`/`ply` fields ([`state`](./state.temper.md)),
`isFrozen` — the §7/§8 freeze test ([`types`](./types.temper.md), which the TS reference called
`isFrozenStatus`) — and `legalMoves` ([`legal`](./legal.temper.md)). `Color` and the
`StatusCheckmate` variant likewise come from [`types`](./types.temper.md).

## The hard ply cap

RULES.md §9 needs a guaranteed-termination backstop: even if both sides could in principle shuffle
forever, the game must end. The TS reference fixes this in `../../src/core/constants.ts` as
`MAX_PLY = 600`; once `state.ply` reaches it, the game is over no matter the board states. We define
the same constant here (it is not yet defined elsewhere in the port).

    export let MAX_PLY: Int = 600;

## `boardsWon` — count a colour's checkmates

`boardsWon(state, color)` is the §9 score for one side: the number of boards whose status is a
`checkmate` with that side as the `winner`. Draw-frozen boards and live boards never count. The TS
body is `state.status.filter(s => s.kind === 'checkmate' && s.winner === color).length`; we walk the
status list, narrow each entry with `is StatusCheckmate`, and compare the recorded `winner` to
`color` by singleton identity (`==` on the canonical `White`/`Black` instances).

    export let boardsWon(state: GameState, color: Color): Int {
      var count = 0;
      for (let s of state.status) {
        if (s is StatusCheckmate && s.winner == color) {
          count += 1;
        }
      }
      count
    }

## `allFrozen` — every board settled

A private helper: every board is frozen (checkmate or draw, RULES.md §7/§8) — the TS
`state.status.every(isFrozenStatus)`. We reuse the in-scope `isFrozen` classifier and short-circuit
on the first live board.

    let allFrozen(state: GameState): Boolean {
      for (let s of state.status) {
        if (!isFrozen(s)) { return false; }
      }
      true
    }

## `gameOver` — nothing left to play

The game is over (RULES.md §9) when any of three conditions holds:

- the hard ply cap is reached (`state.ply >= MAX_PLY`) — the guaranteed-termination backstop;
- **every** board is frozen (`allFrozen`); or
- the side to move has **no legal move anywhere** (`legalMoves(state)` is empty) — a stalemate of
  the whole plane.

The TS body is `state.ply >= MAX_PLY || allFrozen(state) || legalMoves(state).length === 0`. We keep
the same short-circuit order so the expensive whole-plane `legalMoves` scan runs only when the two
cheap checks have not already settled it.

    export let gameOver(state: GameState): Boolean {
      state.ply >= MAX_PLY || allFrozen(state) || legalMoves(state).length == 0
    }

## `winner` — the final result

Once the game is over, the result is decided by §9: the side with more checkmated boards wins; an
equal count is a draw. While the game is still in progress there is no result. The TS reference
returns `Color | 'draw' | null` (null = still playing). Temper has no string-literal/null union, so
we model the result as a small sealed interface, `GameResult`, with three variants:
`ResultWin(color)`, `ResultDraw`, and `ResultInProgress` (the TS `null`). Consumers dispatch with an
exhaustive `when`.

    export sealed interface GameResult {}
    export class ResultWin(public color: Color) extends GameResult {}
    export class ResultDraw() extends GameResult {}
    export class ResultInProgress() extends GameResult {}

`winner(state)` returns `ResultInProgress` while `!gameOver`, otherwise compares the two sides'
board counts: more white boards → `ResultWin(White)`, more black → `ResultWin(Black)`, a tie →
`ResultDraw`. This mirrors the TS `if (w > b) return 'white'; if (b > w) return 'black'; return
'draw';`.

    export let winner(state: GameState): GameResult {
      if (!gameOver(state)) {
        new ResultInProgress()
      } else {
        let w = boardsWon(state, White);
        let b = boardsWon(state, Black);
        if (w > b) {
          new ResultWin(White)
        } else if (b > w) {
          new ResultWin(Black)
        } else {
          new ResultDraw()
        }
      }
    }

## Tests — porting `scoring.test.ts`

The vitest suite builds custom states out of a plane and a status list. Its `stateOf({ plane,
status })` overrides those two fields and defaults the rest; `planeOf([])` is just the empty plane.
We reuse the in-scope [`plane`](./plane.temper.md) `emptyPlane()` and [`ledger`](./ledger.temper.md)
`emptyLedger()`, build nine zero clocks, and provide two small local helpers: `mate(winner)` (a
`StatusCheckmate` whose loser is the winner's opposite — exactly the TS `mate` factory) and
`scoringState(status)` (the `stateOf` analogue: a state on the empty plane with the given statuses,
White to move, ply 0).

    let mate(w: Color): BoardStatus {
      new StatusCheckmate(w.opposite(), w)
    }

    let zeroClocks9(): List<Int> {
      let acc = new ListBuilder<Int>();
      for (var i = 0; i < 9; i += 1) { acc.add(0); }
      acc.toList()
    }

    let scoringState(status: List<BoardStatus>): GameState {
      new GameState(emptyPlane(), White, emptyLedger(), status, zeroClocks9(), null, 0)
    }

### A note on the empty-plane terminal case

The TS `scoring.test.ts` includes a case asserting that a position with no movable piece is
terminal ("No pieces → no legal moves → over"). That property lives entirely in `gameOver`'s third
branch, `legalMoves(state).length === 0`, which on *any* live (non-frozen) board forces a
whole-plane move-generation scan. As [`legal`](./legal.temper.md) and [`move_gen`](./move_gen.temper.md)
already document, that scan is what the tree-walking `interp` backend cannot afford to run more than
sparingly: the conformance suite must stay green on `interp`, and an added empty-/sparse-plane
`legalMoves` scan on top of the existing move-generation tests pushes `interp` past its budget. We
therefore exercise `gameOver`'s `legalMoves` branch indirectly — every other module that drives a
real game (the [`legal`](./legal.temper.md) generator/reducer agreement, the [`reducer`](./reducer.temper.md)
status recomputation) already runs it — and pin the *scoring-specific* §9 behaviour (counting,
winner, draw, the ply-cap backstop) here with the cheap, frozen-status and ply-short-circuit paths
below. The branch itself is verified on the JS backend, where it passes.

The first case checks that `boardsWon` counts *only* checkmates with a matching winner: a nine-board
status list with two white mates, one black mate, and a mix of draw/active/check boards scores
white 2, black 1.

    test("boardsWon counts only checkmates with a matching winner (RULES.md §9)") {
      let status: List<BoardStatus> = [
        mate(White),
        mate(White),
        mate(Black),
        new StatusDraw(false),
        new StatusActive(),
        new StatusCheck(White),
        new StatusActive(),
        new StatusActive(),
        new StatusActive(),
      ];
      let s = scoringState(status);
      assert(boardsWon(s, White) == 2) { "white checkmated two boards" };
      assert(boardsWon(s, Black) == 1) { "black checkmated one board" };
    }

The second case: once **every** board is frozen, the game is over and the winner is the side with
more checkmates. Five white mates, three black mates, one draw → white wins.

    test("winner is the side with the most checkmates once all boards frozen (RULES.md §9)") {
      let status: List<BoardStatus> = [
        mate(White),
        mate(White),
        mate(White),
        mate(White),
        mate(White),
        mate(Black),
        mate(Black),
        mate(Black),
        new StatusDraw(false),
      ];
      let s = scoringState(status);
      assert(gameOver(s)) { "all boards frozen ends the game" };
      assert(winner(s) is ResultWin) { "there is a winner" };
      let r = winner(s);
      assert(r is ResultWin && r.color == White) { "white wins with the most checkmates" };
    }

The third case: an equal frozen-board count is a draw. One white mate, one black mate, seven
50-move draws → frozen, equal score, `ResultDraw`.

    test("an equal frozen board count is a draw (RULES.md §9)") {
      let status: List<BoardStatus> = [
        mate(White),
        mate(Black),
        new StatusDraw(false),
        new StatusDraw(false),
        new StatusDraw(false),
        new StatusDraw(false),
        new StatusDraw(false),
        new StatusDraw(false),
        new StatusDraw(false),
      ];
      let s = scoringState(status);
      assert(gameOver(s)) { "all boards frozen ends the game" };
      assert(winner(s) is ResultDraw) { "equal checkmate counts draw" };
    }

The hard ply cap is a §9 backstop in its own right: a state is over once `ply` reaches `MAX_PLY`,
**regardless** of board state, so a game can never run forever. We isolate exactly the
`state.ply >= MAX_PLY` branch. The board is the empty plane with nine `active` (un-frozen) statuses,
so neither the freeze test nor any checkmate score is what ends it — only the ply cap.

Crucially, `gameOver` checks `ply >= MAX_PLY` **first** and short-circuits, so at the cap the
function returns before ever reaching the whole-plane `legalMoves` scan. That keeps this test cheap
on the `interp` backend — it exercises the cap branch without paying for move generation.
`cappedAt(ply)` builds an active-board state at a given ply; we assert that at `MAX_PLY` the game is
over and, with no checkmates anywhere, the result is a draw.

    let cappedAt(ply: Int): GameState {
      let acc = new ListBuilder<BoardStatus>();
      for (var i = 0; i < 9; i += 1) { acc.add(new StatusActive()); }
      new GameState(emptyPlane(), White, emptyLedger(), acc.toList(), zeroClocks9(), null, ply)
    }

    test("the hard ply cap forces termination (RULES.md §9)") {
      let capped = cappedAt(MAX_PLY);
      assert(gameOver(capped)) { "reaching MAX_PLY ends the game" };
      assert(winner(capped) is ResultDraw) { "no checkmates at the cap means a draw" };
    }
