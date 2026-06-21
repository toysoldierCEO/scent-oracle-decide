import { existsSync, readFileSync } from "node:fs";

export const FRAGELLA_PROVIDER_NAME = "Fragella";
export const FRAGELLA_DEFAULT_API_BASE_URL = "https://api.fragella.com/api/v1";

const LOCAL_ENV_KEYS = new Set([
  "FRAGELLA_API_KEY",
  "FRAGRELLA_API_KEY",
  "FRAGELLA_API_BASE_URL",
  "FRAGRELLA_API_BASE_URL",
]);

export function loadFragellaLocalEnv(filePath = ".env.local", env = process.env) {
  if (!existsSync(filePath)) {
    return {
      file_exists: false,
      loaded: false,
      fragella_key_visible: Boolean(env.FRAGELLA_API_KEY),
      legacy_fragrella_key_visible: Boolean(env.FRAGRELLA_API_KEY),
    };
  }

  const contents = readFileSync(filePath, "utf8");
  let loaded = false;
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalizedLine = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const separatorIndex = normalizedLine.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = normalizedLine.slice(0, separatorIndex).trim();
    if (!LOCAL_ENV_KEYS.has(key) || env[key]) continue;
    env[key] = parseEnvValue(normalizedLine.slice(separatorIndex + 1));
    loaded = true;
  }

  return {
    file_exists: true,
    loaded,
    fragella_key_visible: Boolean(env.FRAGELLA_API_KEY),
    legacy_fragrella_key_visible: Boolean(env.FRAGRELLA_API_KEY),
  };
}

export function getVesperEnrichmentLaneOrder() {
  return [
    "fragella_provider",
    "official_brand_verification",
    "retailer_professional_community_fallback",
  ];
}

export function getFragellaProviderConfig(env = process.env) {
  const apiKey = env.FRAGELLA_API_KEY || env.FRAGRELLA_API_KEY || "";
  const apiKeyEnvName = env.FRAGELLA_API_KEY
    ? "FRAGELLA_API_KEY"
    : env.FRAGRELLA_API_KEY
      ? "FRAGRELLA_API_KEY"
      : null;
  const apiBaseUrl = env.FRAGELLA_API_BASE_URL || env.FRAGRELLA_API_BASE_URL || FRAGELLA_DEFAULT_API_BASE_URL;
  return {
    provider: FRAGELLA_PROVIDER_NAME,
    configured: Boolean(apiKey),
    apiKey,
    apiKeyEnvName,
    apiBaseUrl: String(apiBaseUrl).replace(/\/+$/, ""),
    endpointEnvName: env.FRAGELLA_API_BASE_URL
      ? "FRAGELLA_API_BASE_URL"
      : env.FRAGRELLA_API_BASE_URL
        ? "FRAGRELLA_API_BASE_URL"
        : "default_fragella_provider_endpoint",
  };
}

export function buildFragellaProviderHeaders(config = getFragellaProviderConfig()) {
  return {
    "x-api-key": config.apiKey,
    accept: "application/json",
  };
}

export async function queryFragellaProvider(target, config = getFragellaProviderConfig(), options = {}) {
  const queries = buildFragellaSearchQueries(target).slice(0, options.maxQueries ?? 3);
  for (const query of queries) {
    const url = `${config.apiBaseUrl}/fragrances?search=${encodeURIComponent(query)}&limit=${Number(options.limit ?? 5)}`;
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: buildFragellaProviderHeaders(config),
        signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
      });
      if (!response.ok) {
        return {
          ok: false,
          status: `http_${response.status}`,
          http_status: response.status,
          query,
          reason: `Fragella provider query returned HTTP ${response.status}.`,
        };
      }

      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        return {
          ok: false,
          status: "parse_error",
          http_status: response.status,
          query,
          reason: `Fragella provider response could not be parsed as JSON: ${error?.name ?? "parse_error"}.`,
        };
      }

      const hits = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.results)
          ? payload.results
          : Array.isArray(payload?.data)
            ? payload.data
            : [];
      const hit = pickBestFragellaHit(target, hits);
      if (hit) return { ok: true, status: "success", http_status: response.status, query, hit };
    } catch (error) {
      return {
        ok: false,
        status: "provider_query_failed",
        http_status: null,
        query,
        reason: `Fragella provider query failed: ${error?.name ?? "fetch_error"}.`,
      };
    }
  }

  return {
    ok: false,
    status: "no_provider_match",
    http_status: null,
    query: queries[0] ?? null,
    reason: "Fragella provider query returned no usable candidate matches.",
  };
}

export function normalizeFragellaProviderPayload(target, hit) {
  const matchName = firstProviderString(hit, ["name", "Name", "title", "fragrance", "fragrance_name", "fragranceName"]);
  const matchBrand = firstProviderString(hit, ["brand", "Brand", "brand_name", "brandName", "house", "House"]);
  const normalizedTargetName = normText(target?.name);
  const normalizedTargetBrand = normText(target?.brand);
  const normalizedMatchName = normText(matchName);
  const normalizedMatchBrand = normText(matchBrand);
  const identitySupported = Boolean(
    normalizedTargetName
      && normalizedMatchName
      && (
        normalizedMatchName === normalizedTargetName
        || normalizedMatchName.includes(normalizedTargetName)
        || normalizedTargetName.includes(normalizedMatchName)
      )
      && (
        !normalizedTargetBrand
        || !normalizedMatchBrand
        || normalizedMatchBrand === normalizedTargetBrand
        || normalizedMatchBrand.includes(normalizedTargetBrand)
        || normalizedTargetBrand.includes(normalizedMatchBrand)
      ),
  );

  const topNotes = providerStringList(
    pickProviderValue(hit, ["top_notes", "topNotes", "Top Notes"]),
    pickNestedProviderValue(hit, ["Notes", "Top"]),
    pickNestedProviderValue(hit, ["notes", "top"]),
  );
  const heartNotes = providerStringList(
    pickProviderValue(hit, ["heart_notes", "heartNotes", "middle_notes", "middleNotes", "Heart Notes", "Middle Notes"]),
    pickNestedProviderValue(hit, ["Notes", "Heart"]),
    pickNestedProviderValue(hit, ["Notes", "Middle"]),
    pickNestedProviderValue(hit, ["notes", "heart"]),
    pickNestedProviderValue(hit, ["notes", "middle"]),
  );
  const baseNotes = providerStringList(
    pickProviderValue(hit, ["base_notes", "baseNotes", "Base Notes"]),
    pickNestedProviderValue(hit, ["Notes", "Base"]),
    pickNestedProviderValue(hit, ["notes", "base"]),
  );
  const notes = providerStringList(
    pickProviderValue(hit, ["notes", "Notes", "note_list", "noteList", "fragrance_notes", "fragranceNotes"]),
    pickNestedProviderValue(hit, ["notes"]),
    topNotes,
    heartNotes,
    baseNotes,
  );
  const accords = providerStringList(
    pickProviderValue(hit, ["accords", "Accords", "main_accords", "mainAccords", "Main Accords"]),
    Object.keys(pickProviderValue(hit, ["Main Accords Percentage"]) ?? {}),
  );
  const imageUrl = safeUrl(firstProviderString(hit, [
    "Image URL Transparent",
    "image_url_transparent",
    "transparent_image_url",
    "fragella_transparent_image_url",
    "fragrella_transparent_image_url",
    "Image URL",
    "image_url",
    "imageUrl",
    "bottle_image_url",
  ]));
  const sourceUrl = safeUrl(firstProviderString(hit, ["Purchase URL", "purchase_url", "purchaseUrl", "URL", "url", "Link", "link"]));
  const concentration = firstProviderString(hit, ["concentration", "Concentration", "type", "Type"]);
  const sourceConfidence = firstProviderNumber(hit, ["source_confidence", "sourceConfidence", "confidence", "Confidence"]);
  const communityPerformance = extractFragellaCommunityPerformance(hit);

  return {
    provider: FRAGELLA_PROVIDER_NAME,
    official_registry_eligible: false,
    identity_supported: identitySupported,
    match_name: matchName,
    match_brand: matchBrand,
    source_url: sourceUrl,
    image_url: imageUrl,
    concentration,
    notes,
    top_notes: topNotes,
    heart_notes: heartNotes,
    base_notes: baseNotes,
    accords,
    community_performance: communityPerformance,
    source_confidence: sourceConfidence,
  };
}

export function buildFragellaCandidateProfileFlow(normalized) {
  const identityUsed = Boolean(normalized?.identity_supported && normalized?.match_name);
  const brandUsed = Boolean(normalized?.match_brand);
  const imageUsed = Boolean(normalized?.image_url);
  const notesUsed = Boolean(normalized?.notes?.length);
  const pyramidUsed = Boolean(
    normalized?.top_notes?.length
      || normalized?.heart_notes?.length
      || normalized?.base_notes?.length,
  );
  const accordsUsed = Boolean(normalized?.accords?.length);
  const concentrationUsed = Boolean(normalized?.concentration);
  const communityPerformanceUsed = Boolean(normalized?.community_performance);

  return {
    provider: FRAGELLA_PROVIDER_NAME,
    provider_data_non_official: true,
    official_registry_eligible: false,
    exact_identity_supported: Boolean(normalized?.identity_supported),
    profile_fields_present: {
      identity: identityUsed,
      brand: brandUsed,
      image: imageUsed,
      notes: notesUsed,
      top_notes: Boolean(normalized?.top_notes?.length),
      heart_notes: Boolean(normalized?.heart_notes?.length),
      base_notes: Boolean(normalized?.base_notes?.length),
      accords: accordsUsed,
      concentration: concentrationUsed,
      community_performance: communityPerformanceUsed,
      vote_counts: Boolean(
        normalized?.community_performance?.longevity_votes_total
          || normalized?.community_performance?.projection_votes_total
          || normalized?.community_performance?.sillage_votes_total,
      ),
    },
    candidate_profile_flow: {
      identity_used: identityUsed,
      brand_used: brandUsed,
      image_used: imageUsed,
      notes_used: notesUsed,
      pyramid_used: pyramidUsed,
      accords_used: accordsUsed,
      concentration_used: concentrationUsed,
      community_performance_used: communityPerformanceUsed,
      wear_copy_if_missing: communityPerformanceUsed ? null : "Wear strength not verified",
    },
  };
}

function buildFragellaSearchQueries(target) {
  return unique([
    `${target.brand ?? ""} ${target.name ?? ""}`.trim(),
    target.name,
    normText(target.name),
  ].filter(Boolean)).slice(0, 3);
}

function pickBestFragellaHit(target, hits) {
  let best = null;
  let bestScore = -1;
  for (const hit of hits) {
    const normalized = normalizeFragellaProviderPayload(target, hit);
    if (!normalized.identity_supported) continue;
    const score = (normalized.identity_supported ? 2 : 0)
      + (normalized.match_name ? 0.35 : 0)
      + (normalized.match_brand ? 0.25 : 0)
      + (normalized.notes.length + normalized.top_notes.length + normalized.heart_notes.length + normalized.base_notes.length > 0 ? 0.25 : 0)
      + (normalized.accords.length > 0 ? 0.15 : 0);
    if (score > bestScore) {
      best = hit;
      bestScore = score;
    }
  }
  return best;
}

function extractFragellaCommunityPerformance(hit) {
  const longevity = extractPerformanceDistribution(hit, ["longevity", "Longevity"]);
  const projection = extractPerformanceDistribution(hit, ["projection", "Projection"]);
  const sillage = extractPerformanceDistribution(hit, ["sillage", "Sillage", "trail", "Trail"]);
  if (!longevity && !projection && !sillage) return null;
  return {
    provider: FRAGELLA_PROVIDER_NAME,
    evidence_type: "community_performance",
    longevity_votes_total: longevity?.votes_total ?? null,
    longevity_distribution: longevity?.distribution ?? null,
    projection_votes_total: projection?.votes_total ?? null,
    projection_distribution: projection?.distribution ?? null,
    sillage_votes_total: sillage?.votes_total ?? null,
    sillage_distribution: sillage?.distribution ?? null,
    captured_at: new Date().toISOString(),
    source_confidence: null,
  };
}

function extractPerformanceDistribution(hit, keys) {
  const candidates = [];
  for (const key of keys) {
    candidates.push(pickProviderValue(hit, [
      `${key}_distribution`,
      `${key}Distribution`,
      `${key}_votes`,
      `${key}Votes`,
      `${key} percentage`,
      `${key} Percentage`,
    ]));
    candidates.push(pickNestedProviderValue(hit, ["performance", key]));
    candidates.push(pickNestedProviderValue(hit, ["community_performance", key]));
  }
  const raw = candidates.find((value) => value && typeof value === "object" && !Array.isArray(value));
  if (!raw) return null;
  const distribution = {};
  let votesTotal = 0;
  for (const [label, value] of Object.entries(raw)) {
    const count = Number(value);
    if (!Number.isFinite(count)) continue;
    distribution[label] = count;
    votesTotal += count;
  }
  return Object.keys(distribution).length > 0
    ? { distribution, votes_total: votesTotal || null }
    : null;
}

function firstProviderString(hit, keys) {
  for (const key of keys) {
    const value = pickProviderValue(hit, [key]);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstProviderNumber(hit, keys) {
  for (const key of keys) {
    const value = pickProviderValue(hit, [key]);
    const numeric = typeof value === "number"
      ? value
      : (typeof value === "string" && value.trim() ? Number(value.trim()) : Number.NaN);
    if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 1) return numeric;
  }
  return null;
}

function pickProviderValue(hit, keys) {
  if (!hit || typeof hit !== "object") return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(hit, key)) return hit[key];
  }
  return null;
}

function pickNestedProviderValue(hit, path) {
  let current = hit;
  for (const segment of path) {
    if (!current || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, segment)) return null;
    current = current[segment];
  }
  return current;
}

function providerStringList(...values) {
  const output = [];
  const push = (value) => {
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (value && typeof value === "object") {
      Object.keys(value).forEach(push);
      return;
    }
    if (typeof value !== "string") return;
    for (const part of value.split(/[,;|/]+/)) {
      const trimmed = part.trim();
      if (trimmed && !output.some((existing) => normText(existing) === normText(trimmed))) output.push(trimmed);
    }
  };
  values.forEach(push);
  return output;
}

function parseEnvValue(raw) {
  let value = raw.trim();
  const commentMatch = value.match(/^(.*?)(?<!\\)\s+#.*$/);
  if (commentMatch) value = commentMatch[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value.replace(/\\n/g, "\n").trim();
}

function safeUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}

function normText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function unique(values) {
  return [...new Set(values)];
}
