# Check, checkmate & king-safety (RULES.md §7)

This module is the Temper port of `../../src/core/check.ts` (and its `check.test.ts`). It sits on top
of the credit-aware [`attack`](./attack.temper.md) predicate and answers the three king-safety
questions RULES.md §7 ("Check, checkmate & frozen boards") poses:

- **Where is a colour's king on a given board?** (`kingSquare`)
- **Is that king in check?** (`inCheck`)
- **Is *any* of the mover's kings — anywhere on the plane — in check?** (`ownKingsInCheck`)
- **Is the side to move on a board checkmated?** (`isCheckmate`)

The load-bearing subtlety is the one §7 spells out: "Attacks are not clipped at seams" and "You may
not make a move that leaves any of your own kings in check (**anywhere on the plane**)." Because a
slider ray glides un-clipped across board boundaries, a move can open a line onto a king standing on a
board the move never touched. So `ownKingsInCheck` scans **every** king of the mover's colour across
all 576 cells, not just the kings on the boards a move happened to touch.

This module references names defined in sibling modules — `GameState`/`Color`/`Piece`/`King` from
[`types`](./types.temper.md)/[`state`](./state.temper.md), `boardOrigin`/`offset`/`allCells`/
`squareAt`/`boardOf` from [`coords`](./coords.temper.md), `pieceAt` from [`plane`](./plane.temper.md),
`opposite` from [`pieces`](./pieces.temper.md), `isSquareAttacked` from [`attack`](./attack.temper.md),
and `movesLandingOn` from [`legal`](./legal.temper.md) — all already in lexical scope: the whole `src/`
tree compiles into one library, so there are no `import` lines, and the free circular reference between
`check`, `legal`, and `reducer` is fine. `BoardIndex`/`GlobalSquare` have no structural `==`, so we
compare them through their underlying `Int` via `.value()`.

## `kingSquare` — locate a colour's king on a board

`kingSquare(plane, board, color)` returns the global square of `color`'s king on `board`, or `null` if
it is not there. The TS reference walks the board's 8×8 from its origin, stepping `f` files and `r`
ranks with `offset`, and returns the first king of the right colour it meets. We port that scan
literally. `boardOrigin(board)` is the board's top-left global square; `offset(origin, f, r)` lands on a
board-local square (it never leaves the plane for an in-range board, but we honour the nullable
contract). The first matching king short-circuits the return.

    export let kingSquare(plane: List<Piece?>, board: BoardIndex, color: Color): GlobalSquare? {
      let origin = boardOrigin(board);
      var found: GlobalSquare? = null;
      for (var r = 0; r < boardSize; r += 1) {
        for (var f = 0; f < boardSize; f += 1) {
          if (found == null) {
            let s = offset(origin, f, r);
            if (s != null) {
              let p = pieceAt(plane, s);
              if (p != null && p.type == King && p.color == color) {
                found = s;
              }
            }
          }
        }
      }
      found
    }

## `inCheck` — is this board's king attacked?

`inCheck(state, board, color)` is true when `color`'s king on `board` exists **and** is attacked by the
opposing colour under the credit-aware §7 rules. The TS body is
`ks !== null && isSquareAttacked(plane, ledger, ks, opposite(color))`; we render the null check with an
`if` (Temper narrows `ks` to non-null inside the branch) and delegate the attack test to
[`attack`](./attack.temper.md)'s `isSquareAttacked`, which already enforces "same-board needs no credit,
cross-board needs the crossing credit, a cross-board king never checks".

    export let inCheck(state: GameState, board: BoardIndex, color: Color): Boolean {
      let ks = kingSquare(state.plane, board, color);
      if (ks == null) {
        false
      } else {
        isSquareAttacked(state.plane, state.ledger, ks, opposite(color))
      }
    }

## `ownKingsInCheck` — is *any* of the mover's kings in check?

This is the king-safety scan RULES.md §7 demands: "You may not make a move that leaves any of your own
kings in check (anywhere on the plane)." Because attacks cross seams un-clipped, a move can expose a
king on a board it never touched, so we must scan **all** of the mover's kings, not just the ones on
touched boards. The TS reference iterates `allCells()`, keeps only the cells holding a `color` king, and
returns true on the first one that `isSquareAttacked` by the enemy. We port that scan directly, reading
each cell off the plane by its flat index and testing the king's square via `squareAt(cell)`.

    export let ownKingsInCheck(state: GameState, color: Color): Boolean {
      let enemy = opposite(color);
      var inCheckAnywhere = false;
      var i = 0;
      while (i < state.plane.length && !inCheckAnywhere) {
        let p = state.plane[i];
        if (p != null && p.type == King && p.color == color) {
          let ks = mkGlobal(i % plane, i / plane) orelse panic();
          if (isSquareAttacked(state.plane, state.ledger, ks, enemy)) {
            inCheckAnywhere = true;
          }
        }
        i += 1;
      }
      inCheckAnywhere
    }

## `isCheckmate` — in check and no legal move lands here

`isCheckmate(state, board)` decides checkmate for the side to move on `board`: the side to move is in
check there **and** there is **no legal move that lands on the board** to resolve it. The §7 reasoning is
exact: legal moves are already self-check-free (the [`legal`](./legal.temper.md) filter removed any move
leaving an own king in check), so *any* legal move landing on the checked board necessarily resolves the
check — including a **credited cross-board defender** that slides in to block or capture the checker,
because such a defender's destination *is* on the board, so it is counted automatically. If no such move
exists, the board is mated. The TS body is
`inCheck(state, board, state.toMove) && movesLandingOn(state, board).length === 0`; we mirror it,
reusing [`legal`](./legal.temper.md)'s `movesLandingOn`.

    export let isCheckmate(state: GameState, board: BoardIndex): Boolean {
      inCheck(state, board, state.toMove) && movesLandingOn(state, board).length == 0
    }

## Tests — porting the vitest suite

The TS `check.test.ts` leans on the shared `testkit` (`sq`, `pc`, `planeOf`, `stateOf`) plus a local
`board(n)`. The sibling [`attack`](./attack.temper.md) test block already defines `sq`, `pc`, `planeOf`
and [`ledger`](./ledger.temper.md) already defines `board(n)`; because the whole `src/` tree compiles
into one namespace, those are already in scope here and we **reuse** them rather than redefine (a second
definition would collide). The TS `stateOf` overrides we exercise here are a plane plus optional
`toMove` and `ledger`; the [`move_gen`](./move_gen.temper.md) block already supplies `statePlain` (plane,
empty ledger, active statuses, White to move) and `stateLedger` (plane + ledger). Every `check.test.ts`
case here moves White, so those two constructors cover us — `statePlain` for the no-ledger cases and
`stateLedger` for the credit-toggle cases.

### `inCheck` — same-board and credit-backed cross-board

A rook checking the king on the **same board** needs no crossing credit at all (RULES.md §7: "A
same-board attacker needs no credit"). White king at `(0,7)` on board 0, black rook at `(7,7)` on the
same global rank with a clear file: the rook checks immediately, empty ledger and all.

    test("inCheck detects a same-board rook checking the king, no credit (RULES.md §7)") {
      let plane = planeOf([
        new PlaneWrite(sq(0, 7), pc(King, White)),
        new PlaneWrite(sq(7, 7), pc(Rook, Black)),
      ]);
      let s = statePlain(plane);
      assert(inCheck(s, board(0), White)) { "the same-board rook checks the king" };
    }

The credit-backed cross-board check is the §7 heart. White king on board 0 at `(5,7)`; a black rook on
board 1 at `(8,7)` shares the global rank 7 across the seam (`gx 7|8`) with an open file. Un-clipped the
ray reaches the king — but the cross-board check only fires once Black holds a **rook** credit into
board 0. Without it, no check; toggling the credit flips it.

    test("inCheck: a cross-board rook checks only with a rook credit into the king's board (RULES.md §7)") {
      let plane = planeOf([
        new PlaneWrite(sq(5, 7), pc(King, White)),
        new PlaneWrite(sq(8, 7), pc(Rook, Black)),
      ]);

      // Without a credit into board 0, the cross-board rook does not check.
      assert(!inCheck(statePlain(plane), board(0), White)) { "no credit, no cross-board check" };

      // Toggle a black rook credit into board 0: the flip happens.
      let withCredit = stateLedger(plane, grantCredit(emptyLedger(), board(0), Black, Rook));
      assert(inCheck(withCredit, board(0), White)) { "with the rook credit, the cross-board rook checks" };
    }

### Checkmate — the back-rank mate and the credited cross-board defence

`matePlane` is the TS back-rank mate on board 0: White king cornered at `(0,7)`, its escape squares
blocked by its own pawns at `(0,6)` and `(1,6)`, a black rook checking along the back rank from `(7,7)`
with a clear path, and a far-away black king to make the position whole. We build it once as a local
helper.

    let matePlane(): List<Piece?> {
      planeOf([
        new PlaneWrite(sq(0, 7), pc(King, White)),
        new PlaneWrite(sq(0, 6), pc(Pawn, White)),
        new PlaneWrite(sq(1, 6), pc(Pawn, White)),
        new PlaneWrite(sq(7, 7), pc(Rook, Black)),
        new PlaneWrite(sq(16, 16), pc(King, Black)),
      ])
    }

The back-rank position is recognised as checkmate: in check, and no legal move lands on board 0.

    test("isCheckmate recognises a back-rank checkmate (RULES.md §7)") {
      assert(isCheckmate(statePlain(matePlane()), board(0))) { "back-rank mate" };
    }

The **signature** §7 case: a credited cross-board defender resolves the mate. We add a white rook on
board 1 at `(8,7)`, on the same global rank as the checking rook. With **no** credit it cannot cross the
seam, so the position is still mate; granting White a **rook** credit into board 0 lets the defender
slide across and capture the checker on `(7,7)` — a legal move landing on board 0 — so it is no longer
mate. This is the cross-board "credited defence" that §7 says must be counted.

    test("SIGNATURE: not mate when a credited defender can cross in to capture the checker (RULES.md §7)") {
      let plane = planeOf([
        new PlaneWrite(sq(0, 7), pc(King, White)),
        new PlaneWrite(sq(0, 6), pc(Pawn, White)),
        new PlaneWrite(sq(1, 6), pc(Pawn, White)),
        new PlaneWrite(sq(7, 7), pc(Rook, Black)),
        new PlaneWrite(sq(8, 7), pc(Rook, White)),
        new PlaneWrite(sq(16, 16), pc(King, Black)),
      ]);

      // No credit: the white rook cannot cross in, so the king is still mated.
      assert(isCheckmate(statePlain(plane), board(0))) { "can't cross in -> still mate" };

      // With a rook credit into board 0, the crossing defence resolves the check.
      let withCredit = stateLedger(plane, grantCredit(emptyLedger(), board(0), White, Rook));
      assert(!isCheckmate(withCredit, board(0))) { "credited crossing defence resolves the mate" };
    }

### No per-board stalemate (RULES.md §8, design choice (a))

A boxed-in lone king is **not** in check and is **not** checkmate. White king cornered at `(0,7)` on
board 0, hemmed by a black queen at `(2,6)` and black king at `(2,7)`, with no legal square — but it is
not in check, so it is not mate. Under §8's "no per-board stalemate" rule this stays a live, contestable
board rather than a per-board stalemate.

    test("a boxed-in lone king is neither in check nor checkmate (RULES.md §8)") {
      let plane = planeOf([
        new PlaneWrite(sq(0, 7), pc(King, White)),
        new PlaneWrite(sq(2, 6), pc(Queen, Black)),
        new PlaneWrite(sq(2, 7), pc(King, Black)),
      ]);
      let s = statePlain(plane);
      assert(!inCheck(s, board(0), White)) { "the boxed-in king is not in check" };
      assert(!isCheckmate(s, board(0))) { "and so it is not checkmate (no per-board stalemate)" };
    }

With king-safety fixed, the [`legal`](./legal.temper.md) module can filter pseudo-legal moves down to
the fully legal set, and the [`reducer`](./reducer.temper.md) can recompute per-board check/checkmate
across every non-frozen board after each move.
