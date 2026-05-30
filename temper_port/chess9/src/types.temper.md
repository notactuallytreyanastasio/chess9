# Value vocabulary — colours, piece roles, and per-board status

This is the first substantive module of the Chess-9 Temper port, and it does double duty.
Its surface job is to model the *value vocabulary* of the engine: the small, closed sets of
things a chess value can be — a [`Color`](#color), a [`PieceType`](#piecetype), the
[`Piece`](#the-piece-record) record that pairs them, and a board's lifecycle
[`BoardStatus`](#boardstatus). Its deeper job is to **fix the conventions every later module
follows**, because the way we render these vocabularies decides the shape of everything built
on top of them.

The TypeScript reference (`../../src/core/types.ts`) leans on TypeScript's structural,
string-literal union types: `type Color = 'white' | 'black'`, `type PieceType = 'pawn' | ...`,
and discriminated-union records keyed by a `kind` string. Temper has none of that. It is a
nominally typed language that compiles to six backends, so we cannot lean on string identity or
structural records. The faithful translation is:

- **String-literal unions → sealed interfaces with singleton classes.** `Color` and `PieceType`
  each become a `sealed interface` plus one tiny singleton class per case. "Sealed" means the
  compiler knows the complete set of implementers, so a `when` over them is exhaustive with no
  `else` arm — exactly the totality a closed union gives you in TypeScript, but checked
  nominally and identically on every backend.
- **Discriminated unions → sealed interface + one class per variant.** `BoardStatus` follows the
  same shape, except its variants carry data (who is in check, who won, why it drew).

The rules this module implements are drawn from `../../RULES.md`:

- **§5 Pawns / §9 Winning** define the piece roles — and crucially that "a pawn never exists as
  a pawn on a board other than its home board" and "kings never cross a seam". Those two facts
  are why the crossing/promotion *subsets* of `PieceType` exist (see [the subsets](#the-crossing-and-promotion-subsets)).
- **§7 Check, checkmate & frozen boards** defines the lifecycle a board passes through — `active`,
  `check`, `checkmate` — and that a checkmated board is *frozen and scored*.
- **§8 Draws & termination** defines `draw` and its two reasons, and states the rule that shapes
  this whole type: **there is no per-board stalemate.** A board with no immediate move stays
  `active`. So `BoardStatus` deliberately has *four* cases, not five.

## `Color`

A side is White or Black (RULES.md §2: "You are White; the bot is Black"). In TypeScript this is
`'white' | 'black'`. Here it is a sealed interface with two singleton instances. The interface
carries one piece of behaviour, `opposite`, because flipping a colour is the single most common
operation in the engine and it belongs with the type rather than scattered across call sites.

    export sealed interface Color {
      /** The other side. White.opposite is Black and vice versa (RULES.md §2). */
      opposite(): Color;
    }

Each case is a class with no fields. Because the engine needs exactly one White and one Black
and compares them by identity, we expose a single canonical instance of each as a module-level
constant. Later modules write `White` / `Black` (the values), never `new ColorWhite()`, so there
is only ever one of each to compare against.

    export class ColorWhite() extends Color {
      public opposite(): Color { Black }
    }
    export class ColorBlack() extends Color {
      public opposite(): Color { White }
    }

    export let White: Color = new ColorWhite();
    export let Black: Color = new ColorBlack();

`opposite` is defined by mutual reference to the two constants. That is safe because the constant
bodies don't call `opposite` at construction time — the method is only invoked later, once both
`White` and `Black` are initialised.

This invariant pins the round-trip: flipping twice is identity, and `opposite` agrees with the
TS `opposite('white') === 'black'` test in `../../src/core/pieces.test.ts`.

    test("Color.opposite flips and round-trips") {
      assert(White.opposite() == Black) { "white flips to black" };
      assert(Black.opposite() == White) { "black flips to white" };
      assert(White.opposite().opposite() == White) { "double flip is identity" };
    }

Identity comparison via `==` on these singleton objects is the Temper analogue of TS string
equality on `'white'`. Because `White` and `Black` are unique singleton instances, every
reference to White is the same object, so `==` reduces to reference identity.

    test("Color singletons are canonical") {
      assert(White == White) { "white is itself" };
      assert(!(White == Black)) { "white is not black" };
    }

## `PieceType`

The six roles a piece can have: pawn, knight, bishop, rook, queen, king. In TypeScript,
`type PieceType = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king'`. Here it is again a
sealed interface over six singleton classes.

The interface also captures the two role *predicates* that the rules force on us, so they travel
with the type instead of being recomputed structurally elsewhere:

- `canCross` — whether a piece of this type may cross a board seam at all. By RULES.md §4 ("Kings
  never cross a seam") this is true for every type *except the king*. This is the membership test
  for the `CrossingType` subset described below.
- `canPromoteTo` — whether this type is a legal promotion target. By RULES.md §5 a pawn promotes
  to "Queen/Rook/Bishop/Knight", so neither pawn nor king is a legal target.

We model centipawn material value too. The TS reference keeps a `Record<PieceType, number>`
table in `pieces.ts`; in Temper the natural home for "the value of a knight" is the knight type
itself, so each singleton answers `value()`. The numbers match the TS `VALUES` table verbatim.

    export sealed interface PieceType {
      /** Centipawn material value (matches pieces.ts VALUES). */
      value(): Int;
      /** May a piece of this type cross a seam? False only for the king (RULES.md §4). */
      canCross(): Boolean;
      /** Is this type a legal pawn-promotion target? Queen/Rook/Bishop/Knight only (RULES.md §5). */
      canPromoteTo(): Boolean;
    }

The six cases. The values are the same ordering the TS test pins (pawn < knight < bishop, rook <
queen < king), and the predicates encode §4/§5 directly.

    export class PiecePawn() extends PieceType {
      public value(): Int { 100 }
      public canCross(): Boolean { true }
      public canPromoteTo(): Boolean { false }
    }
    export class PieceKnight() extends PieceType {
      public value(): Int { 320 }
      public canCross(): Boolean { true }
      public canPromoteTo(): Boolean { true }
    }
    export class PieceBishop() extends PieceType {
      public value(): Int { 330 }
      public canCross(): Boolean { true }
      public canPromoteTo(): Boolean { true }
    }
    export class PieceRook() extends PieceType {
      public value(): Int { 500 }
      public canCross(): Boolean { true }
      public canPromoteTo(): Boolean { true }
    }
    export class PieceQueen() extends PieceType {
      public value(): Int { 900 }
      public canCross(): Boolean { true }
      public canPromoteTo(): Boolean { true }
    }
    export class PieceKing() extends PieceType {
      public value(): Int { 20000 }
      public canCross(): Boolean { false }
      public canPromoteTo(): Boolean { false }
    }

As with colours, we expose one canonical singleton per type and use those everywhere.

    export let Pawn: PieceType = new PiecePawn();
    export let Knight: PieceType = new PieceKnight();
    export let Bishop: PieceType = new PieceBishop();
    export let Rook: PieceType = new PieceRook();
    export let Queen: PieceType = new PieceQueen();
    export let King: PieceType = new PieceKing();

The material ordering is exactly the invariant the TS `pieces.test.ts` "material values are
ordered sensibly" case checks.

    test("PieceType material values are ordered sensibly") {
      assert(Pawn.value() < Knight.value()) { "pawn worth less than knight" };
      assert(Bishop.value() > Knight.value()) { "bishop worth more than knight" };
      assert(Rook.value() < Queen.value()) { "rook worth less than queen" };
      assert(King.value() > Queen.value()) { "king worth most" };
    }

## The crossing and promotion subsets

TypeScript expresses two refinements of `PieceType` with `Exclude`:

    // CrossingType  = Exclude<PieceType, 'king'>            — kings never cross
    // PromotionType = Exclude<PieceType, 'pawn' | 'king'>   — legal promotion targets

Temper has no structural `Exclude`, and minting separate sealed interfaces for the subsets would
duplicate all six classes. Instead we model the subsets as **predicates over the full type** —
`canCross` and `canPromoteTo` above — which is the membership test the `Exclude` types stand for.
This mirrors the TS `isCrossingType` helper (`type is CrossingType` narrowing) in `pieces.ts`,
which is itself just `type !== 'king'`.

`canCross` is the `CrossingType` membership test: everything but the king. This pins the same
invariant as the TS `pieces.test.ts` "isCrossingType excludes the king only" case.

    test("CrossingType subset excludes only the king (RULES.md §4)") {
      assert(!King.canCross()) { "king cannot cross a seam" };
      assert(Pawn.canCross()) { "pawn can cross" };
      assert(Knight.canCross()) { "knight can cross" };
      assert(Bishop.canCross()) { "bishop can cross" };
      assert(Rook.canCross()) { "rook can cross" };
      assert(Queen.canCross()) { "queen can cross" };
    }

`canPromoteTo` is the `PromotionType` membership test: the four non-king, non-pawn types. A pawn
is not a promotion *target* (you don't promote to a pawn), and a king is never a target either.

    test("PromotionType subset is queen/rook/bishop/knight (RULES.md §5)") {
      assert(!Pawn.canPromoteTo()) { "cannot promote to a pawn" };
      assert(!King.canPromoteTo()) { "cannot promote to a king" };
      assert(Knight.canPromoteTo()) { "knight is a legal target" };
      assert(Bishop.canPromoteTo()) { "bishop is a legal target" };
      assert(Rook.canPromoteTo()) { "rook is a legal target" };
      assert(Queen.canPromoteTo()) { "queen is a legal target" };
    }

## The `Piece` record

A piece on the plane is its type, its owner, and whether it has moved. The TS `Piece` interface is
a `readonly` record; the Temper analogue is an immutable class with three public fields. The
`hasMoved` flag gates the pawn double-step and castling eligibility (RULES.md §5, §6) — it is the
same field the TS reference carries.

    export class Piece(
      public type: PieceType,
      public color: Color,
      /** Pawn double-step / castling eligibility (RULES.md §5, §6). */
      public hasMoved: Boolean,
    ) {}

A small construction sanity check: a piece faithfully carries the singletons it was built from,
so downstream code can compare `piece.color == White` and `piece.type == Pawn` by identity.

    test("Piece carries its color and type singletons") {
      let p = new Piece(Pawn, White, false);
      assert(p.type == Pawn) { "type is the pawn singleton" };
      assert(p.color == White) { "color is the white singleton" };
      assert(!p.hasMoved) { "fresh piece has not moved" };
      assert(p.color.opposite() == Black) { "owner's opponent is black" };
    }

## `BoardStatus`

Each of the nine boards has its own lifecycle. RULES.md §7 and §8 define the states a board can
occupy, and §8 makes one absence load-bearing: **there is no per-board stalemate.** A board with
no legal move for the side to move stays `active` and contestable. So `BoardStatus` has exactly
four cases — `active`, `check`, `checkmate`, `draw` — not the five a naive chess port would
write.

This is a true discriminated union (the variants carry different data), so it becomes a
`sealed interface` with one class per variant, matched exhaustively with `when`.

    export sealed interface BoardStatus {}

`active` — the default, live state. No data.

    export class StatusActive() extends BoardStatus {}

`check` — the side to move on this board is in check. This is *transient*: the board is not
frozen, and play continues. It records which colour is in check (RULES.md §7: "A king
highlighted with a red ring in the UI is in check").

    export class StatusCheck(
      public inCheck: Color,
    ) extends BoardStatus {}

`checkmate` — the board is decided. RULES.md §7: a checkmated board is **frozen** (no piece may
enter or leave) and **scored** for the mating side. We record both the `loser` (the mated side)
and the `winner` (the mating side); §9 counts these to decide the game.

    export class StatusCheckmate(
      public loser: Color,
      public winner: Color,
    ) extends BoardStatus {}

`draw` — the board is frozen but *unscored* (RULES.md §8, §9: draw-frozen boards count for
neither side). The two reasons are insufficient material and the 50-move rule. Rather than a
nested `DrawReason` union for two leaf cases, we carry a single boolean discriminator and a
small accessor, keeping the variant flat while still naming both reasons.

    export class StatusDraw(
      /** true = insufficient material; false = 50-move rule (RULES.md §8). */
      public byInsufficientMaterial: Boolean,
    ) extends BoardStatus {
      public byFiftyMove(): Boolean { !byInsufficientMaterial }
    }

Because the interface is sealed, a `when` over a status is total without an `else`, and that is
the shape most consumers of board status will use to dispatch on the variant. A tiny classifier —
"is this board frozen?" — pins the §7/§8 freeze semantics: checkmate and draw freeze; active and
check do not.

Here we deliberately write the classifier as an `is`-narrowing `if`/`else` chain rather than a
`when`. The porting cheat-sheet in `../../CLAUDE.md` flags that a `when` used directly as a
function's return value can fail to type-check on some backends (its arm bodies are read as
`Void` statements); the if/else form sidesteps that while testing exactly the same predicate.
Modules that consume a status *for its data* will still use exhaustive `when` with `is` arms, as
the [variant-data test](#boardstatus) below shows.

    export let isFrozen(status: BoardStatus): Boolean {
      if (status is StatusCheckmate) {
        true
      } else if (status is StatusDraw) {
        true
      } else {
        false
      }
    }

The freeze invariant: only decided boards (checkmate/draw) are frozen; `active` and `check` stay
live, the latter encoding §8's "no per-board stalemate" stance that a board under pressure is
still contestable.

    test("only checkmate and draw freeze a board (RULES.md §7, §8)") {
      assert(!isFrozen(new StatusActive())) { "active board is live" };
      assert(!isFrozen(new StatusCheck(White))) { "a board in check is not frozen" };
      assert(isFrozen(new StatusCheckmate(Black, White))) { "checkmate freezes" };
      assert(isFrozen(new StatusDraw(true))) { "draw freezes" };
    }

The data each variant carries is reachable after an `is` narrowing — this is how scoring (§9) will
read the winner off a checkmate and how the UI reads which side is in check.

    test("BoardStatus variants carry their data") {
      let mate = new StatusCheckmate(Black, White);
      assert(mate.winner == White) { "winner recorded" };
      assert(mate.loser == Black) { "loser recorded" };

      let chk = new StatusCheck(Black);
      assert(chk.inCheck == Black) { "checked side recorded" };

      let drawMaterial = new StatusDraw(true);
      assert(drawMaterial.byInsufficientMaterial) { "insufficient-material reason" };
      assert(!drawMaterial.byFiftyMove()) { "and not the 50-move reason" };

      let drawClock = new StatusDraw(false);
      assert(drawClock.byFiftyMove()) { "50-move reason" };
    }

With these vocabularies fixed — sealed interfaces, canonical singletons, exhaustive `when`,
immutable records — the rest of the port has a stable foundation to build coordinates, the
plane, moves, and the reducer on top of.
