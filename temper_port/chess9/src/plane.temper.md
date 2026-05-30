# The occupancy plane — immutable board state as `List<Piece?>`

This module is the Temper port of `../../src/core/plane.ts`. It models the **occupancy plane**:
the single flat array that records, for every one of the 576 cells of the continuous 24×24 grid,
which piece (if any) stands there. RULES.md §1 ("The board") fixes the geometry — nine 8×8 boards
fused into one continuous 24×24 plane, 576 cells total — and this module is where that geometry
becomes *state*. Every later concept (move generation, captures, check detection, the credit rule
of §4) reads and rewrites this plane.

The plane is deliberately the *only* mutable-looking thing in the engine, and even it is immutable:
each write produces a **new** plane and leaves the old one untouched. That copy-on-write discipline
is what lets search explore a move, evaluate the resulting position, and then discard it without
ever corrupting the position it came from. The TS reference enforces this with `ReadonlyArray` plus
`.slice()`; the Temper port enforces it with `List<Piece?>` plus the `toListBuilder → set → toList`
idiom described below.

## The `Plane` type and the empty-cell representation

The TS `Plane` is `type Plane = ReadonlyArray<Piece | null>` (see `../../src/core/types.ts`): a
read-only array of length 576 whose elements are either a `Piece` or `null` for an empty cell. The
faithful Temper rendering is `List<Piece?>` — an immutable `List` whose **element type is nullable**.
`List` is already read-only in Temper (the mutable sibling is `ListBuilder`), so it carries the
`ReadonlyArray` guarantee at the type level, and the `?` on the element carries the `| null`.

The TS `types.ts` exposes a `Plane` type alias; the Temper [`types`](./types.temper.md) port did not
port that alias, so we introduce it here, local to the module that owns the concept. Temper has no
standalone `type X = ...` aliases, so we express the contract in prose and write `List<Piece?>`
literally in every signature. `null` always means "empty cell"; a present `Piece` means an occupied
cell. There is no separate sentinel.

## `emptyPlane` — 576 empty cells

`emptyPlane()` builds the starting occupancy: a plane of exactly `squares` (= 576, from
[`coords`](./coords.temper.md)) cells, every one empty. The TS reference uses
`Array.from({ length: SQUARES }, () => null)`. Temper has no array-fill literal of that kind, so we
accumulate into a `ListBuilder<Piece?>`, pushing `null` 576 times, then freeze it with `toList()`.
The element type annotation `Piece?` on the builder is what lets `null` be a legal element.

    export let emptyPlane(): List<Piece?> {
      let acc = new ListBuilder<Piece?>();
      for (var i = 0; i < squares; i += 1) {
        acc.add(null);
      }
      acc.toList()
    }

The first invariant, straight from the TS "emptyPlane is all null and full length" case: the plane
has length 576 and every cell is empty. We assert the length against the shared `squares` constant
and scan all cells for `null`.

    test("emptyPlane is all null and full length (RULES.md §1)") {
      let p = emptyPlane();
      assert(p.length == squares) { "plane has 576 cells" };
      for (let cell of p) {
        assert(cell == null) { "every cell starts empty" };
      }
    }

## `pieceAt` — reading a cell, `Piece?` out

`pieceAt(plane, sq)` returns what stands on `sq`, or `null` if the cell is empty. It projects the
square to its flat `CellIndex` via [`coords`](./coords.temper.md)'s `cellIndex` (the `gy*24 + gx`
row-major offset), then reads that slot. The TS version writes `plane[cellIndex(sq)] ?? null`; the
trailing `?? null` is pure defensive noise in TS (an out-of-bounds array read yields `undefined`,
coerced to `null`). In Temper the index is *always* in range — a valid `GlobalSquare` always yields
a `CellIndex` in `0..575`, and the plane always has 576 cells — so we read directly with `[]`. The
element type is already `Piece?`, so the return type is `Piece?` with no coercion. This is the
module's stated contract: **`pieceAt` returns `Piece?`, where `null` means empty.**

    export let pieceAt(plane: List<Piece?>, sq: GlobalSquare): Piece? {
      plane[cellIndex(sq).value()]
    }

## `withPiece` — copy-on-write single write

`withPiece(plane, sq, piece)` is the heart of the immutability story: it returns a **new** plane
identical to the old one except that `sq` now holds `piece` (which may be `null` to clear the cell).
The original plane is never mutated.

This is where the `toListBuilder → set → toList` idiom earns its keep, and it is the direct Temper
translation of the TS `const next = plane.slice(); next[i] = piece; return next`. The steps are:

- `plane.toListBuilder()` makes a **mutable copy** of the immutable plane (the analogue of
  `.slice()` — a fresh backing array, so the original is safe).
- `builder.set(i, piece)` overwrites cell `i` in that copy.
- `builder.toList()` freezes the copy back into an immutable `List<Piece?>` to hand out.

Because the builder is a copy, mutating it cannot reach back into the source plane — that is exactly
what makes the operation copy-on-write rather than in-place.

    export let withPiece(plane: List<Piece?>, sq: GlobalSquare, piece: Piece?): List<Piece?> {
      let next = plane.toListBuilder();
      next.set(cellIndex(sq).value(), piece);
      next.toList()
    }

The "pieceAt reads back a written piece" case pins the round trip: write a white king at (5,5),
read it back there, and confirm an untouched neighbour (6,5) is still empty. Since the Temper
[`types`](./types.temper.md) `Piece` is a plain record with no structural `==`, we compare its
fields (type, colour, hasMoved) by singleton identity rather than relying on a deep-equality
operator the way the TS `toEqual` does.

    test("pieceAt reads back a written piece (RULES.md §1)") {
      let wk = new Piece(King, White, false);
      let p = withPiece(emptyPlane(), mkGlobal(5, 5) orelse panic(), wk);
      let got = pieceAt(p, mkGlobal(5, 5) orelse panic());
      assert(got != null) { "the king is present at (5,5)" };
      if (got != null) {
        assert(got.type == King) { "read-back type is king" };
        assert(got.color == White) { "read-back colour is white" };
        assert(!got.hasMoved) { "read-back hasMoved is false" };
      }
      assert(pieceAt(p, mkGlobal(6, 5) orelse panic()) == null) { "neighbour stays empty" };
    }

The "withPiece is copy-on-write (original untouched)" case is the load-bearing invariant of the
whole module: after writing into a derived plane, the **base** plane must still read empty at the
same square while the derived one reads the piece. If `toListBuilder()` aliased instead of copied,
this would fail.

    test("withPiece is copy-on-write — original untouched (RULES.md §1)") {
      let base = emptyPlane();
      let wk = new Piece(King, White, false);
      let next = withPiece(base, mkGlobal(0, 0) orelse panic(), wk);
      assert(pieceAt(base, mkGlobal(0, 0) orelse panic()) == null) { "base stays empty" };
      let got = pieceAt(next, mkGlobal(0, 0) orelse panic());
      assert(got != null) { "derived plane has the piece" };
      if (got != null) {
        assert(got.type == King) { "derived cell holds the king" };
      }
    }

## `withPieces` — a batch of writes, still copy-on-write

`withPieces(plane, writes)` applies several `(square, piece)` writes at once and returns one new
plane. Board setup and a single move's worth of edits (a capture clears one cell and fills another;
castling moves two pieces) are naturally expressed as a small batch, and doing them in one
copy-on-write pass is cheaper than chaining `withPiece` calls that each copy the whole plane.

The TS reference takes a `ReadonlyArray<readonly [GlobalSquare, Piece | null]>` — a list of
two-element tuples — and folds them into one `.slice()`d array. Temper has no tuple literal type,
so each write is modelled as a small immutable `PlaneWrite` class pairing a square with a (possibly
null) piece. The batch is then a `List<PlaneWrite>` (a plain immutable list — `List`, not the
read-only `Listed` interface, because the engine iterates it with a `for`-of loop). We make a single
mutable copy, apply every
write into it in order, then freeze once. Order matters and is preserved: a later write to the same
square overrides an earlier one, exactly as the TS `for` loop overwrites in sequence.

    export class PlaneWrite(
      public sq: GlobalSquare,
      public piece: Piece?,
    ) {}

    export let withPieces(plane: List<Piece?>, writes: List<PlaneWrite>): List<Piece?> {
      let next = plane.toListBuilder();
      for (let w of writes) {
        next.set(cellIndex(w.sq).value(), w.piece);
      }
      next.toList()
    }

The "withPieces applies a batch of writes" case ports the TS batch test verbatim in spirit: write a
white king at (1,1), a black knight at (2,2), then *clear* (1,1) again in the same batch. The
last-write-wins ordering must leave (1,1) empty and (2,2) holding the knight.

    test("withPieces applies a batch of writes, last write wins (RULES.md §1)") {
      let wk = new Piece(King, White, false);
      let bn = new Piece(Knight, Black, true);
      let p = withPieces(emptyPlane(), [
        new PlaneWrite(mkGlobal(1, 1) orelse panic(), wk),
        new PlaneWrite(mkGlobal(2, 2) orelse panic(), bn),
        new PlaneWrite(mkGlobal(1, 1) orelse panic(), null),
      ]);
      assert(pieceAt(p, mkGlobal(1, 1) orelse panic()) == null) { "(1,1) cleared by last write" };
      let got = pieceAt(p, mkGlobal(2, 2) orelse panic());
      assert(got != null) { "(2,2) holds a piece" };
      if (got != null) {
        assert(got.type == Knight) { "(2,2) is the knight" };
        assert(got.color == Black) { "(2,2) knight is black" };
        assert(got.hasMoved) { "(2,2) knight has moved" };
      }
    }

With an immutable, copy-on-write plane in hand, the modules above this one can represent a position,
try a move by producing a fresh plane, and recurse — never having to undo, because nothing was ever
mutated in place.
