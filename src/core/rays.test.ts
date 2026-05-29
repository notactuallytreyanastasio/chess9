import { describe, expect, it } from 'vitest';
import { boardOf } from './coords';
import { knightTargets, traceSlider } from './rays';
import { pc, planeOf, sq } from './testkit';

describe('traceSlider', () => {
  it('slides across one board seam (boundary invisible to geometry)', () => {
    const steps = traceSlider(planeOf([]), sq(7, 7), [1, 1]);
    // From board 0's last cell diagonally into board 4.
    expect(steps[0]).toMatchObject({ crossings: 1 });
    expect(steps[0] && boardOf(steps[0].square)).toBe(4);
  });

  it('corner step (7,7)->(8,8) counts exactly ONE crossing', () => {
    const steps = traceSlider(planeOf([]), sq(7, 7), [1, 1]);
    const first = steps[0];
    expect(first?.square).toEqual(sq(8, 8));
    expect(first?.crossings).toBe(1);
    // The next square (9,9) stays on board 4 -> still 1 crossing, still reachable.
    expect(steps[1]?.square).toEqual(sq(9, 9));
    expect(steps[1]?.crossings).toBe(1);
  });

  it('halts before a SECOND board change', () => {
    // A horizontal ray from board 0 (gx 6) crosses into board 1 at gx 8, then
    // would cross into board 2 at gx 16 — that 2nd crossing is excluded.
    const steps = traceSlider(planeOf([]), sq(6, 0), [1, 0]);
    const maxGx = Math.max(...steps.map((s) => s.square.gx));
    expect(maxGx).toBeLessThan(16); // never reaches board 2
    expect(steps.every((s) => s.crossings <= 1)).toBe(true);
  });

  it('stops at the outer plane wall', () => {
    const steps = traceSlider(planeOf([]), sq(21, 0), [1, 0]);
    expect(steps.map((s) => s.square.gx)).toEqual([22, 23]);
  });

  it('stops at the first occupant (capture candidate)', () => {
    const plane = planeOf([
      [sq(3, 3), pc('rook', 'white')],
      [sq(6, 3), pc('pawn', 'black')],
    ]);
    const steps = traceSlider(plane, sq(3, 3), [1, 0]);
    const last = steps[steps.length - 1];
    expect(last?.square).toEqual(sq(6, 3));
    expect(last?.occupant).toEqual(pc('pawn', 'black'));
  });
});

describe('knightTargets', () => {
  it('produces in-bounds L-targets with crossing flags', () => {
    const targets = knightTargets(sq(7, 7));
    // (7,7) is board 0's corner; some L-jumps land on neighbor boards.
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.some((t) => t.crossings === 1)).toBe(true);
    expect(targets.every((t) => t.square.gx >= 0 && t.square.gx < 24)).toBe(true);
  });

  it('clips targets at the plane corner', () => {
    expect(knightTargets(sq(0, 0))).toHaveLength(2);
  });
});
