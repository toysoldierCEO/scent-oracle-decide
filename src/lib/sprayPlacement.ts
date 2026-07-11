import type { SprayPlacementLocation } from './sprayPlacementCoordinates';
import { SPRAY_PLACEMENT_COORDINATES } from './sprayPlacementCoordinates';

export type SprayPlacementRole = 'Anchor' | 'Layer' | 'Solo' | string;

export type SprayPlacement = {
  location: SprayPlacementLocation;
  count: number;
  optional?: boolean;
  sourceText?: string;
};

export type PlacementGuide = {
  fragrance: string;
  role: SprayPlacementRole;
  familyKey?: string | null;
  colorToken?: string | null;
  placements: SprayPlacement[];
};

const WORD_COUNTS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
};

const LOCATION_PATTERNS: Array<[SprayPlacementLocation, RegExp]> = [
  ['BACK_OF_HEAD', /\bback\s+of\s+(?:the\s+)?head\b/],
  ['BACK_NECK', /\b(?:back\s+neck|back\s+of\s+(?:the\s+)?neck)\b/],
  ['UPPER_CHEST', /\bupper\s+chest\b/],
  ['UPPER_SHIRT', /\bupper\s+shirt\b/],
  ['OUTER_LAYER', /\bouter\s+layer\b/],
  ['INNER_ELBOW', /\binner\s+elbow\b/],
  ['LEFT_WRIST', /\bleft\s+wrist\b/],
  ['RIGHT_WRIST', /\bright\s+wrist\b/],
  ['WRISTS', /\bwrists?\b/],
  ['CHEST', /\bchest\b/],
  ['NECK', /\bneck\b/],
  ['SHIRT', /\bshirt\b/],
  ['HAIR', /\bhair\b/],
];

function normalizePlacementText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function splitPlacementSegments(value: string) {
  return normalizePlacementText(value)
    .split(/\s*(?:[;•,/|]|\bor\b|\band\b)\s*/g)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function readSprayCount(segment: string) {
  const numericMatch = segment.match(/\b(\d+)\s+(?:light\s+|small\s+)?sprays?\b/);
  if (numericMatch) {
    return Math.max(1, Number(numericMatch[1]));
  }

  const wordMatch = segment.match(/\b(one|two|three|four)\s+(?:light\s+|small\s+)?sprays?\b/);
  if (wordMatch) {
    return WORD_COUNTS[wordMatch[1]] ?? null;
  }

  return null;
}

function readLocation(segment: string): SprayPlacementLocation | null {
  for (const [location, pattern] of LOCATION_PATTERNS) {
    if (pattern.test(segment)) return location;
  }
  return null;
}

function combinePlacements(placements: SprayPlacement[]) {
  const combined = new Map<string, SprayPlacement>();

  for (const placement of placements) {
    const key = `${placement.location}:${placement.optional ? 'optional' : 'required'}`;
    const existing = combined.get(key);
    if (existing) {
      existing.count += placement.count;
      existing.sourceText = [existing.sourceText, placement.sourceText].filter(Boolean).join(' | ');
      continue;
    }
    combined.set(key, { ...placement });
  }

  return Array.from(combined.values());
}

export function parseSprayPlacementText(value: string | null | undefined): SprayPlacement[] {
  if (!value?.trim()) return [];

  const placements: SprayPlacement[] = [];
  for (const segment of splitPlacementSegments(value)) {
    const location = readLocation(segment);
    if (!location) continue;

    const optional = /\boptional\b/.test(segment);
    const count = readSprayCount(segment) ?? (optional ? 1 : null);
    if (!count) continue;

    placements.push({
      location,
      count,
      optional,
      sourceText: segment,
    });
  }

  return combinePlacements(placements);
}

export function buildPlacementGuide({
  fragrance,
  role,
  familyKey,
  colorToken,
  placementText,
}: {
  fragrance: string | null | undefined;
  role: SprayPlacementRole;
  familyKey?: string | null;
  colorToken?: string | null;
  placementText: string | null | undefined;
}): PlacementGuide {
  return {
    fragrance: fragrance?.trim() || 'Fragrance',
    role,
    familyKey,
    colorToken,
    placements: parseSprayPlacementText(placementText),
  };
}

export function formatPlacementLocation(location: SprayPlacementLocation) {
  return SPRAY_PLACEMENT_COORDINATES[location].label;
}

export function formatPlacementSummary(placements: SprayPlacement[]) {
  return placements
    .map((placement) => {
      const countLabel = `${placement.count} spray${placement.count === 1 ? '' : 's'}`;
      return `${countLabel} ${formatPlacementLocation(placement.location)}${placement.optional ? ' optional' : ''}`;
    })
    .join(', ');
}
