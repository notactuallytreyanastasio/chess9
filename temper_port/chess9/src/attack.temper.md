# Attack — un-clipped, credit-backed cross-board check

This module is the Temper port of `../../src/core/attack.ts`. It answers a single question that the
rest of the engine builds check, checkmate and move-legality on top of: **is a given square attacked
by a given colour?** The answer follows RULES.md §7 ("Check, checkmate & frozen boards") to the
letter.

Two rules from §7 shape every line here:

- **"Attacks are not clipped at seams."** A rook, bishop or queen attacks straight across a board
  boundary along an unobstructed rank, file or diagonal; a knight or pawn attacks across a seam by
  its fixed geometry. So the rays this module follows are the *un-clipped* rays of
  [`rays`](./rays.temper.md) — `traceSlider` glides over seams, halting only at the plane wall or the
  first occupant, and the jumper target sets already include neighbour-board squares.

- **"Check is credit-backed."** An attacker standing on *another* board only delivers a real
  (checking) threat when it actually **holds the crossing credits its capturing move would need** —
  a credit for every board that capturing move would enter, ending on the target's board. A
  **same-board** attacker needs no credit. And because **kings can never cross a seam** (RULES.md §4,
  `isCrossingType` excludes the king), a cross-board king never gives check.

The cross-board rule is the whole point of the [`ledger`](./ledger.temper.md): the geometric ray may
reach the king from three boards away, but it is only *check* if the attacker has banked the credits
to make that capture legal.

## `threatens` — would this attacker's capture actually be legal?

`threatens` decides whether an attacker of `byColor`/`type` standing on `attackerBoard` could legally
capture onto `targetBoard`, given the boards its capturing move would enter. `entered` is the path's
boards as `traceSlider` records them — every board on the path different from the *ray's origin*
(which here is the target square), in first-seen order, ending on the attacker's own board. For a
jumper or pawn we pass an empty `entered`, since those enter at most the target's board directly.

The three gates mirror the TS reference exactly:

- **Same board** (`attackerBoard == targetBoard`): an ordinary on-board attack — no credit needed.
- **Non-crossing type** (a king): cannot cross a seam to capture, so a cross-board king never
  threatens. We reuse [`isCrossingType`](./pieces.temper.md) (which delegates to `PieceType.canCross()`).
- **Otherwise**: the move enters one or more boards. It needs a same-type credit for every
  *intermediate* board it passes through (each board in `entered` other than the attacker's own
  starting board), **and** a credit for the board it finally lands on (`targetBoard`).

`BoardIndex` is a nominal class with no structural `==`, so board identity is compared through the
underlying `Int` via `.value()`.

    let threatens(
      ledger: Ledger,
      targetBoard: BoardIndex,
      attackerBoard: BoardIndex,
      byColor: Color,
      type: PieceType,
      entered: List<BoardIndex>,
    ): Boolean {
      if (attackerBoard.value() == targetBoard.value()) {
        // same-board attack needs no credit
        true
      } else if (!isCrossingType(type)) {
        // kings cannot cross a seam to capture
        false
      } else {
        var ok = true;
        for (let b of entered) {
          if (b.value() != attackerBoard.value()) {
            // an intermediate board the move passes through (the mover starts on
            // attackerBoard, so that board is not "entered")
            if (!hasCredit(ledger, b, byColor, type)) {
              ok = false;
            }
          }
        }
        // ...and a credit for the board it finally lands on
        ok && hasCredit(ledger, targetBoard, byColor, type)
      }
    }

## `firstOccupant` — the first piece a ray meets, and the boards crossed to reach it

`firstOccupant` walks one un-clipped ray from `target` in direction `dir` and reports the first piece
it meets, along with that piece's board and the entered-board list to reach it. `traceSlider` already
halts at the first occupant (RULES.md §3 — the first occupied square is included as a capture
candidate), so the answer is simply the *last* step it produced: if that step carries an occupant, we
have our attacker; otherwise the ray ran to the wall with nothing on it.

The TS reference returns an object or `null`; the Temper rendering is a small nullable class.

    class Occupant(
      public occ: Piece,
      public board: BoardIndex,
      public entered: List<BoardIndex>,
    ) {}

    let firstOccupant(plane: List<Piece?>, target: GlobalSquare, dir: Vec): Occupant? {
      let steps = traceSlider(plane, target, dir);
      if (steps.length == 0) {
        null
      } else {
        let last = steps[steps.length - 1];
        let occ = last.occupant;
        if (occ == null) {
          null
        } else {
          new Occupant(occ, boardOf(last.square), last.entered)
        }
      }
    }

## `isSquareAttacked` — the public predicate

`isSquareAttacked(plane, ledger, target, byColor)` is true when *any* piece of `byColor` attacks
`target` under the §7 rules. It probes, in turn:

- the four **bishop** directions — a hit is an attack iff the first occupant is a `byColor` bishop or
  queen *and* `threatens` clears its (possibly cross-board) capture;
- the four **rook** directions — same, for a rook or queen;
- the **knight** target squares — a `byColor` knight on one of them attacks, gated by `threatens`
  with an empty entered list (a knight enters at most the target's board, RULES.md §4);
- the **king** target squares — a `byColor` king on an adjacent square, but only *on the same board*
  (cross-board kings are filtered out by `threatens` via `isCrossingType`);
- the two **pawn** capture origins — a `byColor` pawn capturing *into* `target` advances by
  `forwardDir(byColor)`, so it stands one diagonal step "behind" the target (the `-fdy` row offset),
  possibly across a seam (gated by a pawn crossing credit into the target's board).

`jumperFound` is the shared test for a jumper/pawn occupant: the square holds a `byColor` piece of
the expected `type`, and `threatens` (with an empty entered list) backs its capture. The TS reference
takes the candidate `occ` directly; here we read it via `pieceAt` at the call sites and pass it in.

Per the Temper convention (avoid `when` as a function's return value; this is plain straight-line
control flow anyway), the body is a sequence of `for` loops with early `return true`, falling through
to `false`.

    export let isSquareAttacked(
      plane: List<Piece?>,
      ledger: Ledger,
      target: GlobalSquare,
      byColor: Color,
    ): Boolean {
      let targetBoard = boardOf(target);

      // Bishops and queens along the diagonals.
      for (let dir of bishopDirs()) {
        let hit = firstOccupant(plane, target, dir);
        if (hit != null) {
          let occ = hit.occ;
          if (occ.color == byColor && (occ.type == Bishop || occ.type == Queen)
              && threatens(ledger, targetBoard, hit.board, byColor, occ.type, hit.entered)) {
            return true;
          }
        }
      }

      // Rooks and queens along the orthogonals.
      for (let dir of rookDirs()) {
        let hit = firstOccupant(plane, target, dir);
        if (hit != null) {
          let occ = hit.occ;
          if (occ.color == byColor && (occ.type == Rook || occ.type == Queen)
              && threatens(ledger, targetBoard, hit.board, byColor, occ.type, hit.entered)) {
            return true;
          }
        }
      }

      // Knights on their L-targets.
      for (let t of knightTargets(target)) {
        let occ = pieceAt(plane, t.square);
        if (occ != null && occ.color == byColor && occ.type == Knight
            && threatens(ledger, targetBoard, boardOf(t.square), byColor, Knight, emptyBoards())) {
          return true;
        }
      }

      // Adjacent kings (same board only — a cross-board king is filtered by threatens).
      for (let t of kingTargets(target)) {
        let occ = pieceAt(plane, t.square);
        if (occ != null && occ.color == byColor && occ.type == King
            && threatens(ledger, targetBoard, boardOf(t.square), byColor, King, emptyBoards())) {
          return true;
        }
      }

      // Pawns: a byColor pawn capturing INTO target sits one diagonal step "behind"
      // it, where behind means -forwardDir(byColor) in global-Y.
      let fdy = forwardDir(byColor);
      for (let dx of pawnDxs()) {
        let from = offset(target, dx, -fdy);
        if (from != null) {
          let occ = pieceAt(plane, from);
          if (occ != null && occ.color == byColor && occ.type == Pawn
              && threatens(ledger, targetBoard, boardOf(from), byColor, Pawn, emptyBoards())) {
            return true;
          }
        }
      }

      false
    }

Two tiny constructors keep the body readable: an empty entered-board list for jumpers/pawns, and the
pawn's two capture-file deltas (`-1` and `+1`).

    let emptyBoards(): List<BoardIndex> { [] }
    let pawnDxs(): List<Int> { [-1, 1] }

## Tests

These port `../../src/core/attack.test.ts` case-for-case. The TS suite leans on a `testkit`
(`sq`, `pc`, `planeOf`); we reproduce those three helpers locally, as the sibling `rays` test block
does. `pc` defaults `hasMoved` to `true`; `planeOf` lays pieces onto an empty plane via
[`withPieces`](./plane.temper.md). `noCredit` is the empty ledger reused throughout.

    let sq(gx: Int, gy: Int): GlobalSquare { mkGlobal(gx, gy) orelse panic() }
    let pc(t: PieceType, c: Color): Piece { new Piece(t, c, true) }
    let planeOf(writes: List<PlaneWrite>): List<Piece?> {
      withPieces(emptyPlane(), writes)
    }

### Same-board sliders need no credit

A white rook on board 0's rank 0 attacks along that rank with no credit at all (it never leaves its
board), but does not attack a square one row up.

    test("isSquareAttacked detects a same-board rook on the rank, no credit needed (RULES.md §7)") {
      let plane = planeOf([new PlaneWrite(sq(0, 0), pc(Rook, White))]);
      let noCredit = emptyLedger();
      assert(isSquareAttacked(plane, noCredit, sq(5, 0), White)) { "rook attacks along its rank" };
      assert(!isSquareAttacked(plane, noCredit, sq(5, 1), White)) { "but not off the rank" };
    }

A rook that has *physically crossed* onto the target's board (here standing at gx 6, on board 0)
attacks as an ordinary same-board piece — again no credit needed.

    test("isSquareAttacked detects a rook that has crossed onto the board, no credit (RULES.md §7)") {
      let plane = planeOf([new PlaneWrite(sq(6, 0), pc(Rook, White))]);
      assert(isSquareAttacked(plane, emptyLedger(), sq(5, 0), White)) { "on-board rook attacks" };
    }

### The credit toggle — cross-board check flips with the credit

This is the heart of §7. A white rook on board 1 (gx 8) is aligned along rank 0 with a target on
board 0 (gx 5). Un-clipped, the ray reaches across the seam — but the cross-board attack is
credit-backed. With no credit there is no check; granting white a **rook** credit *into the target's
board* turns the same geometry into a check; and a credit of the **wrong type** (knight) does not
back a rook's crossing.

    test("isSquareAttacked: a cross-board slider checks only when its crossing credit is held (RULES.md §7)") {
      let plane = planeOf([new PlaneWrite(sq(8, 0), pc(Rook, White))]);
      let targetBoard = boardOf(sq(5, 0));

      // Without a credit: the ray crosses the seam but no credit -> no check.
      assert(!isSquareAttacked(plane, emptyLedger(), sq(5, 0), White)) { "no credit, no cross-board check" };

      // Toggle the rook credit on: now the cross-board rook gives check.
      let withRook = grantCredit(emptyLedger(), targetBoard, White, Rook);
      assert(isSquareAttacked(plane, withRook, sq(5, 0), White)) { "with the rook credit, it checks" };

      // Wrong credit type (knight) does not back a rook's crossing.
      let wrongType = grantCredit(emptyLedger(), targetBoard, White, Knight);
      assert(!isSquareAttacked(plane, wrongType, sq(5, 0), White)) { "wrong-type credit does not back it" };
    }

### Knights — same board free, across a seam credit-gated

A same-board black knight attacks its L-target with no credit.

    test("isSquareAttacked detects a same-board knight without a credit (RULES.md §7)") {
      let onBoard = planeOf([new PlaneWrite(sq(3, 3), pc(Knight, Black))]);
      assert(isSquareAttacked(onBoard, emptyLedger(), sq(5, 4), Black)) { "knight attacks its L-target" };
    }

A knight on board 0 at `(6,6)` is one L-hop across the vertical seam from a target on board 1 at
`(8,5)`. Un-clipped the hop lands there, but it only checks once black holds a **knight** credit into
the target's board.

    test("isSquareAttacked detects a knight across a seam only with a knight credit (RULES.md §7)") {
      let knight = planeOf([new PlaneWrite(sq(6, 6), pc(Knight, Black))]);
      let target = sq(8, 5);
      let targetBoard = boardOf(target);
      assert(!isSquareAttacked(knight, emptyLedger(), target, Black)) { "no credit, no cross-board knight check" };
      let withKnight = grantCredit(emptyLedger(), targetBoard, Black, Knight);
      assert(isSquareAttacked(knight, withKnight, target, Black)) { "with the knight credit, it checks" };
    }

### Pawns — diagonal-forward by colour, same board

A white pawn at `(4,4)` (forward = `-y`) attacks the two squares diagonally ahead, `(3,3)` and
`(5,3)`, but neither straight ahead `(4,3)` nor backward `(3,5)`.

    test("isSquareAttacked: pawns attack diagonally forward by colour, same board (RULES.md §7)") {
      let plane = planeOf([new PlaneWrite(sq(4, 4), pc(Pawn, White))]);
      let noCredit = emptyLedger();
      assert(isSquareAttacked(plane, noCredit, sq(3, 3), White)) { "attacks the left diagonal" };
      assert(isSquareAttacked(plane, noCredit, sq(5, 3), White)) { "attacks the right diagonal" };
      assert(!isSquareAttacked(plane, noCredit, sq(4, 3), White)) { "not straight ahead" };
      assert(!isSquareAttacked(plane, noCredit, sq(3, 5), White)) { "not backward" };
    }

### Kings — adjacent attack, but never across a seam

An adjacent enemy king attacks on the same board, no credit needed.

    test("isSquareAttacked detects an adjacent enemy king, same board (RULES.md §7)") {
      let plane = planeOf([new PlaneWrite(sq(10, 10), pc(King, Black))]);
      assert(isSquareAttacked(plane, emptyLedger(), sq(11, 10), Black)) { "adjacent king attacks" };
    }

A black king on board 0 at `(7,10)` is adjacent across the seam to a target on board 1 at `(8,10)`.
Because kings can never cross (RULES.md §4), no credit — not even a queen credit — lets it give check.

    test("isSquareAttacked: a king never gives check across a seam (RULES.md §4, §7)") {
      let plane = planeOf([new PlaneWrite(sq(7, 10), pc(King, Black))]);
      let target = sq(8, 10);
      let full = grantCredit(emptyLedger(), boardOf(target), Black, Queen);
      assert(!isSquareAttacked(plane, full, target, Black)) { "a cross-board king never checks" };
    }
