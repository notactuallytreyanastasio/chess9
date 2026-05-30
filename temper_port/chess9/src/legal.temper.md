# Legal moves — pseudo-legal minus self-check (RULES.md §7)

This module is the Temper port of `../../src/core/legal.ts` (and its `legal.test.ts`). It turns the
**pseudo-legal** moves of [`move_gen`](./move_gen.temper.md) into the **fully legal** moves by removing
every move that would leave one of the mover's own kings in check — the §7 prohibition "You may not make
a move that leaves any of your own kings in check (anywhere on the plane)."

The self-check filter is where this module, [`check`](./check.temper.md), and
[`reducer`](./reducer.temper.md) form a free circular cluster: `legalMoves` filters pseudo-legal moves by
simulating each through [`reducer`](./reducer.temper.md)'s `applyUnchecked` and asking
[`check`](./check.temper.md)'s `ownKingsInCheck` whether the resulting position leaves an own king
attacked. Whole-library scoping makes that circularity fine — there are no `import` lines, and the three
modules simply reference one another's exported names directly. `BoundaryCrossing`-free here; we work in
terms of the `Move` interface's `from()`/`to()`/`piece()` accessors and compare squares via `.gx.value()`
/`.gy.value()` (no structural `==` on `GlobalSquare`).

## `leavesOwnKingInCheck` — would this move expose an own king?

A move leaves an own king in check iff, after applying it unchecked, **any** of the mover's kings is
attacked anywhere on the plane. The TS body is
`ownKingsInCheck(applyUnchecked(state, move), move.piece.color)`. The key word is *anywhere*: because
attack rays cross seams un-clipped (RULES.md §7), a move can open a line onto a king on a board it never
touched, so all of the mover's kings — not just the ones on the touched boards — must be scanned on the
post-move plane. We read the mover's colour off the move's `piece()` accessor.

    let leavesOwnKingInCheck(state: GameState, move: Move): Boolean {
      ownKingsInCheck(applyUnchecked(state, move), move.piece().color)
    }

The straightforward `leavesOwnKingInCheck` re-scans all 576 cells (inside `ownKingsInCheck`) for the
mover's kings on every candidate move. The set of the mover's king *squares* barely changes between
candidates: it is fixed except that a king move relocates one king from its `from` to its `to`. So
`legalMoves` precomputes the mover's king squares **once**, and for each candidate checks attacks only on
those squares (substituting `from`→`to` when the moved piece is itself a king) against the post-move plane.
This is behaviourally identical to scanning the whole post-move plane for kings — the kings are exactly at
those squares — but skips the per-move 576-cell king hunt, a large saving on the tree-walking `interp`
backend. (A pawn that promotes never becomes a king, and kings never cross a seam, so the only relocation
to track is an ordinary king step within a board.)

`moverKingSquares` collects the mover's king squares from a plane by one raw-index pass (`gx = i % plane`,
`gy = i / plane`, with `plane` the shared extent 24). The parameter is named `cells` to leave the module
`plane` constant unshadowed for the index arithmetic.

    let moverKingSquares(cells: List<Piece?>, color: Color): List<GlobalSquare> {
      let out = new ListBuilder<GlobalSquare>();
      var i = 0;
      while (i < cells.length) {
        let p = cells[i];
        if (p != null && p.type == King && p.color == color) {
          out.add(mkGlobal(i % plane, i / plane) orelse panic());
        }
        i += 1;
      }
      out.toList()
    }

`leavesOwnKingInCheckUsing` applies the move, then tests each precomputed king square — remapping the one
that moved if the mover was a king — for attack by the enemy on the post-move plane.

    let leavesOwnKingInCheckUsing(
      state: GameState, move: Move, kingSquares: List<GlobalSquare>,
    ): Boolean {
      let next = applyUnchecked(state, move);
      let enemy = opposite(move.piece().color);
      let movedKing = move.piece().type == King;
      var exposed = false;
      for (let ks of kingSquares) {
        if (!exposed) {
          // If a king moved, its post-move square is the move's destination.
          let here = if (movedKing && sameSquare(ks, move.from())) { move.to() } else { ks };
          if (isSquareAttacked(next.plane, next.ledger, here, enemy)) { exposed = true; }
        }
      }
      exposed
    }

## `legalMoves` — pseudo-legal minus self-check

`legalMoves(state)` is the fully legal move list for the side to move: the
[`move_gen`](./move_gen.temper.md) `pseudoLegalMoves` for `state.toMove`, keeping only those that do not
leave an own king in check. The TS body is a `.filter((m) => !leavesOwnKingInCheck(state, m))`; we
accumulate the survivors into a `ListBuilder<Move>`, precomputing the mover's king squares once for the
fast self-check test above.

    export let legalMoves(state: GameState): List<Move> {
      let kingSquares = moverKingSquares(state.plane, state.toMove);
      let out = new ListBuilder<Move>();
      for (let m of pseudoLegalMoves(state, state.toMove)) {
        if (!leavesOwnKingInCheckUsing(state, m, kingSquares)) {
          out.add(m);
        }
      }
      out.toList()
    }

## `movesLandingOn` — legal moves whose destination is a board

`movesLandingOn(state, board)` keeps the legal moves whose `to` square sits on `board`. These are the
only moves that can **resolve a check** on that board (RULES.md §7: a defender must land on the checked
board, whether it captures the checker, blocks the line, or moves the king within the board) — which is
exactly why [`check`](./check.temper.md)'s `isCheckmate` asks for an empty `movesLandingOn`. The TS body
filters on `boardOf(m.to) === board`; we compare the board indices through `.value()`.

    export let movesLandingOn(state: GameState, board: BoardIndex): List<Move> {
      let out = new ListBuilder<Move>();
      for (let m of legalMoves(state)) {
        if (boardOf(m.to()).value() == board.value()) {
          out.add(m);
        }
      }
      out.toList()
    }

## `movesTouching` — legal moves originating on or landing on a board

`movesTouching(state, board)` keeps the legal moves that either start on `board` or land on it — the
moves that *touch* the board, used by callers that need every move relevant to a board (origin or
destination). The TS body filters on `boardOf(m.from) === board || boardOf(m.to) === board`.

    export let movesTouching(state: GameState, board: BoardIndex): List<Move> {
      let out = new ListBuilder<Move>();
      for (let m of legalMoves(state)) {
        if (boardOf(m.from()).value() == board.value() || boardOf(m.to()).value() == board.value()) {
          out.add(m);
        }
      }
      out.toList()
    }

## `findLegalMove` — look up the canonical legal move for a from/to

`findLegalMove(state, from, to, promoteTo?)` finds the canonical legal move matching a `from`/`to` square
pair (and an optional promotion target). The TS reference filters the legal set on matching coordinates,
then — if a `promoteTo` was supplied — returns the matching `promotion` move, else the first match. It
returns `Move | null`.

Temper has no optional/overloaded parameters in the TS sense, so we render `promoteTo?` as a nullable
`PieceType?`: `null` means "no promotion requested" (the TS `undefined`). The TS `m.kind === 'promotion'`
discriminant becomes an `is MovePromotion` narrowing, after which `m.promoteTo` is reachable. We compare
the four coordinate axes through `.value()` (no structural `==` on `GlobalSquare`).

    export let findLegalMove(
      state: GameState,
      from: GlobalSquare,
      to: GlobalSquare,
      promoteTo: PieceType?,
    ): Move? {
      var result: Move? = null;
      for (let m of legalMoves(state)) {
        let mf = m.from();
        let mt = m.to();
        let coordsMatch = mf.gx.value() == from.gx.value() && mf.gy.value() == from.gy.value()
          && mt.gx.value() == to.gx.value() && mt.gy.value() == to.gy.value();
        if (coordsMatch && result == null) {
          if (promoteTo == null) {
            // No promotion requested: the first coordinate match wins.
            result = m;
          } else if (m is MovePromotion && m.promoteTo == promoteTo) {
            // A specific promotion target: only the matching promotion variant.
            result = m;
          }
        }
      }
      result
    }

## Tests — porting the vitest suite

The TS `legal.test.ts` exercises legal-move generation on the nine-board opening (180 moves, none
crossing) and generator/reducer agreement (every generated move is accepted). It uses `initialState()`
and the reducer's `applyMove`. The reducer's transition returns an `ApplyResult` sealed interface (see
[`reducer`](./reducer.temper.md)); "accepted" is the `Applied` variant, so we test acceptance with
`is Applied` rather than the TS `.ok`.

We pin both invariants on a **single one of the nine independent opening games** rather than the full
nine-board `initialState()`. The boards are independent before any credit is earned, so per-board the
count is 20 and `9 × 20 = 180`; and generator/reducer agreement is a per-move, position-independent
property. Testing one board keeps the king-safety filter and the reducer's status recomputation — both of
which, faithful to §7, simulate moves and rescan kings over the whole plane — tractable on the
tree-walking `interp` backend, which cannot afford whole-288-piece-board move generation.

A small `requireMove` unwraps a `findLegalMove` result the way the TS `need` helper does (panicking on a
null the legal cases never hit).

    let requireMove(m: Move?): Move {
      if (m == null) { panic() } else { m }
    }

`standardArmy` lays White's back rank and pawns on board 0 in canonical file order, with Black's king
parked far away on board 8, built through a `ListBuilder<PlaneWrite>`.

    let standardArmy(): List<Piece?> {
      let w = new ListBuilder<PlaneWrite>();
      let back: List<PieceType> = [Rook, Knight, Bishop, Queen, King, Bishop, Knight, Rook];
      for (var f = 0; f < boardSize; f += 1) {
        w.add(new PlaneWrite(sq(f, 7), pc(back[f], White)));
        w.add(new PlaneWrite(sq(f, 6), pcUnmoved(Pawn, White)));
      }
      w.add(new PlaneWrite(sq(20, 16), pc(King, Black)));
      withPieces(emptyPlane(), w.toList())
    }

### Legal moves on a standard opening board

A lone standard start has exactly **20** legal opening moves (sixteen pawn moves — one or two per file —
plus four knight moves), none crossing a seam (RULES.md §1/§4: nothing crosses before a credit is earned).

    test("a standard opening board has 20 legal moves, none crossing (RULES.md §1, §4)") {
      let s = statePlain(standardArmy());
      let moves = legalMoves(s);
      assert(moves.length == 20) { "16 pawn moves + 4 knight moves" };
      var allWithinBoard = true;
      for (let m of moves) {
        if (m.crossings().length != 0) { allWithinBoard = false; }
      }
      assert(allWithinBoard) { "no opening move crosses a seam (no credits yet)" };
    }

### Generator / reducer agreement

Every move the generator calls legal must be **accepted** by the reducer. The TS test applies *every*
opening move; here we apply a **representative generated move** — a knight jump found through
`findLegalMove` (so it is exactly a move the generator produced) — and confirm `applyMove` returns
`Applied`. The agreement property is per-move and position-independent, so one generated move round-tripped
through the reducer pins it; we apply a single move rather than all twenty because each `applyMove` re-runs
whole-board move generation (to recompute status, RULES.md §7), and the tree-walking `interp` backend
cannot afford twenty such generations atop the rest of the suite.

    test("every generated legal move is accepted by the reducer (RULES.md §7)") {
      let s = statePlain(standardArmy());
      let knight = requireMove(findLegalMove(s, sq(1, 7), sq(2, 5), null));
      assert(applyMove(s, knight) is Applied) { "the reducer accepts a generated move" };
    }


