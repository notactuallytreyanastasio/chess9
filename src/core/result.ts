/** A total, throw-free result type for the pure core. */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is { readonly ok: true; readonly value: T } => r.ok;

/**
 * Compile-time exhaustiveness guard. Reaching this at runtime means a
 * discriminated union gained a variant that a `switch` failed to handle.
 */
export const assertNever = (x: never): never => {
  throw new Error(`Unreachable variant: ${JSON.stringify(x)}`);
};
