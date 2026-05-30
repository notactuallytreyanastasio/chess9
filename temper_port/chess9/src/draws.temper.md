# Draws & termination — frozen boards and insufficient material

This module is the Temper port of `../../src/core/draws.ts`. It covers the part of RULES.md §8
("Draws & termination") that a single board can decide on its own: when a board is **frozen** (out
of play for good) and when a board's remaining material is so thin that no mate can ever be forced,
so the board must be declared a dead draw.

RULES.md §8 lists the ways a board reaches a terminal state. Two of them — the 50-move clock and
threefold-style repetition — are bookkeeping the reducer and ledger own; this module owns the two
*structural* questions that depend only on the position and the board's recorded status:

- **Is a board frozen?** A checkmated or drawn board takes no further part in the game (RULES.md
  §7 freezes a checkmate, §8 freezes a draw). The shared [`types`](./types.temper.md) vocabulary
  already answers this with `isFrozen(status)`, so we do **not** redefine it here — we simply reuse
  it. The TS reference had a standalone `isFrozenStatus`; in the Temper port that classifier already
  lives on `BoardStatus`, and the cheat-sheet in `../../CLAUDE.md` is explicit that we must not mint
  a second copy of an existing helper. The test below re-pins the §7/§8 freeze contract against the
  shared `isFrozen` so this module's behaviour is documented where the rule is discussed.

- **Is the material insufficient to force mate?** That is `insufficientMaterial`, the substance of
  this module.

## Reusing the shared freeze classifier

`isFrozen` (defined in [`types`](./types.temper.md)) is the §7/§8 freeze test: only `checkmate` and
`draw` freeze a board; `active` and `check` stay live and contestable (§8 has *no per-board
stalemate*, so a board with no move is still active). We re-assert that contract here, in the module
that discusses termination, rather than copying the function.

    test("a board is frozen only by checkmate or draw (RULES.md §7, §8)") {
      assert(!isFrozen(new StatusActive())) { "active board plays on" };
      assert(!isFrozen(new StatusCheck(White))) { "a checked board is not frozen" };
      assert(isFrozen(new StatusCheckmate(Black, White))) { "checkmate freezes the board" };
      assert(isFrozen(new StatusDraw(true))) { "an insufficient-material draw freezes" };
      assert(isFrozen(new StatusDraw(false))) { "a 50-move draw freezes" };
    }

## `insufficientMaterial` — a conservative dead-position test

RULES.md §8 declares a board drawn when neither side can possibly force mate. We translate that into
a deliberately **conservative** test: it returns `true` only for the textbook dead positions —

- **bare kings** (king versus king), or
- **a lone king versus king + a single minor** (one knight or one bishop, either colour),

— and `false` for anything richer. The moment a pawn, rook, or queen is on the board, mate is still
forceable, so we bail out immediately with `false`. Two or more minors also count as sufficient
here: we never want to call a draw while a mate is still on the board, even at the cost of missing a
genuinely-dead two-minor ending. Being conservative this way means we never freeze a live game.

The TS reference scans the 8×8 of one board by walking the board's origin with `offset(origin, f,
r)`. We port that scan literally. `boardOrigin(board)` gives the top-left global square of the
board; `offset` steps `f` files right and `r` ranks down, returning `null` if the step leaves the
plane (it never does for an in-range board, but we honour the nullable contract). `pieceAt` reads
the cell.

We tally what we find: whether each king is present, and how many minors (knight/bishop) we have
seen. Any pawn, rook, or queen short-circuits to `false`. Because Temper has no `Set` and we only
need a *count* of minors, we keep a plain `Int` counter rather than a list — the TS code pushed into
a `Piece[]` only to read its `.length`, so a counter is the faithful, lighter rendering.

A genuine forced draw requires **both kings present** (it is an endgame, not a fragment) and **at
most one minor** between them. That final predicate is the whole rule.

    export let insufficientMaterial(plane: List<Piece?>, board: BoardIndex): Boolean {
      let origin = boardOrigin(board);
      var minors = 0;
      var whiteKing = false;
      var blackKing = false;
      for (var r = 0; r < boardSize; r += 1) {
        for (var f = 0; f < boardSize; f += 1) {
          let s = offset(origin, f, r);
          if (s != null) {
            let p = pieceAt(plane, s);
            if (p != null) {
              if (p.type == King) {
                if (p.color == White) {
                  whiteKing = true;
                } else {
                  blackKing = true;
                }
              } else if (p.type == Knight || p.type == Bishop) {
                minors += 1;
              } else {
                // a pawn, rook, or queen exists -> mate is still possible
                return false;
              }
            }
          }
        }
      }
      // Only a genuine endgame (both kings present) with <= 1 minor is a forced draw.
      whiteKing && blackKing && minors <= 1
    }

### Tests — porting the insufficient-material cases

The TS `draws.test.ts` "insufficientMaterial" case pins four positions on board 0. We build the same
positions on the Temper plane. The TS `sq(file, rank)` helper places a piece at a *global* square in
the top-left board's coordinates, so `sq(0,7)`, `sq(7,0)`, etc. map straight onto `mkGlobal`. We
assemble each plane with `withPieces` over `emptyPlane`, then read board 0.

A small local helper builds board 0 once.

    let board0(): BoardIndex { mkBoardIndex(0) orelse panic() }

**King versus king** — the barest dead position — is insufficient.

    test("insufficientMaterial: bare kings is a draw (RULES.md §8)") {
      let kvk = withPieces(emptyPlane(), [
        new PlaneWrite(mkGlobal(0, 7) orelse panic(), new Piece(King, White, false)),
        new PlaneWrite(mkGlobal(7, 0) orelse panic(), new Piece(King, Black, false)),
      ]);
      assert(insufficientMaterial(kvk, board0())) { "K vs K cannot force mate" };
    }

**King + single knight versus king** — one minor — is still insufficient.

    test("insufficientMaterial: K + single minor is a draw (RULES.md §8)") {
      let kn = withPieces(emptyPlane(), [
        new PlaneWrite(mkGlobal(0, 7) orelse panic(), new Piece(King, White, false)),
        new PlaneWrite(mkGlobal(2, 2) orelse panic(), new Piece(Knight, White, false)),
        new PlaneWrite(mkGlobal(7, 0) orelse panic(), new Piece(King, Black, false)),
      ]);
      assert(insufficientMaterial(kn, board0())) { "K+N vs K cannot force mate" };
    }

**King + rook versus king** — a rook can mate — is *sufficient*, so not a draw.

    test("insufficientMaterial: a rook is sufficient material (RULES.md §8)") {
      let kr = withPieces(emptyPlane(), [
        new PlaneWrite(mkGlobal(0, 7) orelse panic(), new Piece(King, White, false)),
        new PlaneWrite(mkGlobal(2, 2) orelse panic(), new Piece(Rook, White, false)),
        new PlaneWrite(mkGlobal(7, 0) orelse panic(), new Piece(King, Black, false)),
      ]);
      assert(!insufficientMaterial(kr, board0())) { "K+R vs K can force mate" };
    }

**King + two minors versus king** — knight and bishop — is treated as sufficient by our
conservative test (`minors <= 1` is false), so not a draw.

    test("insufficientMaterial: two minors is treated as sufficient (RULES.md §8)") {
      let twoMinors = withPieces(emptyPlane(), [
        new PlaneWrite(mkGlobal(0, 7) orelse panic(), new Piece(King, White, false)),
        new PlaneWrite(mkGlobal(2, 2) orelse panic(), new Piece(Knight, White, false)),
        new PlaneWrite(mkGlobal(4, 4) orelse panic(), new Piece(Bishop, White, false)),
        new PlaneWrite(mkGlobal(7, 0) orelse panic(), new Piece(King, Black, false)),
      ]);
      assert(!insufficientMaterial(twoMinors, board0())) { "two minors -> not a forced draw" };
    }

One extra guard the TS test implies but does not spell out: a lone minor with **only one king** is
*not* a draw by this test, because a forced draw requires both kings present (the `whiteKing &&
blackKing` clause). A fragment with one king is not a real endgame, so we refuse to call it dead.

    test("insufficientMaterial: a single king alone is not a forced draw (RULES.md §8)") {
      let lone = withPieces(emptyPlane(), [
        new PlaneWrite(mkGlobal(0, 7) orelse panic(), new Piece(King, White, false)),
        new PlaneWrite(mkGlobal(2, 2) orelse panic(), new Piece(Bishop, White, false)),
      ]);
      assert(!insufficientMaterial(lone, board0())) { "needs both kings to be a draw" };
    }
