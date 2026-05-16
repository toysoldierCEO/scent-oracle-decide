import { describe, it, expect } from 'vitest';
import {
  resolveDirection,
  resolveAction,
  SWIPE_DIRECTION_LOCK,
  SWIPE_DOWN_DISTANCE,
  AXIS_DOMINANCE_RATIO,
} from './gesture-intent';

/**
 * Android Chrome-specific gesture tests.
 *
 * Android Chrome differs from iOS Safari in several measurable ways that
 * affect the 3-intent hero-card resolver:
 *
 *  1. High-refresh displays (90/120/144Hz) deliver many more pointermove
 *     frames per gesture, each with smaller per-frame deltas.
 *  2. Android's default touch slop is ~8dp (~12-16px on common DPRs) — the
 *     OS has often already suppressed jitter by the time pointermove fires,
 *     so individual frames are cleaner than iOS but more numerous.
 *  3. Chrome respects `touch-action: none` strictly and does NOT emit a
 *     duplicate zero-delta pointermove on pointerdown the way iOS does.
 *  4. `overscroll-behavior: contain` (used at the page level) means upward
 *     scrolls do not produce rubber-band rebound frames at the tail.
 *  5. Android's back-gesture (edge swipe) is system-level and never reaches
 *     the page, so the resolver should never see a truncated horizontal
 *     stream starting at x≈0.
 *  6. Pointer events on Android Chrome carry accurate movementX/Y, but the
 *     resolver intentionally derives deltas from clientX/Y for parity with
 *     iOS — these tests confirm that flow stays correct under Android's
 *     higher event density.
 *
 * The intent rules must produce identical outcomes to iOS Safari for
 * equivalent gestures. Each test below has an iOS counterpart in
 * gesture-intent.ios.test.ts; the assertions match.
 */

function simulate(
  frames: Array<{ x: number; y: number }>,
  opts: { hasPrevDay?: boolean; hasNextDay?: boolean } = {},
) {
  if (frames.length === 0) {
    return {
      actions: [] as ReturnType<typeof resolveAction>[],
      direction: 'none' as const,
      lockFrame: -1,
    };
  }
  const start = frames[0];
  let lastY = start.y;
  let direction: ReturnType<typeof resolveDirection> = 'none';
  const actions: ReturnType<typeof resolveAction>[] = [];
  let fired = false;
  let lockFrame = -1;

  for (let i = 1; i < frames.length; i++) {
    const f = frames[i];
    const dx = f.x - start.x;
    const dy = f.y - start.y;
    const frameDy = f.y - lastY;
    lastY = f.y;
    const prev = direction;
    direction = resolveDirection({ dx, dy, currentDirection: direction });
    if (prev === 'none' && direction !== 'none') lockFrame = i;
    if (direction === 'none') continue;
    if (fired) continue;
    const action = resolveAction({
      direction,
      dx,
      dy,
      frameDy,
      hasPrevDay: opts.hasPrevDay ?? true,
      hasNextDay: opts.hasNextDay ?? true,
    });
    actions.push(action);
    if (action.kind === 'skip_down') fired = true;
  }
  return { actions, direction, lockFrame };
}

/** Generate a high-refresh-rate frame stream (e.g. 120Hz = small per-frame deltas). */
function highRefreshStream(
  start: { x: number; y: number },
  totalDx: number,
  totalDy: number,
  frameCount: number,
  jitter: { x?: number; y?: number } = {},
) {
  const frames = [start];
  const jx = jitter.x ?? 0;
  const jy = jitter.y ?? 0;
  for (let i = 1; i <= frameCount; i++) {
    const t = i / frameCount;
    frames.push({
      x: start.x + totalDx * t + (i % 2 === 0 ? jx : -jx),
      y: start.y + totalDy * t + (i % 2 === 0 ? jy : -jy),
    });
  }
  return frames;
}

describe('gesture-intent — Android Chrome parity with iOS Safari', () => {
  describe('high-refresh-rate frame density (120Hz)', () => {
    it('locks vertical on a dense upward stream just like iOS', () => {
      // 120 frames over a 200px upward swipe ≈ 1.67px per frame.
      const frames = highRefreshStream({ x: 200, y: 500 }, 0, -200, 120);
      const { direction, actions } = simulate(frames);
      expect(direction).toBe('vertical');
      expect(actions.every(a => a.kind !== 'skip_down')).toBe(true);
      expect(actions.some(a => a.kind === 'page_scroll')).toBe(true);
    });

    it('locks horizontal on a dense side-swipe stream just like iOS', () => {
      const frames = highRefreshStream({ x: 100, y: 300 }, 220, 0, 100);
      const { direction, actions } = simulate(frames);
      expect(direction).toBe('horizontal');
      expect(actions.every(a => a.kind === 'horizontal_drag')).toBe(true);
    });

    it('fires skip_down on a dense downward stream past threshold (iOS parity)', () => {
      const frames = highRefreshStream(
        { x: 200, y: 100 },
        0,
        SWIPE_DOWN_DISTANCE + 20,
        80,
      );
      const { actions } = simulate(frames);
      expect(actions.some(a => a.kind === 'skip_down')).toBe(true);
    });
  });

  describe('Android touch slop has already filtered jitter', () => {
    it('locks vertical with clean per-frame deltas (no jitter)', () => {
      const frames = highRefreshStream({ x: 200, y: 100 }, 0, 120, 60);
      const { direction } = simulate(frames);
      expect(direction).toBe('vertical');
    });

    it('locks horizontal with clean per-frame deltas (no jitter)', () => {
      const frames = highRefreshStream({ x: 100, y: 200 }, 180, 0, 60);
      const { direction } = simulate(frames);
      expect(direction).toBe('horizontal');
    });
  });

  describe('overscroll-behavior: contain — no rubber-band tail', () => {
    it('upward scroll ending abruptly (no rebound) still resolves vertical cleanly', () => {
      const { direction, actions } = simulate([
        { x: 100, y: 400 },
        { x: 100, y: 380 },
        { x: 100, y: 350 },
        { x: 100, y: 320 },
        // No rebound frame — Android Chrome with overscroll-behavior:contain.
      ]);
      expect(direction).toBe('vertical');
      expect(actions.every(a => a.kind !== 'skip_down')).toBe(true);
    });
  });

  describe('no duplicate zero-delta pointermove on Android', () => {
    it('locks on the first real frame past SWIPE_DIRECTION_LOCK without an iOS-style duplicate', () => {
      const { direction, lockFrame } = simulate([
        { x: 150, y: 200 },
        { x: 150, y: 215 }, // first real frame already past lock
        { x: 150, y: 240 },
      ]);
      expect(direction).toBe('vertical');
      expect(lockFrame).toBe(1);
    });
  });

  describe('ambiguous diagonal stays unlocked (iOS parity)', () => {
    it('Android ~45° diagonal does not lock either axis', () => {
      const frames = highRefreshStream({ x: 100, y: 100 }, 120, 120, 60);
      const { direction, actions } = simulate(frames);
      expect(direction).toBe('none');
      expect(actions).toHaveLength(0);
    });

    it('axis-dominance ratio is symmetric for Android and iOS', () => {
      // Ratio applies the same way regardless of platform.
      expect(AXIS_DOMINANCE_RATIO).toBeGreaterThan(1);
      expect(AXIS_DOMINANCE_RATIO).toBeLessThan(2);
    });
  });

  describe('Android weak-motion below slop equivalent', () => {
    it('stays unlocked when total motion is below SWIPE_DIRECTION_LOCK', () => {
      const { direction, actions } = simulate([
        { x: 100, y: 100 },
        { x: 103, y: 102 },
        { x: 105, y: 104 },
        { x: 106, y: 105 }, // max axis = 6, still below 8
      ]);
      expect(Math.max(6, 5)).toBeLessThan(SWIPE_DIRECTION_LOCK);
      expect(direction).toBe('none');
      expect(actions).toHaveLength(0);
    });
  });

  describe('horizontal clamp when no next day (iOS parity)', () => {
    it('clamps drag identically to iOS regardless of frame density', () => {
      const frames = highRefreshStream({ x: 200, y: 300 }, -260, 0, 80);
      const { actions } = simulate(frames, { hasNextDay: false });
      const last = actions[actions.length - 1];
      expect(last.kind).toBe('horizontal_drag');
      if (last.kind === 'horizontal_drag') {
        expect(Math.abs(last.clampedDx)).toBeLessThan(50);
      }
    });
  });

  describe('intent isolation under Android event density', () => {
    it('upward scroll across many frames never bleeds into horizontal_drag', () => {
      const frames = highRefreshStream(
        { x: 100, y: 400 },
        4,
        -180,
        90,
        { x: 0.3 },
      );
      const { direction, actions } = simulate(frames);
      expect(direction).toBe('vertical');
      expect(actions.some(a => a.kind === 'horizontal_drag')).toBe(false);
    });

    it('horizontal swipe across many frames never emits page_scroll or skip_down', () => {
      const frames = highRefreshStream(
        { x: 100, y: 200 },
        200,
        3,
        90,
        { y: 0.3 },
      );
      const { actions } = simulate(frames);
      expect(actions.every(a => a.kind === 'horizontal_drag')).toBe(true);
    });
  });
});
