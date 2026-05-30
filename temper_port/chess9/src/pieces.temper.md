# Piece helpers — colour flipping, material value, crossing & forward direction

This module is the Temper port of `../../src/core/pieces.ts`. It is a small **functional facade**:
four free functions that the rest of the engine and (in the TS reference) the evaluator and move
ordering reach for constantly. None of them carry state — they are pure projections of the value
vocabulary established in [`types`](./types.temper.md).

The rules this module touches are all in `../../RULES.md`:

- **§2 Turns** — "You are White; the bot is Black." [`opposite`](#opposite) flips between the two
  sides, the single most common operation in legal-move generation and search.
- **§4 Crossing between boards** — "Kings never cross a seam." [`isCrossingType`](#iscrossingtype)
  is the membership test for the set of types that *may* cross (everything but the king).
- **§5 Pawns** — pawn direction in global-Y. [`forwardDir`](#forwarddir) gives the
  board-independent advance direction so a pawn that crossed boards is never confused.
- Material value (`../../src/core/pieces.ts` `VALUES`) — [`pieceValue`](#piecevalue) reports the
  centipawn worth used by the evaluator and move ordering.

## Translation strategy: thin functions over rich types

A notable TS→Temper decision shapes this whole file. The TypeScript reference keeps these as
*standalone functions* operating on string-literal `Color` / `PieceType` values, plus a private
`VALUES` lookup table. When the value vocabulary was ported in [`types`](./types.temper.md), those
string unions became sealed interfaces whose singleton cases already answer the relevant questions
as **methods**: `Color.opposite()`, `PieceType.value()`, `PieceType.canCross()`. The behaviour
genuinely belongs on the types (a colour knows its opposite; a knight knows it is worth 320), so
that is where it lives.

This module therefore does *not* re-implement any logic. It re-exposes those methods as the same
free-function surface the TS callers expect, so a downstream port of `evaluate.ts` or move ordering
can call `pieceValue(t)` exactly as the TS code does, while the single source of truth for each
fact stays on the type.

A note on how the vocabulary reaches this file. The TS `pieces.ts` opens with
`import type { Color, CrossingType, PieceType } from './types'`. The Temper port has *no* equivalent
`import("./types")` line: the chess9 library compiles every `.temper.md` file in `src/` into one
module, so the exported names from [`types`](./types.temper.md) — `Color`, `PieceType`, and the
canonical singletons `White` / `Black` / `Pawn` / … — are already in lexical scope here. The
sibling [`coords`](./coords.temper.md) module relies on the same whole-library scoping. We reference
those names directly.

## `opposite`

`opposite(color)` returns the other side (RULES.md §2). The TS body is
`color === 'white' ? 'black' : 'white'`; here it simply delegates to the method the `Color`
interface already carries, so there is exactly one definition of "the other side" in the codebase.

    export let opposite(color: Color): Color { color.opposite() }

The invariant the TS `pieces.test.ts` "opposite flips color" case pins: white maps to black and
black to white. We add the round-trip for good measure, since identity-under-double-flip is what
makes `opposite` safe to call inside search.

    test("opposite flips color (pieces.ts opposite)") {
      assert(opposite(White) == Black) { "white flips to black" };
      assert(opposite(Black) == White) { "black flips to white" };
      assert(opposite(opposite(White)) == White) { "double flip is identity" };
    }

## `pieceValue`

`pieceValue(type)` is the centipawn material value the evaluator and move ordering consume. The TS
reference reads it out of a private `VALUES: Record<PieceType, number>` table
(pawn 100, knight 320, bishop 330, rook 500, queen 900, king 20000). In the Temper port each
`PieceType` singleton answers `value()` with those same numbers, so this function is a one-line
delegation and the table lives on the types.

    export let pieceValue(type: PieceType): Int { type.value() }

The TS "material values are ordered sensibly" case checks the *ordering* the engine relies on —
pawn < knight, bishop > knight, rook < queen, king > queen — rather than the literal numbers. We
pin the same relations through this function surface.

    test("material values are ordered sensibly (pieces.ts VALUES)") {
      assert(pieceValue(Pawn) < pieceValue(Knight)) { "pawn worth less than knight" };
      assert(pieceValue(Bishop) > pieceValue(Knight)) { "bishop worth more than knight" };
      assert(pieceValue(Rook) < pieceValue(Queen)) { "rook worth less than queen" };
      assert(pieceValue(King) > pieceValue(Queen)) { "king worth most" };
    }

## `isCrossingType`

`isCrossingType(type)` answers whether a piece of this type may cross a board seam at all. By
RULES.md §4 — "Kings never cross a seam" — this is true for every type *except* the king. The TS
reference is a *type guard*: `type is CrossingType` narrowing whose body is the plain predicate
`type !== 'king'`. Temper has no structural `CrossingType` subset (see the discussion of the
`Exclude` types in [`types`](./types.temper.md)), so the narrowing aspect disappears and what
remains is the membership predicate itself, delegated to `PieceType.canCross()`.

    export let isCrossingType(type: PieceType): Boolean { type.canCross() }

The TS "isCrossingType excludes the king only" case is reproduced here, broadened to confirm every
non-king type qualifies — the exact §4 rule.

    test("isCrossingType excludes the king only (RULES.md §4)") {
      assert(!isCrossingType(King)) { "king cannot cross a seam" };
      assert(isCrossingType(Pawn)) { "pawn can cross" };
      assert(isCrossingType(Knight)) { "knight can cross" };
      assert(isCrossingType(Bishop)) { "bishop can cross" };
      assert(isCrossingType(Rook)) { "rook can cross" };
      assert(isCrossingType(Queen)) { "queen can cross" };
    }

## `forwardDir`

`forwardDir(color)` gives a pawn's forward direction in **global-Y**, and the emphasis on global-Y
is the whole point (RULES.md §5). Because a pawn can push straight across a seam onto the next
board, "forward" must be defined on the continuous 24×24 plane, not relative to whichever board the
pawn currently stands on — otherwise a pawn that crossed boards could be confused about which way
it advances. White advances toward `gy = 0` (direction `-1`); Black advances toward `gy = 23`
(direction `+1`).

The TS return type is the literal union `-1 | 1`. Temper has no integer-literal types, so this
becomes a plain `Int` that only ever takes the values `-1` or `1`. The body mirrors the TS ternary
directly; there is no method on `Color` for this (it is geometry, not an intrinsic of the colour),
so unlike the other three helpers this one keeps its logic local. We branch on colour identity
against the canonical `White` singleton.

    export let forwardDir(color: Color): Int {
      if (color == White) { -1 } else { 1 }
    }

The TS "forwardDir is board-independent by color" case pins the two directions. The function takes
only a colour — no square, no board — which is exactly what "board-independent" means: the answer
depends on the side alone, so a pawn's advance direction never changes when it crosses a seam.

    test("forwardDir is board-independent by color (RULES.md §5)") {
      assert(forwardDir(White) == -1) { "white advances toward gy=0" };
      assert(forwardDir(Black) == 1) { "black advances toward gy=23" };
    }

With these four projections in place, downstream modules get the familiar free-function surface of
the TS `pieces.ts` while the underlying facts stay defined once, on the value vocabulary itself.
