export type SoloWearGuideLane =
  | 'sweet_gourmand'
  | 'fresh_aquatic'
  | 'woody_oud'
  | 'musk_skin'
  | 'aromatic_spicy'
  | 'floral'
  | 'fallback';

export type SoloWearGuideInput = {
  name?: string | null;
  brand?: string | null;
  family?: string | null;
  family_key?: string | null;
  familyKey?: string | null;
  family_label?: string | null;
  familyLabel?: string | null;
  accords?: unknown;
  notes?: unknown;
  top_notes?: unknown;
  topNotes?: unknown;
  heart_notes?: unknown;
  middle_notes?: unknown;
  middleNotes?: unknown;
  base_notes?: unknown;
  baseNotes?: unknown;
  profileChips?: unknown;
};

export type SoloWearGuide = {
  title: 'Wear Solo';
  placement: string;
  whyItWorks: string;
  caution?: string;
  matchedLane: SoloWearGuideLane;
};

type LaneDefinition = {
  lane: SoloWearGuideLane;
  terms: string[];
  placement: string;
  whyItWorks: string;
};

const FALLBACK_GUIDE: SoloWearGuide = {
  title: 'Wear Solo',
  placement: '2 sprays chest • 1 spray back neck',
  whyItWorks: 'Wear it focused and clean on its own. This keeps the profile clear without forcing a layer.',
  matchedLane: 'fallback',
};

const LANE_DEFINITIONS: LaneDefinition[] = [
  {
    lane: 'sweet_gourmand',
    terms: [
      'sweet',
      'gourmand',
      'amber',
      'vanilla',
      'honey',
      'coffee',
      'tonka',
      'caramel',
      'praline',
      'chocolate',
      'cacao',
      'cocoa',
      'sugar',
      'benzoin',
    ],
    placement: '2 sprays chest • 1 spray back neck',
    whyItWorks: 'Already rich enough to carry on its own. Chest keeps the warmth close; back neck gives it a soft trail without making it heavy.',
  },
  {
    lane: 'fresh_aquatic',
    terms: [
      'fresh',
      'citrus',
      'aquatic',
      'green',
      'clean',
      'ozonic',
      'bergamot',
      'grapefruit',
      'lemon',
      'lime',
      'orange',
      'cucumber',
      'sea air',
      'marine',
      'water',
      'mint',
    ],
    placement: '2 sprays neck • 1 spray chest',
    whyItWorks: 'Fresher profiles lift best with a little air. Wearing it higher keeps it bright without overloading the room.',
  },
  {
    lane: 'woody_oud',
    terms: [
      'woody',
      'wood',
      'woods',
      'cedar',
      'sandalwood',
      'vetiver',
      'oud',
      'agarwood',
      'resin',
      'leather',
      'suede',
      'incense',
      'smoky',
      'smoke',
      'patchouli',
      'labdanum',
      'copaiba',
      'birch tar',
    ],
    placement: '1 spray chest • 1 spray back neck • optional wrist',
    whyItWorks: 'Darker materials already have weight. Keeping most of it close makes it smoother while one trail point gives it presence.',
  },
  {
    lane: 'musk_skin',
    terms: [
      'musk',
      'musky',
      'molecule',
      'skin scent',
      'skin',
      'ambroxan',
      'iso e',
      'iso e super',
      'cashmeran',
      'ambrette',
    ],
    placement: '2 sprays chest • 1 spray inner elbow',
    whyItWorks: 'Skin-close scents work with warmth and movement. Keep it near pulse points so it blooms gradually.',
  },
  {
    lane: 'aromatic_spicy',
    terms: [
      'spicy',
      'spice',
      'aromatic',
      'fougere',
      'lavender',
      'herbal',
      'rosemary',
      'sage',
      'basil',
      'thyme',
      'cardamom',
      'pepper',
      'cinnamon',
      'clove',
      'nutmeg',
      'ginger',
    ],
    placement: '1 spray neck • 2 sprays chest',
    whyItWorks: 'Aromatic spice reads cleanest when it has air. Keep one spray high and the rest close to the body.',
  },
  {
    lane: 'floral',
    terms: [
      'floral',
      'flower',
      'iris',
      'orris',
      'rose',
      'white floral',
      'jasmine',
      'tuberose',
      'orange blossom',
      'ylang ylang',
      'violet',
      'geranium',
    ],
    placement: '1 spray chest • 1 spray neck • 1 spray back neck',
    whyItWorks: 'Florals carry best with space around them. This keeps the profile clear without turning it sharp.',
  },
];

function normalizeText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function extractTextValues(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(extractTextValues);
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return [
      record.label,
      record.name,
      record.note,
      record.token_label,
      record.term,
      record.value,
    ].flatMap(extractTextValues);
  }

  return [];
}

function hasTerm(signal: string, term: string) {
  const normalizedTerm = normalizeText(term);
  if (!normalizedTerm) return false;
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(signal);
}

function addSignals(signals: Array<{ value: string; weight: number }>, value: unknown, weight: number) {
  for (const raw of extractTextValues(value)) {
    const normalized = normalizeText(raw);
    if (normalized) {
      signals.push({ value: normalized, weight });
    }
  }
}

function collectSignals(input: SoloWearGuideInput | null | undefined) {
  const signals: Array<{ value: string; weight: number }> = [];
  if (!input) return signals;

  addSignals(signals, input.top_notes ?? input.topNotes, 3);
  addSignals(signals, input.heart_notes ?? input.middle_notes ?? input.middleNotes, 3);
  addSignals(signals, input.base_notes ?? input.baseNotes, 3);
  addSignals(signals, input.notes, 2);
  addSignals(signals, input.accords, 2);
  addSignals(signals, input.profileChips, 1);
  addSignals(signals, input.family_key ?? input.familyKey ?? input.family, 2);
  addSignals(signals, input.family_label ?? input.familyLabel, 2);

  return signals;
}

export function resolveSoloWearGuide(input: SoloWearGuideInput | null | undefined): SoloWearGuide {
  const signals = collectSignals(input);
  if (signals.length === 0) {
    return { ...FALLBACK_GUIDE };
  }

  let bestLane: LaneDefinition | null = null;
  let bestScore = 0;

  for (const laneDefinition of LANE_DEFINITIONS) {
    let score = 0;
    for (const signal of signals) {
      for (const term of laneDefinition.terms) {
        if (hasTerm(signal.value, term)) {
          score += signal.weight;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestLane = laneDefinition;
    }
  }

  if (!bestLane) {
    return { ...FALLBACK_GUIDE };
  }

  return {
    title: 'Wear Solo',
    placement: bestLane.placement,
    whyItWorks: bestLane.whyItWorks,
    matchedLane: bestLane.lane,
  };
}
