# Coordinates — the continuous plane and the per-board view

This module models the **geometry** of Chess-9. RULES.md §1 ("The board") says it all: nine
standard 8×8 boards are arranged in a 3×3 grid, indexed `0–8` row-major (`0 1 2 / 3 4 5 / 6 7 8`),
and together they form **one continuous 24×24 plane**. Global coordinates are `(gx, gy)`, each in
`0–23`. Crucially, the board seams are *invisible to geometry*: a sliding piece glides straight
across a seam onto the neighbouring board on the same line. So this module's primary space is the
flat 24×24 plane, and the per-board `(board, file, rank)` view is a *derived* projection of it.

Everything downstream — rays, attacks, move generation — computes in the plane space defined here.
The per-board view exists only because the rules occasionally need to talk about "which board" a
square belongs to (the credit rule, §4) or a square's file/rank within its board (pawn home ranks,
§5).

The TypeScript reference (`../../src/core/coords.ts`) builds this on two TypeScript-only devices we
must translate:

- **Branded scalars.** `GX = Brand<number,'GX'>`, `File`, `Rank`, `BoardIndex`, `CellIndex` are
  structural `number`s tagged with a phantom string. Temper has no structural branding, so each
  becomes a **nominal class** holding one `Int`, mintable *only* through a smart constructor. That
  is strictly stronger than TS branding: a `GX` value cannot be confused with a `File` even by
  accident, on any backend.
- **`Result<T,CoordError>`.** The TS smart constructors return `ok`/`err`. Per the porting
  cheat-sheet, a Temper smart constructor that can fail is `... throws Bubble` and signals failure
  with `bubble()` (which takes no arguments). Callers recover with `orelse`. There is no error
  *value* to inspect — `Bubble` is control flow, not data — so the TS `CoordError` record (which
  recorded `axis` and the offending `value`) has no Temper analogue and simply disappears.

One TS check also disappears for a happier reason. The TS `inRange` guards `Number.isInteger(n)`
because a JS `number` can be `1.5`. A Temper `Int` is *already* an integer, so passing a non-integer
to `mkGx` is a compile error, not a runtime rejection. The type system subsumes the check.

## Geometry constants

RULES.md §1 fixes the dimensions. These mirror `../../src/core/constants.ts` exactly. We expose
them as module constants so later modules share one source of truth.

    /** Squares per side of one standard chess board. */
    export let boardSize: Int = 8;
    /** Boards per side of the 3×3 super-grid (RULES.md §1). */
    export let grid: Int = 3;
    /** Squares per side of the continuous plane: 8×3 = 24 (RULES.md §1). */
    export let plane: Int = 24;
    /** Cells in the whole plane: 24×24 = 576. */
    export let squares: Int = 576;
    /** Number of boards: 3×3 = 9. */
    export let boards: Int = 9;

## The branded scalars

Each coordinate axis is its own nominal class wrapping a single validated `Int`. The constructor is
`private`, so the *only* way to obtain one is through the `mk…` smart constructor below — which means
a value of any of these types always satisfies its range invariant. This is the Temper rendering of
"branded value reachable only after range validation" from the TS comment.

`GX`/`GY` are the two global axes (`0–23`). `File`/`Rank` are the column/row *within* a board
(`0–7`). `BoardIndex` names one of the nine boards (`0–8`). `CellIndex` is the flat plane offset
(`0–575 = gy*24 + gx`).

    export class GX(private value_: Int) {
      public value(): Int { value_ }
    }
    export class GY(private value_: Int) {
      public value(): Int { value_ }
    }
    export class File(private value_: Int) {
      public value(): Int { value_ }
    }
    export class Rank(private value_: Int) {
      public value(): Int { value_ }
    }
    export class BoardIndex(private value_: Int) {
      public value(): Int { value_ }
    }
    export class CellIndex(private value_: Int) {
      public value(): Int { value_ }
    }

## Range checking and the smart constructors

The shared range test: `n` is valid for an axis of extent `max` iff `0 <= n < max`. (No integer
check is needed; see the prose above.)

    let inRange(n: Int, max: Int): Boolean {
      n >= 0 && n < max
    }

Each smart constructor validates against its axis extent and `bubble()`s when out of range,
otherwise minting the branded value. This is the direct translation of the TS `mkGX`/`mkGY`/… that
returned `Result`. A caller that *knows* a value is in range writes `mkGx(7) orelse panic()`; a
caller probing the plane edge writes `mkGx(n) orelse …fallback`.

    export let mkGx(n: Int): GX throws Bubble {
      if (inRange(n, plane)) { new GX(n) } else { bubble() }
    }
    export let mkGy(n: Int): GY throws Bubble {
      if (inRange(n, plane)) { new GY(n) } else { bubble() }
    }
    export let mkFile(n: Int): File throws Bubble {
      if (inRange(n, boardSize)) { new File(n) } else { bubble() }
    }
    export let mkRank(n: Int): Rank throws Bubble {
      if (inRange(n, boardSize)) { new Rank(n) } else { bubble() }
    }
    export let mkBoardIndex(n: Int): BoardIndex throws Bubble {
      if (inRange(n, boards)) { new BoardIndex(n) } else { bubble() }
    }

These pin the same boundary behaviour the TS `coords.test.ts` "smart constructors" cases check:
out-of-range values (including the negative and just-past-the-end edges) are rejected, and the
boundary-valid endpoints (`0`, `23`, `7`, `8`) are accepted. We test rejection by recovering the
bubble with `orelse` and observing the fallback; acceptance by reading the minted value back.

    test("smart constructors reject out-of-range values (RULES.md §1)") {
      assert((mkGx(-1) orelse new GX(-1)).value() == -1) { "gx -1 rejected" };
      assert((mkGx(24) orelse new GX(-1)).value() == -1) { "gx 24 rejected" };
      assert((mkFile(8) orelse new File(-1)).value() == -1) { "file 8 rejected" };
      assert((mkBoardIndex(9) orelse new BoardIndex(-1)).value() == -1) { "board 9 rejected" };
    }

    test("smart constructors accept boundary-valid values (RULES.md §1)") {
      assert((mkGx(0) orelse panic()).value() == 0) { "gx 0 ok" };
      assert((mkGx(23) orelse panic()).value() == 23) { "gx 23 ok" };
      assert((mkFile(7) orelse panic()).value() == 7) { "file 7 ok" };
      assert((mkBoardIndex(8) orelse panic()).value() == 8) { "board 8 ok" };
    }

The TS suite also feeds `mkGX(1.5)` and expects rejection. In Temper that line cannot be written —
`mkGx` takes an `Int` and `1.5` is a `Float64` — so the invariant is enforced by the *type checker*
rather than a runtime branch. We record this as a documented translation decision rather than a
test, because there is no compilable expression to assert on.

## `GlobalSquare` — the primary spatial coordinate

A point in the plane: a validated `gx` and `gy`. The TS `GlobalSquare` is a `readonly` record of two
branded numbers; here it is an immutable class holding two branded scalars. All geometry is computed
in this space (RULES.md §1).

    export class GlobalSquare(
      public gx: GX,
      public gy: GY,
    ) {}

The `mkGlobal` smart constructor validates both axes in turn, bubbling on the first failure — the
faithful translation of the TS version that short-circuits on `!x.ok` then `!y.ok`.

    export let mkGlobal(gx: Int, gy: Int): GlobalSquare throws Bubble {
      new GlobalSquare(mkGx(gx), mkGy(gy))
    }

Two squares are the same point iff both axes agree. The TS `sameSquare` compared branded numbers by
`===`; here we compare the unwrapped `Int`s.

    export let sameSquare(a: GlobalSquare, b: GlobalSquare): Boolean {
      a.gx.value() == b.gx.value() && a.gy.value() == b.gy.value()
    }

## `BoardSquare` — the derived per-board view

The projection of a global point onto "which board, and where within it". The TS `BoardSquare` is a
record of `board`/`file`/`rank`; same here.

    export class BoardSquare(
      public board: BoardIndex,
      public file: File,
      public rank: Rank,
    ) {}

## In-bounds and offset

`inBounds` is the plane-membership predicate over raw numbers — used by `offset` and by ray walks to
know when a step has left the 24×24 plane (RULES.md §1: the plane edge, unlike a seam, *does* stop a
slide).

    export let inBounds(gx: Int, gy: Int): Boolean {
      inRange(gx, plane) && inRange(gy, plane)
    }

`offset` steps from a square by `(dx, dy)`. The TS version returns `GlobalSquare | null`; in Temper a
nullable square is `GlobalSquare?` and we return `null` when the step leaves the plane. Note we build
the result with the unchecked `new GX(...)` because we have already proven membership via `inBounds`
— exactly as the TS code reused its internal `brandGX` after the same guard.

    export let offset(sq: GlobalSquare, dx: Int, dy: Int): GlobalSquare? {
      let gx = sq.gx.value() + dx;
      let gy = sq.gy.value() + dy;
      if (inBounds(gx, gy)) {
        new GlobalSquare(new GX(gx), new GY(gy))
      } else {
        null
      }
    }

## Plane ↔ cell index

The flat index of a square is `gy*24 + gx` (row-major over the plane). Its inverse splits an index
back into `(gx, gy)` by remainder and integer division. Both reuse the unchecked constructors: a
valid `GlobalSquare` always yields an in-range `CellIndex`, and a valid `CellIndex` always yields an
in-range square.

    export let cellIndex(sq: GlobalSquare): CellIndex {
      new CellIndex(sq.gy.value() * plane + sq.gx.value())
    }

    export let squareAt(idx: CellIndex): GlobalSquare {
      new GlobalSquare(
        new GX(idx.value() % plane),
        new GY(idx.value() / plane),
      )
    }

## Global ↔ board

`boardOf` answers which of the nine boards a global square sits on: integer-divide each axis by the
board size to get the board's grid column/row, then combine row-major (`by*3 + bx`). This is the
membership map the credit rule (§4) leans on.

    export let boardOf(sq: GlobalSquare): BoardIndex {
      let bx = sq.gx.value() / boardSize;
      let by = sq.gy.value() / boardSize;
      new BoardIndex(by * grid + bx)
    }

`toBoardSquare` completes the projection: the board plus the file/rank *within* that board, obtained
by taking each axis modulo the board size.

    export let toBoardSquare(sq: GlobalSquare): BoardSquare {
      new BoardSquare(
        boardOf(sq),
        new File(sq.gx.value() % boardSize),
        new Rank(sq.gy.value() % boardSize),
      )
    }

`toGlobal` is the inverse: recover the board's grid column/row from its index, then add the in-board
file/rank to that board's origin to land back in plane space.

    export let toGlobal(bs: BoardSquare): GlobalSquare {
      let bx = bs.board.value() % grid;
      let by = bs.board.value() / grid;
      new GlobalSquare(
        new GX(bx * boardSize + bs.file.value()),
        new GY(by * boardSize + bs.rank.value()),
      )
    }

`boardOrigin` gives the top-left (smallest `gx`,`gy`) global square of a board — the corner the UI
and setup code anchor a board's pieces to.

    export let boardOrigin(board: BoardIndex): GlobalSquare {
      let bx = board.value() % grid;
      let by = board.value() / grid;
      new GlobalSquare(
        new GX(bx * boardSize),
        new GY(by * boardSize),
      )
    }

## Enumerating every cell

`allCells` lists all 576 cell indices in order — used to scan the whole plane. The TS version built a
`readonly CellIndex[]` via `Array.from`; here we accumulate a `ListBuilder<CellIndex>` and freeze it.

    export let allCells(): List<CellIndex> {
      let acc = new ListBuilder<CellIndex>();
      for (var i = 0; i < squares; i += 1) {
        acc.add(new CellIndex(i));
      }
      acc.toList()
    }

## The two high-value invariants

The first is the **plane↔cell bijection**: every one of the 576 cells survives the round trip
`cellIndex(squareAt(cell)) == cell`, and `allCells()` produces exactly 576 of them. This is the
Temper port of the TS "round-trips every one of the 576 cells" case. It pins that the flat index and
the `(gx,gy)` split are true inverses across the entire plane.

    test("plane <-> cell index is a bijection over all 576 cells") {
      let cells = allCells();
      assert(cells.length == squares) { "there are 576 cells" };
      for (let cell of cells) {
        assert(cellIndex(squareAt(cell)).value() == cell.value()) {
          "cell ${cell.value().toString()} round-trips"
        };
      }
    }

The second is the **global↔board-square round trip** over *every* square in the plane:
`toGlobal(toBoardSquare(s)) == s`. Because the seams are invisible to geometry (§1), projecting a
square down to its board view and lifting it back must be exact for all 576 squares, not just within
one board. This is the port of the TS "toGlobal(toBoardSquare(s)) === s for all squares" case.

    test("global <-> board-square round-trips over every square (RULES.md §1)") {
      for (var gy = 0; gy < plane; gy += 1) {
        for (var gx = 0; gx < plane; gx += 1) {
          let sq = mkGlobal(gx, gy) orelse panic();
          let back = toGlobal(toBoardSquare(sq));
          assert(sameSquare(back, sq)) {
            "square (${gx.toString()}, ${gy.toString()}) round-trips"
          };
        }
      }
    }

A targeted check on `boardOf` pins the row-major board numbering from §1 (`0 1 2 / 3 4 5 / 6 7 8`):
the last cell of board 0, the first cell of the centre board 4, its row/column neighbours, and the
far corner on board 8. This is the port of the TS "maps the four-board corner cells correctly" case.

    test("boardOf maps corner cells to the row-major board numbering (RULES.md §1)") {
      assert(boardOf(mkGlobal(7, 7) orelse panic()).value() == 0) { "last cell of board 0" };
      assert(boardOf(mkGlobal(8, 8) orelse panic()).value() == 4) { "first cell of centre board" };
      assert(boardOf(mkGlobal(8, 7) orelse panic()).value() == 1) { "right neighbour, same band" };
      assert(boardOf(mkGlobal(7, 8) orelse panic()).value() == 3) { "below neighbour" };
      assert(boardOf(mkGlobal(23, 23) orelse panic()).value() == 8) { "far corner is board 8" };
      assert(boardOf(mkGlobal(0, 0) orelse panic()).value() == 0) { "origin is board 0" };
    }

Finally, `offset` and `inBounds` guard the plane edges. Stepping off the plane yields `null`; a step
that stays in-bounds lands on the expected board (here, crossing the seam from board 0's far corner
into the centre board 4 — a legal *geometric* step, §1). And `inBounds` accepts the inclusive corners
`(0,0)` and `(23,23)` while rejecting the just-past-the-edge coordinates. This ports the TS "offset"
describe block.

    test("offset returns null off the plane and steps in-bounds (RULES.md §1)") {
      assert(offset(mkGlobal(0, 0) orelse panic(), -1, 0) == null) { "step off left edge" };
      assert(offset(mkGlobal(23, 23) orelse panic(), 1, 0) == null) { "step off right edge" };

      let stepped = offset(mkGlobal(7, 7) orelse panic(), 1, 1);
      assert(stepped != null) { "step across the seam stays in-bounds" };
      if (stepped != null) {
        assert(boardOf(stepped).value() == 4) { "lands on the centre board" };
      }
    }

    test("inBounds guards the plane edges (RULES.md §1)") {
      assert(inBounds(0, 0)) { "origin in bounds" };
      assert(inBounds(23, 23)) { "far corner in bounds" };
      assert(!inBounds(24, 0)) { "past the right edge is out" };
      assert(!inBounds(0, -1)) { "before the top edge is out" };
    }

With the plane geometry, the branded scalars, and both round-trip invariants fixed, later modules can
build rays, attacks, and the credit-gated crossing logic (RULES.md §4) directly on top of
`GlobalSquare` and the projections defined here.
