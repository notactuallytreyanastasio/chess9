# The crossing-credit ledger — 1:1 capture replacement (RULES.md §4)

This module is the Temper port of `../../src/core/ledger.ts`. It models the **crossing-credit
ledger**, the bookkeeping behind the core mechanic of Chess-9: a piece may only enter a board
other than the one it started on if its owner *holds a crossing credit* of that piece's type for
that board, and executing such a move *spends one credit per board entered* (RULES.md §4, "the
credit rule"). Credits are **earned 1:1**: when one of your own pieces is captured on a board, you
gain one crossing credit of that piece's type *into that board* (RULES.md §4, "Earning credits" —
"if your bishop is captured on board 4, you may later bring one bishop across into board 4").

The ledger is the running tally of those credits. It answers three questions the move generator
and the reducer ask constantly: *how many* credits do I hold for a given `(board, color, type)`
slot, do I hold *any*, and the two mutations — *grant* one (a capture happened) and *debit* one (a
crossing was executed). Like every structure in the engine it is **immutable**: each mutation
returns a fresh ledger and leaves the input untouched, so search can try a crossing, recurse, and
discard the attempt without corrupting the position it came from.

## Why credits are keyed by `(board, color, type)`

A credit is owned by a *color*, scoped to a *board*, and typed by the *piece type* that may use
it. So the natural index is the triple `(board, color, type)`. RULES.md §4 makes the type axis a
strict subset: **"Kings never cross a seam."** A king credit is meaningless. The TS reference
encodes this in the type system — `CreditCounts = Record<CrossingType, number>` where
`CrossingType = Exclude<PieceType, 'king'>` — so a king slot literally cannot be named. The five
crossing types are pawn, knight, bishop, rook, queen.

## Designing the key: an Int-encoded flat map

The TypeScript ledger is a nested structure: `Ledger = ReadonlyArray<BoardCredits>` indexed by
board, each `BoardCredits = Record<Color, Record<CrossingType, number>>`. Three nested lookups.
Temper restricts `Map` keys to `String` and `Int` only (the porting cheat-sheet in
`../../temper_port/CLAUDE.md`: "Map keys are only `String`/`Int`"), and an `Int64` is *not* a
`MapKey`. So a nested `Map<Color, Map<...>>` is impossible — `Color` is a class, not a key type.

Two faithful options present themselves:

1. **Nested `List`s** mirroring the TS shape: `List<List<List<Int>>>` indexed `[board][color][type]`.
   Copy-on-write at three levels for every grant/debit. Structurally identical to TS, but verbose.
2. **A single flat `Map<Int, Int>`** under a deliberately-designed *Int-encoded* composite key —
   one integer that packs `(board, color, type)` into a unique slot id, mapping to the credit count.

We take option 2: it is the smallest, cheapest copy-on-write target (one map level, not three), it
sidesteps the `MapKey` restriction cleanly, and the encoding *is* the documentation of the index.
Absent keys mean "zero credits", which lets the empty ledger be the empty map — no need to
pre-populate all `9 × 2 × 5 = 90` slots, matching how the TS `creditCount` defaults missing entries
to `0` via `?? 0`.

The encoding. Each axis gets a small contiguous integer code, then we pack them positionally with a
mixed radix so every `(board, color, type)` lands on a distinct id:

- **board**: its `BoardIndex` value, `0..8`.
- **color**: `0` for White, `1` for Black.
- **type**: a crossing-type code `0..4` — pawn, knight, bishop, rook, queen. The king has *no*
  code; attempting to key a king is a programmer error, mirroring how the TS `CrossingType` simply
  cannot express it.

`slotKey = (board * 2 + colorCode) * 5 + typeCode`. With `board ∈ [0,9)`, `colorCode ∈ [0,2)`,
`typeCode ∈ [0,5)`, every slot occupies a unique id in `[0, 90)`. The factors `2` (colors) and `5`
(crossing types) are exactly the cardinalities of those axes, so the packing is dense and
collision-free.

First the color and crossing-type codes. We dispatch on the singleton identities from
[`types`](./types.temper.md) — `White`/`Black` and `Pawn`/`Knight`/`Bishop`/`Rook`/`Queen` — which
are already in lexical scope (the whole `src/` tree compiles into one library, so there is no
`import` line, exactly as [`pieces`](./pieces.temper.md) and [`plane`](./plane.temper.md) note).

The king deliberately has no slot. The TS `CrossingType` makes a king credit unrepresentable; in
Temper we cannot refuse it at the type level (the parameter is a full `PieceType`), so we encode
the §4 rule "kings never cross" as a **failure**: `typeCode` `bubble()`s on a king. A caller that
somehow tries to key a king credit gets a recoverable `Bubble`, never a silent wrong slot.

    let colorCode(color: Color): Int {
      if (color == White) { 0 } else { 1 }
    }

    let typeCode(type: PieceType): Int throws Bubble {
      if (type == Pawn) {
        0
      } else if (type == Knight) {
        1
      } else if (type == Bishop) {
        2
      } else if (type == Rook) {
        3
      } else if (type == Queen) {
        4
      } else {
        bubble()
      }
    }

The composite key packs the three codes. It takes the already-decoded `BoardIndex` value and the
two codes, and `throws Bubble` only via `typeCode` upstream (here the inputs are plain Ints).

    let slotKey(board: BoardIndex, colorCode: Int, typeCode: Int): Int {
      (board.value() * 2 + colorCode) * 5 + typeCode
    }

## The `Ledger` type

The TS `Ledger` is a `ReadonlyArray<BoardCredits>`; here it is a thin immutable wrapper around the
flat `Map<Int, Int>`. Wrapping (rather than passing a bare `Map` around) gives the ledger a nominal
identity matching the TS `Ledger` type, and a home for the credit operations as methods. The map is
private; the only ways to read it are `creditCount`/`hasCredit`, and the only ways to derive a new
one are `grant`/`debit`, preserving the "absent key = zero" and immutability invariants.

    export class Ledger(private credits: Map<Int, Int>) {

`creditCount` — how many credits for this slot. The TS reads `ledger[board]?.[color][type] ?? 0`,
defaulting any missing path to `0`. Our analogue keys the flat map and uses `getOr(key, 0)`, so a
slot never granted reads as `0`. The king case is handled up front: `typeCode` bubbles on a king,
which `orelse -1` turns into a sentinel we guard on, returning `0` — a king can hold no crossing
credits, so "how many" is always zero for a king.

      public creditCount(board: BoardIndex, color: Color, type: PieceType): Int {
        let tc = typeCode(type) orelse -1;
        if (tc < 0) {
          0
        } else {
          credits.getOr(slotKey(board, colorCode(color), tc), 0)
        }
      }

`hasCredit` — is there at least one. Identical to the TS `creditCount(...) > 0`.

      public hasCredit(board: BoardIndex, color: Color, type: PieceType): Boolean {
        creditCount(board, color, type) > 0
      }

`grant` — earn one credit (RULES.md §4, "Earning credits"). One of `color`'s pieces of `type` was
captured on `board`, so `color` gains one crossing credit into that board. The TS `grantCredit`
copies the board record and bumps the count by one; here we copy the map, bump the slot, and wrap a
fresh `Ledger`. A king grant is a no-op: `typeCode` yields the `-1` sentinel, the guard fires, and
we return the ledger unchanged rather than corrupt an unrelated slot. (In practice §4/§7 guarantee
kings are never captured, so this branch is unreachable in legal play — it is defensive, mirroring
the way TS `CrossingType` makes it impossible by construction.)

      public grant(board: BoardIndex, color: Color, type: PieceType): Ledger {
        let tc = typeCode(type) orelse -1;
        if (tc < 0) {
          this
        } else {
          let key = slotKey(board, colorCode(color), tc);
          let next = credits.toMapBuilder();
          next.set(key, credits.getOr(key, 0) + 1);
          new Ledger(next.toMap())
        }
      }

`debit` — spend one credit. RULES.md §4: "Executing the move spends one credit per board entered."
This is the one operation that can *fail*: you cannot spend a credit you do not hold. The TS
reference returns a `Result<Ledger, 'no-credit'>` and the caller checks `.ok`. Per the porting
cheat-sheet ("`Result<T,E>` → `throws Bubble`"), the Temper signature is `Ledger throws Bubble`:
on no credit it `bubble()`s (the single error case `'no-credit'` collapses to a bubble, since the
reason carries no extra data), and the caller recovers with `orelse`. On success it returns a fresh
ledger with the slot decremented by one — down to a real zero, never negative.

      public debit(board: BoardIndex, color: Color, type: PieceType): Ledger throws Bubble {
        let key = slotKey(board, colorCode(color), typeCode(type));
        let current = credits.getOr(key, 0);
        if (current <= 0) { bubble() }
        let next = credits.toMapBuilder();
        next.set(key, current - 1);
        new Ledger(next.toMap())
      }
    }

Note `debit` keys with a bare `typeCode(type)` (no `orelse`): a king has no slot to debit, so a
king debit *should* fail, and letting the `typeCode` bubble propagate gives exactly that — the same
"no credit" outcome as an empty slot.

## The free-function surface

The TS module exports `emptyLedger`, `creditCount`, `hasCredit`, `grantCredit`, and `debitCredit`
as standalone functions over a `Ledger` value. We keep that surface so a downstream port reads the
same way, delegating to the methods above.

`emptyLedger` — a ledger holding no credits at all. The TS builds nine zeroed board records; ours
is simply the empty map, since absent keys read as zero. This is the §4 starting state: at the
opening no piece has been captured, so no crossing is yet possible.

    export let emptyLedger(): Ledger {
      new Ledger(new Map<Int, Int>([]))
    }

    export let creditCount(ledger: Ledger, board: BoardIndex, color: Color, type: PieceType): Int {
      ledger.creditCount(board, color, type)
    }

    export let hasCredit(ledger: Ledger, board: BoardIndex, color: Color, type: PieceType): Boolean {
      ledger.hasCredit(board, color, type)
    }

    export let grantCredit(ledger: Ledger, board: BoardIndex, color: Color, type: PieceType): Ledger {
      ledger.grant(board, color, type)
    }

`debitCredit` carries the fallibility through: `Ledger throws Bubble`, the replacement for the TS
`Result<Ledger, 'no-credit'>`.

    export let debitCredit(
      ledger: Ledger, board: BoardIndex, color: Color, type: PieceType
    ): Ledger throws Bubble {
      ledger.debit(board, color, type)
    }

## Tests — porting the vitest suite

The tests below mirror `../../src/core/ledger.test.ts` one-to-one. A small helper mints a
`BoardIndex` the way the TS test's `board(n)` does, via the [`coords`](./coords.temper.md) smart
constructor (`mkBoardIndex` `throws Bubble`; a known-good index recovers with `panic()`).

    let board(n: Int): BoardIndex {
      mkBoardIndex(n) orelse panic()
    }

**A fresh ledger holds nothing.** Pins the §4 opening state: no captures yet, so every slot reads
zero and `hasCredit` is false everywhere.

    test("ledger starts empty") {
      let l = emptyLedger();
      assert(!hasCredit(l, board(0), White, Bishop)) { "no white-bishop credit on board 0" };
      assert(creditCount(l, board(4), Black, Queen) == 0) { "no black-queen credit on board 4" };
    }

**Grant hits exactly the targeted slot.** This is the isolation invariant: the Int-encoded key must
be collision-free across the `(board, color, type)` axes, so granting white-bishop-on-4 must leave
white-knight-on-4, black-bishop-on-4, and white-bishop-on-3 all at zero. This is the test that the
key packing is sound.

    test("grant targets exactly the [board][color][type] slot") {
      let l = grantCredit(emptyLedger(), board(4), White, Bishop);
      assert(creditCount(l, board(4), White, Bishop) == 1) { "the targeted slot is 1" };
      assert(creditCount(l, board(4), White, Knight) == 0) { "different type untouched" };
      assert(creditCount(l, board(4), Black, Bishop) == 0) { "different color untouched" };
      assert(creditCount(l, board(3), White, Bishop) == 0) { "different board untouched" };
    }

**Debit reaches a true zero.** Grant one, debit it, and the slot is back to a real `0` (not
negative, not absent-but-wrong). Mirrors the TS "debits down to a real zero" case; the TS unwraps
`d.ok`, here we `orelse panic()` on the known-good debit.

    test("debit brings a granted slot back to zero") {
      let l = grantCredit(emptyLedger(), board(2), Black, Rook);
      let d = debitCredit(l, board(2), Black, Rook) orelse panic();
      assert(creditCount(d, board(2), Black, Rook) == 0) { "slot is a real zero after debit" };
    }

**Debit refuses when empty.** The no-double-spend invariant and the §4 "spends one credit per board
entered" rule's precondition: you cannot spend what you do not hold. The TS returns `{ok:false,
error:'no-credit'}`; here `debitCredit` `bubble()`s, which we detect by recovering to a sentinel.

    test("debit refuses when no credit is held") {
      var refused = false;
      let d = debitCredit(emptyLedger(), board(0), White, Pawn) orelse do {
        refused = true;
        emptyLedger()
      };
      assert(refused) { "debiting an empty slot bubbles (no-credit)" };
    }

**Mutations never touch the input ledger.** Copy-on-write: granting against `l` returns a new
ledger and leaves `l` itself empty. This is what makes the ledger safe for speculative search.

    test("grant does not mutate the input ledger") {
      let l = emptyLedger();
      let after = grantCredit(l, board(0), White, Queen);
      assert(creditCount(l, board(0), White, Queen) == 0) { "original ledger unchanged" };
      assert(creditCount(after, board(0), White, Queen) == 1) { "derived ledger has the credit" };
    }

**No double-spend across two debits.** A reinforcing case beyond the TS suite: grant exactly one,
debit it once (succeeds), then a second debit of the same slot must bubble. This nails that a
credit is spent exactly once — the heart of the 1:1 §4 accounting.

    test("a single credit cannot be spent twice") {
      let one = grantCredit(emptyLedger(), board(5), White, Knight);
      let spent = debitCredit(one, board(5), White, Knight) orelse panic();
      assert(creditCount(spent, board(5), White, Knight) == 0) { "first debit succeeds" };
      var refused = false;
      let again = debitCredit(spent, board(5), White, Knight) orelse do {
        refused = true;
        spent
      };
      assert(refused) { "the same credit cannot be debited a second time" };
    }
