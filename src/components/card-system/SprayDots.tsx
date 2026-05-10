type SprayCountSource = {
  anchor_sprays?: number | string | null;
  anchorSprays?: number | string | null;
  hero_sprays?: number | string | null;
  heroSprays?: number | string | null;
  main_sprays?: number | string | null;
  mainSprays?: number | string | null;
  base_sprays?: number | string | null;
  baseSprays?: number | string | null;
  layer_sprays?: number | string | null;
  layerSprays?: number | string | null;
  top_sprays?: number | string | null;
  topSprays?: number | string | null;
  support_sprays?: number | string | null;
  supportSprays?: number | string | null;
  spray_map?: unknown;
  sprayMap?: unknown;
  zone_spray_map?: unknown;
  zoneSprayMap?: unknown;
  ratio_hint?: string | null;
  ratioHint?: string | null;
  placement_hint?: string | null;
  placementHint?: string | null;
  spray_guidance?: string | null;
  sprayGuidance?: string | null;
};

type DerivedSprayCounts = {
  main: number | null;
  layer: number | null;
};

const MAX_VISIBLE_SPRAY_DOTS = 4;

function toPositiveSprayCount(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.max(1, Math.min(MAX_VISIBLE_SPRAY_DOTS, Math.round(value)));
  }

  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d{1,2})$/);
    if (match) {
      const numericValue = Number.parseInt(match[1], 10);
      if (numericValue > 0) {
        return Math.max(1, Math.min(MAX_VISIBLE_SPRAY_DOTS, numericValue));
      }
    }
  }

  return null;
}

function extractCountFromNestedSource(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  return (
    toPositiveSprayCount(source.sprays)
    ?? toPositiveSprayCount(source.count)
    ?? toPositiveSprayCount(source.total)
    ?? null
  );
}

function extractCountsFromStructuredSource(value: unknown): DerivedSprayCounts | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;

  const main = (
    toPositiveSprayCount(source.anchor_sprays)
    ?? toPositiveSprayCount(source.anchorSprays)
    ?? toPositiveSprayCount(source.hero_sprays)
    ?? toPositiveSprayCount(source.heroSprays)
    ?? toPositiveSprayCount(source.main_sprays)
    ?? toPositiveSprayCount(source.mainSprays)
    ?? toPositiveSprayCount(source.base_sprays)
    ?? toPositiveSprayCount(source.baseSprays)
    ?? extractCountFromNestedSource(source.anchor)
    ?? extractCountFromNestedSource(source.hero)
    ?? extractCountFromNestedSource(source.main)
    ?? extractCountFromNestedSource(source.base)
  );
  const layer = (
    toPositiveSprayCount(source.layer_sprays)
    ?? toPositiveSprayCount(source.layerSprays)
    ?? toPositiveSprayCount(source.top_sprays)
    ?? toPositiveSprayCount(source.topSprays)
    ?? toPositiveSprayCount(source.support_sprays)
    ?? toPositiveSprayCount(source.supportSprays)
    ?? extractCountFromNestedSource(source.layer)
    ?? extractCountFromNestedSource(source.top)
    ?? extractCountFromNestedSource(source.support)
  );

  if (main || layer) {
    return { main, layer };
  }

  return null;
}

function deriveCountsFromRatioText(value: unknown): DerivedSprayCounts | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/\b([1-9])\s*:\s*([1-9])\b/);
  if (!match) return null;
  return {
    main: toPositiveSprayCount(match[1]),
    layer: toPositiveSprayCount(match[2]),
  };
}

function deriveCountsFromGenericPlacementText(value: unknown): DerivedSprayCounts | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;

  const equalMatch = text.match(/\b(one|1)\s+spray\s+each\b/i);
  if (equalMatch) {
    return { main: 1, layer: 1 };
  }

  const mainMatch = text.match(/\b(anchor|hero|main|base)\s*:\s*(\d)\s*sprays?\b/i);
  const layerMatch = text.match(/\b(layer|top|support)\s*:\s*(\d)\s*sprays?\b/i);
  if (mainMatch || layerMatch) {
    return {
      main: mainMatch ? toPositiveSprayCount(mainMatch[2]) : null,
      layer: layerMatch ? toPositiveSprayCount(layerMatch[2]) : null,
    };
  }

  return null;
}

export function deriveSprayCountsFromLayerMode(source: SprayCountSource | null | undefined): DerivedSprayCounts {
  if (!source) {
    return { main: null, layer: null };
  }

  const explicit = {
    main: (
      toPositiveSprayCount(source.anchor_sprays)
      ?? toPositiveSprayCount(source.anchorSprays)
      ?? toPositiveSprayCount(source.hero_sprays)
      ?? toPositiveSprayCount(source.heroSprays)
      ?? toPositiveSprayCount(source.main_sprays)
      ?? toPositiveSprayCount(source.mainSprays)
      ?? toPositiveSprayCount(source.base_sprays)
      ?? toPositiveSprayCount(source.baseSprays)
    ),
    layer: (
      toPositiveSprayCount(source.layer_sprays)
      ?? toPositiveSprayCount(source.layerSprays)
      ?? toPositiveSprayCount(source.top_sprays)
      ?? toPositiveSprayCount(source.topSprays)
      ?? toPositiveSprayCount(source.support_sprays)
      ?? toPositiveSprayCount(source.supportSprays)
    ),
  };
  if (explicit.main || explicit.layer) {
    return explicit;
  }

  const structured = extractCountsFromStructuredSource(source.spray_map ?? source.sprayMap ?? source.zone_spray_map ?? source.zoneSprayMap);
  if (structured) {
    return structured;
  }

  const ratioCounts = deriveCountsFromRatioText(source.ratio_hint ?? source.ratioHint ?? null);
  if (ratioCounts) {
    return ratioCounts;
  }

  const genericPlacementCounts = deriveCountsFromGenericPlacementText(
    source.placement_hint
      ?? source.placementHint
      ?? source.spray_guidance
      ?? source.sprayGuidance
      ?? null,
  );
  if (genericPlacementCounts) {
    return genericPlacementCounts;
  }

  return { main: null, layer: null };
}

interface SprayDotsProps {
  count: number | null | undefined;
  color: string;
  className?: string;
}

export function SprayDots({ count, color, className }: SprayDotsProps) {
  const visibleCount = toPositiveSprayCount(count);
  if (!visibleCount) return null;

  return (
    <span
      aria-hidden="true"
      className={className ?? "inline-flex items-center gap-1"}
    >
      {Array.from({ length: visibleCount }).map((_, index) => (
        <span
          key={`spray-dot-${index}`}
          className="inline-block h-[5px] w-[5px] rounded-full"
          style={{
            backgroundColor: color,
            opacity: 0.82,
            boxShadow: `0 0 0 1px ${color}22`,
          }}
        />
      ))}
    </span>
  );
}
