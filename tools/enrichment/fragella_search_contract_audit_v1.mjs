#!/usr/bin/env node

import {
  buildFragellaProviderHeaders,
  getFragellaProviderConfig,
  getVesperEnrichmentLaneOrder,
  loadFragellaLocalEnv,
  normalizeFragellaProviderPayload,
} from "./fragella_provider_client_v1.mjs";

const SIENNA_TARGET = {
  name: "Sienna Brume",
  brand: "Mihan Aromatics",
};

const SIENNA_VARIANTS = [
  { label: "name_only", query: "Sienna Brume" },
  { label: "name_plus_brand", query: "Sienna Brume Mihan Aromatics" },
  { label: "brand_plus_name", query: "Mihan Aromatics Sienna Brume" },
  { label: "slug", query: "sienna-brume" },
  { label: "official_url", query: "https://mihanaromatics.com/product/sienna-brume" },
];

const CONTROL_TARGETS = [
  { name: "Baccarat Rouge 540", brand: "Maison Francis Kurkdjian" },
  { name: "Sauvage", brand: "Dior" },
  { name: "Aventus", brand: "Creed" },
];

loadFragellaLocalEnv();

const config = getFragellaProviderConfig();
const laneOrder = getVesperEnrichmentLaneOrder();
const baseSummary = {
  provider: "Fragella",
  env: {
    fragella_key_visible: Boolean(process.env.FRAGELLA_API_KEY),
    fragrella_compat_key_visible: Boolean(process.env.FRAGRELLA_API_KEY),
    selected_env_var: config.apiKeyEnvName ?? "none",
    provider_mode: config.configured ? "enabled" : "disabled",
  },
  contract: {
    base_url_source: config.endpointEnvName,
    endpoint_path: "/fragrances",
    method: "GET",
    query_params: ["search", "limit"],
    auth_header_style: "x-api-key",
  },
  pipeline: {
    fragella_before_official_source: laneOrder[0] === "fragella_provider",
    provider_data_non_official: true,
    official_registry_eligible: false,
  },
  safety: {
    catalog_mutations: "none",
    official_registry_writes: "none",
    metadata_writes: "none",
    provider_table_writes: "none",
    queue_writes: "none",
    raw_secret_printed: false,
    raw_provider_payload_printed: false,
    fake_data_generated: false,
    env_file_committed: false,
  },
};

if (!config.configured) {
  writeSummary({
    verdict: "BLOCKED",
    ...baseSummary,
    root_cause: "not_configured",
    sienna_variants: [],
    control_results: [],
  });
  process.exitCode = 2;
} else {
  const siennaResults = [];
  for (const variant of SIENNA_VARIANTS) {
    siennaResults.push(await auditQueryVariant(SIENNA_TARGET, variant));
  }

  const controlResults = [];
  for (const target of CONTROL_TARGETS) {
    controlResults.push({
      target,
      variants: [
        await auditQueryVariant(target, { label: "name_only", query: target.name }),
        await auditQueryVariant(target, { label: "name_plus_brand", query: `${target.name} ${target.brand}` }),
      ],
    });
  }

  const rootCause = classifyRootCause(siennaResults, controlResults);
  writeSummary({
    verdict: rootCause === "unknown" ? "PARTIAL" : "COMPLETE",
    ...baseSummary,
    root_cause: rootCause,
    sienna_variants: siennaResults,
    control_results: controlResults,
    aggregate_fields: aggregateAcceptedFields([...siennaResults, ...controlResults.flatMap((result) => result.variants)]),
  });
}

async function auditQueryVariant(target, variant) {
  const result = {
    query_variant: variant.label,
    query_attempted: variant.query,
    http_status: null,
    hit_count: 0,
    top_hits: [],
    exact_identity_match: false,
    name_only_match: false,
    brand_only_match: false,
    identity_guard_accepted: false,
    identity_guard_reason: "not_run",
    detail_fetch_possible: false,
    detail_fetch_attempted: false,
    detail_fetch_reason: "not_attempted_without_documented_detail_contract",
    fields: emptyFieldPresence(),
  };

  let response;
  try {
    response = await fetch(buildSearchUrl(variant.query), {
      method: "GET",
      headers: buildFragellaProviderHeaders(config),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    return {
      ...result,
      identity_guard_reason: `endpoint_error:${error?.name ?? "fetch_error"}`,
    };
  }

  result.http_status = response.status;
  if (!response.ok) {
    result.identity_guard_reason = `endpoint_error:http_${response.status}`;
    return result;
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    return {
      ...result,
      identity_guard_reason: `parser_mismatch:${error?.name ?? "parse_error"}`,
    };
  }

  const hits = extractFragellaHits(payload);
  result.hit_count = hits.length;
  result.top_hits = hits.slice(0, 3).map((hit) => redactedHitSummary(hit));

  let bestAccepted = null;
  let bestNameOnly = false;
  let bestBrandOnly = false;
  let firstRejectedReason = hits.length ? "insufficient_identity" : "no_hits";
  for (const hit of hits) {
    const normalized = normalizeFragellaProviderPayload(target, hit);
    const match = classifyIdentity(target, normalized);
    bestNameOnly ||= match.name;
    bestBrandOnly ||= match.brand;
    result.detail_fetch_possible ||= hasDetailReference(hit);
    if (normalized.identity_supported) {
      bestAccepted = normalized;
      result.exact_identity_match = match.exact_name && match.exact_brand;
      result.identity_guard_accepted = true;
      result.identity_guard_reason = "accepted";
      break;
    }
    if (!match.name && !match.brand) firstRejectedReason = "wrong_name_and_brand";
    else if (!match.name) firstRejectedReason = "wrong_name";
    else if (!match.brand) firstRejectedReason = "wrong_brand";
  }

  result.name_only_match = bestNameOnly;
  result.brand_only_match = bestBrandOnly;
  if (!result.identity_guard_accepted) {
    result.identity_guard_reason = firstRejectedReason;
  }
  if (bestAccepted) {
    result.fields = fieldPresence(bestAccepted);
  }

  return result;
}

function buildSearchUrl(query) {
  const url = new URL(`${config.apiBaseUrl}/fragrances`);
  url.searchParams.set("search", query);
  url.searchParams.set("limit", "5");
  return url.toString();
}

function extractFragellaHits(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function redactedHitSummary(hit) {
  return {
    name: firstString(hit, ["name", "Name", "title", "fragrance", "fragrance_name", "fragranceName"]) ?? null,
    brand: firstString(hit, ["brand", "Brand", "brand_name", "brandName", "house", "House"]) ?? null,
    has_detail_reference: hasDetailReference(hit),
  };
}

function classifyIdentity(target, normalized) {
  const targetName = normText(target.name);
  const targetBrand = normText(target.brand);
  const matchName = normText(normalized.match_name);
  const matchBrand = normText(normalized.match_brand);
  return {
    exact_name: Boolean(targetName && matchName && matchName === targetName),
    exact_brand: Boolean(targetBrand && matchBrand && matchBrand === targetBrand),
    name: Boolean(targetName && matchName && (
      matchName === targetName
      || matchName.includes(targetName)
      || targetName.includes(matchName)
    )),
    brand: Boolean(targetBrand && matchBrand && (
      matchBrand === targetBrand
      || matchBrand.includes(targetBrand)
      || targetBrand.includes(matchBrand)
    )),
  };
}

function hasDetailReference(hit) {
  if (!hit || typeof hit !== "object") return false;
  const detailKeys = [
    "id",
    "_id",
    "uuid",
    "slug",
    "Slug",
    "url",
    "URL",
    "link",
    "Link",
    "href",
    "detail_url",
    "detailUrl",
    "fragrance_url",
    "fragranceUrl",
    "source_url",
    "sourceUrl",
  ];
  return detailKeys.some((key) => Object.prototype.hasOwnProperty.call(hit, key) && hit[key]);
}

function fieldPresence(normalized) {
  const performance = normalized.community_performance;
  return {
    image: Boolean(normalized.image_url),
    notes: Boolean(
      normalized.notes.length
        || normalized.top_notes.length
        || normalized.heart_notes.length
        || normalized.base_notes.length,
    ),
    pyramid: Boolean(
      normalized.top_notes.length
        || normalized.heart_notes.length
        || normalized.base_notes.length,
    ),
    accords: Boolean(normalized.accords.length),
    concentration: Boolean(normalized.concentration),
    community_performance: Boolean(performance),
    vote_counts: Boolean(performance && (
      performance.longevity_votes_total
        || performance.projection_votes_total
        || performance.sillage_votes_total
    )),
  };
}

function emptyFieldPresence() {
  return {
    image: false,
    notes: false,
    pyramid: false,
    accords: false,
    concentration: false,
    community_performance: false,
    vote_counts: false,
  };
}

function aggregateAcceptedFields(results) {
  const output = emptyFieldPresence();
  for (const result of results) {
    if (!result.identity_guard_accepted) continue;
    for (const key of Object.keys(output)) {
      output[key] ||= Boolean(result.fields?.[key]);
    }
  }
  return output;
}

function classifyRootCause(siennaResults, controlResults) {
  const siennaAccepted = siennaResults.some((result) => result.identity_guard_accepted);
  const siennaHadHits = siennaResults.some((result) => result.hit_count > 0);
  const siennaAnyDetailReference = siennaResults.some((result) => result.detail_fetch_possible);
  const controls = controlResults.flatMap((result) => result.variants);
  const controlAcceptedCount = controls.filter((result) => result.identity_guard_accepted).length;
  const controlFieldCount = controls.filter((result) => (
    result.fields.image
      || result.fields.notes
      || result.fields.pyramid
      || result.fields.accords
      || result.fields.concentration
      || result.fields.community_performance
  )).length;
  const endpointErrors = [...siennaResults, ...controls].filter((result) => String(result.identity_guard_reason).startsWith("endpoint_error"));
  const parserErrors = [...siennaResults, ...controls].filter((result) => String(result.identity_guard_reason).startsWith("parser_mismatch"));

  if (endpointErrors.length > 0 && controlAcceptedCount === 0) return "wrong_endpoint_or_base_url";
  if (parserErrors.length > 0 && controlAcceptedCount === 0) return "parser_mismatch";
  if (siennaAccepted) return "sienna_supported_by_fragella";
  if (controlAcceptedCount >= 3 && !siennaAccepted && siennaHadHits) return "sienna_coverage_gap_or_provider_search_index_gap";
  if (controlAcceptedCount >= 3 && !siennaAccepted && !siennaHadHits) return "sienna_coverage_gap";
  if (controlAcceptedCount >= 1 && controlFieldCount === 0) return "missing_detail_fetch_may_be_required";
  if (controlAcceptedCount === 0 && siennaAnyDetailReference) return "unknown_possible_detail_fetch_or_query_contract";
  if (controlAcceptedCount === 0) return "wrong_query_shape_or_endpoint_contract";
  return "unknown";
}

function firstString(hit, keys) {
  if (!hit || typeof hit !== "object") return null;
  for (const key of keys) {
    const value = hit[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
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

function writeSummary(summary) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
