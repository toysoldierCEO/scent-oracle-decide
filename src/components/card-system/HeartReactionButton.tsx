import React, { useEffect, useRef, useState } from 'react';
import {
  CARD_ACTION_BUTTON_BASE_CLASS,
  CARD_ACTION_BUTTON_BASE_STYLE,
  CARD_ACTION_BUTTON_INACTIVE_STYLE,
  HEART_LIKE_COLOR,
  HEART_LOVE_COLOR,
} from './tokens';
import FloatingActionLabel from './FloatingActionLabel';

export type HeartState = 0 | 1 | 2; // 0 = none, 1 = like, 2 = love

interface HeartReactionButtonProps {
  state: HeartState;
  onChange: (next: HeartState) => void;
  /** Optional haptic hook — fired after each state change. */
  onHaptic?: (intensity: 'light' | 'medium') => void;
  disabled?: boolean;
}

/**
 * HeartReactionButton — neutral → pink "Like" → red "Love".
 *
 * Reusable across guest and signed-in cards. State persistence is the
 * caller's responsibility (frontend cache today; future Supabase logging
 * can be wired into onChange without touching the UI).
 */
const HeartReactionButton: React.FC<HeartReactionButtonProps> = ({
  state,
  onChange,
  onHaptic,
  disabled,
}) => {
  const [flashAt, setFlashAt] = useState<number>(0);
  const [labelTick, setLabelTick] = useState(0);
  const [labelText, setLabelText] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const liked = state >= 1;
  const loved = state === 2;
  const heartColor = loved ? HEART_LOVE_COLOR : liked ? HEART_LIKE_COLOR : undefined;

  const handleClick = () => {
    if (disabled) return;
    const next: HeartState = state === 0 ? 1 : state === 1 ? 2 : 0;
    onChange(next);
    setFlashAt(Date.now());
    onHaptic?.(next === 2 ? 'medium' : 'light');

    if (next === 1) setLabelText('Like');
    else if (next === 2) setLabelText('Love');
    else setLabelText('Off');
    setLabelTick((t) => t + 1);
  };

  const flashing = flashAt && Date.now() - flashAt < 320;
  const labelColor = labelText === 'Love'
    ? HEART_LOVE_COLOR
    : labelText === 'Like'
    ? HEART_LIKE_COLOR
    : undefined;

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={loved ? 'Loved' : liked ? 'Liked' : 'Like'}
      aria-pressed={liked}
      onClick={handleClick}
      disabled={disabled}
      className={`${CARD_ACTION_BUTTON_BASE_CLASS} relative`}
      style={{
        ...CARD_ACTION_BUTTON_BASE_STYLE,
        ...(liked
          ? {
              color: heartColor,
              background: loved ? 'rgba(239,68,68,0.14)' : 'rgba(244,114,182,0.14)',
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 12px 24px ${
                loved ? 'rgba(239,68,68,0.16)' : 'rgba(244,114,182,0.14)'
              }`,
            }
          : CARD_ACTION_BUTTON_INACTIVE_STYLE),
      }}
    >
      <span
        className="relative inline-block transition-transform duration-300"
        style={{ width: 16, height: 16, transform: flashing ? 'scale(1.18)' : 'scale(1)' }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill={liked ? heartColor : 'none'}
          stroke={liked ? heartColor : 'currentColor'}
          strokeWidth="1.55"
          className="absolute inset-0 transition-all duration-300"
          style={{
            filter: liked ? `drop-shadow(0 0 5px ${heartColor}66)` : undefined,
          }}
        >
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      </span>

      <FloatingActionLabel
        triggerKey={labelTick || null}
        text={labelText}
        anchorRef={buttonRef}
        color={labelColor}
      />
    </button>
  );
};

export default HeartReactionButton;

