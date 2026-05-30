# Move generation — pseudo-legal moves over the continuous plane (RULES.md §3–§6)

This module is the Temper port of `../../src/core/moveGen.ts` (and its `moveGen.test.ts`). It is the
heart of the engine's legality machinery below king-safety: given a [`GameState`](./state.temper.md)
and a side to move, it enumerates every **pseudo-legal** move — every move that is geometrically and
credit-legal, *before* the separate check that a move may not leave one of your own kings in check
(RULES.md §7, handled by a later `legal` module). The four rule sections it realises:

- **§3 Movement within a board** — standard chess geometry (sliders slide, knights jump, kings step,
  pawns push/capture), and two absolute prohibitions: "You may never capture your own piece, and you
  may never capture a king."
- **§4 Crossing between boards** — the credit rule. Every board a move *enters* (any board on the path
  different from the origin board, pass-through boards included) needs a same-type crossing credit, and
  a frozen board may never be entered. Kings never cross.
- **§5 Pawns** — a pawn may push *straight across a seam* and capture diagonally across a seam, both
  gated by a pawn credit; the home-rank double-step stays within the home board; and **any pawn move
  that crosses a board border always promotes**, as does a push to the plane's outer edge.
- **§6 Castling & en passant** — ordinary within-board castling (kings never cross, so castling is
  always within one board), with transit-square safety checked through
  [`isSquareAttacked`](./attack.temper.md); en passant, which may itself cross a seam diagonally.

Everything below the move records is geometry already built by [`rays`](./rays.temper.md)
(`sliderSteps`, `knightTargets`, `kingTargets`) and the credit accounting of
[`ledger`](./ledger.temper.md) (`hasCredit`). As with every sibling module, the whole `src/` tree is
one library, so the names from `types`, `coords`, `pieces`, `plane`, `ledger`, `rays`, `attack`, and
`state` are already in lexical scope — no `import` lines.

## `BoundaryCrossing` — one board entered, one credit spent

RULES.md §4: "A move that enters several boards needs a credit for every board it enters… Executing
the move spends one credit per board entered." The TS reference models each such entry as a
`BoundaryCrossing` record carrying the move's origin board (constant across the list), the board
*entered* (whose ledger slot is debited), and the credit type (which equals the moving piece's type).
The Temper rendering is an immutable class with those three fields.

    export class BoundaryCrossing(
      /** The move's ORIGIN board (constant across a move's crossing list). */
      public fromBoard: BoardIndex,
      /** A board ENTERED; this board's ledger slot is debited (RULES.md §4). */
      public toBoard: BoardIndex,
      /** The crossing credit type — equals the moving piece's type. */
      public creditType: PieceType,
    ) {}

## The `Move` sealed interface and its five variants

The TS `Move` is a discriminated union over a shared `MoveBase` (`from`, `to`, `piece`, `captured`,
`crossings`) with five `kind`s: `normal`, `double-pawn`, `en-passant`, `promotion`, `castle`. Per the
porting cheat-sheet, a discriminated union becomes a `sealed interface` plus one class per variant,
matched with `is`-narrowing. Temper classes extend interfaces only (no shared base *class*), so the
five common `MoveBase` fields are declared as **getters on the interface** and each variant supplies
them; the variant-specific data (`promoteTo`, the castle rook squares, the en-passant captured pawn)
lives on the relevant class.

    export sealed interface Move {
      public from(): GlobalSquare;
      public to(): GlobalSquare;
      public piece(): Piece;
      /** Piece removed at `to` (null for en-passant, where the victim is elsewhere). */
      public captured(): Piece?;
      /** Boards ENTERED along the path (empty for a same-board move). One per board, each gated + debited (RULES.md §4). */
      public crossings(): List<BoundaryCrossing>;
    }

`MoveNormal` — an ordinary step/slide/capture that promotes nothing. Carries only the base fields.

    export class MoveNormal(
      public fromSq: GlobalSquare,
      public toSq: GlobalSquare,
      public movedPiece: Piece,
      public capturedPiece: Piece?,
      public crossingList: List<BoundaryCrossing>,
    ) extends Move {
      public from(): GlobalSquare { fromSq }
      public to(): GlobalSquare { toSq }
      public piece(): Piece { movedPiece }
      public captured(): Piece? { capturedPiece }
      public crossings(): List<BoundaryCrossing> { crossingList }
    }

`MoveDoublePawn` — the home-rank two-square push. The TS type pins `crossings: readonly []` — the
double-step stays within the home board (RULES.md §5), so it never crosses and never captures. We
encode that by always handing back an empty crossing list and a `null` capture.

    export class MoveDoublePawn(
      public fromSq: GlobalSquare,
      public toSq: GlobalSquare,
      public movedPiece: Piece,
    ) extends Move {
      public from(): GlobalSquare { fromSq }
      public to(): GlobalSquare { toSq }
      public piece(): Piece { movedPiece }
      public captured(): Piece? { null }
      public crossings(): List<BoundaryCrossing> { [] }
    }

`MoveEnPassant` — a diagonal pawn capture onto an empty square that matches the recorded en-passant
target. The captured pawn does **not** stand on `to` (so `captured()` is `null`, matching the base
shape); it sits on `capturedSquare`, recorded separately along with the `capturedPawn` itself. The
move may cross a seam (gated by a pawn credit), so its crossing list is carried like any other move's.

    export class MoveEnPassant(
      public fromSq: GlobalSquare,
      public toSq: GlobalSquare,
      public movedPiece: Piece,
      public crossingList: List<BoundaryCrossing>,
      public capturedSquare: GlobalSquare,
      public capturedPawn: Piece,
    ) extends Move {
      public from(): GlobalSquare { fromSq }
      public to(): GlobalSquare { toSq }
      public piece(): Piece { movedPiece }
      public captured(): Piece? { null }
      public crossings(): List<BoundaryCrossing> { crossingList }
    }

`MovePromotion` — a pawn move that crosses a seam or reaches the plane edge, replacing the pawn with
the chosen `promoteTo` type (RULES.md §5). It may carry a capture (a diagonal cross-capture promotes
too) and a crossing list.

    export class MovePromotion(
      public fromSq: GlobalSquare,
      public toSq: GlobalSquare,
      public movedPiece: Piece,
      public capturedPiece: Piece?,
      public crossingList: List<BoundaryCrossing>,
      public promoteTo: PieceType,
    ) extends Move {
      public from(): GlobalSquare { fromSq }
      public to(): GlobalSquare { toSq }
      public piece(): Piece { movedPiece }
      public captured(): Piece? { capturedPiece }
      public crossings(): List<BoundaryCrossing> { crossingList }
    }

`MoveCastle` — within-board castling (RULES.md §6). The TS type pins `crossings: readonly []` (kings
never cross), records the king-side/queen-side discriminator, and the rook's `from`/`to` squares. We
model `side` as a plain boolean `kingSide` (true = king-side) rather than a string union.

    export class MoveCastle(
      public fromSq: GlobalSquare,
      public toSq: GlobalSquare,
      public movedPiece: Piece,
      /** true = king-side (e→g, rook h→f); false = queen-side (e→c, rook a→d). */
      public kingSide: Boolean,
      public rookFrom: GlobalSquare,
      public rookTo: GlobalSquare,
    ) extends Move {
      public from(): GlobalSquare { fromSq }
      public to(): GlobalSquare { toSq }
      public piece(): Piece { movedPiece }
      public captured(): Piece? { null }
      public crossings(): List<BoundaryCrossing> { [] }
    }

## `isFrozenBoard` — may we touch this board at all?

A frozen board (checkmate or draw, RULES.md §7/§8) may be neither stood on as a mover nor entered by a
crossing (RULES.md §4: "A move may not enter (pass through or land on) a frozen board"). The TS helper
reads `state.status[board]` and asks `isFrozenStatus`; the Temper port reads the same slot and reuses
the shared `isFrozen` classifier defined in [`types`](./types.temper.md) (the sibling
[`draws`](./draws.temper.md) module documents why there is no second `isFrozenStatus`). We read the
status list by the board's underlying `Int` index.

    export let isFrozenBoard(state: GameState, board: BoardIndex): Boolean {
      isFrozen(state.status[board.value()])
    }

## Pawn promotion — the §5 "any border crossing promotes" rule

RULES.md §5 makes promotion broader than standard chess: a pawn move promotes when it **lands on a
different board than it left** (a seam crossing — straight push *or* diagonal capture) **or** when it
reaches the plane's outer-edge rank (White at `gy = 0`, Black at `gy = 23`) even without crossing.
Interior within-board moves do not promote. `planeEdgeRank` gives the outer rank for a colour, and
`pawnPromotes` is the disjunction the TS reference uses verbatim.

    let planeEdgeRank(color: Color): Int {
      if (color == White) { 0 } else { plane - 1 }
    }

    let pawnPromotes(color: Color, fromBoard: BoardIndex, to: GlobalSquare): Boolean {
      boardOf(to).value() != fromBoard.value() || to.gy.value() == planeEdgeRank(color)
    }

## `enteredFor` — boards entered by a single jump or step

Knights, kings, and pawn diagonals all move to a *directly adjacent* board at most, so a single
step/jump enters either zero boards (it stayed on the origin board) or exactly one (the destination
board). The slider path is different — it carries its own ordered entered-list from
[`rays`](./rays.temper.md) — but every other generator routes through `enteredFor`.

    let enteredFor(from: GlobalSquare, to: GlobalSquare): List<BoardIndex> {
      let toBoard = boardOf(to);
      if (boardOf(from).value() == toBoard.value()) { [] } else { [toBoard] }
    }

## `resolveCrossings` — gate a path on a credit per entered board

This is the §4 credit rule made concrete. Given the ordered list of boards a move enters, it returns
either the list of `BoundaryCrossing`s to attach to the move (one per entered board) or a rejection.
A move is rejected if it enters a board it may not:

- the mover is a **king** (kings never cross a seam — `isCrossingType` is false), or
- an entered board is **frozen** (RULES.md §4: may not pass through or land on a frozen board), or
- the mover holds **no same-type credit** for an entered board.

A same-board move (`entered` empty) trivially succeeds with no crossings. The TS reference returns a
`{ ok, crossings } | { ok: false }` union; the Temper rendering is a small `CrossResult` class with an
`ok` flag and the (possibly empty) crossing list — `ok == false` carries an empty list that callers
must not read.

    class CrossResult(
      public ok: Boolean,
      public crossings: List<BoundaryCrossing>,
    ) {}

The function — named `resolveCrossingsFor` here to underline that its `entered` argument is a list of
**board indices**, not crossings — walks the entered boards, failing fast on a king, a frozen board, or
a missing credit, and otherwise building one `BoundaryCrossing` per board (origin board constant,
entered board the loop variable, credit type the piece's type).

    let resolveCrossingsFor(
      state: GameState,
      color: Color,
      piece: Piece,
      from: GlobalSquare,
      entered: List<BoardIndex>,
    ): CrossResult {
      if (entered.length == 0) {
        new CrossResult(true, [])
      } else if (!isCrossingType(piece.type)) {
        // kings never cross a seam (RULES.md §4)
        new CrossResult(false, [])
      } else {
        let fromBoard = boardOf(from);
        let acc = new ListBuilder<BoundaryCrossing>();
        var ok = true;
        for (let toBoard of entered) {
          if (isFrozenBoard(state, toBoard)) {
            ok = false;
          } else if (!hasCredit(state.ledger, toBoard, color, piece.type)) {
            ok = false;
          } else {
            acc.add(new BoundaryCrossing(fromBoard, toBoard, piece.type));
          }
        }
        if (ok) {
          new CrossResult(true, acc.toList())
        } else {
          new CrossResult(false, [])
        }
      }
    }

## `emitStep` — emit a normal/capture move for a slider or knight step

For a single reachable square, `emitStep` enforces the two §3 capture prohibitions and the §4 credit
gate, then pushes a `MoveNormal` if the move survives. The prohibitions: you may never capture your
own piece, and **a king is never capturable** (RULES.md §3 — a board is decided by checkmate before its
king could be taken, which keeps every active board's king present). If the destination holds your own
piece or *any* king, the step is dropped. Otherwise we resolve the crossings; a rejection (king mover,
frozen board, or missing credit) drops the step too.

    let emitStep(
      out: ListBuilder<Move>,
      state: GameState,
      color: Color,
      piece: Piece,
      from: GlobalSquare,
      to: GlobalSquare,
      entered: List<BoardIndex>,
      occupant: Piece?,
    ): Void {
      if (occupant != null && (occupant.color == color || occupant.type == King)) {
        // cannot capture your own piece, and a king is never capturable (RULES.md §3)
      } else {
        let cross = resolveCrossingsFor(state, color, piece, from, entered);
        if (cross.ok) {
          out.add(new MoveNormal(from, to, piece, occupant, cross.crossings));
        }
      }
    }

## `genSlider` — flatten a slider's rays into moves

`genSlider` runs [`rays`](./rays.temper.md)'s `sliderSteps` (which already carries each reachable
square's ordered entered-board list across as many seams as the path allows, RULES.md §4) and emits a
step per reachable square. A bishop passes `bishopDirs()`, a rook `rookDirs()`, a queen `queenDirs()`.

    let genSlider(
      out: ListBuilder<Move>,
      state: GameState,
      color: Color,
      piece: Piece,
      from: GlobalSquare,
      dirs: List<Vec>,
    ): Void {
      for (let step of sliderSteps(state.plane, from, dirs)) {
        emitStep(out, state, color, piece, from, step.square, step.entered, step.occupant);
      }
    }

## `genKnight` — L-jumps, each entering at most one board

A knight enters exactly one board per jump (RULES.md §4), so its entered-list comes from `enteredFor`.
The occupant is read directly from the plane at the target.

    let genKnight(
      out: ListBuilder<Move>,
      state: GameState,
      color: Color,
      piece: Piece,
      from: GlobalSquare,
    ): Void {
      for (let t of knightTargets(from)) {
        let entered = enteredFor(from, t.square);
        emitStep(out, state, color, piece, from, t.square, entered, pieceAt(state.plane, t.square));
      }
    }

## Castling — within-board, transit-safe (RULES.md §6)

Castling is ordinary within-board chess castling: an unmoved king, the corner rook unmoved, the squares
between them empty, the king not currently in check, and the two squares the king transits/lands on not
attacked — including by a piece that has just crossed onto this board (which is why the attack test runs
through the full credit-aware [`isSquareAttacked`](./attack.temper.md)). Kings never cross a seam, so
castling stays within one board; the king-home check pins the king to file 4 on its colour's home rank.

The home rank is local rank 7 for White (bottom of its board) and 0 for Black (top). `KING_HOME_FILE`
is 4. These mirror the TS `HOME_RANK` record and `KING_HOME_FILE` constant.

    let homeRank(color: Color): Int {
      if (color == White) { 7 } else { 0 }
    }
    let kingHomeFile(): Int { 4 }

`genCastle` works in the king's board-local frame: it derives the board origin, checks the king is on
its home square, refuses to castle out of check, then for each side verifies the corner rook, the empty
transit squares, and the king's transit/landing safety. The small local helpers `at`/`empty`/`safe`/
`cornerRook` mirror the TS closures; `offset(origin, file, rank)` lands on a board-local square (origin
is the board's top-left, so adding a local file/rank stays within the board). We thread the squares as
nullable and guard them, exactly as the TS code does.

    let genCastle(
      out: ListBuilder<Move>,
      state: GameState,
      color: Color,
      king: Piece,
      from: GlobalSquare,
    ): Void {
      if (king.hasMoved) {
        // an already-moved king cannot castle
      } else {
        let origin = boardOrigin(boardOf(from));
        let localFile = from.gx.value() - origin.gx.value();
        let localRank = from.gy.value() - origin.gy.value();
        if (localFile != kingHomeFile() || localRank != homeRank(color)) {
          // not on the king's home square — no castling
        } else {
          let enemy = opposite(color);
          if (isSquareAttacked(state.plane, state.ledger, from, enemy)) {
            // cannot castle out of check (RULES.md §6)
          } else {
            genCastleSides(out, state, color, king, from, origin, localRank, enemy);
          }
        }
      }
    }

`genCastleSides` emits the king-side and queen-side castles when each is legal. King-side: king e→g
(file 6), rook h(7)→f(5); the king transits/lands on f(5) and g(6), both of which must be empty and
safe. Queen-side: king e→c (file 2), rook a(0)→d(3); the king transits/lands on d(3) and c(2) (both
empty and safe), while b(1) need only be *empty* (the king never steps there, so it need not be safe).

Three small board-local helpers replace the TS closures (plain functions read more cleanly than
captured lambdas here). `atFile` lands on a board-local square — every `(file, localRank)` with both in
`0..7` stays inside the plane because `origin` is the board's top-left corner, so `offset` never
returns null here; we recover the nullable with `?? panic()` (`offset` returns a nullable
`GlobalSquare?`, not a `throws Bubble`, so the null-coalescing `??` is the right unwrap, not `orelse`),
the panic documenting the invariant rather than a real failure path. `isEmptySq`/`isSafeSq`/
`isCornerRook` test a square for emptiness, transit safety, and an unmoved same-colour corner rook.

    let atFile(origin: GlobalSquare, file: Int, localRank: Int): GlobalSquare {
      offset(origin, file, localRank) ?? panic()
    }
    let isEmptySq(plane: List<Piece?>, sq: GlobalSquare): Boolean {
      pieceAt(plane, sq) == null
    }
    let isSafeSq(plane: List<Piece?>, ledger: Ledger, sq: GlobalSquare, enemy: Color): Boolean {
      !isSquareAttacked(plane, ledger, sq, enemy)
    }
    let isCornerRook(plane: List<Piece?>, sq: GlobalSquare, color: Color): Boolean {
      let p = pieceAt(plane, sq);
      p != null && p.type == Rook && p.color == color && !p.hasMoved
    }

    let genCastleSides(
      out: ListBuilder<Move>,
      state: GameState,
      color: Color,
      king: Piece,
      from: GlobalSquare,
      origin: GlobalSquare,
      localRank: Int,
      enemy: Color,
    ): Void {
      let plane = state.plane;
      let ledger = state.ledger;

      // King-side: king e->g, rook h->f. Transit/land squares f(5), g(6).
      let f = atFile(origin, 5, localRank);
      let g = atFile(origin, 6, localRank);
      let hRook = atFile(origin, 7, localRank);
      if (isCornerRook(plane, hRook, color) && isEmptySq(plane, f) && isEmptySq(plane, g)
          && isSafeSq(plane, ledger, f, enemy) && isSafeSq(plane, ledger, g, enemy)) {
        out.add(new MoveCastle(from, g, king, true, hRook, f));
      }

      // Queen-side: king e->c, rook a->d. Transit/land d(3), c(2); b(1) only needs to be empty.
      let d = atFile(origin, 3, localRank);
      let c = atFile(origin, 2, localRank);
      let b = atFile(origin, 1, localRank);
      let aRook = atFile(origin, 0, localRank);
      if (isCornerRook(plane, aRook, color) && isEmptySq(plane, d) && isEmptySq(plane, c)
          && isEmptySq(plane, b) && isSafeSq(plane, ledger, d, enemy) && isSafeSq(plane, ledger, c, enemy)) {
        out.add(new MoveCastle(from, c, king, false, aRook, d));
      }
    }

## `genKing` — one-square steps, board-bound, plus castling

A king steps to any of its eight neighbours but is **board-bound** (RULES.md §4: kings never cross), so
any `kingTargets` entry with a non-zero crossing count is skipped. The surviving (same-board) steps go
through `emitStep` with an empty entered-list. Then `genCastle` adds the castles.

    let genKing(
      out: ListBuilder<Move>,
      state: GameState,
      color: Color,
      piece: Piece,
      from: GlobalSquare,
    ): Void {
      for (let t of kingTargets(from)) {
        if (t.crossings == 0) {
          emitStep(out, state, color, piece, from, t.square, [], pieceAt(state.plane, t.square));
        }
      }
      genCastle(out, state, color, piece, from);
    }

## Pawns — pushes, captures, en passant, and the broad promotion rule (RULES.md §5)

The four promotion targets, in the TS `PROMOTIONS` order (queen, rook, bishop, knight). A cross-seam or
edge-reaching pawn move expands into one move per target.

    let promotions(): List<PieceType> { [Queen, Rook, Bishop, Knight] }

`emitPawnAdvance` is the shared tail of every pawn push/capture: if the destination promotes (a seam
crossing or the plane edge, by `pawnPromotes`), emit the four promotion variants; otherwise a single
`MoveNormal`. It carries through the capture (null for a push) and the resolved crossing list.

    let emitPawnAdvance(
      out: ListBuilder<Move>,
      color: Color,
      piece: Piece,
      from: GlobalSquare,
      to: GlobalSquare,
      fromBoard: BoardIndex,
      captured: Piece?,
      crossings: List<BoundaryCrossing>,
    ): Void {
      if (pawnPromotes(color, fromBoard, to)) {
        for (let promoteTo of promotions()) {
          out.add(new MovePromotion(from, to, piece, captured, crossings, promoteTo));
        }
      } else {
        out.add(new MoveNormal(from, to, piece, captured, crossings));
      }
    }

`genPawn` produces the forward push (possibly across a seam, gated by a pawn credit, promoting on any
crossing), the home-rank double-step (which never crosses and never promotes — it stays within the home
board), the two diagonal captures (cross-seam-gated, promoting on a crossing), and en passant. The
forward direction is `forwardDir(color)` in global-Y (board-independent — RULES.md §5).

The double-step is only offered when the single push did **not** cross a seam (`crossings` empty), the
pawn is unmoved, the single push itself did not promote, and the two-square target stays on the home
board and is empty. The en-passant clause fires when a diagonal target is empty but equals the recorded
`state.enPassant` square and a captured enemy pawn sits one rank "behind" the target.

    let genPawn(
      out: ListBuilder<Move>,
      state: GameState,
      color: Color,
      piece: Piece,
      from: GlobalSquare,
    ): Void {
      let fdy = forwardDir(color);
      let fromBoard = boardOf(from);

      // Forward push. May cross a single seam (pawn-credit-gated); any crossing — or
      // reaching the plane edge — promotes.
      let one = offset(from, 0, fdy);
      if (one != null) {
        if (pieceAt(state.plane, one) == null) {
          let cross = resolveCrossingsFor(state, color, piece, from, enteredFor(from, one));
          if (cross.ok) {
            emitPawnAdvance(out, color, piece, from, one, fromBoard, null, cross.crossings);
            // Double push stays within the home board (never crosses, never promotes).
            let two = offset(from, 0, 2 * fdy);
            if (two != null) {
              if (cross.crossings.length == 0
                  && !piece.hasMoved
                  && !pawnPromotes(color, fromBoard, one)
                  && boardOf(two).value() == fromBoard.value()
                  && pieceAt(state.plane, two) == null) {
                out.add(new MoveDoublePawn(from, two, piece));
              }
            }
          }
        }
      }

      // Diagonal captures (may cross exactly one boundary, pawn-credit-gated).
      for (let dx of [-1, 1]) {
        let to = offset(from, dx, fdy);
        if (to != null) {
          let cross = resolveCrossingsFor(state, color, piece, from, enteredFor(from, to));
          if (cross.ok) {
            let occ = pieceAt(state.plane, to);
            if (occ != null && occ.color != color && occ.type != King) {
              emitPawnAdvance(out, color, piece, from, to, fromBoard, occ, cross.crossings);
            } else if (occ == null && enPassantMatches(state, to)) {
              // En passant: empty target matching the recorded en-passant square.
              let capturedSquare = offset(to, 0, -fdy);
              if (capturedSquare != null) {
                let capturedPawn = pieceAt(state.plane, capturedSquare);
                if (capturedPawn != null) {
                  if (capturedPawn.type == Pawn && capturedPawn.color != color) {
                    out.add(new MoveEnPassant(
                      from, to, piece, cross.crossings, capturedSquare, capturedPawn));
                  }
                }
              }
            }
          }
        }
      }
    }

`enPassantMatches` factors out the nullable comparison against `state.enPassant`: the recorded square
exists and equals `to`. (`GlobalSquare` has no structural `==`, so we compare axes via `sameSquare`.)

    let enPassantMatches(state: GameState, to: GlobalSquare): Boolean {
      let ep = state.enPassant;
      ep != null && sameSquare(ep, to)
    }

## `pseudoLegalMoves` — scan the plane, dispatch by piece type

The public entry point scans every cell of the plane, skips empty cells and enemy pieces, skips any
piece standing on a **frozen** board (RULES.md §4/§7 — a frozen board's pieces may not move), and
dispatches to the per-type generator. King-safety (RULES.md §7) is *not* yet enforced — that is the
job of the later `legal` module — so these are *pseudo*-legal moves.

We dispatch on the piece type's singleton identity with an `is`-narrowing `if`/`else` chain
(per the cheat-sheet, this avoids a `when` whose `Void` arm bodies confuse the type checker), and
because `PieceType`'s `value()`/`canCross()` are methods on the singletons we compare against `Pawn`,
`Knight`, … directly.

    export let pseudoLegalMoves(state: GameState, color: Color): List<Move> {
      let out = new ListBuilder<Move>();
      for (let cell of allCells()) {
        let cellPiece = state.plane[cell.value()];
        if (cellPiece != null) {
          if (cellPiece.color == color) {
            let from = squareAt(cell);
            if (!isFrozenBoard(state, boardOf(from))) {
              let t = cellPiece.type;
              if (t == Pawn) {
                genPawn(out, state, color, cellPiece, from);
              } else if (t == Knight) {
                genKnight(out, state, color, cellPiece, from);
              } else if (t == Bishop) {
                genSlider(out, state, color, cellPiece, from, bishopDirs());
              } else if (t == Rook) {
                genSlider(out, state, color, cellPiece, from, rookDirs());
              } else if (t == Queen) {
                genSlider(out, state, color, cellPiece, from, queenDirs());
              } else if (t == King) {
                genKing(out, state, color, cellPiece, from);
              }
            }
          }
        }
      }
      out.toList()
    }

## Tests — porting the vitest suite

The TS `moveGen.test.ts` leans on the shared `testkit` (`sq`, `pc`, `planeOf`, `stateOf`) plus a local
`board(n)` and a `crossings(moves)` filter. The sibling [`attack`](./attack.temper.md) test block
already defines `sq`, `pc`, and `planeOf`, and [`ledger`](./ledger.temper.md) already defines
`board(n)`; because the whole `src/` tree compiles into one namespace, those are already in scope here
and we **reuse** them rather than redefine (a second definition would collide). `pc` defaults
`hasMoved` to `true` (matching the TS default), so for the one test that needs an unmoved pawn we add
`pcUnmoved`. `stateOf` mirrors the TS overrides object: a plane plus optional ledger and status,
defaulting to an empty ledger, nine `active` statuses, nine zero clocks, White to move, no en-passant,
ply 0.

    let pcUnmoved(t: PieceType, c: Color): Piece { new Piece(t, c, false) }

    let activeStatuses(): List<BoardStatus> {
      let acc = new ListBuilder<BoardStatus>();
      for (var i = 0; i < boards; i += 1) { acc.add(new StatusActive()); }
      acc.toList()
    }
    let zeroClocks(): List<Int> {
      let acc = new ListBuilder<Int>();
      for (var i = 0; i < boards; i += 1) { acc.add(0); }
      acc.toList()
    }

`stateOf` takes the plane, a ledger, and a status list — the three overrides these tests actually use —
defaulting the rest. (The TS object-overrides become explicit parameters with sensible defaults baked
into the two specialised constructors below.)

    let stateWith(plane: List<Piece?>, ledger: Ledger, status: List<BoardStatus>): GameState {
      new GameState(plane, White, ledger, status, zeroClocks(), null, 0)
    }
    let statePlain(plane: List<Piece?>): GameState {
      stateWith(plane, emptyLedger(), activeStatuses())
    }
    let stateLedger(plane: List<Piece?>, ledger: Ledger): GameState {
      stateWith(plane, ledger, activeStatuses())
    }

The `crossings` filter keeps only moves that actually entered a board (a non-empty crossing list),
mirroring `moves.filter(m => m.crossings.length > 0)`.

    let crossingMoves(moves: List<Move>): List<Move> {
      let acc = new ListBuilder<Move>();
      for (let m of moves) {
        if (m.crossings().length > 0) { acc.add(m); }
      }
      acc.toList()
    }

### Boundary-crossing gating

A bishop crossing is emitted **only** when a bishop credit exists on the destination board. With no
credit the bishop on board 0's far corner `(7,7)` produces no crossing moves at all; granting a bishop
credit into board 4 makes its cross-seam slides appear, every one landing on board 4. This is the §4
credit rule's central toggle.

    test("a bishop crossing is emitted only with a bishop credit on the destination board (RULES.md §4)") {
      let plane = planeOf([new PlaneWrite(sq(7, 7), pc(Bishop, White))]);

      let noCredit = pseudoLegalMoves(statePlain(plane), White);
      assert(crossingMoves(noCredit).length == 0) { "no credit, no crossing moves" };

      let ledger = grantCredit(emptyLedger(), board(4), White, Bishop);
      let withCredit = pseudoLegalMoves(stateLedger(plane, ledger), White);
      let crossed = crossingMoves(withCredit);
      assert(crossed.length > 0) { "with a board-4 bishop credit, crossings appear" };
      var allOnBoard4 = true;
      for (let m of crossed) {
        if (boardOf(m.to()).value() != 4) { allOnBoard4 = false; }
      }
      assert(allOnBoard4) { "every crossing lands on board 4" };
    }

A two-board bishop slide is generated **only** when credits exist on **both** entered boards. The
bishop on board 0 at `(7,7)` sliding NE passes through board 4 and lands on board 8 at `(16,16)`;
reaching it needs a bishop credit on board 4 (passed through) **and** board 8 (landed on). With
neither, only-8, or only-4, the slide to `(16,16)` is absent; with both, it appears carrying the
ordered crossing list `[4, 8]`.

    test("a 2-board bishop slide needs credits on BOTH entered boards (RULES.md §4)") {
      let plane = planeOf([new PlaneWrite(sq(7, 7), pc(Bishop, White))]);

      // Neither credit: the slide halts at the board-4 seam, never reaching board 8.
      assert(!lands16(pseudoLegalMoves(statePlain(plane), White))) { "no credits, no landing on (16,16)" };

      // Only board 8 (missing the board-4 pass-through credit): still illegal.
      let only8 = grantCredit(emptyLedger(), board(8), White, Bishop);
      assert(!lands16(pseudoLegalMoves(stateLedger(plane, only8), White))) { "only board-8 credit: no" };

      // Only board 4: reaches board-4 squares but not (16,16) on board 8.
      let only4 = grantCredit(emptyLedger(), board(4), White, Bishop);
      let m4 = pseudoLegalMoves(stateLedger(plane, only4), White);
      var anyOn4 = false;
      for (let m of m4) {
        if (boardOf(m.to()).value() == 4) { anyOn4 = true; }
      }
      assert(anyOn4) { "board-4 credit reaches board-4 squares" };
      assert(!lands16(m4)) { "but not (16,16) on board 8" };

      // Both credits: the slide to (16,16) appears, carrying [4, 8].
      let both = grantCredit(only4, board(8), White, Bishop);
      let mBoth = pseudoLegalMoves(stateLedger(plane, both), White);
      var found = false;
      var firstToBoard = -1;
      var secondToBoard = -1;
      var crossingCount = -1;
      for (let m of mBoth) {
        if (!found && m.to().gx.value() == 16 && m.to().gy.value() == 16) {
          found = true;
          let cl = m.crossings();
          crossingCount = cl.length;
          if (cl.length == 2) {
            firstToBoard = cl[0].toBoard.value();
            secondToBoard = cl[1].toBoard.value();
          }
        }
      }
      assert(found) { "the 2-board slide is generated" };
      assert(crossingCount == 2) { "two crossings" };
      assert(firstToBoard == 4 && secondToBoard == 8) { "ordered [4, 8]" };
    }

A small local helper for "does any move land on `(16,16)`", mirroring the TS `lands8` closure.

    let lands16(moves: List<Move>): Boolean {
      var found = false;
      for (let m of moves) {
        if (m.to().gx.value() == 16 && m.to().gy.value() == 16) { found = true; }
      }
      found
    }

A knight L-jump across a seam is gated by a knight credit on the destination board. From `(7,7)` two of
the knight's eight jumps — `(8,9)` and `(9,8)` — land on board 4; with no credit neither is a crossing
move, and with a board-4 knight credit exactly those two appear.

    test("a knight L-jump across a seam is gated by a destination knight credit (RULES.md §4)") {
      let plane = planeOf([new PlaneWrite(sq(7, 7), pc(Knight, White))]);
      assert(crossingMoves(pseudoLegalMoves(statePlain(plane), White)).length == 0) { "no credit, no crossings" };

      let ledger = grantCredit(emptyLedger(), board(4), White, Knight);
      let crossed = crossingMoves(pseudoLegalMoves(stateLedger(plane, ledger), White));
      assert(crossed.length == 2) { "exactly (8,9) and (9,8) land on board 4" };
      var allOn4 = true;
      for (let m of crossed) {
        if (boardOf(m.to()).value() != 4) { allOn4 = false; }
      }
      assert(allOn4) { "both crossings land on board 4" };
    }

### Pawn rules

A pawn does **not** push straight across a seam without a pawn credit. The white pawn at `(8,8)` on
board 4 would push to `(8,7)` on board 1 — a seam crossing — so with no credit there is no push, and no
captures either, leaving zero moves.

    test("a pawn does not push across a seam without a pawn credit (RULES.md §4, §5)") {
      let plane = planeOf([new PlaneWrite(sq(8, 8), pc(Pawn, White))]);
      let moves = pseudoLegalMoves(statePlain(plane), White);
      assert(moves.length == 0) { "no credit: no push, no captures" };
    }

With a pawn credit it pushes across the seam and **always promotes** on the entered board (RULES.md §5).
The push from `(8,8)` lands on board 1 at `(8,7)`, expanding into the four promotion variants, each
crossing into board 1 and capturing nothing.

    test("a credited straight push across a seam always promotes on the entered board (RULES.md §5)") {
      let plane = planeOf([new PlaneWrite(sq(8, 8), pc(Pawn, White))]);
      let ledger = grantCredit(emptyLedger(), board(1), White, Pawn);
      let moves = pseudoLegalMoves(stateLedger(plane, ledger), White);

      var pushCount = 0;
      var allPromotion = true;
      var allCrossBoard1 = true;
      var allNoCapture = true;
      var sawQueen = false;
      var sawRook = false;
      var sawBishop = false;
      var sawKnight = false;
      for (let m of moves) {
        if (m.to().gx.value() == 8 && m.to().gy.value() == 7) {
          pushCount += 1;
          if (m is MovePromotion) {
            let cl = m.crossings();
            if (!(cl.length == 1 && cl[0].toBoard.value() == 1)) { allCrossBoard1 = false; }
            let pt = m.promoteTo;
            if (pt == Queen) { sawQueen = true; }
            if (pt == Rook) { sawRook = true; }
            if (pt == Bishop) { sawBishop = true; }
            if (pt == Knight) { sawKnight = true; }
          } else {
            allPromotion = false;
          }
          if (m.captured() != null) { allNoCapture = false; }
        }
      }
      assert(pushCount == 4) { "four promotion variants" };
      assert(allPromotion) { "every push variant is a promotion" };
      assert(allCrossBoard1) { "each crosses into board 1" };
      assert(allNoCapture) { "a push captures nothing" };
      assert(sawQueen && sawRook && sawBishop && sawKnight) { "all four promotion targets present" };
    }

A diagonal cross-capture **always promotes** too. The white pawn at `(8,8)` captures diagonally to
`(7,7)` on board 0, expanding into the four promotion variants, each crossing into board 0 and
capturing the black rook there.

    test("a diagonal cross-capture always promotes (RULES.md §5)") {
      let plane = planeOf([
        new PlaneWrite(sq(8, 8), pc(Pawn, White)),
        new PlaneWrite(sq(7, 7), pc(Rook, Black)),
      ]);
      let ledger = grantCredit(emptyLedger(), board(0), White, Pawn);
      let moves = pseudoLegalMoves(stateLedger(plane, ledger), White);

      var capCount = 0;
      var allPromotion = true;
      var allCrossBoard0 = true;
      var allCaptureRook = true;
      for (let m of moves) {
        if (m.to().gx.value() == 7 && m.to().gy.value() == 7) {
          capCount += 1;
          if (!(m is MovePromotion)) { allPromotion = false; }
          let cl = m.crossings();
          if (!(cl.length == 1 && cl[0].toBoard.value() == 0)) { allCrossBoard0 = false; }
          let cap = m.captured();
          if (cap == null || cap.type != Rook) { allCaptureRook = false; }
        }
      }
      assert(capCount == 4) { "four promotion variants" };
      assert(allPromotion) { "every capture variant is a promotion" };
      assert(allCrossBoard0) { "each crosses into board 0" };
      assert(allCaptureRook) { "each captures the rook" };
    }

A straight push to the plane outer edge promotes with **no** seam crossed. The white pawn at `(4,1)` on
board 0 pushes to `(4,0)` — still on board 0, but the plane's top edge (White's promotion rank) — so the
four promotion variants appear with empty crossing lists.

    test("a push to the plane outer edge promotes with no crossing (RULES.md §5)") {
      let plane = planeOf([new PlaneWrite(sq(4, 1), pc(Pawn, White))]);
      let moves = pseudoLegalMoves(statePlain(plane), White);
      var pushCount = 0;
      var allEdgePromotion = true;
      for (let m of moves) {
        if (m.to().gx.value() == 4 && m.to().gy.value() == 0) {
          pushCount += 1;
          if (!(m is MovePromotion && m.crossings().length == 0)) { allEdgePromotion = false; }
        }
      }
      assert(pushCount == 4) { "four edge-promotion variants" };
      assert(allEdgePromotion) { "each is a promotion with no crossing" };
    }

A within-board push that crosses no seam and is not at the plane edge does **not** promote. The white
pawn at `(4,2)` on board 0 pushes to `(4,1)` — interior — so exactly one plain `MoveNormal` appears.

    test("an interior within-board push does not promote (RULES.md §5)") {
      let plane = planeOf([new PlaneWrite(sq(4, 2), pc(Pawn, White))]);
      let moves = pseudoLegalMoves(statePlain(plane), White);
      var pushCount = 0;
      var isNormal = false;
      for (let m of moves) {
        if (m.to().gx.value() == 4 && m.to().gy.value() == 1) {
          pushCount += 1;
          if (m is MoveNormal) { isNormal = true; }
        }
      }
      assert(pushCount == 1) { "a single interior push" };
      assert(isNormal) { "it is a plain normal move" };
    }

The home-rank double-step is offered. An unmoved white pawn at `(4,6)` may step two squares to `(4,4)`,
a `MoveDoublePawn` that stays within its home board.

    test("a double-step is offered from the home rank (RULES.md §5)") {
      let plane = planeOf([new PlaneWrite(sq(4, 6), pcUnmoved(Pawn, White))]);
      let moves = pseudoLegalMoves(statePlain(plane), White);
      var sawDouble = false;
      for (let m of moves) {
        if (m is MoveDoublePawn && m.to().gy.value() == 4) { sawDouble = true; }
      }
      assert(sawDouble) { "the double-step to (4,4) is present" };
    }

### King is board-bound (RULES.md §4)

A king never emits a move onto another board. The white king on board 0's far corner `(7,7)` has
neighbours on boards 1, 3 and 4, but every generated move stays on board 0 with an empty crossing list.

    test("a king never moves onto another board (RULES.md §4)") {
      let plane = planeOf([new PlaneWrite(sq(7, 7), pc(King, White))]);
      let moves = pseudoLegalMoves(statePlain(plane), White);
      var allNoCrossing = true;
      var allOnBoard0 = true;
      for (let m of moves) {
        if (m.crossings().length != 0) { allNoCrossing = false; }
        if (boardOf(m.to()).value() != 0) { allOnBoard0 = false; }
      }
      assert(allNoCrossing) { "no king move carries a crossing" };
      assert(allOnBoard0) { "every king move stays on board 0" };
    }

### Frozen boards (RULES.md §4, §7)

A piece standing on a frozen board is excluded entirely. With board 0 checkmated (frozen), the white
rook at `(3,3)` on board 0 generates no moves at all.

    test("pieces on a frozen board are excluded (RULES.md §7)") {
      let plane = planeOf([new PlaneWrite(sq(3, 3), pc(Rook, White))]);
      let moves = pseudoLegalMoves(stateWith(plane, emptyLedger(), frozen(0)), White);
      assert(moves.length == 0) { "a piece on a frozen board cannot move" };
    }

Crossing **into** a frozen board is excluded even with a credit. The white rook at `(8,7)` on board 1
can slide toward board 0, and holds a board-0 rook credit — but board 0 is frozen, so no generated move
lands on it (RULES.md §4: may not enter a frozen board).

    test("crossing into a frozen board is excluded even with a credit (RULES.md §4, §7)") {
      let plane = planeOf([new PlaneWrite(sq(8, 7), pc(Rook, White))]);
      let ledger = grantCredit(emptyLedger(), board(0), White, Rook);
      let moves = pseudoLegalMoves(stateWith(plane, ledger, frozen(0)), White);
      var noneOnBoard0 = true;
      for (let m of moves) {
        if (boardOf(m.to()).value() == 0) { noneOnBoard0 = false; }
      }
      assert(noneOnBoard0) { "no move enters the frozen board 0" };
    }

`frozen(idx)` builds the nine-status list with one board checkmated (frozen) and the rest active,
mirroring the TS test's local `frozen` helper.

    let frozen(idx: Int): List<BoardStatus> {
      let acc = new ListBuilder<BoardStatus>();
      for (var i = 0; i < boards; i += 1) {
        if (i == idx) {
          acc.add(new StatusCheckmate(Black, White));
        } else {
          acc.add(new StatusActive());
        }
      }
      acc.toList()
    }

### The king is uncapturable (RULES.md §3)

A reinforcing case beyond the TS suite, pinning the §3 prohibition "you may never capture a king": a
white rook adjacent to an enemy king on the same board generates a slide *toward* the king but never a
move that lands on the king's square.

    test("no move ever captures a king (RULES.md §3)") {
      let plane = planeOf([
        new PlaneWrite(sq(0, 0), pc(Rook, White)),
        new PlaneWrite(sq(3, 0), pc(King, Black)),
      ]);
      let moves = pseudoLegalMoves(statePlain(plane), White);
      var capturesKing = false;
      for (let m of moves) {
        if (m.to().gx.value() == 3 && m.to().gy.value() == 0) { capturesKing = true; }
      }
      assert(!capturesKing) { "the rook's slide stops before the king's square" };
    }
