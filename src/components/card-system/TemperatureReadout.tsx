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
        'leading-none text-foreground/85 ' +
        (className ?? 'text-[26px] tracking-[0.04em] font-normal')
      }
      style={{
        fontFamily: DIGITAL_READOUT_FONT_STACK,
        fontVariantNumeric: 'tabular-nums',
        textShadow: '0 0 10px rgba(255,255,255,0.10), 0 0 22px rgba(255,255,255,0.04)',
      }}
    >
      {value}°
    </span>
  );
};

export default TemperatureReadout;
