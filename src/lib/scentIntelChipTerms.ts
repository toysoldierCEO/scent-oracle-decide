export type ScentIntelDisplayTerm = {
  label: string;
  slug?: string | null;
  position?: string | null;
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

export function expandScentIntelDisplayTerm(term: ScentIntelDisplayTerm): ScentIntelDisplayTerm[] {
  const cleanLabel = String(term.label ?? '').trim();
  if (!cleanLabel) return [];

  const normalizedLabel = normalizeCompositeKey(cleanLabel);
  const normalizedSlug = normalizeCompositeKey(String(term.slug ?? '').replace(/-/g, ' '));
  const isAmberResinIncenseComposite = AMBER_RESIN_INCENSE_COMPOSITES.has(normalizedLabel)
    || AMBER_RESIN_INCENSE_COMPOSITES.has(normalizedSlug);

  if (!isAmberResinIncenseComposite) {
    return [{
      label: cleanLabel,
      slug: term.slug ?? null,
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
