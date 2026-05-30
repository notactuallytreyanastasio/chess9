# Deterministic RNG — mulberry32, for tie-breaks only

This module is the Temper port of `../../src/core/rng.ts`. It supplies the single source of
randomness the engine is allowed to touch: a small, fast, **deterministic** PRNG used *only* to
break ties among equally-scored moves.

The rule it serves is `../../RULES.md` **§10 (The opponent / bot)**: the bot "only randomises among
*equally* scored moves, so it never plays a random move among unequal ones." For that to be sound the
randomness must be a pure function of an injected seed — given the same seed the bot must make the
same choices, so games are reproducible and testable. The RNG therefore carries no global state; it
is threaded in explicitly, exactly as the TS core threads a `Rng` value into `chooseMove`.

## The `Rng` shape

The TS reference (`../../src/core/types.ts`) declares the injection point as an interface:

```ts
export interface Rng {
  next(): number; // [0, 1)
}
```

In Temper this becomes a `sealed interface` with a single `next()` method returning a `Float64` in
the half-open interval `[0, 1)`. Sealing it documents that the engine has exactly one RNG
implementation (`mulberry32` below) — there is no expectation of third-party subclasses; the seam
exists purely to keep the core pure and the tie-break source swappable in tests.

    export sealed interface Rng {
      public next(): Float64;
    }

## mulberry32, and why Int32 wrapping replaces the `>>> 0` / `Math.imul` dance

The TS body is the classic mulberry32 generator:

```ts
export const makeRng = (seed: number): Rng => {
  let a = seed >>> 0;
  return {
    next: (): number => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
};
```

Every awkward operator in that TS is there to *force JavaScript's Float64 numbers to behave like
32-bit integers*:

- `| 0` after `a + 0x6d2b79f5` truncates the sum back into a signed 32-bit value — JavaScript
  would otherwise keep accumulating in Float64 and lose the low bits.
- `Math.imul(x, y)` is "multiply as 32-bit integers, keep the low 32 bits, wrapping on overflow" —
  a primitive that exists *only* because the plain `*` operator on JS numbers is Float64 multiply.

Temper's `Int` is `Int32` and, per the porting cheat-sheet, **`Int32` wraps on overflow**. That is
precisely the semantics those TS contortions are emulating, so the port is *more direct than the
original*:

- `(a + 0x6d2b79f5) | 0` → plain `a + 0x6d2b79f5`. The `+` is already a wrapping 32-bit add; the
  `| 0` was a no-op-shaped truncation we no longer need.
- `Math.imul(x, y)` → plain `x * y`. Int32 `*` keeps the low 32 bits and wraps, which is the
  definition of `imul`.
- `a >>> 15`, `t >>> 7`, `t >>> 14` → `a >>> 15`, etc. Temper has the same unsigned-right-shift
  operator on `Int32`.
- `^`, `|` on the masks (`1 | a`, `61 | t`) port verbatim — they are bitwise ops on Int32.

The one place the bit-width difference still shows is the final step. TS does
`((t ^ (t >>> 14)) >>> 0) / 4294967296`: the `>>> 0` reinterprets the 32-bit result as an *unsigned*
value in `0 .. 2^32 - 1` before dividing by `2^32` to land in `[0, 1)`. Temper's `Int32` is signed,
so the top-bit-set values that TS sees as large positive numbers are negative here. We restore the
unsigned reading explicitly: if the Int32 is negative, add `2^32` to its Float64 value. (`4294967296`
is `2^32`; `2147483648.0` is `2^31`, the threshold whose set sign bit means "negative when signed.")

One Temper-specific wrinkle: `/` **bubbles** on a zero divisor (it does not produce `Infinity`/`NaN`
like JavaScript), so `x / 4294967296.0` would force `next()` to declare `throws Bubble` even though
the divisor is a non-zero constant. We sidestep that by multiplying by the precomputed reciprocal
`INV_2_32 = 1 / 2^32` instead — multiplication never bubbles, so `next()` stays total.

    let toUnsignedFloat(bits: Int): Float64 {
      let f = bits.toFloat64();
      if (f < 0.0) { f + 4294967296.0 } else { f }
    }

`makeRng(seed)` mints the generator. The TS `let a = seed >>> 0` (reinterpret the seed as unsigned)
is unnecessary for our purposes: `a` is only ever fed back through the same wrapping arithmetic, and
the bit pattern of `seed` is what matters, not its signed/unsigned reading — the very first step
adds `0x6d2b79f5` and mixes. So we keep `a` as a plain mutable `Int`. The closure-with-mutable-`a`
of the TS becomes a small class holding the state in a `var` field, which is the Temper idiom for a
stateful object behind an interface.

    let INV_2_32 = 2.3283064365386963e-10;

    export class Mulberry32(private var a: Int) extends Rng {
      public next(): Float64 {
        a = a + 0x6d2b79f5;
        var t = (a ^ (a >>> 15)) * (1 | a);
        t = (t + ((t ^ (t >>> 7)) * (61 | t))) ^ t;
        toUnsignedFloat(t ^ (t >>> 14)) * INV_2_32
      }
    }

    export let makeRng(seed: Int): Rng { new Mulberry32(seed) }

## Tests

There is no `rng.test.ts` in the TS reference — the generator is exercised indirectly through the
bot's determinism tests (`../../src/core/bot.test.ts`: "is deterministic given the same seed"). We
pin the two properties those downstream tests depend on directly here.

### Determinism: same seed → same sequence

The load-bearing property for §10. Two generators created from the same seed must emit byte-for-byte
identical sequences; otherwise "randomise only among equal moves" would still make the bot
non-reproducible. We also check that a *different* seed diverges, so the generator is actually using
the seed rather than ignoring it.

    test("same seed yields same sequence (RULES.md §10 determinism)") {
      let r1 = makeRng(42);
      let r2 = makeRng(42);
      for (var i = 0; i < 20; ++i) {
        assert(r1.next() == r2.next()) { "seed 42 diverged at draw ${i.toString()}" };
      }
      let a = makeRng(1).next();
      let b = makeRng(2).next();
      assert(a != b) { "distinct seeds should not collide on first draw" };
    }

A single generator advances — successive draws from one instance are (almost surely) distinct,
confirming the state actually mutates between calls rather than returning a constant.

    test("sequence advances within one generator") {
      let r = makeRng(7);
      let first = r.next();
      let second = r.next();
      assert(first != second) { "generator returned the same value twice in a row" };
    }

### Range: every result lies in [0, 1)

`next()` must return a value usable as `floor(rng.next() * n)` to index into `n` equally-scored moves
(that is how `bot.ts` consumes it). For that index to stay in bounds the result must be `>= 0` and
strictly `< 1`. We sample a long run across a spread of seeds to exercise both halves of the Int32
range (the `toUnsignedFloat` correction matters only for the top-bit-set draws).

    test("results lie in [0, 1) (rng.ts next contract)") {
      let seeds = [0, 1, 42, 123456, 2147483647, -1, -99999];
      for (let seed of seeds) {
        let r = makeRng(seed);
        for (var i = 0; i < 200; ++i) {
          let x = r.next();
          assert(x >= 0.0) { "draw ${i.toString()} from seed ${seed.toString()} was negative: ${x.toString()}" };
          assert(x < 1.0) { "draw ${i.toString()} from seed ${seed.toString()} reached 1.0: ${x.toString()}" };
        }
      }
    }
