import { describe, it, expect } from 'vitest';
import {
  resolveDirection,
  resolveAction,
  SWIPE_DIRECTION_LOCK,
  SWIPE_DOWN_DISTANCE,
} from './gesture-intent';

/**
 * iOS/Safari-specific gesture tests.
 *
 * Mobile Safari has several pointer/touch quirks that desktop Chromium does
 * not exhibit:
 *
 *  1. Coalesced touchmove events arrive in tight bursts at ~60Hz with
 *     sub-pixel jitter from the finger's contact patch.
 *  2. Momentum / rubber-band scrolling can produce small reverse-direction
 *     frames at the tail of a flick.
 *  3. `touch-action: none` on the element is required, otherwise Safari
 *     swallows the pointer stream into native scroll and the resolver never
 *     sees a clean dy.
 *  4. The very first pointermove sometimes arrives with dx/dy = 0 because
 *     Safari fires pointerdown + pointermove at the same coordinates.
 *  5. PointerEvent.movementX/Y is unreliable on iOS — frame-by-frame deltas
 *     must be computed from clientX/Y (which is what OdaraScreen does via
 *     `lastY`). These tests assert the resolver tolerates that flow.
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

describe('gesture-intent — iOS/Safari quirks', () => {
  describe('coalesced touchmove bursts with sub-pixel jitter', () => {
    it('locks vertical despite ±1px horizontal jitter from contact patch', () => {
      // Simulate a ~60Hz vertical swipe down with iOS-style jitter.
      const frames = [{ x: 200, y: 100 }];
      const jitter = [0.4, -0.6, 0.8, -0.3, 0.5, -0.7, 0.2, -0.4];
      for (let i = 0; i < jitter.length; i++) {
        frames.push({ x: 200 + jitter[i], y: 100 + (i + 1) * 10 });
      }
      const { direction } = simulate(frames);
      expect(direction).toBe('vertical');
    });

    it('locks horizontal despite ±1px vertical jitter during a side swipe', () => {
      const frames = [{ x: 100, y: 300 }];
      const jitter = [0.5, -0.4, 0.7, -0.6, 0.3];
      for (let i = 0; i < jitter.length; i++) {
        frames.push({ x: 100 + (i + 1) * 14, y: 300 + jitter[i] });
      }
      const { direction } = simulate(frames);
      expect(direction).toBe('horizontal');
    });
  });

  describe('iOS pointerdown emitting a zero-delta first pointermove', () => {
    it('stays unlocked on the duplicate zero-delta frame and locks on the next real frame', () => {
      const { direction, lockFrame } = simulate([
        { x: 150, y: 200 },
        { x: 150, y: 200 }, // iOS duplicate
        { x: 150, y: 215 }, // 15px down — passes lock
        { x: 150, y: 240 },
      ]);
      expect(direction).toBe('vertical');
      expect(lockFrame).toBeGreaterThan(1);
    });
  });

  describe('momentum / rubber-band tail frames', () => {
    it('a single reverse frame at the tail of an upward scroll does not flip direction', () => {
      const { direction, actions } = simulate([
        { x: 100, y: 400 },
        { x: 100, y: 380 },
        { x: 100, y: 350 },
        { x: 100, y: 320 },
        { x: 100, y: 322 }, // rubber-band tail
      ]);
      expect(direction).toBe('vertical');
      // Should never have produced a skip_down despite the +2 tail frame.
      expect(actions.every(a => a.kind !== 'skip_down')).toBe(true);
    });

    it('a brief downward rebound at the tail of a horizontal swipe does not emit skip', () => {
      const { actions, direction } = simulate([
        { x: 100, y: 200 },
        { x: 140, y: 202 },
        { x: 190, y: 205 },
        { x: 230, y: 212 }, // small dy rebound
      ]);
      expect(direction).toBe('horizontal');
      expect(actions.every(a => a.kind === 'horizontal_drag')).toBe(true);
    });
  });

  describe('touchAction:none ownership contract', () => {
    it('SWIPE_DIRECTION_LOCK is small enough that iOS bursts cross it within ~2-3 frames', () => {
      // iOS coalesces ~6 frames per 100ms; at a slow 60px/s swipe that is
      // 1px per frame. The lock must trigger before the user gives up.
      // We assert the constant is in a sensible mobile range.
      expect(SWIPE_DIRECTION_LOCK).toBeGreaterThanOrEqual(6);
      expect(SWIPE_DIRECTION_LOCK).toBeLessThanOrEqual(16);
    });

    it('SWIPE_DOWN_DISTANCE leaves enough headroom above the lock for iOS to disambiguate', () => {
      expect(SWIPE_DOWN_DISTANCE).toBeGreaterThan(SWIPE_DIRECTION_LOCK * 4);
    });
  });

  describe('iOS slow-drag downward skip', () => {
    it('fires skip_down for a slow, jittery iOS-style downward drag past threshold', () => {
      const frames = [{ x: 200, y: 100 }];
      const jitter = [0.5, -0.4, 0.6, -0.3, 0.7, -0.5, 0.4, -0.6];
      // Reach > SWIPE_DOWN_DISTANCE with small frame steps like a slow finger.
      const steps = Math.ceil((SWIPE_DOWN_DISTANCE + 10) / 9);
      for (let i = 0; i < steps; i++) {
        frames.push({
          x: 200 + (jitter[i % jitter.length] ?? 0),
          y: 100 + (i + 1) * 9,
        });
      }
      const { actions } = simulate(frames);
      expect(actions.some(a => a.kind === 'skip_down')).toBe(true);
    });
  });

  describe('iOS edge swipe (back-gesture) hand-off', () => {
    it('a swipe that starts horizontal but immediately drops out (Safari steals it) leaves no orphan actions', () => {
      // Two real frames horizontal, then no more frames — simulating Safari
      // intercepting the gesture for its edge-swipe back navigation.
      const { actions, direction } = simulate([
        { x: 10, y: 300 },
        { x: 30, y: 301 },
        { x: 55, y: 302 },
      ]);
      expect(direction).toBe('horizontal');
      // Only horizontal_drag frames, no skip and no page_scroll.
      expect(
        actions.every(
          a => a.kind === 'horizontal_drag' || a.kind === 'none',
        ),
      ).toBe(true);
    });
  });
});
