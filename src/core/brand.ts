declare const __brand: unique symbol;

/**
 * Nominal/branded type helper. A `Brand<number, 'GX'>` is structurally a number
 * but cannot be assigned from a raw number — values are only minted by the smart
 * constructors in `coords.ts`, which validate range first. This makes illegal
 * coordinates unrepresentable in the type system.
 */
export type Brand<T, B extends string> = T & { readonly [__brand]: B };
