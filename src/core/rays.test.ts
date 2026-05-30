import { describe, expect, it } from 'vitest';
import { boardOf } from './coords';
import { knightTargets, traceSlider } from './rays';
import { pc, planeOf, sq } from './testkit';

describe('traceSlider', () => {
  it('slides across one board seam (boundary invisible to geometry)', () => {
    const steps = traceSlider(planeOf([]), sq(7, 7), [1, 1]);
    // From board 0's last cell diagonally into board 4.
    expect(steps[0]?.entered).toEqual([4]);
    expect(steps[0] && boardOf(steps[0].square)).toBe(4);
  });

  it('corner step (7,7)->(8,8) records exactly ONE entered board', () => {
    const steps = traceSlider(planeOf([]), sq(7, 7), [1, 1]);
    const first = steps[0];
    expect(first?.square).toEqual(sq(8, 8));
    expect(first?.entered).toEqual([4]);
    // The next square (9,9) stays on board 4 -> still just [4], still reachable.
    expect(steps[1]?.square).toEqual(sq(9, 9));
    expect(steps[1]?.entered).toEqual([4]);
  });

  it('slides across a SECOND board change, recording both entered boards in order', () => {
    // Rule change: a slide may cross as many boundaries as the unobstructed path
    // allows. A horizontal ray from board 0 (gx 6) crosses into board 1 at gx 8,
    // then into board 2 at gx 16 — both are now reachable and recorded in order.
    const steps = traceSlider(planeOf([]), sq(6, 0), [1, 0]);
    const maxGx = Math.max(...steps.map((s) => s.square.gx));
    expect(maxGx).toBe(23); // reaches the far plane wall, through board 2
    // First square on board 1 records [1]; first on board 2 records [1, 2].
    const onB1 = steps.find((s) => boardOf(s.square) === 1);
    const onB2 = steps.find((s) => boardOf(s.square) === 2);
    expect(onB1?.entered).toEqual([1]);
    expect(onB2?.entered).toEqual([1, 2]);
    // The final square is on board 2 with both boards recorded.
    expect(steps[steps.length - 1]?.entered).toEqual([1, 2]);
  });

  it('exit-and-reenter: a diagonal that leaves then re-enters records each board once, in order', () => {
    // A NE diagonal from (7,7) (board 0) steps onto board 4 at (8,8), continues
    // through board 4, then onto board 8 at (16,16). Each entered board is
    // recorded a single time, in first-seen order.
    const steps = traceSlider(planeOf([]), sq(7, 7), [1, 1]);
    const onB4 = steps.find((s) => boardOf(s.square) === 4);
    const onB8 = steps.find((s) => boardOf(s.square) === 8);
    expect(onB4?.entered).toEqual([4]);
    expect(onB8?.entered).toEqual([4, 8]);
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
