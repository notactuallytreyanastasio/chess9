# Chess-9 — development report

A retrospective on building Chess-9 (a 3×3-board chess variant) from an empty directory to a tested,
single-file game with a rules revision in flight. Written as an honest log of how the work actually went,
including the parts that didn't go cleanly.

---

## What was asked for

A game: nine chess boards in a 3×3 grid, all live at once, with a rule that a piece can move to another
board if a piece of its own kind was captured there (a 1:1 replacement credit). Played for the most
checkmates. Strict TypeScript, functional core / imperative shell, no `any`, exhaustive contracts, vitest
everywhere, a non-trivial bot, responsive on mobile and desktop, and packageable as a single droppable file.
And: use a workflow.

## Clarify before building

The novel rule had real ambiguity, so the first move was questions, not code: which square a crossing
lands on, whose captured pieces unlock a crossing, how the match ends, and how to reconcile "strict tested
project" with "single droppable file." That last one resolved cleanly — build a real project and **bolt on
a bundler** that inlines everything into one HTML. The geometry resolved to a key insight from the user:
crossings aren't teleports; the nine boards are one continuous 24×24 plane and a piece slides across the
seam as a normal geometric move, gated by the credit.

That continuous-plane framing became the spine of the whole design.

## Design as a workflow

Rather than improvise the type model, three architect agents each proposed an architecture from a different
angle — type-safety-first, simplicity-first, novel-mechanics-first — and a judge synthesized one blueprint.
The decisions that mattered came out of that synthesis and held up:

- **Global plane is the single source of truth.** Per-board `(board, file, rank)` is a derived view. Sliding
  geometry runs once in 24×24 space, so seams are invisible by construction.
- **Count board crossings by per-step board-index change**, not per-axis seam count. This is the subtle one:
  a corner diagonal `(7,7) → (8,8)` enters the center board in a single step — one crossing, not two. The
  per-axis method would have wrongly rejected it.
- **Credits keyed by destination board, granted to the captured piece's owner.** Your lost bishop on a board
  buys *you* one bishop crossing into it.
- **Checkmate = in check and no legal move lands on the board** — so a credited cross-board defender counts
  automatically.

## Building it

Bottom-up, with tests written alongside each module and an atomic commit per layer: coordinates → pieces →
plane → ledger → rays → attack → move generation → reducer → legality → check → scoring → bot → UI → bundle.
Every commit ran `tsc + eslint + vitest`. The strict bar was enforced at three layers, not just intended:
strict tsconfig (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESLint making `any` a hard error,
and a bundle check that fails if the artifact references anything external.

The bot needed a course-correction for performance: a naive depth-2 search took ~2.2s/move because every node
re-ran the full legality pipeline. Refactoring to a search-internal apply (skip re-validation; only pay for
mate detection when a touched board is in check) plus a shallow-scan-then-deepen root brought it to ~80ms,
and later to a clean depth-3 at ~280ms.

## Where it got real: the corner-cutting reckoning

Two interventions from the user changed the tenor of the project for the better.

**Castling.** The synthesized blueprint had quietly deferred castling, and I let that ride without flagging it.
The user caught it — *"are you testing all the tricky stuff with castling"* — and was right to. Deferring a
core rule is a decision for them, not something to bury in a subagent's output. The honest response was to own
it, then go further: I gave a complete audit of **everything** that had been simplified or cut — not just
castling, but the `MoveError` variants that were declared but never produced, the bot defaulting below the
blueprint's spec, and a real termination gap where a game could run forever with lone kings. Then I fixed them:

- Castling, with the full tricky-case suite (out of / through / into check, including a piece that *just
  crossed onto* the board, king/rook-moved invalidation, blocked paths).
- Precise `MoveError` diagnostics — every rejection path now returns its specific reason.
- Draw and termination rules — insufficient material, a per-board 50-move clock, a hard ply cap.
- The bot brought to the blueprint's depth-3 with a real cross-threat lookahead.
- Bot-move highlighting — a pulsing ring on desktop, pan-and-zoom on mobile.

The lesson I took: surface the cut. A decision made silently, even a defensible one, reads as a decision
hidden.

## Adversarial review

With the implementation green (109 tests, ~99% core coverage, ~24KB single file), a read-only multi-agent
review swept the core: seven dimension reviewers, then an independent skeptic that tried to *refute* each
finding before it counted. It surfaced **27 verified issues including one critical**: because a side may
legally move elsewhere while in check, and legality only validated the mover's king on *touched* boards, move
generation could actually produce a move that **captures the enemy king** — after which the board silently
reverts to "active" and no win is scored. That's a genuine hole in the win condition that the test suite,
green as it was, did not catch. The review is attached to PR #1 as a review with inline comments.

This is the strongest argument for the whole exercise: a passing test suite proves the code does what the
tests imagined, not what the rules require. The adversarial pass imagined harder.

## Play, and a non-bug

The user played the single-file build and reported a pawn that "should" be able to capture across a seam but
couldn't. Investigated: it was a cross-board capture with no pawn credit on the destination board — the credit
rule working exactly as specified, not a bug. The real gap was UX: the game gives no way to *see* which credits
you hold or *why* a crossing is unavailable. That surfaced a genuine feature (a credit inventory display) and a
good question — *does the bot even know it can cross?* — answered with a quick proof: the engine is symmetric;
Black takes a cross-board capture the moment it holds a credit. It simply rarely holds one early.

## The rules revision (in flight)

The user then substantially **rewrote the geometry**, and this round we nailed down each ambiguity by
conversation before code:

1. **Crossings span many boards** — a slide is legal across any number of seams if the path is clear, with a
   credit required (and debited) for **every board entered**.
2. **Pawns cross straight**, and **any** pawn move that crosses a board border **always promotes**.
3. **Attacks aren't clipped at seams**, but cross-board **check is credit-backed** — a piece only checks across
   a seam if it actually holds the credits to cross in and capture (this overrode my initial "geometric" default;
   the user corrected it). Applies to all sliders.

Delivered as three sibling PRs off PR #1 (#2 multi-board crossings, #3 pawn-cross-and-promote, #4 credit-backed
cross-board check), each green on `tsc + eslint + vitest`, each individually reviewable.

### What didn't work: parallelism

The intent was to build these in parallel. It couldn't be done the clean way: the Workflow tool's git-worktree
isolation refused, because the harness decided at session start that this directory wasn't a git repo — true at
the time, since `git init` happened *after* the session began — and there was no `WorktreeCreate` hook fallback
configured. So the parallel run failed in 34ms having done nothing, and the work ran **sequentially** instead:
same three individual PRs, produced one after another. Worth noting parallelism would only have bought speed,
not clean merges — all three changes touch `types.ts`, `moveGen.ts`, and `reducer.ts`, so they're independently
*reviewable*, not independently *mergeable*.

## How the collaboration went

The pattern that worked: **clarify the genuinely ambiguous, default the conventional, and say which is which.**
The friction came entirely from the one time I broke that pattern — deferring castling silently. After that,
every decision (stalemate semantics, draw rules, the geometric-vs-credit-backed check question) went to the user
explicitly, and the back-and-forth got faster and better because of it. The user pushed hard on quality and was
right to; the adversarial review and the castling catch both improved the result materially.

## Where things stand

- **PR #1** — the full base implementation (0 → now), 14 atomic commits, with the adversarial review attached.
- **PR #2, #3, #4** — the rules revision as three green sibling PRs.
- **Open, by design:**
  - The critical **C1** king-capture/scoring bug and the related draw/scoring fixes (from the review) are *not*
    yet fixed — they were surfaced for decision, not silently patched.
  - The **credit-inventory UI** (board-map pips + a chip row) is designed and approved but not yet built.
  - Two rule decisions remain genuinely open only insofar as they affect the review fixes; the revision's
    semantics are now settled.

The honest one-line summary: the engine is thoroughly tested for the rules it was *told* to enforce, an
adversarial pass found where "tested" and "correct" diverge, and the rules themselves are still evolving — which
is exactly why the credit mechanic, the continuous-plane model, and the per-board status pipeline were built to
be changed without unraveling.
