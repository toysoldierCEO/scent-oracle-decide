import React from "react";

import type { PlacementGuide, SprayPlacement } from "@/lib/sprayPlacement";
import { formatPlacementSummary } from "@/lib/sprayPlacement";
import { SPRAY_PLACEMENT_COORDINATES, type SprayPlacementSide } from "@/lib/sprayPlacementCoordinates";

type SprayPlacementMapProps = {
  guide?: PlacementGuide | null;
  placements?: SprayPlacement[];
  familyColor?: string | null;
  fragrance?: string | null;
  role?: string | null;
  compact?: boolean;
  accessibleLabel?: string;
  className?: string;
};

const SIDE_LABELS: Record<SprayPlacementSide, string> = {
  front: 'Front',
  back: 'Back',
};

const DOT_OFFSETS: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  2: [[-3.5, 0], [3.5, 0]],
  3: [[0, -3.2], [-3.6, 3.2], [3.6, 3.2]],
};

function groupPlacementsBySide(placements: SprayPlacement[]) {
  return placements.reduce<Record<SprayPlacementSide, SprayPlacement[]>>((groups, placement) => {
    const coordinate = SPRAY_PLACEMENT_COORDINATES[placement.location];
    groups[coordinate.side].push(placement);
    return groups;
  }, { front: [], back: [] });
}

function renderDots(placement: SprayPlacement, familyColor: string) {
  const coordinate = SPRAY_PLACEMENT_COORDINATES[placement.location];
  const cx = coordinate.x * 100;
  const cy = coordinate.y * 140;
  const offsets = DOT_OFFSETS[Math.min(placement.count, 3)];

  if (placement.count > 3) {
    return (
      <g
        key={`${placement.location}-${placement.optional ? 'optional' : 'required'}`}
        data-spray-placement-dot
        data-location={placement.location}
        data-count={placement.count}
        data-optional={placement.optional ? 'true' : 'false'}
      >
        <circle
          cx={cx}
          cy={cy}
          r="4.5"
          fill={familyColor}
          fillOpacity={placement.optional ? 0.4 : 0.95}
          stroke={familyColor}
          strokeOpacity="0.95"
          strokeWidth={placement.optional ? 1.8 : 0}
        />
        <text x={cx + 7} y={cy + 3.5} fill="rgba(255,255,255,0.86)" fontSize="8" fontWeight="700">
          x{placement.count}
        </text>
      </g>
    );
  }

  return offsets.map(([dx, dy], index) => (
    <circle
      key={`${placement.location}-${placement.optional ? 'optional' : 'required'}-${index}`}
      data-spray-placement-dot
      data-location={placement.location}
      data-count="1"
      data-optional={placement.optional ? 'true' : 'false'}
      cx={cx + dx}
      cy={cy + dy}
      r={placement.optional ? 3.8 : 4.2}
      fill={familyColor}
      fillOpacity={placement.optional ? 0.38 : 0.95}
      stroke={familyColor}
      strokeOpacity="0.95"
      strokeWidth={placement.optional ? 1.8 : 0}
    />
  ));
}

function BodySilhouette({
  side,
  placements,
  familyColor,
  compact,
}: {
  side: SprayPlacementSide;
  placements: SprayPlacement[];
  familyColor: string;
  compact?: boolean;
}) {
  return (
    <div
      className="flex min-w-[5.25rem] flex-1 flex-col items-center gap-1"
      data-spray-placement-side={side}
    >
      <svg
        className={compact ? "h-28 w-20" : "h-32 w-24"}
        viewBox="0 0 100 140"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`spray-body-${side}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.24)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.06)" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="17" r="11" fill={`url(#spray-body-${side})`} stroke="rgba(255,255,255,0.32)" strokeWidth="1" />
        <path
          d="M31 39 C36 31 64 31 69 39 L78 83 C80 92 72 98 66 90 L61 58 L61 125 L39 125 L39 58 L34 90 C28 98 20 92 22 83 Z"
          fill={`url(#spray-body-${side})`}
          stroke="rgba(255,255,255,0.32)"
          strokeWidth="1"
        />
        {side === 'back' && (
          <path d="M39 37 C45 43 55 43 61 37" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.2" />
        )}
        {placements.map((placement) => renderDots(placement, familyColor))}
      </svg>
      <span className="text-[8px] uppercase tracking-[0.18em] text-white/38">{SIDE_LABELS[side]}</span>
    </div>
  );
}

export default function SprayPlacementMap({
  guide,
  placements,
  familyColor,
  fragrance,
  role,
  compact,
  accessibleLabel,
  className = '',
}: SprayPlacementMapProps) {
  const resolvedPlacements = guide?.placements ?? placements ?? [];
  if (resolvedPlacements.length === 0) return null;

  const resolvedFragrance = guide?.fragrance ?? fragrance ?? 'Fragrance';
  const resolvedRole = guide?.role ?? role ?? 'Placement';
  const resolvedColor = guide?.colorToken ?? familyColor ?? '#888';
  const groups = groupPlacementsBySide(resolvedPlacements);
  const visibleSides = (['front', 'back'] as SprayPlacementSide[]).filter((side) => groups[side].length > 0);
  const summary = formatPlacementSummary(resolvedPlacements);

  return (
    <section
      className={`rounded-[18px] border bg-black/20 px-3 py-3 shadow-[0_12px_30px_rgba(0,0,0,0.22)] ${className}`}
      style={{
        borderColor: `${resolvedColor}44`,
        boxShadow: `0 0 0 1px ${resolvedColor}1f, 0 14px 32px rgba(0,0,0,0.24)`,
      }}
      data-spray-placement-map
      data-spray-placement-role={resolvedRole}
      data-spray-placement-fragrance={resolvedFragrance}
      aria-label={accessibleLabel ?? `${resolvedRole} ${resolvedFragrance}: ${summary}`}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 text-left">
          <div className="text-[8px] uppercase tracking-[0.2em] text-white/42">{resolvedRole}</div>
          <div className="truncate text-[12px] font-medium text-white/88">{resolvedFragrance}</div>
        </div>
        <div
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: resolvedColor, boxShadow: `0 0 14px ${resolvedColor}99` }}
          aria-hidden="true"
        />
      </div>
      <div className="flex gap-2">
        {visibleSides.map((side) => (
          <BodySilhouette
            key={side}
            side={side}
            placements={groups[side]}
            familyColor={resolvedColor}
            compact={compact}
          />
        ))}
      </div>
    </section>
  );
}
