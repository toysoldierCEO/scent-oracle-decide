import React, { useEffect, useRef, useState } from 'react';
import {
  CARD_ACTION_BUTTON_BASE_CLASS,
  CARD_ACTION_BUTTON_BASE_STYLE,
  CARD_ACTION_BUTTON_INACTIVE_STYLE,
  HEART_LIKE_COLOR,
  HEART_LOVE_COLOR,
} from './tokens';

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
  const [labelText, setLabelText] = useState<string | null>(null);
  const labelTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (labelTimer.current) window.clearTimeout(labelTimer.current);
  }, []);

  const liked = state >= 1;
  const loved = state === 2;
  const heartColor = loved ? HEART_LOVE_COLOR : liked ? HEART_LIKE_COLOR : undefined;

  const handleClick = () => {
    if (disabled) return;
    const next: HeartState = state === 0 ? 1 : state === 1 ? 2 : 0;
    onChange(next);
    setFlashAt(Date.now());
    onHaptic?.(next === 2 ? 'medium' : 'light');

    // Floating micro-label
    if (next === 1) setLabelText('Like');
    else if (next === 2) setLabelText('Love');
    else setLabelText(null);

    if (labelTimer.current) window.clearTimeout(labelTimer.current);
    if (next !== 0) {
      labelTimer.current = window.setTimeout(() => setLabelText(null), 1100);
    }
  };

  const flashing = flashAt && Date.now() - flashAt < 320;

  return (
    <button
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

      {/* Floating micro-label — appears just BELOW the button, fades out */}
      {labelText && (
        <span
          key={labelText + flashAt}
          className="pointer-events-none absolute left-1/2 -bottom-6 -translate-x-1/2 whitespace-nowrap text-[9.5px] uppercase tracking-[0.2em] px-2 py-[2px] rounded-full"
          style={{
            color: heartColor ?? 'rgba(255,255,255,0.85)',
            background: 'rgba(10,10,12,0.78)',
            border: `1px solid ${heartColor ?? 'rgba(255,255,255,0.12)'}55`,
            backdropFilter: 'blur(10px)',
            animation: 'actionLabelPop 1100ms cubic-bezier(0.2,0,0,1) forwards',
          }}
        >
          {labelText}
        </span>
      )}
    </button>
  );
};

export default HeartReactionButton;
