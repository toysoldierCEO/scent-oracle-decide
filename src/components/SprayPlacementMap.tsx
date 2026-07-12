import React from "react";

import type { PlacementGuide, SprayPlacement } from "@/lib/sprayPlacement";
import { formatPlacementSummary } from "@/lib/sprayPlacement";
import {
  SPRAY_PLACEMENT_COORDINATES,
  type SprayPlacementLocation,
} from "@/lib/sprayPlacementCoordinates";

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

type SprayPlacementSurface = 'skin' | 'clothing';

const CLOTHING_LOCATIONS = new Set<SprayPlacementLocation>(['SHIRT', 'UPPER_SHIRT', 'OUTER_LAYER']);

const DOT_OFFSETS: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  2: [[-3.5, 0], [3.5, 0]],
  3: [[0, -3.2], [-3.6, 3.2], [3.6, 3.2]],
};

function getPlacementSurface(location: SprayPlacementLocation): SprayPlacementSurface {
  return CLOTHING_LOCATIONS.has(location) ? 'clothing' : 'skin';
}

function groupPlacementsBySurface(placements: SprayPlacement[]) {
  return placements.reduce<Record<SprayPlacementSurface, SprayPlacement[]>>((groups, placement) => {
    groups[getPlacementSurface(placement.location)].push(placement);
    return groups;
  }, { skin: [], clothing: [] });
}

function getVisualCoordinate(placement: SprayPlacement) {
  if (getPlacementSurface(placement.location) === 'clothing') {
    return { x: 0.5, y: 0.48 };
  }

  return SPRAY_PLACEMENT_COORDINATES[placement.location];
}

function getVisualLocation(placement: SprayPlacement): SprayPlacementLocation {
  return getPlacementSurface(placement.location) === 'clothing' ? 'SHIRT' : placement.location;
}

function renderDots(placement: SprayPlacement, familyColor: string) {
  const coordinate = getVisualCoordinate(placement);
  const cx = coordinate.x * 100;
  const cy = coordinate.y * 140;
  const offsets = DOT_OFFSETS[Math.min(placement.count, 3)];
  const visualLocation = getVisualLocation(placement);
  const surface = getPlacementSurface(placement.location);

  if (placement.count > 3) {
    return (
      <g
        key={`${placement.location}-${placement.optional ? 'optional' : 'required'}`}
        data-spray-placement-dot
        data-location={visualLocation}
        data-semantic-location={placement.location}
        data-spray-placement-surface={surface}
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
      data-location={visualLocation}
      data-semantic-location={placement.location}
      data-spray-placement-surface={surface}
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

function BodyIcon({
  placements,
  familyColor,
  compact,
}: {
  placements: SprayPlacement[];
  familyColor: string;
  compact?: boolean;
}) {
  return (
    <div
      className="flex min-w-[5.25rem] flex-1 flex-col items-center gap-1"
      data-spray-placement-surface="skin"
      data-spray-placement-icon="body"
    >
      <svg
        className={compact ? "h-28 w-20" : "h-32 w-24"}
        viewBox="0 0 100 140"
        aria-hidden="true"
      >
        <circle cx="50" cy="17" r="11" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.44)" strokeWidth="1.4" />
        <path
          d="M31 39 C36 31 64 31 69 39 L78 83 C80 92 72 98 66 90 L61 58 L61 125 L39 125 L39 58 L34 90 C28 98 20 92 22 83 Z"
          fill="rgba(255,255,255,0.045)"
          stroke="rgba(255,255,255,0.44)"
          strokeWidth="1.4"
        />
        {placements.map((placement) => renderDots(placement, familyColor))}
      </svg>
    </div>
  );
}

function ShirtIcon({
  placements,
  familyColor,
  compact,
}: {
  placements: SprayPlacement[];
  familyColor: string;
  compact?: boolean;
}) {
  return (
    <div
      className="flex min-w-[5.25rem] flex-1 flex-col items-center gap-1"
      data-spray-placement-surface="clothing"
      data-spray-placement-icon="shirt"
    >
      <svg
        className={compact ? "h-28 w-20" : "h-32 w-24"}
        viewBox="0 0 100 140"
        aria-hidden="true"
      >
        <path
          d="M35 32 L44 26 H56 L65 32 L82 45 L72 61 L64 55 V121 H36 V55 L28 61 L18 45 Z"
          fill="rgba(255,255,255,0.045)"
          stroke="rgba(255,255,255,0.44)"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path
          d="M44 26 C46 34 54 34 56 26"
          fill="none"
          stroke="rgba(255,255,255,0.32)"
          strokeWidth="1.2"
        />
        {placements.map((placement) => renderDots(placement, familyColor))}
      </svg>
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
  const groups = groupPlacementsBySurface(resolvedPlacements);
  const visibleSurfaces = (['skin', 'clothing'] as SprayPlacementSurface[]).filter((surface) => groups[surface].length > 0);
  const summary = formatPlacementSummary(resolvedPlacements);

  return (
    <section
      className={`rounded-[18px] border bg-black/20 px-3 py-3 ${className}`}
      style={{
        borderColor: `${resolvedColor}44`,
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
          style={{ backgroundColor: resolvedColor }}
          aria-hidden="true"
        />
      </div>
      <div className="flex gap-2">
        {visibleSurfaces.includes('skin') && (
          <BodyIcon placements={groups.skin} familyColor={resolvedColor} compact={compact} />
        )}
        {visibleSurfaces.includes('clothing') && (
          <ShirtIcon placements={groups.clothing} familyColor={resolvedColor} compact={compact} />
        )}
      </div>
    </section>
  );
}
