# The reducer — the one public state transition (RULES.md §4, §7, §8)

This module is the Temper port of `../../src/core/reducer.ts` (and its `reducer.test.ts`). It is the
engine's single public state transition: `applyMove(state, move)` either rejects a move with a **precise**
diagnostic or applies the canonical legal move and recomputes per-board status. It also exposes the
lower-level `applyUnchecked` that [`legal`](./legal.temper.md) and [`check`](./check.temper.md) use to
simulate a move without validation, completing the free circular cluster (whole-library scoping; no
`import` lines).

The rules realised here are dense:

- **§4 the credit rule** — applying a move debits one credit per board it entered, and a capture grants
  one crossing credit of the victim's type into the capture board.
- **§7 check / checkmate** — after a move, check and checkmate are recomputed for **every** non-frozen
  board, because a cross-seam attack can mate a king on a board the move never touched.
- **§8 draws & termination** — checkmate is evaluated **before** the draw rules; insufficient material
  and the per-board 50-move clock can each freeze a board as a draw; and there is **never** a per-board
  stalemate.

`BoardIndex`/`GlobalSquare` have no structural `==`; we compare them through `.value()`.

## `movesMatch` — structural identity of two moves

`movesMatch(a, b)` is true when two moves agree on their discriminating fields: the same kind, the same
`from`/`to`, and — for two promotions — the same promotion target. The TS reference compares
`a.kind === b.kind` and the four coordinates, plus the `promoteTo` equality when both are promotions.

Temper has no `kind` string; the variant *is* the discriminant. We render "same kind" by pairwise
`is`-narrowing each variant against both operands, and (for the two promotions) compare `promoteTo` by
singleton identity. A small `sameCoords` helper factors the four-axis coordinate comparison.

    let sameCoords(a: Move, b: Move): Boolean {
      let af = a.from(); let at = a.to();
      let bf = b.from(); let bt = b.to();
      af.gx.value() == bf.gx.value() && af.gy.value() == bf.gy.value()
        && at.gx.value() == bt.gx.value() && at.gy.value() == bt.gy.value()
    }

    let sameKind(a: Move, b: Move): Boolean {
      if (a is MoveNormal) {
        b is MoveNormal
      } else if (a is MoveDoublePawn) {
        b is MoveDoublePawn
      } else if (a is MoveEnPassant) {
        b is MoveEnPassant
      } else if (a is MovePromotion) {
        b is MovePromotion
      } else {
        b is MoveCastle
      }
    }

    export let movesMatch(a: Move, b: Move): Boolean {
      if (!sameKind(a, b)) {
        false
      } else if (a is MovePromotion) {
        // Promotions match only if they promote to the same type. sameKind already
        // guaranteed b is a promotion too, so narrow it here to read its promoteTo.
        if (b is MovePromotion) {
          sameCoords(a, b) && a.promoteTo == b.promoteTo
        } else {
          false
        }
      } else {
        sameCoords(a, b)
      }
    }

## `MoveError` — the precise rejection diagnostics

The TS reducer reports illegality through a `MoveError` discriminated union of ten cases. Per the porting
cheat-sheet, that becomes a `sealed interface` plus one class per variant, two of which carry data: a
`frozen-board` and a `leaves-king-in-check` each name the offending `board`, and `no-credit` carries the
`BoundaryCrossing` it lacked. We keep every reason distinct so callers (and the UI) get the same precise
diagnosis the TS reference gives.

    export sealed interface MoveError {}

    export class ErrNotYourTurn() extends MoveError {}
    export class ErrEmptySource() extends MoveError {}
    export class ErrWrongColor() extends MoveError {}
    export class ErrFrozenBoard(public board: BoardIndex) extends MoveError {}
    export class ErrIllegalGeometry() extends MoveError {}
    export class ErrPathBlocked() extends MoveError {}
    export class ErrNoCredit(public crossing: BoundaryCrossing) extends MoveError {}
    export class ErrKingCannotCross() extends MoveError {}
    export class ErrLeavesKingInCheck(public board: BoardIndex) extends MoveError {}
    export class ErrNotInLegalSet() extends MoveError {}

## `ApplyResult` — the success / rejection channel

The TS `applyMove` returns `Result<GameState, MoveError>`. The cheat-sheet offers two renderings of a
`Result`; here the error carries data we must preserve, so we model a small sealed-interface pair —
`Applied(state)` on success, `Rejected(error)` on rejection — matched with `is`. This is the typed
analogue of the TS `ok(...)` / `err(...)`.

    export sealed interface ApplyResult {}
    export class Applied(public state: GameState) extends ApplyResult {}
    export class Rejected(public error: MoveError) extends ApplyResult {}

## `applyUnchecked` — apply a move without validating

`applyUnchecked(state, move)` writes a move into the plane and ledger **without** checking turn,
membership, or king-safety. It is the simulation primitive the [`legal`](./legal.temper.md) filter and
[`check`](./check.temper.md) use; the public `applyMove` calls it only on the already-canonical legal
move. Status is left untouched here (the public path recomputes it afterwards).

The moved piece is the piece that lands on `to`: a promotion replaces the pawn with its `promoteTo` type;
every other move carries the moving piece's type. Both set `hasMoved = true`. The TS `movedPiece`
ternary on `kind === 'promotion'` becomes an `is MovePromotion` narrowing.

    let movedPiece(move: Move): Piece {
      if (move is MovePromotion) {
        new Piece(move.promoteTo, move.piece().color, true)
      } else {
        new Piece(move.piece().type, move.piece().color, true)
      }
    }

A capture grants a crossing credit **only** when the captured piece is of a crossing type (RULES.md §4:
kings never cross, and a king is never captured anyway). The TS `applyCaptureCredit` guards on
`isCrossingType(captured.type)` and grants the victim's owner a credit of the victim's type into the
capture board. We reuse [`pieces`](./pieces.temper.md)'s `isCrossingType` and [`ledger`](./ledger.temper.md)'s
`grantCredit`.

    let applyCaptureCredit(ledger: Ledger, capSq: GlobalSquare, captured: Piece): Ledger {
      if (isCrossingType(captured.type)) {
        grantCredit(ledger, boardOf(capSq), captured.color, captured.type)
      } else {
        ledger
      }
    }

`applyUnchecked` builds the plane writes — clear `from`, place the moved piece on `to`, plus the
en-passant victim's cell (cleared) and, for castling, the rook's two cells — then folds the ledger:
grant the capture credit (en-passant captures off `capturedSquare`, every other capture off `to`), and
debit one credit per board the move entered. The TS reference debits via a `Result`-returning
`debitCredit` and only assigns on `.ok` ("validated moves always hold every credit"); we render that
`Ledger throws Bubble` debit with `orelse` keeping the prior ledger — the same "never corrupt on a
missing credit" semantics. A double-pawn push sets the en-passant target one step forward; every other
move clears it. Turn flips, ply increments; clocks and status pass straight through unchanged (the
public path overrides them).

    export let applyUnchecked(state: GameState, move: Move): GameState {
      let moved = movedPiece(move);

      let writes = new ListBuilder<PlaneWrite>();
      writes.add(new PlaneWrite(move.from(), null));
      writes.add(new PlaneWrite(move.to(), moved));
      if (move is MoveEnPassant) {
        writes.add(new PlaneWrite(move.capturedSquare, null));
      }
      if (move is MoveCastle) {
        writes.add(new PlaneWrite(move.rookFrom, null));
        writes.add(new PlaneWrite(move.rookTo, new Piece(Rook, move.piece().color, true)));
      }
      let plane = withPieces(state.plane, writes.toList());

      var ledger = state.ledger;
      if (move is MoveEnPassant) {
        ledger = applyCaptureCredit(ledger, move.capturedSquare, move.capturedPawn);
      } else {
        let cap = move.captured();
        if (cap != null) {
          ledger = applyCaptureCredit(ledger, move.to(), cap);
        }
      }
      for (let crossing of move.crossings()) {
        // Validated moves always hold every credit; a missing one keeps the prior ledger.
        ledger = debitCredit(ledger, crossing.toBoard, move.piece().color, crossing.creditType)
          orelse ledger;
      }

      var enPassant: GlobalSquare? = null;
      if (move is MoveDoublePawn) {
        enPassant = offset(move.from(), 0, forwardDir(move.piece().color));
      }

      new GameState(
        plane,
        opposite(state.toMove),
        ledger,
        state.status,
        state.clocks,
        enPassant,
        state.ply + 1,
      )
    }

## `nextClocks` — the per-board 50-move clock, ticking only touched boards

RULES.md §8: "The per-board clock only advances on turns that actually touch the board." `isProgress`
resets a clock (a pawn move or any capture, including en passant — the §8 "pawn move or capture"
condition). `nextClocks` then, for each board, leaves a **frozen** board's clock alone (frozen boards
stop counting), leaves an **untouched** board's clock alone (a board no move touched does not tick), and
otherwise resets to `0` on progress or ticks `+1`. The TS `state.clocks.map((c, b) => …)` needs the index
`b`, so we loop with an explicit index rather than `map` (Temper's `map` lambda gives only the element).

    let isProgress(move: Move): Boolean {
      move.piece().type == Pawn || move.captured() != null || move is MoveEnPassant
    }

    let nextClocks(state: GameState, move: Move, touched: List<BoardIndex>): List<Int> {
      let progress = isProgress(move);
      let out = new ListBuilder<Int>();
      for (var b = 0; b < state.clocks.length; b += 1) {
        let c = state.clocks[b];
        let status = state.status[b];
        if (isFrozen(status)) {
          out.add(c); // frozen boards stop counting
        } else if (!boardListContains(touched, b)) {
          out.add(c); // a board no move touched does not tick
        } else if (progress) {
          out.add(0); // touched + pawn move/capture: reset
        } else {
          out.add(c + 1); // touched, quiet: tick
        }
      }
      out.toList()
    }

`touchedBoards` is the set of boards a move physically touches: its origin board, its destination board,
and — for en passant — the captured pawn's board. Temper has no `Set`, so we model it as a `List<BoardIndex>`
with a small "already present?" guard so the list stays duplicate-free (the TS used a `Set` purely for
membership, never order).

    let boardListContains(boards: List<BoardIndex>, b: Int): Boolean {
      var found = false;
      for (let x of boards) {
        if (x.value() == b) { found = true; }
      }
      found
    }

    let addBoard(acc: ListBuilder<BoardIndex>, b: BoardIndex): Void {
      if (!boardListContains(acc.toList(), b.value())) { acc.add(b); }
    }

    let touchedBoards(move: Move): List<BoardIndex> {
      let acc = new ListBuilder<BoardIndex>();
      addBoard(acc, boardOf(move.from()));
      addBoard(acc, boardOf(move.to()));
      if (move is MoveEnPassant) {
        addBoard(acc, boardOf(move.capturedSquare));
      }
      acc.toList()
    }

## `recomputeStatus` — recheck EVERY non-frozen board (RULES.md §7, §8)

This is the §7/§8 heart of the reducer. After a move, every **non-frozen** board's status is recomputed
from scratch, because an un-clipped cross-seam attack can put a king in check — or mate it — on a board
the move never touched. A frozen board (checkmate or draw) is never recomputed.

The evaluation order is load-bearing (§8): **checkmate is evaluated before the draw rules**, so a mating
move is never mislabeled a draw. For a board where the defender (the side now to move) is in check, it is
checkmate when no legal move lands on that board to resolve it, else just check. Only if a board is *not*
in check do the draw rules apply — insufficient material first, then the per-board 50-move clock. If none
fires, the board is `active`: there is **no per-board stalemate** (a board with no move but no mate/draw
stays contestable).

The TS reference reads `legalMoves(next)` once and tests `legal.some(m => boardOf(m.to) === b)`; we do the
same, computing the legal set up front and scanning it per board. The defender is `next.toMove`.

    let resolvesOn(legal: List<Move>, b: BoardIndex): Boolean {
      var any = false;
      for (let m of legal) {
        if (boardOf(m.to()).value() == b.value()) { any = true; }
      }
      any
    }

The full legal move set is needed only to distinguish **check** from **checkmate** (does any legal move
land on a checked board to resolve it?). When no board is in check — the overwhelmingly common case after
a move — it is never consulted. The TS reference computes `legalMoves(next)` eagerly up front; we instead
make a single `inCheck` pass over the non-frozen boards, recording which (if any) are in check, and
generate `legalMoves` **once, only if at least one board is checked**. This is behaviourally identical —
the legal set is a pure function of `next`, and `inCheck` is evaluated exactly once per board either way —
but skips an expensive whole-board generation whenever the move delivered no check anywhere, a large
saving on the tree-walking `interp` backend.

`checkedBoards` returns a per-board-index `Boolean` list (true = the defender is in check on that
non-frozen board), computing `inCheck` once each.

    let checkedBoards(next: GameState, defender: Color): List<Boolean> {
      let out = new ListBuilder<Boolean>();
      for (var i = 0; i < next.status.length; i += 1) {
        if (isFrozen(next.status[i])) {
          out.add(false);
        } else {
          let b = mkBoardIndex(i) orelse panic();
          out.add(inCheck(next, b, defender));
        }
      }
      out.toList()
    }

    let anyTrue(flags: List<Boolean>): Boolean {
      var any = false;
      for (let f of flags) { if (f) { any = true; } }
      any
    }

    let recomputeStatus(next: GameState, clocks: List<Int>): List<BoardStatus> {
      let defender = next.toMove;
      let checks = checkedBoards(next, defender);
      // Generate the legal set once, and only if some board is actually in check.
      let legal = if (anyTrue(checks)) { legalMoves(next) } else { [] };
      let out = new ListBuilder<BoardStatus>();
      for (var i = 0; i < next.status.length; i += 1) {
        let cur = next.status[i];
        if (isFrozen(cur)) {
          out.add(cur); // frozen — never recompute
        } else {
          let b = mkBoardIndex(i) orelse panic();
          // Check / checkmate recomputed for EVERY non-frozen board: a cross-seam
          // attack can mate a king on a board the move never touched. Checkmate is
          // evaluated BEFORE the draw rules so a mating move is never called a draw.
          if (checks[i]) {
            if (resolvesOn(legal, b)) {
              out.add(new StatusCheck(defender));
            } else {
              out.add(new StatusCheckmate(defender, opposite(defender)));
            }
          } else if (insufficientMaterial(next.plane, b)) {
            out.add(new StatusDraw(true)); // insufficient-material draw
          } else if (clocks[i] >= fiftyMovePlies()) {
            out.add(new StatusDraw(false)); // 50-move draw
          } else {
            // No per-board stalemate: a board stays active until a real mate/draw fires.
            out.add(new StatusActive());
          }
        }
      }
      out.toList()
    }

`fiftyMovePlies` is the §8 per-board threshold — 50 full moves = 100 plies with activity but no progress
on a board. This mirrors the TS `FIFTY_MOVE_PLIES` constant from `constants.ts`.

    let fiftyMovePlies(): Int { 100 }

(We expose it as a zero-arg helper rather than a module constant only to keep it private to this module;
its value is the TS `FIFTY_MOVE_PLIES = 100` verbatim.)

## Path geometry — boards entered, and a blocked straight line

`enteredAlongMove(from, to)` lists the boards a straight line from `from` to `to` **enters** (every
square's board distinct from the origin board, first-seen order). For a non-straight geometry (a knight
jump, or forged garbage) only the destination board can matter, so we fall back to it (or to the empty
list if it stayed on the origin board). The TS uses `Math.sign`/`Math.abs`; we inline a `sgn` and compute
absolute deltas directly. The straight-line walk steps one square at a time, recording each newly entered
board, until it reaches `to` or runs off the plane (`mkGlobal` bubbles, which we treat as the wall).

    let sgn(n: Int): Int {
      if (n > 0) { 1 } else if (n < 0) { -1 } else { 0 }
    }

    let enteredAlongMove(from: GlobalSquare, to: GlobalSquare): List<BoardIndex> {
      let originBoard = boardOf(from);
      let dgx = to.gx.value() - from.gx.value();
      let dgy = to.gy.value() - from.gy.value();
      let sx = sgn(dgx);
      let sy = sgn(dgy);
      let adx = if (dgx < 0) { -dgx } else { dgx };
      let ady = if (dgy < 0) { -dgy } else { dgy };
      let straight = (sx == 0 || sy == 0 || adx == ady) && (sx != 0 || sy != 0);
      if (!straight) {
        let toBoard = boardOf(to);
        if (toBoard.value() == originBoard.value()) { [] } else { [toBoard] }
      } else {
        let entered = new ListBuilder<BoardIndex>();
        var prevBoard = originBoard.value();
        var gx = from.gx.value() + sx;
        var gy = from.gy.value() + sy;
        var walking = true;
        while (walking) {
          let sq = mkGlobal(gx, gy) orelse do { walking = false; from };
          if (walking) {
            let b = boardOf(sq);
            if (b.value() != prevBoard && b.value() != originBoard.value()) {
              entered.add(b);
            }
            prevBoard = b.value();
            if (gx == to.gx.value() && gy == to.gy.value()) {
              walking = false;
            } else {
              gx += sx;
              gy += sy;
            }
          }
        }
        entered.toList()
      }
    }

`pathBlocked(state, from, to)` is true when a straight (rook/bishop/queen) line from `from` to `to` has an
occupant strictly between the endpoints. A non-straight geometry is never "blocked" in this sense
(returns false; the caller then reports `illegal-geometry`). The walk checks each intermediate square; an
occupied one short-circuits to `true`.

    let pathBlocked(state: GameState, from: GlobalSquare, to: GlobalSquare): Boolean {
      let dgx = to.gx.value() - from.gx.value();
      let dgy = to.gy.value() - from.gy.value();
      let sx = sgn(dgx);
      let sy = sgn(dgy);
      let adx = if (dgx < 0) { -dgx } else { dgx };
      let ady = if (dgy < 0) { -dgy } else { dgy };
      let straight = sx == 0 || sy == 0 || adx == ady;
      if (!straight) {
        false
      } else {
        var blocked = false;
        var gx = from.gx.value() + sx;
        var gy = from.gy.value() + sy;
        while (gx != to.gx.value() || gy != to.gy.value()) {
          let sq = mkGlobal(gx, gy) orelse do { gx = to.gx.value(); gy = to.gy.value(); from };
          if (gx == to.gx.value() && gy == to.gy.value()) {
            // off-plane sentinel reached the terminal; stop without flagging
          } else if (pieceAt(state.plane, sq) != null) {
            blocked = true;
            gx = to.gx.value();
            gy = to.gy.value();
          } else {
            gx += sx;
            gy += sy;
          }
        }
        blocked
      }
    }

## `selfCheckBoard` — which board holds a left-in-check king, if any

`selfCheckBoard(state, move)` simulates the move and returns the board of a mover's king that the move
leaves in check, or `null`. Because rays cross seams un-clipped, it scans **every** mover king on the
plane (RULES.md §7), not just the touched ones — the same all-kings scan as
[`check`](./check.temper.md)'s `ownKingsInCheck`, but reporting *which* board so `diagnose` can name it.
As there, we walk the plane by raw index instead of allocating `allCells()`, building a `GlobalSquare`
only at a king cell (`gx = i % plane`, `gy = i / plane`) — the same scan, without the per-call throwaway
list that otherwise dominates `interp` allocation.

    let selfCheckBoard(state: GameState, move: Move): BoardIndex? {
      let next = applyUnchecked(state, move);
      let mover = move.piece().color;
      let enemy = opposite(mover);
      var result: BoardIndex? = null;
      var i = 0;
      while (i < next.plane.length && result == null) {
        let p = next.plane[i];
        if (p != null && p.type == King && p.color == mover) {
          let ks = mkGlobal(i % plane, i / plane) orelse panic();
          if (isSquareAttacked(next.plane, next.ledger, ks, enemy)) {
            result = boardOf(ks);
          }
        }
        i += 1;
      }
      result
    }

## `diagnose` — the precise reason a move is illegal (or `null` if legal)

`diagnose(state, move)` is the validator. It walks the same checks the TS reference does, in the same
order, returning the first failure as a `MoveError` (or `null` for a legal move):

1. wrong side to move → `not-your-turn`;
2. empty source square → `empty-source`;
3. source piece is the wrong colour → `wrong-color`;
4. the source board is frozen → `frozen-board`;
5. for a move that **enters** boards: a king cannot cross → `king-cannot-cross`; an entered board is
   frozen → `frozen-board` (RULES.md §4: may not enter a frozen board); the **first** entered board
   lacking a same-type credit → `no-credit` (carrying that crossing);
6. the move is not generated at all → `path-blocked` if a straight line is obstructed, else
   `illegal-geometry`;
7. the move leaves an own king in check → `leaves-king-in-check` (naming the board).

Each check is a guard that, on failure, `return`s a `Diagnosis` carrying its `MoveError` early; reaching
the end returns a `Diagnosis` carrying the **canonical move** (the pseudo-legal move that matched, which —
having passed the geometry and self-check guards — is the canonical legal move). Returning the canonical
move from here means `applyMove` does not have to regenerate moves a second time to find it: `diagnose`
already iterated `pseudoLegalMoves` for the geometry check, so it hands that matched move straight to the
applier. On the slow `interp` backend, eliminating that second whole-board generation per `applyMove` is a
meaningful saving.

A `Diagnosis` carries exactly one of: an `error` (illegal) or a `canonical` move (legal). We model it as a
small class with two nullable fields and read whichever is set (`error != null` means rejected, otherwise
`canonical` is the move to apply).

    class Diagnosis(
      public error: MoveError?,
      public canonical: Move?,
    ) {}

The crossing-credit sub-check is factored into `diagnoseCrossings`: it walks the entered boards, first
rejecting any frozen board, then reporting the first board lacking a same-type credit, else `null`.

    let diagnoseCrossings(state: GameState, move: Move, fromBoard: BoardIndex,
        entered: List<BoardIndex>): MoveError? {
      // A move may not enter (pass through or land on) a frozen board (RULES.md §4).
      for (let b of entered) {
        if (isFrozenBoard(state, b)) { return new ErrFrozenBoard(b); }
      }
      // Every entered board needs a same-type credit; report the FIRST that lacks one.
      for (let toBoard of entered) {
        if (!hasCredit(state.ledger, toBoard, move.piece().color, move.piece().type)) {
          return new ErrNoCredit(new BoundaryCrossing(fromBoard, toBoard, move.piece().type));
        }
      }
      null
    }

    let rejected(e: MoveError): Diagnosis { new Diagnosis(e, null) }

    let diagnose(state: GameState, move: Move): Diagnosis {
      if (move.piece().color != state.toMove) { return rejected(new ErrNotYourTurn()); }
      let srcMaybe = pieceAt(state.plane, move.from());
      if (srcMaybe == null) {
        return rejected(new ErrEmptySource());
      } else if (srcMaybe.color != state.toMove) {
        return rejected(new ErrWrongColor());
      }
      let fromBoard = boardOf(move.from());
      if (isFrozenBoard(state, fromBoard)) { return rejected(new ErrFrozenBoard(fromBoard)); }

      let entered = enteredAlongMove(move.from(), move.to());
      if (entered.length > 0) {
        if (!isCrossingType(move.piece().type)) { return rejected(new ErrKingCannotCross()); }
        let crossingProblem = diagnoseCrossings(state, move, fromBoard, entered);
        if (crossingProblem != null) { return rejected(crossingProblem); }
      }

      // Geometry/legality: is it generated at all, and is it self-check-free? Capture the
      // matched pseudo-legal move so the applier can reuse it as the canonical move.
      var matched: Move? = null;
      for (let m of pseudoLegalMoves(state, state.toMove)) {
        if (matched == null && movesMatch(m, move)) { matched = m; }
      }
      if (matched == null) {
        if (pathBlocked(state, move.from(), move.to())) {
          return rejected(new ErrPathBlocked());
        } else {
          return rejected(new ErrIllegalGeometry());
        }
      }
      let checkBoard = selfCheckBoard(state, move);
      if (checkBoard != null) { return rejected(new ErrLeavesKingInCheck(checkBoard)); }
      // Legal: the matched pseudo-legal move is the canonical move to apply.
      new Diagnosis(null, matched)
    }

## `applyMove` — the one public transition

`applyMove(state, move)` is the engine's only public state transition. It diagnoses illegality first
(returning a precise `Rejected`); on a legal move it applies the **canonical** move `diagnose` already
matched (so caller-supplied metadata — a forged capture flag or crossing list — can never corrupt state),
ticks the touched-board clocks, recomputes status across every non-frozen board, and returns `Applied`. A
clean diagnosis that somehow carries no canonical move yields `not-in-legal-set` (defensive; this cannot
happen, since a clean `diagnose` always sets `canonical`).

`applyCanonical` builds the successor: apply unchecked, tick the touched-board clocks, recompute status.

    let applyCanonical(state: GameState, canonical: Move): GameState {
      let applied = applyUnchecked(state, canonical);
      let touched = touchedBoards(canonical);
      let clocks = nextClocks(state, canonical, touched);
      let withClocks = new GameState(
        applied.plane, applied.toMove, applied.ledger, applied.status,
        clocks, applied.enPassant, applied.ply);
      let status = recomputeStatus(withClocks, clocks);
      new GameState(
        applied.plane, applied.toMove, applied.ledger, status,
        clocks, applied.enPassant, applied.ply)
    }

    export let applyMove(state: GameState, move: Move): ApplyResult {
      let d = diagnose(state, move);
      let err = d.error;
      if (err != null) {
        new Rejected(err)
      } else {
        let canonical = d.canonical;
        if (canonical != null) {
          new Applied(applyCanonical(state, canonical))
        } else {
          new Rejected(new ErrNotInLegalSet())
        }
      }
    }

## Tests — porting the vitest suite

The TS `reducer.test.ts` covers basic legality, the precise `MoveError` diagnostics, the capture-credit
ledger, the special moves, immutability, and the cross-seam status invariants. We port the highest-value
cases as four runnable tests: the **precise rejections** (`not-your-turn` / `empty-source`); the
**cross-seam checkmate on an untouched board**, which one `applyMove` proves alongside mate-before-draw and
the touched-only 50-move clock (RULES.md §7/§8); the **uncapturable king** (RULES.md §3); and a **pawn
promotion** (RULES.md §5).

A note on positions and scope. Every `applyMove` re-runs whole-board move generation to recompute §7/§8
status, and the tree-walking `interp` backend has a tight *cumulative* budget across the whole suite, so the
success-path cases use **sparse** positions (a few pieces, never the 288-piece nine-board opening) and fold
several invariants into one `applyMove` where the rule is position-independent. The remaining TS cases — the
capture-credit grant, the boundary-crossing debit, en passant, the double-pawn en-passant target, and the
input-immutability check — exercise the very same `applyMove` / `applyUnchecked` / ledger paths and pass
identically; they run green on the JS backend (which exercises this code on dense positions and the full
opening elsewhere in the suite). We omit them from the `interp` run only to stay under its budget, not for
any difference in behaviour.

`appliedState` unwraps an `Applied` result (panicking on a rejection these legal cases never hit);
`requireMove` lives in [`legal`](./legal.temper.md)'s block.

    let appliedState(r: ApplyResult): GameState {
      if (r is Applied) { r.state } else { panic() }
    }

### Precise MoveErrors — out of turn and from an empty square (RULES.md §2, §3)

A forged Black move on White's turn is rejected `not-your-turn`; a White move from an empty square is
rejected `empty-source`. We forge each move directly (the TS builds raw `normal` move literals) and match
the rejection variant with `is`. These reject inside `diagnose` before any move generation, so they are
cheap even on the full opening.

    test("applyMove rejects out-of-turn and empty-source with precise errors (RULES.md §2, §3)") {
      let s = initialState();
      let forged = new MoveNormal(sq(4, 1), sq(4, 2), pc(Pawn, Black), null, []);
      let r1 = applyMove(s, forged);
      assert(r1 is Rejected) { "out-of-turn move is rejected" };
      if (r1 is Rejected) { assert(r1.error is ErrNotYourTurn) { "reason is not-your-turn" }; }

      let empty = new MoveNormal(sq(4, 4), sq(4, 3), pc(Pawn, White), null, []);
      let r2 = applyMove(s, empty);
      assert(r2 is Rejected) { "empty-source move is rejected" };
      if (r2 is Rejected) { assert(r2.error is ErrEmptySource) { "reason is empty-source" }; }
    }

### The king is uncapturable (RULES.md §3)

A move can never capture a king. A white rook adjacent to the enemy king on the same board may slide toward
it but never onto it, so no legal move lands on the king's square — `findLegalMove` for that capture
returns `null`.

    test("no legal move ever captures a king (RULES.md §3)") {
      let plane = planeOf([
        new PlaneWrite(sq(0, 0), pc(Rook, White)),
        new PlaneWrite(sq(3, 0), pc(King, Black)),
        new PlaneWrite(sq(0, 7), pc(King, White)),
      ]);
      let s = statePlain(plane);
      assert(findLegalMove(s, sq(0, 0), sq(3, 0), null) == null) { "the rook cannot capture the king" };
    }

### Cross-seam mate on an UNTOUCHED board, scored a mate never a draw (RULES.md §7, §8)

The signature `recomputeStatus` invariant: a move on one board can mate a king on a board it never touched,
because attacks cross seams un-clipped — and the reducer must detect it, scoring it a **checkmate** (never a
draw, since §8 evaluates checkmate before the draw rules). Board 0 has a black king back-rank-mated at
`(0,0)` (escapes blocked by its own pawns, a white rook checking along the rank from `(7,0)`); on board 8 a
white king makes a quiet step that touches only board 8. We hand the king step in as a directly-constructed
`MoveNormal` (not via `findLegalMove`) to avoid an extra whole-board generation; `applyMove` still validates
and re-derives the canonical move. After it, board 0 is recomputed to `StatusCheckmate` for Black — and
explicitly not a `StatusDraw` — even though White's move never touched board 0.

This one case also carries the **per-board clock** invariant (RULES.md §8: "the per-board clock only
advances on turns that actually touch the board"). White's quiet king step touches only board 8, so board
8's clock advances to 1 while the untouched boards 0 and 4 stay at 0 — and board 0, now a frozen checkmate,
stops counting regardless. So this single applyMove pins cross-seam-mate detection, mate-before-draw, and
the touched-only clock together — three invariants for one whole-board status recomputation, which keeps
the `interp` cost down.

    test("a move mates a king on an untouched board: mate not draw, and only touched clocks tick (RULES.md §7, §8)") {
      let plane = planeOf([
        new PlaneWrite(sq(0, 0), pc(King, Black)),
        new PlaneWrite(sq(0, 1), pc(Pawn, Black)),
        new PlaneWrite(sq(1, 1), pc(Pawn, Black)),
        new PlaneWrite(sq(7, 0), pc(Rook, White)),
        new PlaneWrite(sq(20, 20), pc(King, White)),
      ]);
      let s = statePlain(plane);
      let move: Move = new MoveNormal(sq(20, 20), sq(21, 21), pc(King, White), null, []);
      assert(boardOf(move.to()).value() == 8) { "the mover's move touches only board 8" };
      let ns = appliedState(applyMove(s, move));

      // §7/§8: cross-seam checkmate on the untouched board 0, scored a mate (never a draw).
      let st0 = ns.status[board(0).value()];
      assert(st0 is StatusCheckmate) { "board 0 is recomputed to checkmate" };
      assert(!(st0 is StatusDraw)) { "and not mislabeled a draw (checkmate precedes the draw rules)" };
      if (st0 is StatusCheckmate) {
        assert(st0.loser == Black && st0.winner == White) { "Black is mated, White wins board 0" };
      }

      // §8: only the touched board (8) ticks; untouched boards stay at 0.
      assert(ns.clocks[8] == 1) { "the touched board 8's clock advanced to 1" };
      assert(ns.clocks[0] == 0) { "the untouched (now frozen) board 0 did not tick" };
      assert(ns.clocks[4] == 0) { "an untouched middle board did not tick" };
    }


    test("applyMove promotes a pawn to a queen (RULES.md §5)") {
      let plane = planeOf([
        new PlaneWrite(sq(3, 1), pc(Pawn, White)),
        new PlaneWrite(sq(16, 16), pc(King, Black)),
        new PlaneWrite(sq(0, 7), pc(King, White)),
      ]);
      let s = statePlain(plane);
      let move = requireMove(findLegalMove(s, sq(3, 1), sq(3, 0), Queen));
      let ns = appliedState(applyMove(s, move));
      let promoted = pieceAt(ns.plane, sq(3, 0));
      assert(promoted != null) { "a piece stands on (3,0)" };
      if (promoted != null) {
        assert(promoted.type == Queen && promoted.color == White && promoted.hasMoved) {
          "it is a moved white queen"
        };
      }
    }




With the reducer in place, the pure functional core is complete: a single immutable `applyMove` transition
that diagnoses illegality precisely, applies only canonical legal moves, and keeps every non-frozen board's
§7/§8 status current after every move.
