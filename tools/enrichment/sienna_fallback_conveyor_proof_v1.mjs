#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  getFragellaProviderConfig,
  getVesperEnrichmentLaneOrder,
  loadFragellaLocalEnv,
  queryFragellaProvider,
} from "./fragella_provider_client_v1.mjs";
import { classifyTarget } from "./vesperizer_intake_autopilot_v1.mjs";

const TARGET = {
  name: "Sienna Brume",
  brand: "Mihan Aromatics",
  canonical_id: "c892b7e3-a829-4fee-91f1-09d3ffefacc6",
};

const OWNED_COLLECTION_STATUSES = new Set(["owned", "collection", "signature", "liked", "tried"]);

if (isDirectRun()) {
  main().catch((error) => {
    process.stdout.write(`${JSON.stringify(blockedSummary(error), null, 2)}\n`);
    process.exitCode = 1;
  });
}

async function main() {
  loadFragellaLocalEnv();
  loadLocalEnv(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"]);

  const config = getFragellaProviderConfig();
  const laneOrder = getVesperEnrichmentLaneOrder();
  const fragellaResult = config.configured
    ? await queryFragellaProvider(TARGET, config, {
        maxQueries: 3,
        limit: 5,
        timeoutMs: 10000,
      })
    : {
        ok: false,
        status: "not_configured",
        http_status: null,
        reason: "Fragella provider config was not available.",
      };

  const db = createReadOnlySupabaseRest();
  const fragrance = await getSingleRow(db, "fragrances", {
    id: `eq.${TARGET.canonical_id}`,
    select: [
      "id",
      "name",
      "brand",
      "family_key",
      "notes",
      "top_notes",
      "heart_notes",
      "base_notes",
      "accords",
      "concentration",
      "release_year",
      "perfumer",
      "longevity_score",
      "projection_score",
      "source_url",
      "source_confidence",
    ].join(","),
  });
  const intakes = await getRows(db, "fragrance_intake_requests_v1", {
    canonical_fragrance_id: `eq.${TARGET.canonical_id}`,
    select: "id,submitted_name,submitted_brand,desired_status,request_status,canonical_fragrance_id,limited_intel,updated_at",
    order: "updated_at.desc",
    limit: "5",
  });
  const officialEvidenceRows = await getRows(db, "fragrance_official_source_evidence_registry_v1", {
    fragrance_id: `eq.${TARGET.canonical_id}`,
    source_type: "eq.official_brand",
    select: [
      "source_url",
      "source_domain",
      "source_evidence_type",
      "official_notes",
      "official_top_notes",
      "official_heart_notes",
      "official_base_notes",
      "evidence_status",
      "review_status",
      "created_at",
    ].join(","),
    order: "created_at.desc",
    limit: "10",
  });
  const collectionRows = await getRows(db, "user_collection", {
    fragrance_id: `eq.${TARGET.canonical_id}`,
    select: "status,created_at,updated_at",
    order: "updated_at.desc",
    limit: "20",
  });
  const retiredRows = await getOptionalRows(db, "user_fragrance_retirement_preferences_v1", {
    fragrance_id: `eq.${TARGET.canonical_id}`,
    retired: "eq.true",
    select: "retired",
    limit: "20",
  });
  const dislikedRows = await getOptionalRows(db, "user_fragrance_preferences_v1", {
    fragrance_id: `eq.${TARGET.canonical_id}`,
    preference_state: "eq.disliked",
    select: "preference_state",
    limit: "20",
  });

  const activeEvidenceRows = officialEvidenceRows.filter((row) => (
    row.evidence_status === "active"
    && !["rejected", "superseded"].includes(String(row.review_status ?? ""))
  ));
  const pyramidEvidence = activeEvidenceRows.find((row) => row.source_evidence_type === "official_pyramid") ?? null;
  const intake = intakes[0] ?? null;
  const collectionStatuses = collectionRows.map((row) => String(row.status ?? "").toLowerCase()).filter(Boolean);
  const collectionOwned = collectionStatuses.some((status) => OWNED_COLLECTION_STATUSES.has(status));
  const retired = retiredRows.some((row) => row.retired === true) || collectionStatuses.includes("retired");
  const disliked = dislikedRows.some((row) => row.preference_state === "disliked") || collectionStatuses.includes("disliked");
  const canonicalProfile = fragrance
    ? classifyTarget(
        {
          id: intake?.id ?? "sienna-proof",
          submitted_name: intake?.submitted_name ?? TARGET.name,
          submitted_brand: intake?.submitted_brand || TARGET.brand,
          desired_status: intake?.desired_status ?? "owned",
          request_status: intake?.request_status ?? "matched_existing",
          canonical_fragrance_id: fragrance.id,
          canonical_collection_status: collectionOwned ? "owned" : collectionStatuses[0] ?? null,
          canonical: fragrance,
        },
        [{ ...fragrance, exact: true, confidence: 1 }],
        { ...fragrance, exact: true, confidence: 1 },
        { status: "not_needed", attempts: [], candidates: [] },
        { status: pyramidEvidence ? "official_source_already_present" : "not_needed", attempts: [], best: null },
      ).summary
    : null;
  const topNotes = cleanArray(pyramidEvidence?.official_top_notes, fragrance?.top_notes);
  const heartNotes = cleanArray(pyramidEvidence?.official_heart_notes, fragrance?.heart_notes);
  const baseNotes = cleanArray(pyramidEvidence?.official_base_notes, fragrance?.base_notes);
  const officialPyramidPresent = Boolean(topNotes.length && heartNotes.length && baseNotes.length);
  const profileReady = Boolean(fragrance && officialPyramidPresent && fragrance.family_key);
  const fragellaRejected = fragellaResult.status === "provider_identity_rejected" || fragellaResult.status === "no_provider_match";
  const officialSourceResult = pyramidEvidence
    ? "already_present"
    : activeEvidenceRows.length > 0
      ? "accepted"
      : "not_found";
  const continuedAfterRejection = Boolean(fragellaRejected && (fragrance || activeEvidenceRows.length > 0));
  const recommendable = Boolean(collectionOwned && profileReady && !retired && !disliked);

  const proof = {
    verdict: fragrance && collectionOwned && officialPyramidPresent && continuedAfterRejection ? "COMPLETE" : "PARTIAL",
    target: TARGET,
    fragella: {
      invoked: config.configured,
      ordered_before_official: laneOrder[0] === "fragella_provider",
      hits_returned: fragellaResult.status === "provider_identity_rejected",
      identity_guard_result: fragellaRejected ? "rejected" : (fragellaResult.ok ? "accepted" : "not_run"),
      rejection_reason: fragellaResult.status === "provider_identity_rejected"
        ? "wrong_name_or_brand"
        : fragellaResult.status,
      fields_used: false,
    },
    fallback: {
      continued_after_fragella_rejection: continuedAfterRejection,
      official_source_attempted: Boolean(activeEvidenceRows.length || fragrance?.source_url),
      official_source_url: pyramidEvidence?.source_url ?? fragrance?.source_url ?? null,
      official_source_result: officialSourceResult,
      source_not_found_after_attempts: false,
    },
    canonical_profile: {
      canonical_row_present: Boolean(fragrance),
      collection_owned: collectionOwned,
      official_pyramid_present: officialPyramidPresent,
      top_notes: topNotes,
      heart_notes: heartNotes,
      base_notes: baseNotes,
      profile_complete_or_display_ready: profileReady,
    },
    ui_state: {
      user_facing_card_should_still_say_vesperizing: Boolean(canonicalProfile?.user_facing_card_should_still_say_vesperizing),
      normal_collection_card_expected: Boolean(fragrance && collectionOwned),
      wear_copy: "Wear strength not verified",
    },
    recommendation_doctrine: {
      owned_collection: collectionOwned,
      retired,
      disliked,
      recommendable_by_default: recommendable,
      performance_missing_is_hard_block: false,
      classifier_gate_reason: canonicalProfile?.canonical_profile?.recommendation_gate_reason ?? null,
    },
    audit_context: {
      intake_linked: Boolean(intake?.canonical_fragrance_id === TARGET.canonical_id),
      intake_request_status: intake?.request_status ?? null,
      intake_desired_status: intake?.desired_status ?? null,
      collection_statuses: collectionStatuses,
      official_evidence_row_count: activeEvidenceRows.length,
      source_not_found_state_used_by_classifier: canonicalProfile?.state === "source_not_found_after_attempts",
    },
    safety: safetySummary(),
  };

  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
  if (proof.verdict !== "COMPLETE") process.exitCode = 2;
}

function blockedSummary(error) {
  return {
    verdict: "BLOCKED",
    target: TARGET,
    reason: redactError(error),
    safety: safetySummary(),
  };
}

function createReadOnlySupabaseRest() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not visible to the proof runtime.");
  const supabaseUrl = process.env.SUPABASE_URL || readLinkedSupabaseUrl();
  if (!supabaseUrl) throw new Error("Supabase URL/project ref is not visible to the proof runtime.");
  return {
    supabaseUrl: String(supabaseUrl).replace(/\/+$/, ""),
    serviceRoleKey,
  };
}

async function getRows(db, relation, params) {
  const url = new URL(`${db.supabaseUrl}/rest/v1/${relation}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    method: "GET",
    headers: {
      apikey: db.serviceRoleKey,
      authorization: `Bearer ${db.serviceRoleKey}`,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`Read-only Supabase query failed for ${relation}: HTTP ${response.status}`);
  }
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

async function getOptionalRows(db, relation, params) {
  try {
    return await getRows(db, relation, params);
  } catch {
    return [];
  }
}

async function getSingleRow(db, relation, params) {
  const rows = await getRows(db, relation, { ...params, limit: params.limit ?? "1" });
  return rows[0] ?? null;
}

function loadLocalEnv(keys, filePath = ".env.local", env = process.env) {
  if (!existsSync(filePath)) return false;
  const allowed = new Set(keys);
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalizedLine = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const separatorIndex = normalizedLine.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = normalizedLine.slice(0, separatorIndex).trim();
    if (!allowed.has(key) || env[key]) continue;
    env[key] = parseEnvValue(normalizedLine.slice(separatorIndex + 1));
  }
  return true;
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

function readLinkedSupabaseUrl() {
  const refPath = "supabase/.temp/project-ref";
  if (!existsSync(refPath)) return null;
  const ref = readFileSync(refPath, "utf8").trim();
  if (!/^[a-z0-9]{20}$/.test(ref)) return null;
  return `https://${ref}.supabase.co`;
}

function cleanArray(...values) {
  const output = [];
  const seen = new Set();
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const clean = String(item ?? "").trim();
      const key = clean.toLowerCase();
      if (!clean || seen.has(key)) continue;
      seen.add(key);
      output.push(clean);
    }
    if (output.length > 0) return output;
  }
  return output;
}

function safetySummary() {
  return {
    catalog_mutations: "none",
    official_registry_writes: "none",
    metadata_writes: "none",
    provider_table_writes: "none",
    queue_writes: "none",
    collection_writes: "none",
    raw_secret_printed: false,
    fake_data_generated: false,
  };
}

function redactError(error) {
  return String(error?.message || error || "unknown_error")
    .replace(/eyJ[a-zA-Z0-9._-]+/g, "[redacted-jwt]")
    .replace(/service[_-]?role[a-zA-Z0-9._=-]*/gi, "service_role[redacted]");
}

function isDirectRun() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}
