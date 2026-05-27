import { describe, it, expect } from 'vitest';
import {
  shouldLockHorizontal,
  clampDayDragOffset,
  resolveDayCommit,
  DAY_SWIPE_THRESHOLD,
  DAY_SWIPE_MAX_OFFSET,
  HORIZONTAL_INTENT_DISTANCE,
} from './day-swipe';
import { resolveDirection, resolveAction } from './gesture-intent';

/**
 * Integration tests: verify horizontal swipe detection and day-change commits
 * behave correctly across common mobile viewport resolutions.
 *
 * The day-swipe logic is pixel-based and resolution-independent, but the
 * thresholds must remain reachable with comfortable swipe distances on every
 * supported device. These tests parameterize realistic swipe distances per
 * device and assert detection + commit outcomes are consistent.
 */

interface Device {
  name: string;
  width: number;
  height: number;
  dpr: number;
}

// Representative mobile resolutions (CSS pixels).
const DEVICES: Device[] = [
  { name: 'iPhone SE',         width: 320, height: 568,  dpr: 2 },
  { name: 'iPhone 12 mini',    width: 360, height: 780,  dpr: 3 },
  { name: 'iPhone 13/14',      width: 390, height: 844,  dpr: 3 },
  { name: 'iPhone 14 Pro Max', width: 430, height: 932,  dpr: 3 },
  { name: 'Pixel 5',           width: 393, height: 851,  dpr: 2.75 },
  { name: 'Galaxy S20',        width: 360, height: 800,  dpr: 3 },
  { name: 'Galaxy Fold',       width: 280, height: 653,  dpr: 3 },
  { name: 'iPad Mini portrait',width: 768, height: 1024, dpr: 2 },
];

// Build a horizontal swipe stream sized to a fraction of viewport width.
function horizontalStream(
  device: Device,
  fraction: number,
  direction: 'left' | 'right',
  frames = 20,
  yJitter = 0,
) {
  const startX = device.width / 2;
  const startY = device.height / 2;
  const totalDx = device.width * fraction * (direction === 'right' ? 1 : -1);
  const out: { x: number; y: number }[] = [{ x: startX, y: startY }];
  for (let i = 1; i <= frames; i++) {
    const t = i / frames;
    out.push({
      x: startX + totalDx * t,
      y: startY + (i % 2 === 0 ? yJitter : -yJitter),
    });
  }
  return out;
}

function runStream(
  frames: { x: number; y: number }[],
  opts: { hasPrevDay?: boolean; hasNextDay?: boolean } = {},
) {
  const start = frames[0];
  let lastY = start.y;
  let direction = 'none' as ReturnType<typeof resolveDirection>;
  let lastDx = 0;
  let lastDy = 0;
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i];
    const dx = f.x - start.x;
    const dy = f.y - start.y;
    const frameDy = f.y - lastY;
    lastY = f.y;
    lastDx = dx;
    lastDy = dy;
    direction = resolveDirection({ dx, dy, currentDirection: direction });
    if (direction !== 'none') {
      resolveAction({
        direction,
        dx,
        dy,
        frameDy,
        hasPrevDay: opts.hasPrevDay ?? true,
        hasNextDay: opts.hasNextDay ?? true,
      });
    }
  }
  return { direction, finalDx: lastDx, finalDy: lastDy };
}

describe('day-swipe across common mobile resolutions', () => {
  for (const device of DEVICES) {
    describe(`${device.name} (${device.width}x${device.height} @${device.dpr}x)`, () => {
      it('detects horizontal intent on a comfortable 25% width left swipe', () => {
        const frames = horizontalStream(device, 0.25, 'left');
        const { direction, finalDx, finalDy } = runStream(frames);
        expect(direction).toBe('horizontal');
        expect(shouldLockHorizontal(finalDx, finalDy)).toBe(true);
      });

      it('detects horizontal intent on a comfortable 25% width right swipe', () => {
        const frames = horizontalStream(device, 0.25, 'right');
        const { direction } = runStream(frames);
        expect(direction).toBe('horizontal');
      });

      it('commits next day on a confident left swipe', () => {
        const frames = horizontalStream(device, 0.4, 'left');
        const { finalDx } = runStream(frames);
        const commit = resolveDayCommit({
          dx: finalDx,
          didCancel: false,
          hasPrevDay: true,
          hasNextDay: true,
        });
        expect(commit).toBe('next');
      });

      it('commits prev day on a confident right swipe', () => {
        const frames = horizontalStream(device, 0.4, 'right');
        const { finalDx } = runStream(frames);
        const commit = resolveDayCommit({
          dx: finalDx,
          didCancel: false,
          hasPrevDay: true,
          hasNextDay: true,
        });
        expect(commit).toBe('prev');
      });

      it('does not commit on a tiny 3% width nudge', () => {
        const frames = horizontalStream(device, 0.03, 'left');
        const { finalDx } = runStream(frames);
        // Tiny swipe must remain below the commit threshold on every device.
        expect(Math.abs(finalDx)).toBeLessThan(DAY_SWIPE_THRESHOLD);
        expect(
          resolveDayCommit({
            dx: finalDx,
            didCancel: false,
            hasPrevDay: true,
            hasNextDay: true,
          }),
        ).toBeNull();
      });

      it('drag clamp never exceeds DAY_SWIPE_MAX_OFFSET regardless of screen width', () => {
        const frames = horizontalStream(device, 0.95, 'left');
        const { finalDx } = runStream(frames);
        const clamped = clampDayDragOffset(finalDx, {
          hasPrevDay: true,
          hasNextDay: true,
        });
        expect(Math.abs(clamped)).toBeLessThanOrEqual(DAY_SWIPE_MAX_OFFSET);
      });

      it('softens drag at the edge when no next day is available', () => {
        const frames = horizontalStream(device, 0.6, 'left');
        const { finalDx } = runStream(frames);
        const clamped = clampDayDragOffset(finalDx, {
          hasPrevDay: true,
          hasNextDay: false,
        });
        expect(clamped).toBeGreaterThan(-DAY_SWIPE_MAX_OFFSET);
        expect(clamped).toBeGreaterThanOrEqual(-DAY_SWIPE_MAX_OFFSET * 0.28);
      });

      it('cancelled gesture never commits a day change', () => {
        const frames = horizontalStream(device, 0.5, 'right');
        const { finalDx } = runStream(frames);
        expect(
          resolveDayCommit({
            dx: finalDx,
            didCancel: true,
            hasPrevDay: true,
            hasNextDay: true,
          }),
        ).toBeNull();
      });

      it('horizontal intent distance is reachable in under 15% of viewport width', () => {
        // Sanity: the lock threshold must be a small fraction of the
        // narrowest supported viewport so users do not have to swipe far.
        expect(HORIZONTAL_INTENT_DISTANCE).toBeLessThan(device.width * 0.15);
      });

      it('vertical scroll on this device does not trigger a horizontal lock', () => {
        const startX = device.width / 2;
        const startY = device.height / 2;
        const frames: { x: number; y: number }[] = [{ x: startX, y: startY }];
        for (let i = 1; i <= 20; i++) {
          frames.push({ x: startX + (i % 2 ? 0.5 : -0.5), y: startY - i * 8 });
        }
        const { direction, finalDx, finalDy } = runStream(frames);
        expect(direction).toBe('vertical');
        expect(shouldLockHorizontal(finalDx, finalDy)).toBe(false);
      });
    });
  }
});

describe('day-swipe cross-resolution invariants', () => {
  it('commit threshold is identical pixel value on every device', () => {
    for (const _device of DEVICES) {
      expect(DAY_SWIPE_THRESHOLD).toBe(40);
    }
  });

  it('a 40% width left swipe commits next on every supported resolution', () => {
    for (const device of DEVICES) {
      const frames = horizontalStream(device, 0.4, 'left');
      const { finalDx } = runStream(frames);
      const commit = resolveDayCommit({
        dx: finalDx,
        didCancel: false,
        hasPrevDay: true,
        hasNextDay: true,
      });
      expect(commit, `expected next commit on ${device.name}`).toBe('next');
    }
  });

  it('a 40% width right swipe commits prev on every supported resolution', () => {
    for (const device of DEVICES) {
      const frames = horizontalStream(device, 0.4, 'right');
      const { finalDx } = runStream(frames);
      const commit = resolveDayCommit({
        dx: finalDx,
        didCancel: false,
        hasPrevDay: true,
        hasNextDay: true,
      });
      expect(commit, `expected prev commit on ${device.name}`).toBe('prev');
    }
  });
});
