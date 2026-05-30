# The immutable game state and the nine-army opening

This module is the Temper port of `../../src/core/setup.ts` (and its `setup.test.ts`). It pulls
together everything the earlier modules built — the [`Color`](./types.temper.md)/`Piece` vocabulary,
the [`coords`](./coords.temper.md) geometry, the copy-on-write [`plane`](./plane.temper.md), and the
crossing-credit [`ledger`](./ledger.temper.md) — into the engine's single root value: the immutable
**`GameState`**. It also defines the opening position, `initialState()`, which lays nine standard
8×8 armies into the 24×24 plane.

RULES.md §1 ("The board") is the rule this module realises as state: "Nine standard chessboards are
arranged in a 3×3 grid… Each board starts as a full, standard chess game with its own two kings.
**All nine are active simultaneously.**" So the opening is literally nine independent standard chess
openings, fused onto one plane, with every board live, no credits yet earned, and White to move
(RULES.md §2: "You are White").

## The `GameState` record

The TS `GameState` (`../../src/core/types.ts`) is a `readonly` record of seven fields:

```ts
interface GameState {
  readonly plane: Plane;                 // length 576
  readonly toMove: Color;
  readonly ledger: Ledger;               // length 9
  readonly status: BoardStatuses;        // length 9
  readonly clocks: ReadonlyArray<number>;// length 9
  readonly enPassant: GlobalSquare | null;
  readonly ply: number;
}
```

The Temper analogue is an immutable class with seven public fields. Each TS field maps onto a type
the earlier modules already fixed:

- `plane: Plane` → `plane: List<Piece?>`. The TS `Plane` alias (`ReadonlyArray<Piece | null>`) was
  introduced locally in [`plane`](./plane.temper.md); we reuse that rendering here verbatim.
- `toMove: Color` → `toMove: Color`, the sealed-interface singleton from
  [`types`](./types.temper.md). No string `'white'`; we hold the `White` singleton.
- `ledger: Ledger` → `ledger: Ledger`, the immutable Int-keyed wrapper from
  [`ledger`](./ledger.temper.md). (The TS comment "length 9" describes the *conceptual* nine-board
  shape; our `Ledger` packs all nine boards into one flat map, so there is no literal length to
  carry.)
- `status: BoardStatuses` → `status: List<BoardStatus>` of length 9, one
  [`BoardStatus`](./types.temper.md) per board. The TS `BoardStatuses` is a fixed-length tuple of
  nine; Temper has no tuple types, so a `List<BoardStatus>` whose length we pin to `boards` (= 9) is
  the faithful rendering.
- `clocks: ReadonlyArray<number>` → `clocks: List<Int>` of length 9 — the per-board halfmove clock
  for the 50-move rule (RULES.md §8). `ReadonlyArray` is `List`; `number` (here always an integer
  count) is `Int`.
- `enPassant: GlobalSquare | null` → `enPassant: GlobalSquare?`. The TS `| null` becomes Temper's
  nullable `?`; `null` means "no en-passant target this ply".
- `ply: number` → `ply: Int`, the half-move counter and turn-parity source.

Every field is `public` (Temper requires an explicit visibility keyword) and the class carries no
methods — it is a plain immutable record, exactly like the TS interface. Because all the contained
types are themselves immutable (the plane is a `List`, the ledger copies-on-write, statuses are
singletons or immutable variants), a `GameState` is deeply immutable: search can derive a successor
state and discard it without disturbing its parent.

    export class GameState(
      /** The 576-cell occupancy plane (RULES.md §1). */
      public plane: List<Piece?>,
      /** Side to move (RULES.md §2: White is the human). */
      public toMove: Color,
      /** Crossing-credit ledger (RULES.md §4). */
      public ledger: Ledger,
      /** Per-board lifecycle status, one per board, length 9 (RULES.md §7). */
      public status: List<BoardStatus>,
      /** Per-board 50-move halfmove clock, length 9 (RULES.md §8). */
      public clocks: List<Int>,
      /** En-passant target square, valid for the current ply only; null if none (RULES.md §6). */
      public enPassant: GlobalSquare?,
      /** Half-move counter, also turn parity. */
      public ply: Int,
    ) {}

## The standard back rank

Each board's first and last ranks hold the standard chess piece order. The TS reference keeps a
`BACK_RANK: readonly PieceType[]` table — rook, knight, bishop, queen, king, bishop, knight, rook —
indexed by file. The Temper analogue is a `List<PieceType>` of the same eight singletons in the same
order. File 4 is the king, which (RULES.md §4) is the one piece that never crosses a seam and anchors
each board's checkmate.

    let backRank(): List<PieceType> {
      [Rook, Knight, Bishop, Queen, King, Bishop, Knight, Rook]
    }

A tiny constructor for a fresh, unmoved piece, mirroring the TS `piece(type, color)` helper that
always sets `hasMoved: false`. Every piece in the opening is unmoved, which is what makes the pawn
double-step and castling (RULES.md §5, §6) available from the start.

    let freshPiece(type: PieceType, color: Color): Piece {
      new Piece(type, color, false)
    }

## Laying down the nine armies

`buildPlane()` produces the opening occupancy. It walks all nine boards; for each, it walks the eight
files and places four pieces per file — the two black pieces on the board's top two local ranks and
the two white pieces on its bottom two. This is a direct port of the TS `buildPlane`, which builds a
list of `(GlobalSquare, Piece)` writes and folds them through `withPieces`.

The rank convention is the one [`types`](./types.temper.md) documents and the TS comment fixes:
*within each board, local rank 0 (top) holds black, local rank 7 (bottom) holds white.* In global
terms, for a board whose top edge is global row `gy0 = by * boardSize`:

- `gy0 + 0` — black back-rank piece for this file,
- `gy0 + 1` — black pawn,
- `gy0 + 6` — white pawn,
- `gy0 + 7` — white back-rank piece.

The board's grid column/row come from the board index exactly as
[`coords`](./coords.temper.md)'s `boardOrigin` computes them (`bx = board % grid`, `by = board / grid`),
and a file's global column is `bx * boardSize + file`.

Two small translation notes. The TS code constructs each `GlobalSquare` through the fallible
`mkGlobal` and pushes the write *only if* `sq.ok`; every coordinate here is provably in range
(`bx*8+file` and `gy0+{0,1,6,7}` are all within `0..23`), so the Temper port recovers each
`mkGlobal` with `orelse panic()` — an unreachable panic that documents the invariant rather than a
real failure path. And the TS list of `[gy, Piece]` tuples becomes a sequence of
[`PlaneWrite`](./plane.temper.md) values, since Temper has no tuple literal. We accumulate all the
writes into a `ListBuilder<PlaneWrite>` and apply them in one copy-on-write batch via `withPieces`.

    let buildPlane(): List<Piece?> {
      let rank = backRank();
      let writes = new ListBuilder<PlaneWrite>();
      for (var board = 0; board < boards; board += 1) {
        let bx = board % grid;
        let by = board / grid;
        for (var file = 0; file < boardSize; file += 1) {
          let gx = bx * boardSize + file;
          let gy0 = by * boardSize;
          let back = rank[file];
          writes.add(new PlaneWrite(
            mkGlobal(gx, gy0 + 0) orelse panic(), freshPiece(back, Black)));
          writes.add(new PlaneWrite(
            mkGlobal(gx, gy0 + 1) orelse panic(), freshPiece(Pawn, Black)));
          writes.add(new PlaneWrite(
            mkGlobal(gx, gy0 + 6) orelse panic(), freshPiece(Pawn, White)));
          writes.add(new PlaneWrite(
            mkGlobal(gx, gy0 + 7) orelse panic(), freshPiece(back, White)));
        }
      }
      withPieces(emptyPlane(), writes.toList())
    }

## The nine starting statuses and clocks

The opening has every board `active` (RULES.md §1: "All nine are active simultaneously") and every
per-board clock at zero. The TS reference builds these with `Array.from({ length: BOARDS }, …)`;
Temper has no array-fill literal, so we accumulate each into a `ListBuilder` of length `boards`. Each
status slot gets a fresh `StatusActive`; each clock slot gets `0`.

    let initialStatuses(): List<BoardStatus> {
      let acc = new ListBuilder<BoardStatus>();
      for (var i = 0; i < boards; i += 1) {
        acc.add(new StatusActive());
      }
      acc.toList()
    }

    let initialClocks(): List<Int> {
      let acc = new ListBuilder<Int>();
      for (var i = 0; i < boards; i += 1) {
        acc.add(0);
      }
      acc.toList()
    }

## `initialState` — the opening position

`initialState()` assembles the root `GameState`: the nine-army plane, White to move, an empty ledger
(no piece has been captured yet, so no crossing is possible — RULES.md §4), nine `active` statuses,
nine zeroed clocks, no en-passant target, and ply 0. This is the verbatim shape of the TS
`initialState` object literal.

    export let initialState(): GameState {
      new GameState(
        buildPlane(),
        White,
        emptyLedger(),
        initialStatuses(),
        initialClocks(),
        null,
        0,
      )
    }

## Tests — porting the vitest suite

The tests below mirror `../../src/core/setup.test.ts` one-to-one. A small piece-counter helper ports
the TS `countPieces`, scanning the whole plane and tallying by colour into a pair of mutable counters
(Temper has no `Set`/`Record`, so we hold two `Int`s and compare the piece's `color` singleton by
identity).

    let countWhite(s: GameState): Int {
      var n = 0;
      for (let cell of s.plane) {
        if (cell != null && cell.color == White) { n += 1; }
      }
      n
    }

    let countBlack(s: GameState): Int {
      var n = 0;
      for (let cell of s.plane) {
        if (cell != null && cell.color == Black) { n += 1; }
      }
      n
    }

**The scalar fields are at their opening values.** Ports the TS "has the right scalar fields" case:
White to move, ply 0, no en-passant target, a full 576-cell plane, nine statuses, and every status
`active`. We test the "all active" property with the [`types`](./types.temper.md) `is StatusActive`
narrowing rather than a TS `.kind === 'active'` string compare.

    test("initialState has the right scalar opening fields (RULES.md §1, §2)") {
      let s = initialState();
      assert(s.toMove == White) { "white to move" };
      assert(s.ply == 0) { "ply starts at zero" };
      assert(s.enPassant == null) { "no en-passant target at the opening" };
      assert(s.plane.length == squares) { "plane has all 576 cells" };
      assert(s.status.length == boards) { "one status per board" };
      for (let st of s.status) {
        assert(st is StatusActive) { "every board starts active" };
      }
    }

**Nine complete armies — 16 per side per board.** This is the load-bearing §1 invariant: nine full
standard games means `9 × 16 = 144` pieces of each colour on the plane. Ports the TS "places 9
complete armies (16 per side per board)" case.

    test("initialState places nine complete armies, 16 per side per board (RULES.md §1)") {
      let s = initialState();
      assert(countWhite(s) == 9 * 16) { "144 white pieces" };
      assert(countBlack(s) == 9 * 16) { "144 black pieces" };
    }

**The opening ledger is empty.** No piece has been captured yet, so every crossing-credit slot — for
every board, colour, and crossing type — reads zero (RULES.md §4: credits are earned only by losing a
piece). Ports the TS "has an empty ledger" case, iterating the same five crossing types.

    test("initialState has an empty crossing-credit ledger (RULES.md §4)") {
      let s = initialState();
      let types: List<PieceType> = [Pawn, Knight, Bishop, Rook, Queen];
      for (var b = 0; b < boards; b += 1) {
        let board = mkBoardIndex(b) orelse panic();
        for (let color of [White, Black]) {
          for (let t of types) {
            assert(creditCount(s.ledger, board, color, t) == 0) {
              "no credit at the opening"
            };
          }
        }
      }
    }

**Kings sit on their home squares.** Ports the TS "places white king at e1 and black king at e8 on
the center board" case. The centre board (index 4) spans global `gx`/`gy` `8..15`; the king file is
4, so its global column is `12`. White's king sits on the board's bottom local rank (`gy = 15`),
Black's on the top (`gy = 8`). We read each square back through [`plane`](./plane.temper.md)'s
`pieceAt` and check the singleton type/colour and the unmoved flag by identity — the Temper analogue
of the TS `toEqual({ type:'king', color:'white', hasMoved:false })`.

    test("initialState places the kings on their home squares (RULES.md §1)") {
      let s = initialState();
      let whiteKing = pieceAt(s.plane, mkGlobal(12, 15) orelse panic());
      let blackKing = pieceAt(s.plane, mkGlobal(12, 8) orelse panic());

      assert(whiteKing != null) { "white king present at (12,15)" };
      if (whiteKing != null) {
        assert(whiteKing.type == King) { "it is a king" };
        assert(whiteKing.color == White) { "it is white" };
        assert(!whiteKing.hasMoved) { "the king has not moved" };
      }

      assert(blackKing != null) { "black king present at (12,8)" };
      if (blackKing != null) {
        assert(blackKing.type == King) { "it is a king" };
        assert(blackKing.color == Black) { "it is black" };
        assert(!blackKing.hasMoved) { "the king has not moved" };
      }
    }

With the root `GameState` and the nine-army opening fixed, the move generator and the reducer have a
concrete starting position to operate on: a full plane, a clean ledger, and nine live boards waiting
to be contested for checkmates (RULES.md §9).
