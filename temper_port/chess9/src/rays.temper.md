# Rays — sliding paths and jumper targets across the continuous plane

This module is the Temper port of `../../src/core/rays.ts`. It computes the *raw geometry* of how
pieces reach squares on the Chess-9 board, before any credit accounting (RULES.md §4) decides which
of those reaches are actually legal. Two shapes of movement live here:

- **Sliders** (rook, bishop, queen) walk a straight ray until something stops them.
- **Jumpers** (knight, king) leap to a fixed set of offset squares.

Everything is computed in the flat 24×24 plane that [`coords`](./coords.temper.md) established
(RULES.md §1: nine 8×8 boards fused into one continuous plane, the seams *invisible to geometry*).
Because the seams are invisible, a slider glides straight across a board boundary onto the
neighbouring board on the same line — the boundary is not a wall, only a bookkeeping event. The
*plane edge*, by contrast, really does stop a slide.

## Why this module records the boards a ray ENTERS

RULES.md §4 ("Crossing between boards") is the reason `traceSlider` does more than list reachable
squares. The **credit rule** says: "A move that enters several boards needs a credit for every board
it enters (each board on the path that differs from the origin — *including boards it merely passes
through*). Executing the move spends one credit per board entered." And: "Sliders keep going across
as many seams as the path allows until blocked by a piece or the plane edge — legal as long as you
hold a credit for each board entered."

So for every square a ray can reach, the eventual legality check needs to know the **ordered list of
boards entered** to get there — every board on the path different from the ray's origin board, in
the order first stepped onto. `traceSlider` therefore carries that list forward as it walks, and
attaches the running list to each reachable square. This is the heart of the TS reference's `RayStep`
and the rule that "a slide may cross AS MANY boundaries as the unobstructed path allows" — there is
no single-boundary cap.

## Direction vectors

A direction is a `(dx, dy)` step. The TS reference models these as `readonly [number, number]`
tuples; Temper has no tuple type, so `Vec` is a tiny immutable class with two `Int` fields.

    export class Vec(
      public dx: Int,
      public dy: Int,
    ) {}

The diagonal and orthogonal direction sets, and the slider direction vectors built from them. A
bishop slides the four diagonals; a rook the four orthogonals; a queen all eight. These mirror
`DIAGONALS`, `ORTHOGONALS`, `BISHOP_DIRS`, `ROOK_DIRS`, `QUEEN_DIRS` in the TS reference. We build
them as plain immutable `List<Vec>`.

    let diagonals(): List<Vec> {
      [new Vec(1, 1), new Vec(1, -1), new Vec(-1, 1), new Vec(-1, -1)]
    }
    let orthogonals(): List<Vec> {
      [new Vec(1, 0), new Vec(-1, 0), new Vec(0, 1), new Vec(0, -1)]
    }

    export let bishopDirs(): List<Vec> { diagonals() }
    export let rookDirs(): List<Vec> { orthogonals() }
    export let queenDirs(): List<Vec> {
      let acc = new ListBuilder<Vec>();
      acc.addAll(diagonals());
      acc.addAll(orthogonals());
      acc.toList()
    }

The jumper delta sets. A knight has the eight L-shaped deltas; a king steps to any of its eight
neighbours (the same eight vectors a queen uses, but exactly one step). These mirror `KNIGHT_DELTAS`
and `KING_DELTAS` in the TS reference.

    let knightDeltas(): List<Vec> {
      [
        new Vec(1, 2), new Vec(2, 1), new Vec(-1, 2), new Vec(-2, 1),
        new Vec(1, -2), new Vec(2, -1), new Vec(-1, -2), new Vec(-2, -1),
      ]
    }
    let kingDeltas(): List<Vec> { queenDirs() }

## `RayStep` — one reachable square with its entered-board list

One reachable square along a ray, carrying the **ordered list of boards entered** to reach it (every
board on the path different from the ray's origin board, in first-seen order), plus whatever piece
stands on the square (`null` if empty). The list is empty while the ray is still on its origin board.
The TS reference uses `ReadonlyArray<BoardIndex>` for `entered`; the Temper rendering is an immutable
`List<BoardIndex>`.

    export class RayStep(
      public square: GlobalSquare,
      public entered: List<BoardIndex>,
      public occupant: Piece?,
    ) {}

## `JumpTarget` — one jumper destination with its crossing count

A single knight/king target square with its crossing count: `0` if the target stays on the jumper's
own board, `1` if it lands on a different board. A knight (or king) jump enters at most one board
(RULES.md §4: "Knights jump and enter exactly one board"), so the count is always `0` or `1`.

    export class JumpTarget(
      public square: GlobalSquare,
      public crossings: Int,
    ) {}

## `traceSlider` — walk a ray to the wall or the first occupant

`traceSlider(plane, from, dir)` walks a sliding ray from `from` in direction `dir`, returning every
square reachable along it. The walk halts only at the **plane wall** (a step that leaves the 24×24
plane, where [`coords`](./coords.temper.md)'s `offset` returns `null`) or at the **first occupied
square** — which is itself included as a potential capture (RULES.md §3, §4). There is no
single-boundary cap: the ray crosses as many seams as the unobstructed path allows.

The board-boundary bookkeeping reproduces the TS reference exactly. We track the origin board and the
previous square's board (compared by their underlying `Int` via `.value()`, since `BoardIndex` is a
nominal class with no structural `==`). On each step, if the new board differs from both the previous
board *and* the origin board, it is a board we have not yet recorded for this ray — because a straight
slide visits each board contiguously, such a board is necessarily new — so we append it to the running
`entered` list. We then record the step (with a *copy* of the running list so later appends cannot
mutate an already-recorded step's list), and stop if it was occupied.

We build `entered` as a `ListBuilder<BoardIndex>` that grows as the walk proceeds, snapshotting it to
an immutable `List` for each `RayStep`.

    export let traceSlider(plane: List<Piece?>, from: GlobalSquare, dir: Vec): List<RayStep> {
      let steps = new ListBuilder<RayStep>();
      let originBoard = boardOf(from).value();
      var prevBoard = originBoard;
      let entered = new ListBuilder<BoardIndex>();
      var cur = from;
      var walking = true;
      while (walking) {
        let next = offset(cur, dir.dx, dir.dy);
        if (next == null) {
          walking = false;
        } else {
          let nb = boardOf(next);
          let nbv = nb.value();
          if (nbv != prevBoard && nbv != originBoard) {
            entered.add(nb);
          }
          prevBoard = nbv;
          let occupant = pieceAt(plane, next);
          steps.add(new RayStep(next, entered.toList(), occupant));
          if (occupant != null) {
            walking = false;
          } else {
            cur = next;
          }
        }
      }
      steps.toList()
    }

## `sliderSteps` — flatten a slider's rays over all its directions

`sliderSteps(plane, from, dirs)` runs `traceSlider` for each direction and concatenates the results —
the Temper rendering of the TS `dirs.flatMap(d => traceSlider(...))`. A bishop passes `bishopDirs()`,
a rook `rookDirs()`, a queen `queenDirs()`.

    export let sliderSteps(plane: List<Piece?>, from: GlobalSquare, dirs: List<Vec>): List<RayStep> {
      let acc = new ListBuilder<RayStep>();
      for (let d of dirs) {
        acc.addAll(traceSlider(plane, from, d));
      }
      acc.toList()
    }

## Jumper targets

`jumpTargets(from, deltas)` is the shared engine behind `knightTargets` and `kingTargets`: for each
delta, step from `from` and, if the step stays on the plane, record the destination with its crossing
count (`0` if it lands on the origin board, `1` otherwise). Off-plane steps are silently dropped (the
TS `continue`).

    let jumpTargets(from: GlobalSquare, deltas: List<Vec>): List<JumpTarget> {
      let fromBoard = boardOf(from).value();
      let out = new ListBuilder<JumpTarget>();
      for (let d of deltas) {
        let sq = offset(from, d.dx, d.dy);
        if (sq != null) {
          let crossings = if (boardOf(sq).value() == fromBoard) { 0 } else { 1 };
          out.add(new JumpTarget(sq, crossings));
        }
      }
      out.toList()
    }

    export let knightTargets(from: GlobalSquare): List<JumpTarget> {
      jumpTargets(from, knightDeltas())
    }
    export let kingTargets(from: GlobalSquare): List<JumpTarget> {
      jumpTargets(from, kingDeltas())
    }

## Test helpers

The TS tests lean on a `testkit` (`sq`, `pc`, `planeOf`) that the Temper port has not ported as a
shared module. We reproduce the three helpers locally. `sqOf` mints a `GlobalSquare` (panicking on a
bad coordinate, which never happens in these tests). `mkPiece` builds a `Piece` (the TS `pc` defaults
`hasMoved` to `true`). `planeWith` lays the given pieces onto an empty plane via `withPieces` from
[`plane`](./plane.temper.md).

    let sqOf(gx: Int, gy: Int): GlobalSquare { mkGlobal(gx, gy) orelse panic() }
    let mkPiece(t: PieceType, c: Color): Piece { new Piece(t, c, true) }
    let planeWith(writes: List<PlaneWrite>): List<Piece?> {
      withPieces(emptyPlane(), writes)
    }

A small helper to find the first `RayStep` whose square lies on a given board index, mirroring the TS
`steps.find(s => boardOf(s.square) === b)`. Returns `null` if none.

    let firstOnBoard(steps: List<RayStep>, board: Int): RayStep? {
      var found: RayStep? = null;
      for (let s of steps) {
        if (found == null && boardOf(s.square).value() == board) {
          found = s;
        }
      }
      found
    }

## Tests — sliding across seams

The first case ports the TS "slides across one board seam (boundary invisible to geometry)". A NE
diagonal from `(7,7)` — board 0's far corner — steps onto board 4 at `(8,8)`. The very first reachable
square records exactly the entered-board list `[4]` and itself sits on board 4. This pins the §1 rule
that a seam is invisible to geometry: the slide simply continues onto the neighbouring board.

    test("traceSlider slides across one board seam, recording the entered board (RULES.md §1, §4)") {
      let steps = traceSlider(emptyPlane(), sqOf(7, 7), new Vec(1, 1));
      assert(steps.length > 0) { "the ray reaches at least one square" };
      let first = steps[0];
      assert(first.entered.length == 1) { "one board entered so far" };
      assert(first.entered[0].value() == 4) { "the entered board is board 4" };
      assert(boardOf(first.square).value() == 4) { "the first square sits on board 4" };
    }

The "corner step (7,7)->(8,8) records exactly ONE entered board" case: the first square is `(8,8)` on
board 4 with `entered == [4]`, and the next square `(9,9)` stays on board 4, so it still records just
`[4]`. This confirms the entered list does not double-count a board the ray remains on.

    test("traceSlider corner step records ONE entered board, holds it while on that board (RULES.md §4)") {
      let steps = traceSlider(emptyPlane(), sqOf(7, 7), new Vec(1, 1));
      assert(steps.length >= 2) { "at least two squares reachable" };
      let first = steps[0];
      assert(sameSquare(first.square, sqOf(8, 8))) { "first square is (8,8)" };
      assert(first.entered.length == 1 && first.entered[0].value() == 4) { "first records [4]" };
      let second = steps[1];
      assert(sameSquare(second.square, sqOf(9, 9))) { "second square is (9,9)" };
      assert(second.entered.length == 1 && second.entered[0].value() == 4) { "second still [4]" };
    }

The multi-board entry-order case ports "slides across a SECOND board change, recording both entered
boards in order". A horizontal ray from `(6,0)` (board 0) crosses into board 1 at gx 8, then into
board 2 at gx 16. Both are reachable and recorded in order: the first square on board 1 records `[1]`,
the first on board 2 records `[1, 2]`, and the final square (the far plane wall at gx 23, on board 2)
records `[1, 2]`. This is the rule that a slide may cross as many boundaries as the unobstructed path
allows (RULES.md §4), with no single-boundary cap.

    test("traceSlider records multiple entered boards in order across a horizontal ray (RULES.md §4)") {
      let steps = traceSlider(emptyPlane(), sqOf(6, 0), new Vec(1, 0));
      var maxGx = 0;
      for (let s of steps) {
        let g = s.square.gx.value();
        if (g > maxGx) { maxGx = g; }
      }
      assert(maxGx == 23) { "the ray reaches the far plane wall at gx 23" };

      let onB1 = firstOnBoard(steps, 1);
      assert(onB1 != null) { "the ray reaches board 1" };
      if (onB1 != null) {
        assert(onB1.entered.length == 1 && onB1.entered[0].value() == 1) { "first on board 1 records [1]" };
      }
      let onB2 = firstOnBoard(steps, 2);
      assert(onB2 != null) { "the ray reaches board 2" };
      if (onB2 != null) {
        assert(onB2.entered.length == 2) { "first on board 2 entered two boards" };
        assert(onB2.entered[0].value() == 1 && onB2.entered[1].value() == 2) { "in order [1, 2]" };
      }
      let last = steps[steps.length - 1];
      assert(last.entered.length == 2) { "final square entered two boards" };
      assert(last.entered[0].value() == 1 && last.entered[1].value() == 2) { "final records [1, 2]" };
    }

The diagonal exit-and-reenter case ports "a diagonal that leaves then re-enters records each board
once, in order". The NE diagonal from `(7,7)` steps onto board 4 at `(8,8)`, slides through board 4,
then onto board 8 at `(16,16)`. Each entered board is recorded a single time, in first-seen order:
board 4 records `[4]`, board 8 records `[4, 8]`.

    test("traceSlider records each diagonally-entered board once, in order (RULES.md §4)") {
      let steps = traceSlider(emptyPlane(), sqOf(7, 7), new Vec(1, 1));
      let onB4 = firstOnBoard(steps, 4);
      assert(onB4 != null) { "the ray reaches board 4" };
      if (onB4 != null) {
        assert(onB4.entered.length == 1 && onB4.entered[0].value() == 4) { "board 4 records [4]" };
      }
      let onB8 = firstOnBoard(steps, 8);
      assert(onB8 != null) { "the ray reaches board 8" };
      if (onB8 != null) {
        assert(onB8.entered.length == 2) { "board 8 entered two boards" };
        assert(onB8.entered[0].value() == 4 && onB8.entered[1].value() == 8) { "in order [4, 8]" };
      }
    }

## Tests — halting at the wall and at an occupant

The "stops at the outer plane wall" case: a horizontal ray from `(21,0)` reaches only `(22,0)` and
`(23,0)` before the plane edge halts it (RULES.md §1: the plane edge, unlike a seam, *does* stop a
slide).

    test("traceSlider stops at the outer plane wall (RULES.md §1)") {
      let steps = traceSlider(emptyPlane(), sqOf(21, 0), new Vec(1, 0));
      assert(steps.length == 2) { "exactly two squares before the wall" };
      assert(steps[0].square.gx.value() == 22) { "first reached is gx 22" };
      assert(steps[1].square.gx.value() == 23) { "last reached is gx 23" };
    }

The obstruction case ports "stops at the first occupant (capture candidate)". With a white rook at
`(3,3)` and a black pawn at `(6,3)`, an eastward ray from `(3,3)` halts on the pawn: the last reachable
square is `(6,3)` and it carries the pawn as a capture candidate (RULES.md §3 — you may capture an
enemy piece; the ray includes the first occupant and stops).

    test("traceSlider stops at the first occupant, included as a capture candidate (RULES.md §3)") {
      let plane = planeWith([
        new PlaneWrite(sqOf(3, 3), mkPiece(Rook, White)),
        new PlaneWrite(sqOf(6, 3), mkPiece(Pawn, Black)),
      ]);
      let steps = traceSlider(plane, sqOf(3, 3), new Vec(1, 0));
      assert(steps.length > 0) { "the ray reaches at least one square" };
      let last = steps[steps.length - 1];
      assert(sameSquare(last.square, sqOf(6, 3))) { "the ray halts on the occupied square (6,3)" };
      let occ = last.occupant;
      assert(occ != null) { "the halting square carries an occupant" };
      if (occ != null) {
        assert(occ.type == Pawn) { "the occupant is the pawn" };
        assert(occ.color == Black) { "the occupant is black" };
      }
    }

## Tests — knight targets

The "produces in-bounds L-targets with crossing flags" case: `(7,7)` is board 0's corner, so some of
its eight L-jumps land on neighbour boards (crossing `1`) while staying in the plane. We assert at
least one target, at least one crossing-1 target, and every target inside `0 <= gx < 24` (RULES.md §4:
a knight enters exactly one board).

    test("knightTargets produces in-bounds L-targets with crossing flags (RULES.md §4)") {
      let targets = knightTargets(sqOf(7, 7));
      assert(targets.length > 0) { "there are some targets" };
      var anyCrossing = false;
      var allInBounds = true;
      for (let t of targets) {
        if (t.crossings == 1) { anyCrossing = true; }
        let g = t.square.gx.value();
        if (!(g >= 0 && g < 24)) { allInBounds = false; }
      }
      assert(anyCrossing) { "at least one L-jump crosses into a neighbour board" };
      assert(allInBounds) { "every target lies within the plane" };
    }

The "clips targets at the plane corner" case: from `(0,0)` only two of the eight L-jumps stay on the
plane (`(1,2)` and `(2,1)`); the other six step off an edge and are dropped.

    test("knightTargets clips at the plane corner (RULES.md §1)") {
      assert(knightTargets(sqOf(0, 0)).length == 2) { "only two L-jumps fit from the corner" };
    }
