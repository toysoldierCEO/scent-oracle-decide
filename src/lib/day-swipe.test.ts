import { describe, it, expect } from 'vitest';
import {
  shouldLockHorizontal,
  clampDayDragOffset,
  resolveDayCommit,
  DAY_SWIPE_THRESHOLD,
  DAY_SWIPE_MAX_OFFSET,
  HORIZONTAL_INTENT_DISTANCE,
} from './day-swipe';

describe('day-swipe — horizontal intent lock', () => {
  it('does not lock for tiny motion', () => {
    expect(shouldLockHorizontal(4, 2)).toBe(false);
  });

  it('does not lock for predominantly vertical motion', () => {
    expect(shouldLockHorizontal(20, 60)).toBe(false);
  });

  it('does not lock for diagonal motion (~45°)', () => {
    expect(shouldLockHorizontal(30, 30)).toBe(false);
  });

  it('locks on a clear horizontal swipe (left)', () => {
    expect(shouldLockHorizontal(-(HORIZONTAL_INTENT_DISTANCE + 2), 6)).toBe(true);
  });

  it('locks on a clear horizontal swipe (right)', () => {
    expect(shouldLockHorizontal(HORIZONTAL_INTENT_DISTANCE + 2, 6)).toBe(true);
  });

  it('does not lock when horizontal travel is just below intent distance', () => {
    expect(shouldLockHorizontal(HORIZONTAL_INTENT_DISTANCE - 1, 2)).toBe(false);
  });
});

describe('day-swipe — drag clamp', () => {
  it('clamps within max offset for normal drag', () => {
    expect(clampDayDragOffset(50, { hasPrevDay: true, hasNextDay: true })).toBe(50);
    expect(clampDayDragOffset(500, { hasPrevDay: true, hasNextDay: true })).toBe(DAY_SWIPE_MAX_OFFSET);
    expect(clampDayDragOffset(-500, { hasPrevDay: true, hasNextDay: true })).toBe(-DAY_SWIPE_MAX_OFFSET);
  });

  it('softens drag past edge when no previous day', () => {
    const out = clampDayDragOffset(300, { hasPrevDay: false, hasNextDay: true });
    expect(out).toBeLessThan(DAY_SWIPE_MAX_OFFSET);
    expect(out).toBeLessThanOrEqual(DAY_SWIPE_MAX_OFFSET * 0.28);
  });

  it('softens drag past edge when no next day', () => {
    const out = clampDayDragOffset(-300, { hasPrevDay: true, hasNextDay: false });
    expect(out).toBeGreaterThan(-DAY_SWIPE_MAX_OFFSET);
    expect(out).toBeGreaterThanOrEqual(-DAY_SWIPE_MAX_OFFSET * 0.28);
  });
});

describe('day-swipe — release commit', () => {
  const ctx = { hasPrevDay: true, hasNextDay: true };

  it('commits next on strong left release', () => {
    expect(resolveDayCommit({ dx: -(DAY_SWIPE_THRESHOLD + 1), didCancel: false, ...ctx })).toBe('next');
  });

  it('commits prev on strong right release', () => {
    expect(resolveDayCommit({ dx: DAY_SWIPE_THRESHOLD + 1, didCancel: false, ...ctx })).toBe('prev');
  });

  it('no commit below threshold', () => {
    expect(resolveDayCommit({ dx: DAY_SWIPE_THRESHOLD - 1, didCancel: false, ...ctx })).toBeNull();
    expect(resolveDayCommit({ dx: -(DAY_SWIPE_THRESHOLD - 1), didCancel: false, ...ctx })).toBeNull();
  });

  it('no commit when cancelled', () => {
    expect(resolveDayCommit({ dx: DAY_SWIPE_THRESHOLD + 50, didCancel: true, ...ctx })).toBeNull();
  });

  it('no commit toward edge with no available day', () => {
    expect(
      resolveDayCommit({ dx: -(DAY_SWIPE_THRESHOLD + 20), didCancel: false, hasPrevDay: true, hasNextDay: false }),
    ).toBeNull();
    expect(
      resolveDayCommit({ dx: DAY_SWIPE_THRESHOLD + 20, didCancel: false, hasPrevDay: false, hasNextDay: true }),
    ).toBeNull();
  });
});
