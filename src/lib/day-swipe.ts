/**
 * Pure helpers for the ODARA hero-card day-swipe gesture.
 *
 * The hero card uses `touch-action: pan-y` so vertical scroll stays native.
 * We only claim a horizontal day-swipe when intent is clearly sideways, then
 * clamp the visual drag and commit a day change past a release threshold.
 *
 * Extracted from OdaraScreen so the rules are unit-testable in isolation.
 */

export const SWIPE_DIRECTION_LOCK = 4;        // px before either axis can lock
export const HORIZONTAL_INTENT_DISTANCE = 10;  // |dx| required to claim horizontal
export const HORIZONTAL_AXIS_RATIO = 1.0;      // |dx| must exceed |dy| * ratio
export const DAY_SWIPE_THRESHOLD = 40;         // |dx| at release to commit day change
export const DAY_SWIPE_FLICK_DISTANCE = 18;    // minimum travel for velocity-assisted flick commit
export const DAY_SWIPE_FLICK_VELOCITY = 0.35;  // px / ms required for quick flick commit
export const DAY_SWIPE_MAX_OFFSET = 148;       // visual drag clamp

export type DaySwipeDirection = 'none' | 'horizontal';

/**
 * Decide whether the gesture has crossed the horizontal lock threshold.
 * Vertical / ambiguous motion stays 'none' so the browser keeps scrolling.
 */
export function shouldLockHorizontal(dx: number, dy: number): boolean {
  if (Math.abs(dx) < SWIPE_DIRECTION_LOCK && Math.abs(dy) < SWIPE_DIRECTION_LOCK) {
    return false;
  }
  return (
    Math.abs(dx) >= HORIZONTAL_INTENT_DISTANCE &&
    Math.abs(dx) > Math.abs(dy) * HORIZONTAL_AXIS_RATIO
  );
}

/**
 * Clamp the visual drag offset for the card stack. When the user drags toward
 * an edge with no more days available the drag is softened to ~28% travel.
 */
export function clampDayDragOffset(
  dx: number,
  opts: { hasPrevDay: boolean; hasNextDay: boolean; maxOffset?: number } = {
    hasPrevDay: true,
    hasNextDay: true,
  },
): number {
  const maxOffset = opts.maxOffset ?? DAY_SWIPE_MAX_OFFSET;
  let clamped = Math.max(-maxOffset, Math.min(maxOffset, dx));
  if (dx > 0 && !opts.hasPrevDay) clamped = Math.min(dx, maxOffset * 0.28);
  if (dx < 0 && !opts.hasNextDay) clamped = Math.max(dx, -maxOffset * 0.28);
  return clamped;
}

export interface ResolveDayCommitInput {
  dx: number;
  didCancel: boolean;
  hasPrevDay: boolean;
  hasNextDay: boolean;
  velocityX?: number;
}

export type DayCommit = 'prev' | 'next' | null;

/**
 * Given the release deltas, decide whether to commit a prev/next day change.
 * Returns null when the gesture is cancelled, below threshold, or pointed at
 * an edge with no available day.
 */
export function resolveDayCommit({
  dx,
  didCancel,
  hasPrevDay,
  hasNextDay,
  velocityX = 0,
}: ResolveDayCommitInput): DayCommit {
  if (didCancel) return null;
  if (dx <= -DAY_SWIPE_THRESHOLD) return hasNextDay ? 'next' : null;
  if (dx >= DAY_SWIPE_THRESHOLD) return hasPrevDay ? 'prev' : null;
  if (Math.abs(dx) < DAY_SWIPE_FLICK_DISTANCE) return null;
  if (velocityX <= -DAY_SWIPE_FLICK_VELOCITY) return hasNextDay ? 'next' : null;
  if (velocityX >= DAY_SWIPE_FLICK_VELOCITY) return hasPrevDay ? 'prev' : null;
  return null;
}
