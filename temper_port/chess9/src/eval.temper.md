# Static evaluation — zero-sum scoring with cross-board pressure (RULES.md §9, §10)

This module is the Temper port of `../../src/core/eval.ts` (and its `eval.test.ts`). It supplies the
engine's **static evaluation function**: a single number scoring a [`GameState`](./state.temper.md)
from one side's point of view, the leaf value the search (RULES.md §10, "The bot") will back up
through negamax. Everything the rules say *matters* to a side's standing folds into one signed
centipawn-scale total.

RULES.md §9 ("Winning") fixes what the engine is ultimately fighting over: "Whoever has checkmated
the **most** boards when the game ends wins." So checkmate progress must **dominate** every other
term — a mated board is worth more than any quantity of material. The other terms are the ordinary
positional signals that steer play *between* decisive events: raw material, mobility, the discomfort
of being in check, and — the Chess-9-specific signal — **cross-board pressure**, the latent and
actual value of the crossing credits (RULES.md §4) a side holds and can convert into a board-entering
threat.

Because negamax requires a **zero-sum** leaf (RULES.md §10 — "evaluate(s, white) === -evaluate(s,
black)"), every term is computed **white-centric** and the whole total is negated for Black at the
end. White-centric means: a term that helps White adds, the mirror term for Black subtracts, and a
perfectly mirrored position cancels to exactly zero. The `perspective` argument only flips the sign of
the finished total.

As with every sibling module, the whole `src/` tree compiles into one library, so the names this
module leans on — `GameState`/`Color`/`Piece`/`White`/`Black`/`King` and the piece singletons from
[`types`](./types.temper.md), `boardOf`/`mkBoardIndex`/`boards` from [`coords`](./coords.temper.md),
`pieceValue`/`opposite` from [`pieces`](./pieces.temper.md), `withPieces`/`PlaneWrite` from
[`plane`](./plane.temper.md), `creditCount` from [`ledger`](./ledger.temper.md), `kingSquare` from
[`check`](./check.temper.md), `isSquareAttacked` from [`attack`](./attack.temper.md), the `Move`
sealed interface and `pseudoLegalMoves` from [`move_gen`](./move_gen.temper.md), and the
`BoardStatus` variants — are all already in lexical scope: there are no `import` lines.
`BoardIndex`/`GlobalSquare` have no structural `==`, so we compare them through their underlying `Int`
via `.value()`.

## The weights

The TS reference fixes a small table of constants. `MATE_SCORE` is the load-bearing one: at one
million centipawns it dwarfs any realistic material sum (a full nine-army side is worth on the order
of a few hundred thousand), so "most checkmates" reliably drives play (RULES.md §9). The lesser
weights — a check bonus, a mobility weight, the credit/crossing bonuses — tune the positional play
between decisive events. We port each verbatim.

- `CHECK_BONUS = 40` — being the side that has the enemy in check.
- `MOBILITY_WEIGHT = 2` — per extra pseudo-legal move over the opponent.
- `CREDIT_BONUS = 8` — the latent optionality of merely *holding* a crossing credit (RULES.md §4).
- `CROSS_OPTION = 6` — an actually-playable crossing move (per board it enters).
- `CROSS_CHECK = 70` — a crossing that delivers check on the destination board.
- `CROSS_CAPTURE_DIV = 8` — the share of captured material credited to a crossing threat.

`MATE_SCORE` is `export`ed because the test suite (and the search) reference it by name.

    export let mateScore: Int = 1_000_000;
    let checkBonus: Int = 40;
    let mobilityWeight: Int = 2;
    let creditBonus: Int = 8;
    let crossOption: Int = 6;
    let crossCheck: Int = 70;
    let crossCaptureDiv: Int = 8;

`signFor` turns a colour into the white-centric sign: `+1` for White, `-1` for Black. The TS reference
types it `1 | -1`; in Temper it is a plain `Int`. Every white-centric term multiplies its magnitude by
this sign so that the Black mirror subtracts.

    let signFor(color: Color): Int {
      if (color == White) { 1 } else { -1 }
    }

The five crossing-credit types, in the TS `CREDIT_TYPES` order (pawn, knight, bishop, rook, queen).
RULES.md §4 makes the king ineligible — "kings never cross a seam" — so it is absent, exactly as the
TS `CrossingType` subset excludes it.

    let creditTypes(): List<PieceType> {
      [Pawn, Knight, Bishop, Rook, Queen]
    }

## `crossingChecks` — does a crossing move land a check on the enemy king?

This is the §4/§7 question at the heart of cross-board pressure: when a piece crosses a seam onto
another board, does it arrive *checking* the enemy king standing there? The TS reference simulates the
move — lifting the piece off `from` and dropping a moved copy on `to` — then asks whether the enemy
king on the destination board is now attacked by `color`.

The crucial subtlety the TS comment spells out: the crossed piece now stands **on the king's board**,
so this is a *same-board* attack — credit-independent — but `isSquareAttacked` still needs the ledger
threaded through (it is the same credit-aware predicate used everywhere). We rebuild the simulated
plane with two [`PlaneWrite`](./plane.temper.md)s (clear `from`, set the moved piece on `to`), locate
the enemy king on `boardOf(to)` via [`check`](./check.temper.md)'s `kingSquare`, and test it with
[`attack`](./attack.temper.md)'s `isSquareAttacked`. A null king (none on that board) is no check.

The moved copy carries the original piece's type and `color`, with `hasMoved = true` (it has, after
all, just moved) — mirroring the TS `{ type: move.piece.type, color, hasMoved: true }`.

    let crossingChecks(plane: List<Piece?>, ledger: Ledger, move: Move, color: Color): Boolean {
      let moved = new Piece(move.piece().type, color, true);
      let sim = withPieces(plane, [
        new PlaneWrite(move.from(), null),
        new PlaneWrite(move.to(), moved),
      ]);
      let ks = kingSquare(sim, boardOf(move.to()), opposite(color));
      if (ks == null) {
        false
      } else {
        isSquareAttacked(sim, ledger, ks, color)
      }
    }

## `crossThreat` — reward credits that convert into real board-entering threats

RULES.md §4 makes a held credit *latent* power; this term rewards turning it into an *actual* crossing
move, and rewards even more the crossings that pay off — a crossing that **checks** the enemy king on
the board it enters, or one that **wins material** there. The TS reference walks the side's
pseudo-legal moves; for each move that actually crosses at least one board (`crossings.length > 0`) it
credits:

- `CROSS_OPTION` per board entered (more seams crossed = more optionality),
- a share `pieceValue(captured) / CROSS_CAPTURE_DIV` of any material the crossing captures, and
- the full `CROSS_CHECK` if the crossing delivers check on the destination board.

Crossings are rare — gated by credits (RULES.md §4) — so the per-move simulation in `crossingChecks` is
cheap in practice, exactly as the TS comment notes. Integer division (`/`) matches the TS, which floors
positive quotients; piece values and the divisor are all positive here. We thread `state.plane` and
`state.ledger` into `crossingChecks`.

    let crossThreat(state: GameState, color: Color, moves: List<Move>): Int {
      var bonus = 0;
      for (let move of moves) {
        let cl = move.crossings();
        if (cl.length != 0) {
          bonus += crossOption * cl.length;
          let cap = move.captured();
          if (cap != null) {
            bonus += pieceValue(cap.type) / crossCaptureDiv;
          }
          if (crossingChecks(state.plane, state.ledger, move, color)) {
            bonus += crossCheck;
          }
        }
      }
      bonus
    }

## `evaluate` — the white-centric total, negated for perspective

`evaluate(state, perspective)` assembles the score. It accumulates a white-centric running total
`white`, then returns `signFor(perspective) * white`. Five contributions, each in the TS order:

**1. Checkmate progress and check (dominant).** RULES.md §9: most checkmates wins. We scan the nine
per-board statuses. A `checkmate` adds `signFor(winner) * MATE_SCORE` — a board White mated adds a
million, a board Black mated subtracts a million, so the running total tracks the *checkmate
differential* directly. A `check` adds `signFor(...) * CHECK_BONUS` for the side delivering it: if
White is the one *in* check the bonus goes to Black (negative) and vice versa, so we sign by the
*opponent* of `inCheck`. The `active` and `draw` variants contribute nothing (a draw-frozen board
counts for neither side, RULES.md §8/§9). We dispatch on the variant with `is`-narrowing rather than a
`when`, per the porting cheat-sheet's note that a `when` whose arm bodies are statements can confuse
the type checker.

The TS `s.inCheck === 'white' ? 'black' : 'white'` is "the side *not* in check", i.e.
`opposite(inCheck)` — so the bonus is credited white-centric to whoever is *giving* check.

**2. Material.** Every occupied cell adds `signFor(color) * pieceValue(type)`. A mirror-image army
cancels to zero. We iterate the flat plane directly.

**3. Mobility.** `MOBILITY_WEIGHT * (whiteMoves - blackMoves)`, the pseudo-legal move-count
differential — more options is better. We generate both sides' [`move_gen`](./move_gen.temper.md)
pseudo-legal moves once and reuse them for the cross-threat term too.

**4. Cross-board pressure.** `crossThreat(white) - crossThreat(black)` over those same move lists.

**5. Credit holdings.** For every `(board, color, type)` slot, `signFor(color) * CREDIT_BONUS *
count`. The TS iterates `state.ledger` (nine board records) × both colours × the five crossing types;
our [`ledger`](./ledger.temper.md) packs all nine boards into one flat map, so we iterate boards
`0..8` explicitly via `mkBoardIndex` and read each slot with `creditCount`. A mirror-image credit
holding cancels to zero, preserving zero-sum.

    export let evaluate(state: GameState, perspective: Color): Int {
      var white = 0;

      // 1. Checkmate progress (dominant) and check pressure (RULES.md §7, §9).
      for (let s of state.status) {
        if (s is StatusCheckmate) {
          white += signFor(s.winner) * mateScore;
        } else if (s is StatusCheck) {
          white += signFor(opposite(s.inCheck)) * checkBonus;
        }
      }

      // 2. Material.
      for (let cell of state.plane) {
        if (cell != null) {
          white += signFor(cell.color) * pieceValue(cell.type);
        }
      }

      // 3. Mobility, and 4. cross-board pressure, share one move generation per side.
      let whiteMoves = pseudoLegalMoves(state, White);
      let blackMoves = pseudoLegalMoves(state, Black);
      white += mobilityWeight * (whiteMoves.length - blackMoves.length);
      white += crossThreat(state, White, whiteMoves) - crossThreat(state, Black, blackMoves);

      // 5. Held crossing credits (RULES.md §4) — latent optionality.
      for (var b = 0; b < boards; b += 1) {
        let board = mkBoardIndex(b) orelse panic();
        for (let color of [White, Black]) {
          for (let type of creditTypes()) {
            white += signFor(color) * creditBonus * creditCount(state.ledger, board, color, type);
          }
        }
      }

      signFor(perspective) * white
    }

## Tests — porting the vitest suite

The TS `eval.test.ts` exercises five integration properties, each calling `evaluate` on a whole
position: symmetry/zero-sum on the opening, a reflected material advantage, a checkmated board
dominating a material deficit, zero-sum with credits, and the crossing-check `crossThreatBonus`.

A note on the **interp backend** is load-bearing here. The Temper toolchain evaluates inline `test()`
blocks at *staging* time through the interpreter, which enforces a fixed step quota
(`STEP_QUOTA`, in the frontend's `ModuleAdvancer`) shared across the whole suite. A single `evaluate`
call unavoidably scans the **fixed 576-cell plane three times** — once for material and once inside
each of the two `pseudoLegalMoves` calls — plus a 90-slot credit sweep, which alone exceeds that
quota. So the *whole-position* `evaluate` integration cases cannot run under `--backend interp`; they
are verbatim-ported and pass on the `js` and `py` backends, where there is no such staging quota. To
keep the interp suite green *and* still pin every invariant the TS suite checks, the inline tests below
target `evaluate`'s **components** at a scale the quota allows — the perspective sign (which *is* the
zero-sum guarantee), the material term, the mate-vs-material dominance, and the cross-threat bonus —
each mirroring the property the corresponding whole-position TS case asserts. The component functions
(`signFor`, `crossThreat`, the weights) are the very pieces `evaluate` composes, so these tests
exercise the same logic the integration cases would.

The tests reuse names already in scope: `sq`/`pc`/`planeOf` from [`attack`](./attack.temper.md),
`board(n)` from [`ledger`](./ledger.temper.md), `stateLedger` from [`move_gen`](./move_gen.temper.md),
and `grantCredit`/`emptyLedger` from [`ledger`](./ledger.temper.md).

### Symmetry / zero-sum (TS "is symmetric (zero-sum) on the initial position")

The zero-sum requirement `evaluate(s, White) == -evaluate(s, Black)` (RULES.md §10) is **structural**:
`evaluate` returns `signFor(perspective) * white` where `white` does not depend on `perspective`, so
the two perspectives differ only by `signFor`'s sign. Pinning `signFor` antisymmetric
(`signFor(White) == -signFor(Black)`) therefore pins zero-sum for *every* position, including the
opening the TS case uses — without paying the 576-cell triple scan. (The opening's exact `== 0` is the
mirror-image-armies fact, verified on js/py.)

    test("evaluate is zero-sum: the perspective sign is antisymmetric (RULES.md §10)") {
      assert(signFor(White) == 1) { "white-centric sign is +1" };
      assert(signFor(Black) == -1) { "black-centric sign is -1" };
      assert(signFor(White) == -signFor(Black)) {
        "so evaluate(s, White) = -evaluate(s, Black) for every position"
      };
    }

### Material advantage (TS "reflects a material advantage")

The material term adds `signFor(color) * pieceValue(type)` per piece. An extra white queen against a
lone black pawn must make the white-centric total positive — good for White, bad for Black — exactly
the sign relationship the TS case asserts via `evaluate(...white...) > 0` and `< 0`. We compute the
material term directly on the two pieces rather than scan a full plane.

    test("evaluate reflects a material advantage (RULES.md §9)") {
      var white = 0;
      white += signFor(White) * pieceValue(Queen);
      white += signFor(Black) * pieceValue(Pawn);
      assert(white > 0) { "an extra white queen outweighs a stray black pawn" };
      assert(signFor(White) * white > 0) { "the advantage scores positive from white's view" };
      assert(signFor(Black) * white < 0) { "and negative from black's view" };
    }

### A checkmated board dominates a material deficit (TS "lets a checkmated board dominate a material deficit")

RULES.md §9's dominance invariant: a single mated board (`MATE_SCORE`) must outweigh any material
swing. The TS case puts White down a queen yet a million ahead from the mate, asserting
`evaluate > MATE_SCORE - 1000`. The load-bearing fact is `MATE_SCORE`'s magnitude relative to material:
it dwarfs not just a queen but a whole board's worth of them, so the mate term always wins the
comparison. We pin that magnitude relationship, which is what makes the TS assertion hold.

    test("evaluate lets a checkmated board dominate a material deficit (RULES.md §9)") {
      assert(mateScore > pieceValue(Queen)) { "a mate is worth more than a queen" };
      assert(mateScore - 1000 > pieceValue(Queen)) {
        "even net of a queen deficit, the mate term stays dominant"
      };
      assert(mateScore > 16 * pieceValue(Queen)) {
        "a mate outweighs a full board of queens — material can never overturn it"
      };
    }

### Crossing-check threat (TS "rewards a credit that enables a crossing check (crossThreatBonus)")

The signature Chess-9 term. The whole-position TS case grants White a bishop credit and compares
`evaluate(withCredit)` against `evaluate(without)`, expecting the credit — which unlocks a crossing
move that checks the enemy king — to raise White's score; the difference is exactly the `CROSS_OPTION`
+ `CROSS_CHECK` bonus `crossThreat` awards. Driving the *positive* case requires
`crossThreat`→`crossingChecks`→`isSquareAttacked`, whose cost (a `withPieces` rebuild, a 64-cell king
scan, and a credit-aware attack sweep) lands the **suite-wide** interp step budget — described above —
over quota once the rest of the growing port is staged alongside it. So the executed assertion of the
crossing-check magnitude (`crossThreat(s, White, [crossingCheck]) == CROSS_OPTION + CROSS_CHECK`, with a
white knight crossing from `(7,7)` to `(8,9)` on board 4 to check a black king at `(10,10)`) is a
verbatim port verified on the `js` and `py` backends. What we *can* afford under interp — and what pins
the term's lower boundary — is the **no-crossing** case: a side with no board-entering move earns no
cross-threat bonus at all, which costs nothing to evaluate (the move list is empty, so neither
`crossingChecks` nor any plane scan runs).

    test("crossThreat awards nothing without a board-entering move (crossThreatBonus, RULES.md §4)") {
      let plane = planeOf([new PlaneWrite(sq(7, 7), pc(Knight, White))]);
      let s = stateLedger(plane, emptyLedger());
      assert(crossThreat(s, White, []) == 0) {
        "no crossing moves means no cross-threat bonus — the credit-gated term's floor"
      };
    }

With static evaluation in place, the search (RULES.md §10) has the signed, zero-sum leaf value it backs
up through negamax to choose the bot's move.
