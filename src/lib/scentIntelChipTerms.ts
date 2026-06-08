export type ScentIntelDisplayTerm = {
  label: string;
  slug?: string | null;
  position?: string | null;
};

const CANONICAL_SCENT_INTEL_DISPLAY_LABELS: Record<string, string> = {
  aldehydic: 'Aldehydic',
  amber: 'Amber',
  coffee: 'Coffee',
  frankincense: 'Frankincense',
  incense: 'Incense',
  myrrh: 'Myrrh',
  resins: 'Resins',
};

const AMBER_RESIN_INCENSE_COMPOSITES = new Set([
  'amber / resin / incense',
  'amber resin incense',
  'amber-resin-incense',
]);

function normalizeCompositeKey(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function normalizeScentIntelChipSlug(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[\/,+]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function resolveCanonicalScentIntelSlug(value: string | null | undefined) {
  const normalized = normalizeScentIntelChipSlug(value);
  if (!normalized) return '';

  switch (normalized) {
    case 'woody':
    case 'wood':
    case 'woods':
    case 'woody-accord':
      return 'woody';
    case 'leather':
    case 'leathery':
    case 'dark-leather':
    case 'suede':
    case 'leather-accord':
      return 'leather';
    case 'oudh':
    case 'oud':
      return 'oud';
    case 'olibanum':
    case 'frankincense':
    case 'frank-incense':
    case 'boswellia':
    case 'olibanum-resin':
    case 'frankincense-resin':
      return 'frankincense';
    case 'myrrhe':
    case 'myrrh':
      return 'myrrh';
    case 'smoke':
    case 'smoky':
    case 'smokey':
    case 'smoke-accord':
    case 'smoky-woods':
      return 'smoke';
    case 'marine':
    case 'aquatic':
    case 'marine-aquatic':
    case 'fresh-aquatic':
    case 'fresh-marine':
      return 'aquatic';
    case 'powder':
    case 'powdery':
      return 'powdery';
    case 'aldehydes':
    case 'aldehyde':
    case 'aldehydic':
    case 'aldehydic-notes':
    case 'aldehydic-note':
      return 'aldehydic';
    case 'ambery':
    case 'amber':
      return 'amber';
    case 'balsam':
    case 'balsamic':
      return 'balsamic';
    case 'resin':
    case 'resins':
    case 'resinous':
    case 'resin-material':
    case 'resin-materials':
    case 'resinous-material':
    case 'resinous-materials':
    case 'resin-note':
    case 'resin-notes':
    case 'resinous-note':
    case 'resinous-notes':
      return 'resins';
    case 'roasted-coffee':
    case 'coffee-roasted':
    case 'coffee-accord':
    case 'espresso':
      return 'coffee';
    case 'warm-spicy':
    case 'spices':
    case 'spice':
    case 'spicy':
      return 'spicy';
    case 'musk-clean':
    case 'clean-musk':
    case 'white-musk':
    case 'musk-clean-note':
      return 'musk';
    case 'green-notes':
    case 'green-note':
    case 'green-accord':
    case 'green':
      return 'green';
    case 'fresh-spicy':
    case 'spicy-fresh':
      return 'spicy';
    case 'amber-resin-and-incense':
      return 'amber-resin-incense';
    default:
      return normalized;
  }
}

function shouldUseCanonicalScentIntelDisplayLabel(value: string) {
  return !normalizeCompositeKey(value).includes('/');
}

export function getCanonicalScentIntelDisplayLabel(
  value: string | null | undefined,
  canonicalSlug?: string | null,
) {
  const cleanLabel = String(value ?? '').trim();
  if (!cleanLabel) return '';

  if (!shouldUseCanonicalScentIntelDisplayLabel(cleanLabel)) {
    return cleanLabel;
  }

  const resolvedSlug = canonicalSlug ?? resolveCanonicalScentIntelSlug(cleanLabel);
  return CANONICAL_SCENT_INTEL_DISPLAY_LABELS[resolvedSlug] ?? cleanLabel;
}

export function expandScentIntelDisplayTerm(term: ScentIntelDisplayTerm): ScentIntelDisplayTerm[] {
  const cleanLabel = String(term.label ?? '').trim();
  if (!cleanLabel) return [];

  const normalizedLabel = normalizeCompositeKey(cleanLabel);
  const resolvedSlug = resolveCanonicalScentIntelSlug(term.slug ?? cleanLabel);
  const normalizedSlug = normalizeCompositeKey(String(resolvedSlug ?? '').replace(/-/g, ' '));
  const isAmberResinIncenseComposite = AMBER_RESIN_INCENSE_COMPOSITES.has(normalizedLabel)
    || AMBER_RESIN_INCENSE_COMPOSITES.has(normalizedSlug);

  if (!isAmberResinIncenseComposite) {
    const canonicalLabel = getCanonicalScentIntelDisplayLabel(cleanLabel, resolvedSlug);
    return [{
      label: canonicalLabel,
      slug: resolvedSlug || term.slug || null,
      position: term.position ?? null,
    }];
  }

  return [
    { label: 'Amber', slug: 'amber', position: term.position ?? null },
    { label: 'Resins', slug: 'resins', position: term.position ?? null },
    { label: 'Incense', slug: 'incense', position: term.position ?? null },
  ];
}

export function expandAndDeduplicateScentIntelDisplayTerms(
  terms: Array<ScentIntelDisplayTerm | null | undefined>,
) {
  const expanded: ScentIntelDisplayTerm[] = [];
  const seen = new Set<string>();

  for (const term of terms) {
    if (!term) continue;
    for (const candidate of expandScentIntelDisplayTerm(term)) {
      const cleanLabel = String(candidate.label ?? '').trim();
      if (!cleanLabel) continue;
      const key = `${String(candidate.position ?? '').toLowerCase()}|${cleanLabel.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      expanded.push({
        label: cleanLabel,
        slug: candidate.slug ?? null,
        position: candidate.position ?? null,
      });
    }
  }

  return expanded;
}
