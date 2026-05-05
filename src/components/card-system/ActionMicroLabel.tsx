import React, { useEffect, useState } from 'react';

interface ActionMicroLabelProps {
  /** Render-key — when this changes, the label re-pops. */
  triggerKey: string | number | null;
  /** Visible label text. Pass empty string / null to hide. */
  text: string | null;
  /** Optional accent color (hex/rgb). Defaults to neutral white. */
  color?: string;
  /** Auto-dismiss in ms. Default 1100. */
  duration?: number;
}

/**
 * ActionMicroLabel — tiny floating label that appears UNDER an action button.
 *
 * Used by Favorite / Like / Love / Daisy Chain. Centralized so any future
 * card action inherits the same lightweight micro-feedback aesthetic.
 *
 * Parent should give its button `position: relative` and render this as a
 * child sibling of the icon.
 */
const ActionMicroLabel: React.FC<ActionMicroLabelProps> = ({
  triggerKey,
  text,
  color,
  duration = 1100,
}) => {
  const [visibleText, setVisibleText] = useState<string | null>(null);
  const [renderKey, setRenderKey] = useState(0);

  useEffect(() => {
    if (!text || triggerKey === null) {
      setVisibleText(null);
      return;
    }
    setVisibleText(text);
    setRenderKey((k) => k + 1);
    const id = window.setTimeout(() => setVisibleText(null), duration);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey]);

  if (!visibleText) return null;

  return (
    <span
      key={renderKey}
      className="pointer-events-none absolute left-1/2 -bottom-6 -translate-x-1/2 whitespace-nowrap text-[9.5px] uppercase tracking-[0.2em] px-2 py-[2px] rounded-full"
      style={{
        color: color ?? 'rgba(255,255,255,0.86)',
        background: 'rgba(10,10,12,0.78)',
        border: `1px solid ${color ?? 'rgba(255,255,255,0.12)'}55`,
        backdropFilter: 'blur(10px)',
        animation: 'actionLabelPop 1100ms cubic-bezier(0.2,0,0,1) forwards',
      }}
    >
      {visibleText}
    </span>
  );
};

export default ActionMicroLabel;
