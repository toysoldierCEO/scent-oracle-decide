/**
 * ODARA Card System — shared design tokens.
 *
 * Cascade-first: any visual rule defined here is consumed by the main
 * signed-in card, guest card, and layer card surfaces. New card surfaces
 * should import from this module instead of redefining values inline.
 */

/* Digital instrument font stack used by TemperatureReadout (and any future
 * dashboard-style numeric readouts). 'Share Tech Mono' is loaded in
 * index.css and gives a refined digital-clock look without the cheap
 * 7-segment calculator aesthetic. */
export const DIGITAL_READOUT_FONT_STACK =
  "'Share Tech Mono', 'JetBrains Mono', 'SF Mono', 'IBM Plex Mono', 'Geist Mono', ui-monospace, monospace";

/* Action row — keeps star, heart, infinity visually identical and evenly spaced. */
export const CARD_ACTION_BUTTON_SIZE_PX = 40;        // h-10 / w-10
export const CARD_ACTION_ROW_GAP_CLASS = 'gap-10';
export const CARD_ACTION_BUTTON_BASE_CLASS =
  'flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300 active:scale-95';
export const CARD_ACTION_BUTTON_BASE_STYLE = {
  border: '1px solid rgba(255,255,255,0.06)',
  backdropFilter: 'blur(12px)',
} as const;
export const CARD_ACTION_BUTTON_INACTIVE_STYLE = {
  color: 'rgba(255,255,255,0.62)',
  background: 'rgba(255,255,255,0.035)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
} as const;

/* Heart reaction colors. Like = pink. Love = red. */
export const HEART_LIKE_COLOR = '#f472b6';   // pink-400
export const HEART_LOVE_COLOR = '#ef4444';   // red-500

/* Layer card depth — single, refined surface. No duplicate "ghost shelf". */
export const LAYER_CARD_OUTER_GLOW_OPACITY_HEX = '14'; // hex alpha (~8%)
export const LAYER_CARD_BORDER_ALPHA_HEX = '40';
