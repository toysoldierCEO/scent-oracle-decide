import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface FloatingActionLabelProps {
  /** Render-key — when this changes, the label re-pops. */
  triggerKey: string | number | null;
  /** Visible label text. */
  text: string | null;
  /** Anchor element — label centers horizontally and floats just below it. */
  anchorRef: React.RefObject<HTMLElement>;
  /** Optional accent color (hex/rgb). Defaults to neutral white. */
  color?: string;
  /** Auto-dismiss in ms. Default 1100. */
  duration?: number;
  /** Vertical offset (px) from anchor bottom. Default 8. */
  offsetY?: number;
}

/**
 * FloatingActionLabel — renders the micro-feedback label in a portal so it
 * is NEVER clipped by the parent card's overflow:hidden / border-radius.
 *
 * Position is computed from the anchor's bounding rect and updates on
 * scroll/resize while visible. Label feels attached to the button while
 * visually floating above the card.
 */
const FloatingActionLabel: React.FC<FloatingActionLabelProps> = ({
  triggerKey,
  text,
  anchorRef,
  color,
  duration = 2600,
  offsetY = 8,
}) => {
  const [visibleText, setVisibleText] = useState<string | null>(null);
  const [renderKey, setRenderKey] = useState(0);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const recompute = () => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: r.left + r.width / 2, y: r.bottom + offsetY });
  };

  useLayoutEffect(() => {
    if (!text || triggerKey === null) {
      setVisibleText(null);
      return;
    }
    recompute();
    setVisibleText(text);
    setRenderKey((k) => k + 1);
    const id = window.setTimeout(() => setVisibleText(null), duration);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey]);

  useEffect(() => {
    if (!visibleText) return;
    const onChange = () => recompute();
    window.addEventListener('scroll', onChange, true);
    window.addEventListener('resize', onChange);
    return () => {
      window.removeEventListener('scroll', onChange, true);
      window.removeEventListener('resize', onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleText]);

  if (!visibleText || !pos || typeof document === 'undefined') return null;

  return createPortal(
    <span
      key={renderKey}
      className="pointer-events-none fixed whitespace-nowrap text-[9.5px] uppercase tracking-[0.2em] px-2 py-[2px] rounded-full z-[120]"
      style={{
        left: pos.x,
        top: pos.y,
        transform: 'translate(-50%, 0)',
        color: color ?? 'rgba(255,255,255,0.86)',
        background: 'rgba(10,10,12,0.82)',
        border: `1px solid ${color ?? 'rgba(255,255,255,0.14)'}55`,
        backdropFilter: 'blur(10px)',
        animation: `actionLabelPop ${duration}ms cubic-bezier(0.2,0,0,1) forwards`,
      }}
    >
      {visibleText}
    </span>,
    document.body,
  );
};

export default FloatingActionLabel;
