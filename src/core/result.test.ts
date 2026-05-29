import { describe, expect, it } from 'vitest';
import { assertNever, err, isOk, ok } from './result';

describe('result', () => {
  it('ok wraps a value', () => {
    const r = ok(42);
    expect(r).toEqual({ ok: true, value: 42 });
    expect(isOk(r)).toBe(true);
  });

  it('err wraps an error', () => {
    const r = err('boom');
    expect(r).toEqual({ ok: false, error: 'boom' });
    expect(isOk(r)).toBe(false);
  });

  it('assertNever throws when reached', () => {
    const reach = (): never => assertNever(undefined as never);
    expect(reach).toThrow(/Unreachable/);
  });
});
