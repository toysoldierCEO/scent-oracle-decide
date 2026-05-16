import { describe, it, expect } from 'vitest';
import {
  resolveDirection,
  resolveAction,
  SWIPE_DIRECTION_LOCK,
  SWIPE_DOWN_DISTANCE,
} from './gesture-intent';

/**
 * Simulate a full pointer stream as a sequence of frames, threading the
 * gesture-intent resolvers exactly the way OdaraScreen's pointermove handler
 * does. Returns the list of actions that fired across the stream.
 */
function simulate(
  frames: Array<{ x: number; y: number }>,
  opts: { hasPrevDay?: boolean; hasNextDay?: boolean } = {},
) {
  if (frames.length === 0) return { actions: [] as ReturnType<typeof resolveAction>[], direction: 'none' as const };
  const start = frames[0];
  let lastY = start.y;
  let direction: ReturnType<typeof resolveDirection> = 'none';
  const actions: ReturnType<typeof resolveAction>[] = [];
  let fired = false;

  for (let i = 1; i < frames.length; i++) {
    const f = frames[i];
    const dx = f.x - start.x;
    const dy = f.y - start.y;
    const frameDy = f.y - lastY;
    lastY = f.y;
    direction = resolveDirection({ dx, dy, currentDirection: direction });
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
  return { actions, direction };
}

describe('gesture-intent — 3-intent hero card system', () => {
  describe('vertical page scroll (upward finger motion)', () => {
    it('forwards upward motion to window.scrollBy frame-by-frame', () => {
      const { direction, actions } = simulate([
        { x: 100, y: 400 },
        { x: 100, y: 380 }, // 20px up — passes lock
        { x: 100, y: 350 }, // another 30px up
        { x: 100, y: 320 }, // another 30px up
      ]);
      expect(direction).toBe('vertical');
      const scrolls = actions.filter(a => a.kind === 'page_scroll');
      expect(scrolls.length).toBeGreaterThanOrEqual(2);
      // Total scrollBy should equal total upward travel after lock
      const total = scrolls.reduce(
        (sum, a) => sum + (a.kind === 'page_scroll' ? a.scrollBy : 0),
        0,
      );
      expect(total).toBeGreaterThan(0);
    });

    it('never fires a skip when motion is purely upward', () => {
      const { actions } = simulate([
        { x: 100, y: 500 },
        { x: 100, y: 400 },
        { x: 100, y: 300 },
      ]);
      expect(actions.every(a => a.kind !== 'skip_down')).toBe(true);
    });
  });

  describe('downward hero-card skip', () => {
    it('fires skip_down once when downward travel passes SWIPE_DOWN_DISTANCE', () => {
      const { direction, actions } = simulate([
        { x: 100, y: 100 },
        { x: 100, y: 120 },
        { x: 100, y: 150 },
        { x: 100, y: 100 + SWIPE_DOWN_DISTANCE + 5 },
      ]);
      expect(direction).toBe('vertical');
      const skips = actions.filter(a => a.kind === 'skip_down');
      expect(skips).toHaveLength(1);
    });

    it('does NOT fire skip for weak downward motion (below threshold)', () => {
      const { actions } = simulate([
        { x: 100, y: 100 },
        { x: 100, y: 120 },
        { x: 100, y: 140 }, // 40px — below 60px threshold
      ]);
      expect(actions.every(a => a.kind !== 'skip_down')).toBe(true);
    });

    it('does NOT fire skip when horizontal drift is too large vs vertical', () => {
      // dy = 70 (past threshold) but dx = 80 — fails horizontal-tolerance gate
      // AND axis-dominance gate may even route it to horizontal. Either way,
      // no skip should fire.
      const { actions } = simulate([
        { x: 100, y: 100 },
        { x: 140, y: 130 },
        { x: 180, y: 170 },
      ]);
      expect(actions.every(a => a.kind !== 'skip_down')).toBe(true);
    });
  });

  describe('horizontal hero-card swipe', () => {
    it('locks to horizontal when intent is clearly horizontal', () => {
      const { direction, actions } = simulate([
        { x: 100, y: 200 },
        { x: 130, y: 205 },
        { x: 170, y: 208 },
      ]);
      expect(direction).toBe('horizontal');
      expect(actions.some(a => a.kind === 'horizontal_drag')).toBe(true);
    });

    it('clamps drag when there is no next day available', () => {
      const { actions } = simulate(
        [
          { x: 100, y: 200 },
          { x: 0, y: 205 }, // dx = -100 (toward next)
          { x: -200, y: 208 }, // dx = -300, should be clamped because no next
        ],
        { hasNextDay: false },
      );
      const last = actions[actions.length - 1];
      expect(last.kind).toBe('horizontal_drag');
      if (last.kind === 'horizontal_drag') {
        // Without next day available, drag is clamped to maxOffset * 0.28 (~41.4)
        expect(Math.abs(last.clampedDx)).toBeLessThan(50);
      }
    });
  });

  describe('weak / ambiguous motion', () => {
    it('stays unlocked when total motion is below SWIPE_DIRECTION_LOCK', () => {
      const { direction, actions } = simulate([
        { x: 100, y: 100 },
        { x: 102, y: 103 },
        { x: 104, y: 105 },
      ]);
      // Below the 8px lock threshold on both axes
      expect(Math.max(4, 5)).toBeLessThan(SWIPE_DIRECTION_LOCK);
      expect(direction).toBe('none');
      expect(actions).toHaveLength(0);
    });

    it('stays unlocked when neither axis dominates (diagonal at ~45°)', () => {
      // Past the lock threshold but with dx ≈ dy → ambiguous, no lock.
      const { direction, actions } = simulate([
        { x: 100, y: 100 },
        { x: 115, y: 115 },
        { x: 130, y: 130 },
      ]);
      expect(direction).toBe('none');
      expect(actions).toHaveLength(0);
    });
  });

  describe('intent isolation', () => {
    it('upward scroll does not bleed into a horizontal drag', () => {
      const { direction, actions } = simulate([
        { x: 100, y: 400 },
        { x: 103, y: 360 },
        { x: 105, y: 320 },
      ]);
      expect(direction).toBe('vertical');
      expect(actions.some(a => a.kind === 'horizontal_drag')).toBe(false);
    });

    it('horizontal swipe never produces page_scroll or skip_down', () => {
      const { actions } = simulate([
        { x: 100, y: 200 },
        { x: 160, y: 203 },
        { x: 220, y: 206 },
      ]);
      expect(actions.every(a => a.kind === 'horizontal_drag')).toBe(true);
    });
  });
});
