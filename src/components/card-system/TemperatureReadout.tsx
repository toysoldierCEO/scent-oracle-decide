import React from 'react';
import { DIGITAL_READOUT_FONT_STACK } from './tokens';

interface TemperatureReadoutProps {
  /** Temperature value already resolved to display units (no conversion done here). */
  value: number | string;
  /** Optional className for sizing/positioning overrides. */
  className?: string;
}

/**
 * TemperatureReadout — premium digital-instrument numeric display.
 *
 * Used by both signed-in and guest main cards (and any future card surface
 * that needs a temperature-like readout). Visual language is centralized
 * here so future tweaks cascade everywhere.
 */
const TemperatureReadout: React.FC<TemperatureReadoutProps> = ({ value, className }) => {
  return (
    <span
      data-temperature-readout
      className={
        'leading-none text-foreground/90 ' +
        (className ?? 'text-[24px] tracking-[0.02em] font-normal')
      }
      style={{
        fontFamily: DIGITAL_READOUT_FONT_STACK,
        fontVariantNumeric: 'tabular-nums',
        textShadow:
          '0 0 8px rgba(255,255,255,0.12), 0 0 18px rgba(255,255,255,0.05)',
      }}
    >
      {value}°
    </span>
  );
};

export default TemperatureReadout;
