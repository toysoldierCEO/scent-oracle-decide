/**
 * Pure gesture intent resolver for the ODARA hero card.
 *
 * Mirrors the 3-intent system implemented inline in OdaraScreen's
 * pointermove handler so it can be unit-tested in isolation:
 *
 *   1. vertical page scroll (forwarded via window.scrollBy on upward motion)
 *   2. horizontal hero-card swipe (day change)
 *   3. downward hero-card skip (skip / unlock action)
 *
 * Weak or ambiguous motion intentionally produces no action.
 */

export const SWIPE_DOWN_DISTANCE = 60;
export const SWIPE_DIRECTION_LOCK = 8;
export const SWIPE_HORIZONTAL_TOLERANCE = 1.2;
export const AXIS_DOMINANCE_RATIO = 1.25;

export type GestureDirection = 'none' | 'vertical' | 'horizontal';

export interface ResolveDirectionInput {
  dx: number;
  dy: number;
  currentDirection: GestureDirection;
}

/**
 * Decide whether the gesture has crossed the direction-lock threshold and,
 * if so, which axis owns it. Ambiguous motion (no dominant axis) stays 'none'.
 */
export function resolveDirection({
  dx,
  dy,
  currentDirection,
}: ResolveDirectionInput): GestureDirection {
  if (currentDirection !== 'none') return currentDirection;
  if (Math.abs(dx) < SWIPE_DIRECTION_LOCK && Math.abs(dy) < SWIPE_DIRECTION_LOCK) {
    return 'none';
  }
  if (Math.abs(dy) > Math.abs(dx) * AXIS_DOMINANCE_RATIO) return 'vertical';
  if (Math.abs(dx) > Math.abs(dy) * AXIS_DOMINANCE_RATIO) return 'horizontal';
  return 'none';
}

export type GestureAction =
  | { kind: 'none' }
  | { kind: 'page_scroll'; scrollBy: number }
  | { kind: 'horizontal_drag'; clampedDx: number }
  | { kind: 'skip_down' };

export interface ResolveActionInput {
  direction: GestureDirection;
  dx: number;
  dy: number;
  frameDy: number;
  hasPrevDay?: boolean;
  hasNextDay?: boolean;
  maxOffset?: number;
}

/**
 * Given a locked direction + deltas, decide what the card should do this frame.
 */
export function resolveAction({
  direction,
  dx,
  dy,
  frameDy,
  hasPrevDay = true,
  hasNextDay = true,
  maxOffset = 148,
}: ResolveActionInput): GestureAction {
  if (direction === 'horizontal') {
    let clamped = Math.max(-maxOffset, Math.min(maxOffset, dx));
    if (dx > 0 && !hasPrevDay) clamped = Math.min(dx, maxOffset * 0.28);
    if (dx < 0 && !hasNextDay) clamped = Math.max(dx, -maxOffset * 0.28);
    return { kind: 'horizontal_drag', clampedDx: clamped };
  }
  if (direction === 'vertical') {
    if (dy < 0) {
      // Upward finger motion → forward to page scroll.
      if (frameDy < 0) return { kind: 'page_scroll', scrollBy: -frameDy };
      return { kind: 'none' };
    }
    const downwardOk =
      dy >= SWIPE_DOWN_DISTANCE &&
      Math.abs(dy) >= Math.abs(dx) * SWIPE_HORIZONTAL_TOLERANCE;
    if (downwardOk) return { kind: 'skip_down' };
    return { kind: 'none' };
  }
  return { kind: 'none' };
}
