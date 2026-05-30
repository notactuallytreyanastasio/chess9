# Chess-9

A chess variant played on a **3×3 grid of standard 8×8 boards** that together form one
continuous **24×24 plane**. All nine games are live at once, players share a single turn,
and pieces can **cross between boards** by spending replacement credits earned from their
own captured pieces. **Most boards checkmated wins.**

Built as a strict-TypeScript **functional core / imperative shell**, fully unit-tested with
vitest, and bundled into **one self-contained `dist/index.html`** you can drop anywhere
(including as a Claude artifact) — zero external requests.

---

## Rules

1. **Nine boards, one plane.** The 9 boards tile a continuous 24×24 surface. Board borders
   are invisible to geometry — a bishop on the right file of one board glides straight onto
   the neighbouring board on the same diagonal.
2. **All boards active, shared turn.** Each board is its own game with its own two kings.
   A turn is one move on *any* board; players alternate (you are White, the bot is Black).
3. **Crossing rule.** A move may cross **at most one** board boundary, and only if one of
   **your own** pieces of the **same type** was previously captured on the board being
   entered. This is a **1:1 replacement credit** — one captured bishop buys exactly one
   bishop crossing into that board, consumed when used. The path must still be a legal,
   unobstructed move.
4. **Pieces & crossings.** Knights cross via their L-jump (knight credit); pawns cross only
   via a diagonal **capture** onto the neighbour (pawn credit); pawns never push across a
   seam. **Kings never cross** — they are board-bound, which keeps per-board checkmate
   well-defined. Castling is supported (within a board, standard rules).
5. **Freezing & scoring.** A checkmated board freezes and scores for the mater. Stalemate,
   insufficient material, and a per-board 50-move clock freeze a board as a **draw**
   (unscored). When every board is frozen (or a hard ply cap is reached), whoever has the
   **most checkmates** wins.

## Design decisions worth knowing

These were genuine rule ambiguities in the variant; the choices made are:

- **Per-board stalemate is a draw** — a board with no legal move touching it (and not in
  check) freezes as a draw, even if the player has moves on other boards.
- **Promotion** happens on the far rank of the board the pawn is on (a pushing pawn can't
  cross a seam, so that rank is the end of the line).
- **En passant** may itself cross a seam if gated by a pawn credit.
- **Termination** is guaranteed by three rules: insufficient-material draw (bare kings or
  K + single minor), a per-board 50-move (100-ply) clock, and an absolute ply cap.

## The bot

Alpha-beta negamax (default depth 3), run in-game on the main thread (a move takes roughly
0.3–3s). A cheap depth-1 scan ranks every root move so tactics always surface, then the
most promising are searched to full depth; interior nodes are beam-pruned. Evaluation =
checkmate progress (dominant) + material + mobility + king-in-check pressure +
**cross-threat** (credits that enable a crossing which checks the enemy king or wins
material). A seeded PRNG only breaks ties between equally-scored moves, so it never plays
randomly. After it moves, the destination is highlighted with a pulsing ring (desktop) or a
pan-and-zoom (mobile).

---

## Architecture

```
src/core/   PURE functional core — total, deterministic, no DOM/Date/Math.random,
            the only tree under coverage. Illegal states are unrepresentable:
            coordinates are branded and minted only by Result-returning smart
            constructors; every transition flows through one immutable reducer.

  brand, result, types, constants   primitives & strong contracts
  coords, pieces, plane, ledger     coordinate authority, occupancy, credit ledger
  rays, attack                      plane geometry & per-board attack detection
  moveGen                           pseudo-legal moves (crossings, pawns, castling)
  legal, check, reducer             legality filter, check/mate, the applyMove reducer
  draws, scoring                    draw/termination rules, win condition
  eval, bot, rng                    evaluation, alpha-beta search, seeded PRNG
  index.ts                          public API barrel

src/ui/     IMPERATIVE shell (the only place with DOM / real RNG seed / mutable ref).
  store, render, glyphs, main, styles.css
```

## Develop

```bash
npm install
npm test            # vitest (109 cases)
npm run coverage    # core coverage (>99% statements)
npm run typecheck   # strict tsc, no emit
npm run lint        # eslint — bans `any` and type-assertion escape hatches
npm run dev         # vite dev server
npm run bundle      # build + verify the single self-contained dist/index.html
```

The strict requirements are enforced at three layers: `tsconfig` (strict +
`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`), ESLint (hard error on `any`),
and a bundle check that fails if `dist/index.html` references any external resource.

## Ship it

```bash
npm run bundle
# -> dist/index.html : one file, no external requests, opens by double-click.
```
