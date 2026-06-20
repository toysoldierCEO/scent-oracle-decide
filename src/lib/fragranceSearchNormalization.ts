export type FragranceSearchCandidate = {
  name?: unknown;
  brand?: unknown;
  family?: unknown;
  familyLabel?: unknown;
  notes?: unknown[];
  accords?: unknown[];
  aliases?: unknown[];
};

const DIACRITIC_RE = /[\u0300-\u036f]/g;
const ALPHA_NUM_BOUNDARY_RE = /([a-z])(\d)/gi;
const NUM_ALPHA_BOUNDARY_RE = /(\d)([a-z])/gi;

export function normalizeFragranceSearchText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(DIACRITIC_RE, '')
    .replace(/[’‘`´]/g, "'")
    .replace(/#/g, ' ')
    .replace(ALPHA_NUM_BOUNDARY_RE, '$1 $2')
    .replace(NUM_ALPHA_BOUNDARY_RE, '$1 $2')
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function buildFragranceSearchTokens(value: unknown): string[] {
  const normalized = normalizeFragranceSearchText(value);
  if (!normalized) return [];
  return Array.from(new Set(normalized.split(/\s+/).filter(Boolean)));
}

function flattenSearchValues(values: unknown[]): unknown[] {
  const flattened: unknown[] = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      flattened.push(...flattenSearchValues(value));
    } else {
      flattened.push(value);
    }
  }
  return flattened;
}

function tokenMatches(queryToken: string, candidateToken: string): boolean {
  if (!queryToken || !candidateToken) return false;
  if (/^\d+$/.test(queryToken)) {
    return candidateToken === queryToken;
  }
  return candidateToken === queryToken
    || candidateToken.startsWith(queryToken)
    || candidateToken.includes(queryToken);
}

export function matchesFragranceSearchQuery(query: unknown, values: unknown[]): boolean {
  const queryTokens = buildFragranceSearchTokens(query);
  if (queryTokens.length === 0) return true;

  const candidateTokens = buildFragranceSearchTokens(flattenSearchValues(values).join(' '));
  if (candidateTokens.length === 0) return false;

  return queryTokens.every((queryToken) => (
    candidateTokens.some((candidateToken) => tokenMatches(queryToken, candidateToken))
  ));
}

function scoreTokenAgainstTokens(queryToken: string, candidateTokens: string[], weight: number): number {
  if (/^\d+$/.test(queryToken)) {
    return candidateTokens.includes(queryToken) ? weight : 0;
  }
  let best = 0;
  for (const candidateToken of candidateTokens) {
    if (candidateToken === queryToken) best = Math.max(best, weight);
    else if (candidateToken.startsWith(queryToken)) best = Math.max(best, weight * 0.75);
    else if (candidateToken.includes(queryToken)) best = Math.max(best, weight * 0.45);
  }
  return best;
}

export function scoreFragranceSearchCandidate(
  query: unknown,
  candidate: FragranceSearchCandidate,
): number {
  const normalizedQuery = normalizeFragranceSearchText(query);
  const queryTokens = buildFragranceSearchTokens(normalizedQuery);
  if (!normalizedQuery || queryTokens.length === 0) return 0;

  const nameText = normalizeFragranceSearchText(candidate.name);
  const brandText = normalizeFragranceSearchText(candidate.brand);
  const familyText = normalizeFragranceSearchText(candidate.familyLabel ?? candidate.family);
  const noteText = normalizeFragranceSearchText(candidate.notes ?? []);
  const accordText = normalizeFragranceSearchText(candidate.accords ?? []);
  const aliasText = normalizeFragranceSearchText(candidate.aliases ?? []);
  const allValues = [nameText, brandText, familyText, noteText, accordText, aliasText].filter(Boolean);

  if (!matchesFragranceSearchQuery(normalizedQuery, allValues)) return 0;

  const nameTokens = buildFragranceSearchTokens(nameText);
  const brandTokens = buildFragranceSearchTokens(brandText);
  const familyTokens = buildFragranceSearchTokens(familyText);
  const noteTokens = buildFragranceSearchTokens(noteText);
  const accordTokens = buildFragranceSearchTokens(accordText);
  const aliasTokens = buildFragranceSearchTokens(aliasText);

  let score = 0;
  if (nameText === normalizedQuery) score += 80;
  else if (nameText.startsWith(normalizedQuery)) score += 34;
  else if (nameText.includes(normalizedQuery)) score += 24;

  if (brandText === normalizedQuery) score += 28;
  else if (brandText.startsWith(normalizedQuery)) score += 14;
  else if (brandText.includes(normalizedQuery)) score += 8;

  for (const token of queryTokens) {
    score += scoreTokenAgainstTokens(token, nameTokens, 12);
    score += scoreTokenAgainstTokens(token, brandTokens, 6);
    score += scoreTokenAgainstTokens(token, familyTokens, 2);
    score += scoreTokenAgainstTokens(token, noteTokens, 2);
    score += scoreTokenAgainstTokens(token, accordTokens, 1);
    score += scoreTokenAgainstTokens(token, aliasTokens, 8);
  }

  return score;
}

export function buildFragranceSearchBackendQueryVariants(query: unknown): string[] {
  const normalized = normalizeFragranceSearchText(query);
  const tokens = buildFragranceSearchTokens(normalized);
  const variants = new Set<string>();
  if (normalized) variants.add(normalized);

  const textOnly = tokens.filter((token) => !/^\d+$/.test(token)).join(' ');
  if (textOnly.length >= 3) variants.add(textOnly);

  return Array.from(variants).slice(0, 3);
}
