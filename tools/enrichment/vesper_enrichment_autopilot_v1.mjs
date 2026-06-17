#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { URL } from "node:url";

const VERSION = "vesper_enrichment_autopilot_v1";
const DEFAULT_BATCH_LABEL = "auto_001";
const DEFAULT_MAX_TARGETS = 100;
const DEFAULT_MAX_REGISTRY_PAYLOADS = 50;
const SUPABASE_CLI = "supabase@2.106.0";

const HIGH_VALUE_BRANDS = [
  "Chanel",
  "Dior",
  "Tom Ford",
  "Maison Francis Kurkdjian",
  "Prada",
  "Louis Vuitton",
  "Le Labo",
  "Guerlain",
  "Yves Saint Laurent",
  "Jean Paul Gaultier",
  "Parfums de Marly",
  "Xerjoff",
  "Mugler",
  "Versace",
  "Creed",
  "Roja",
  "Alexandria Fragrances",
  "Alexandria",
  "Afnan",
  "Valentino",
  "Giorgio Armani",
  "Dolce & Gabbana",
  "Carolina Herrera",
  "Azzaro",
  "Montblanc",
];

const OFFICIAL_DOMAINS_BY_BRAND = new Map([
  ["acqua di parma", ["acquadiparma.com"]],
  ["afnan", ["afnan.com"]],
  ["al haramain", ["alharamainperfumes.com"]],
  ["alexandria", ["alexandriafragrances.com"]],
  ["alexandria fragrances", ["alexandriafragrances.com"]],
  ["azzaro", ["azzaro.com"]],
  ["carolina herrera", ["carolinaherrera.com"]],
  ["chanel", ["chanel.com"]],
  ["creed", ["creedfragrances.com", "creedboutique.com"]],
  ["dior", ["dior.com"]],
  ["dolce gabbana", ["dolcegabbana.com"]],
  ["dolce & gabbana", ["dolcegabbana.com"]],
  ["giorgio armani", ["armanibeauty.com", "giorgioarmanibeauty-usa.com"]],
  ["guerlain", ["guerlain.com"]],
  ["jean paul gaultier", ["jeanpaulgaultier.com"]],
  ["le labo", ["lelabofragrances.com"]],
  ["louis vuitton", ["louisvuitton.com"]],
  ["maison francis kurkdjian", ["franciskurkdjian.com"]],
  ["maison alhambra", ["maisonalhambra-usa.com"]],
  ["montblanc", ["montblanc.com"]],
  ["mugler", ["mugler.com"]],
  ["parfums de marly", ["parfums-de-marly.com"]],
  ["prada", ["prada-beauty.com", "prada.com"]],
  ["rabanne", ["rabanne.com"]],
  ["paco rabanne", ["rabanne.com"]],
  ["roja", ["rojaparfums.com"]],
  ["tom ford", ["tomfordbeauty.com", "tomford.com"]],
  ["valentino", ["valentino-beauty.us", "valentino-beauty.com"]],
  ["versace", ["versace.com"]],
  ["xerjoff", ["xerjoff.com"]],
  ["yves saint laurent", ["yslbeautyus.com", "yslbeauty.com"]],
]);

const ACCEPTED_REGISTRY_EVIDENCE_TYPES = new Set([
  "official_pyramid",
  "official_notes_only",
  "official_key_notes",
  "official_prose_only",
  "ambiguous",
  "identity_mismatch",
  "duplicate_or_flanker_risk",
]);

const PROSE_FRAGMENT_PATTERNS = [
  /\btake over\b/i,
  /\btransport(s|ing)? you\b/i,
  /\bwhat you need\b/i,
  /\bperfectly balanced\b/i,
  /\bleaving behind\b/i,
  /\bcomforting embrace\b/i,
  /\bit may\b/i,
  /\bmay not return\b/i,
  /\bbrings? a sort\b/i,
  /\bare perfect\b/i,
  /\bsenses?\b/i,
  /\bdesigned to\b/i,
  /\bcrafted to\b/i,
  /\binspired by\b/i,
  /\bimpression of\b/i,
];

const NOTE_CONNECTOR_STARTS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "by",
  "for",
  "from",
  "in",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

const PROSE_VERBS = new Set([
  "are",
  "balanced",
  "be",
  "been",
  "being",
  "brings",
  "bring",
  "can",
  "comforting",
  "create",
  "creates",
  "designed",
  "embrace",
  "evoke",
  "evokes",
  "had",
  "has",
  "have",
  "is",
  "leaving",
  "may",
  "might",
  "need",
  "needs",
  "return",
  "should",
  "take",
  "takes",
  "transport",
  "transports",
  "was",
  "were",
  "will",
  "would",
]);

const CLONE_HOUSE_BRANDS = new Set([
  "alexandria",
  "alexandria fragrances",
  "dua",
  "the dua brand",
  "maison alhambra",
]);

const FORBIDDEN_SQL_TOKENS = [
  "insert",
  "update",
  "delete",
  "truncate",
  "alter",
  "grant",
  "revoke",
  "refresh_taxonomy_operationalization_queue_current_v1",
  "refresh_fragrance_performance_features_v1",
  "apply_completed_fragrance_official_source_patch_v1",
  "apply_completed_fragrance_official_notes_only_patch_v1",
  "apply_fragrance_official_source_backfill_v1",
  "apply_fragrance_official_notes_backfill_v1",
];

const argv = parseArgs(process.argv.slice(2));
const batchLabel = argv["batch-label"] ?? DEFAULT_BATCH_LABEL;
const OUTPUT_PREFIX = prefixForBatchLabel(batchLabel);
const maxTargets = positiveInt(argv["max-targets"], DEFAULT_MAX_TARGETS);
const maxRegistryPayloads = Math.min(
  positiveInt(argv["max-registry-payloads"], DEFAULT_MAX_REGISTRY_PAYLOADS),
  DEFAULT_MAX_REGISTRY_PAYLOADS,
);
const allowOfficialFetch = argv["allow-official-fetch"] !== "false";
const providerMode = argv["provider-mode"] ?? "detect-env";
const brandAllowlist = parseAllowlist(argv["brand-allowlist"]);

main().catch((error) => {
  console.error(`[${VERSION}] failed: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const generatedAt = new Date().toISOString();
  const projectRef = readProjectRef();
  const linkedProject = readLinkedProjectRef();
  const catalogRows = queryCatalogRows();
  const selectedTargets = selectTargets(catalogRows);
  const providerConfigured = hasProviderKey();

  const registryRows = [];
  const providerRows = [];
  const needsReviewRows = [];
  const blockedRows = [];

  for (const target of selectedTargets) {
    const officialFinding = await inspectOfficialSource(target);
    const providerFinding = await inspectProviderSource(target, providerConfigured);
    if (providerFinding) {
      providerRows.push(providerFinding);
    }

    const reviewRow = buildReviewRow(target, officialFinding, providerFinding, generatedAt);
    if (reviewRow.helper_payload && registryRows.length < maxRegistryPayloads) {
      registryRows.push(reviewRow);
    } else if (reviewRow.safety_bucket === "RED_blocked") {
      blockedRows.push(reviewRow);
    } else {
      needsReviewRows.push(reviewRow);
    }
  }

  const helperPayloads = registryRows.map((row) => row.helper_payload);
  const dryRunSql = buildDryRunSql(helperPayloads, batchLabel);
  const validation = validateGeneratedFiles(helperPayloads, dryRunSql, registryRows);

  const payloadPacket = {
    packet_type: "official_source_registry_capture_review_packet",
    generator: VERSION,
    generated_at: generatedAt,
    batch_label: batchLabel,
    project_ref_from_local_metadata: projectRef,
    linked_project_ref_from_local_json: linkedProject,
    max_targets: maxTargets,
    max_registry_payloads: maxRegistryPayloads,
    selected_target_count: selectedTargets.length,
    registry_payload_count: registryRows.length,
    provider_mode: providerMode,
    provider_configured: providerConfigured,
    official_fetch_enabled: allowOfficialFetch,
    rows: registryRows,
  };

  const providerPacket = {
    packet_type: "provider_enrichment_review_packet",
    generator: VERSION,
    generated_at: generatedAt,
    provider_mode: providerMode,
    provider_configured: providerConfigured,
    trust_lane: "provider_only_enrichment",
    warning:
      "Fragella provider data is provider-derived intelligence only and is not treated as official source truth.",
    rows: providerRows,
  };

  const needsReviewPacket = {
    packet_type: "needs_review_official_source_packet",
    generator: VERSION,
    generated_at: generatedAt,
    rows: needsReviewRows,
  };

  const blockedPacket = {
    packet_type: "blocked_official_source_packet",
    generator: VERSION,
    generated_at: generatedAt,
    rows: blockedRows,
  };

  const reviewReport = buildReviewReport({
    generatedAt,
    projectRef,
    linkedProject,
    selectedTargets,
    registryRows,
    providerRows,
    needsReviewRows,
    blockedRows,
    providerConfigured,
    validation,
  });

  writeJson(`${OUTPUT_PREFIX}_registry_payloads.json`, payloadPacket);
  writeFileSync(`${OUTPUT_PREFIX}_dry_run.sql`, dryRunSql);
  writeFileSync(`${OUTPUT_PREFIX}_review_report.md`, reviewReport);
  writeJson(`${OUTPUT_PREFIX}_provider_enrichment.json`, providerPacket);
  writeJson(`${OUTPUT_PREFIX}_needs_review.json`, needsReviewPacket);
  writeJson(`${OUTPUT_PREFIX}_blocked.json`, blockedPacket);

  console.log(JSON.stringify({
    generator: VERSION,
    generated_at: generatedAt,
    selected_target_count: selectedTargets.length,
    registry_payload_count: registryRows.length,
    provider_rows: providerRows.length,
    needs_review_rows: needsReviewRows.length,
    blocked_rows: blockedRows.length,
    validation,
  }, null, 2));
}

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function prefixForBatchLabel(label) {
  const match = String(label).match(/(\d+)$/);
  if (!match) return `proposed_autopilot_batch_${label}`;
  return `proposed_autopilot_batch_${match[1].padStart(3, "0")}`;
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseAllowlist(value) {
  if (!value) return null;
  return new Set(value.split(",").map((brand) => normText(brand)).filter(Boolean));
}

function readProjectRef() {
  const path = "supabase/.temp/project-ref";
  return existsSync(path) ? readFileSync(path, "utf8").trim() : null;
}

function readLinkedProjectRef() {
  const path = "supabase/.temp/linked-project.json";
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return raw.project_ref ?? raw.projectRef ?? raw.ref ?? null;
  } catch {
    return null;
  }
}

function queryCatalogRows() {
  const sql = `
    with base as (
      select
        f.id,
        f.name,
        f.brand,
        f.concentration,
        f.family_key,
        coalesce(f.notes, '{}'::text[]) as notes,
        coalesce(f.top_notes, '{}'::text[]) as top_notes,
        coalesce(f.heart_notes, '{}'::text[]) as heart_notes,
        coalesce(f.base_notes, '{}'::text[]) as base_notes,
        coalesce(f.accords, '{}'::text[]) as accords,
        f.source_url,
        f.source_confidence,
        f.longevity_score,
        f.projection_score,
        q.queue_state,
        q.queue_lane,
        exists (
          select 1
          from public.fragrance_official_source_registry_candidate_view_v1 cv
          where cv.fragrance_id = f.id
            and cv.active_capture_guard is true
        ) as active_registry_evidence,
        (
          select count(*)
          from public.fragrances d
          where lower(btrim(d.name)) = lower(btrim(f.name))
            and lower(btrim(coalesce(d.brand, ''))) = lower(btrim(coalesce(f.brand, '')))
        ) as exact_name_brand_count
      from public.fragrances f
      left join public.taxonomy_operationalization_queue_current_v1 q
        on q.fragrance_id = f.id
    )
    select coalesce(jsonb_agg(to_jsonb(base) order by lower(brand), lower(name)), '[]'::jsonb) as rows
    from base;
  `;
  const result = spawnSync(
    "npx",
    ["-y", SUPABASE_CLI, "db", "query", "--linked", "-o", "json", sql],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        SUPABASE_CLI_DISABLE_TELEMETRY: "1",
      },
      maxBuffer: 1024 * 1024 * 20,
    },
  );
  if (result.status !== 0) {
    throw new Error(`read-only catalog query failed: ${result.stderr || result.stdout}`);
  }
  const parsed = parseCliJson(result.stdout);
  if (Array.isArray(parsed)) {
    return parsed?.[0]?.rows ?? [];
  }
  if (Array.isArray(parsed?.rows) && Array.isArray(parsed.rows?.[0]?.rows)) {
    return parsed.rows[0].rows;
  }
  if (Array.isArray(parsed?.rows)) {
    return parsed.rows;
  }
  return [];
}

function parseCliJson(output) {
  const trimmed = output.trim();
  const firstArray = trimmed.indexOf("[");
  const firstObject = trimmed.indexOf("{");
  const startCandidates = [firstArray, firstObject].filter((index) => index >= 0);
  if (startCandidates.length === 0) {
    throw new Error("Supabase CLI did not return JSON");
  }
  const start = Math.min(...startCandidates);
  const jsonText = trimmed.slice(start);
  return JSON.parse(jsonText);
}

function selectTargets(rows) {
  const brandCounts = new Map();
  for (const row of rows) {
    const key = normText(row.brand);
    brandCounts.set(key, (brandCounts.get(key) ?? 0) + 1);
  }

  return rows
    .filter((row) => !row.active_registry_evidence)
    .filter((row) => !brandAllowlist || brandAllowlist.has(normText(row.brand)))
    .map((row) => {
      const noteCount = arr(row.notes).length;
      const topCount = arr(row.top_notes).length;
      const heartCount = arr(row.heart_notes).length;
      const baseCount = arr(row.base_notes).length;
      const accordCount = arr(row.accords).length;
      const brandScore = brandPriority(row.brand);
      const sourceMissingScore = row.source_url ? 0 : 10;
      const pyramidGapScore = topCount + heartCount + baseCount === 0 ? 8 : 0;
      const noteGapScore = noteCount === 0 ? 5 : 0;
      const accordGapScore = accordCount === 0 ? 4 : 0;
      const perfGapScore =
        row.longevity_score === null || row.projection_score === null ? 3 : 0;
      const officialSourceAvailableScore = domainMatchesOfficial(row.brand, row.source_url) ? 30 : 0;
      const duplicateRisk = duplicateRiskFor(row, brandCounts);
      const cleanIdentityScore = duplicateRisk === "none" ? 5 : -10;
      return {
        ...row,
        note_count: noteCount,
        top_count: topCount,
        heart_count: heartCount,
        base_count: baseCount,
        accord_count: accordCount,
        duplicate_risk_guess: duplicateRisk,
        concentration_ambiguity_guess: concentrationAmbiguityFor(row),
        rank_score:
          brandScore +
          sourceMissingScore +
          pyramidGapScore +
          noteGapScore +
          accordGapScore +
          perfGapScore +
          officialSourceAvailableScore +
          cleanIdentityScore,
      };
    })
    .sort((a, b) => b.rank_score - a.rank_score || a.name.localeCompare(b.name))
    .slice(0, maxTargets);
}

function brandPriority(brand) {
  const normalized = normText(brand);
  const index = HIGH_VALUE_BRANDS.findIndex((value) => normText(value) === normalized);
  if (index >= 0) return 50 - index;
  return 0;
}

function duplicateRiskFor(row, brandCounts) {
  if ((row.exact_name_brand_count ?? 0) > 1) return "possible_duplicate";
  const name = normText(row.name);
  const concentration = normText(row.concentration);
  const brandCount = brandCounts.get(normText(row.brand)) ?? 0;
  const genericName =
    name.length < 4 ||
    ["homme", "pour homme", "parfum", "eau de parfum", "intense"].includes(name);
  if (genericName && brandCount > 1) return "possible_flanker";
  if (!concentration && /\b(edp|edt|parfum|elixir|intense|cologne)\b/i.test(row.name ?? "")) {
    return "possible_flanker";
  }
  return "none";
}

function concentrationAmbiguityFor(row) {
  const concentration = normText(row.concentration);
  const name = normText(row.name);
  if (!concentration && /\b(eau de parfum|edp|eau de toilette|edt|parfum|extrait|elixir)\b/.test(name)) {
    return "concentration_missing";
  }
  return "none";
}

async function inspectOfficialSource(target) {
  const currentUrl = safeUrl(target.source_url);
  const officialDomainMatch = currentUrl && domainMatchesOfficial(target.brand, currentUrl);
  if (!currentUrl || !officialDomainMatch) {
    return {
      source_url: currentUrl,
      source_evidence_type: currentUrl ? "ambiguous" : "missing_official_source",
      direct_source_verification_status: currentUrl
        ? "current_source_url_is_not_recognized_as_official_brand_domain"
        : "no_current_source_url_available_for_direct_official_verification",
      extraction_method: currentUrl ? "official_domain_guard" : "no_official_source_url",
      extraction_quality: "low",
      extraction_confidence: 0,
      extraction_warnings: currentUrl
        ? ["current source URL is not on a recognized official brand domain"]
        : ["no current source URL available for direct official verification"],
      clone_vs_inspiration_risk: "unknown",
      official_notes: [],
      official_top_notes: [],
      official_heart_notes: [],
      official_base_notes: [],
      evidence_payload: {},
      source_confidence: 0.5,
      source_verification_summary:
        "No direct official brand product page was verified by the dry-generation autopilot.",
      reason:
        "No active official source evidence was generated. This row needs source discovery before registry capture.",
    };
  }

  if (!allowOfficialFetch) {
    return {
      source_url: currentUrl,
      source_evidence_type: "ambiguous",
      direct_source_verification_status: "official_fetch_disabled",
      extraction_method: "official_fetch_disabled",
      extraction_quality: "low",
      extraction_confidence: 0,
      extraction_warnings: ["direct official page fetch disabled"],
      clone_vs_inspiration_risk: cloneRiskFor(target, currentUrl, "", "", null).status,
      official_notes: [],
      official_top_notes: [],
      official_heart_notes: [],
      official_base_notes: [],
      evidence_payload: {},
      source_confidence: 0.65,
      source_verification_summary:
        "Current source URL is on an official brand domain, but direct page fetch was disabled.",
      reason:
        "Registry capture should wait for direct official product-page verification.",
    };
  }

  try {
    const response = await fetch(currentUrl, {
      headers: {
        "user-agent": `${VERSION}/1.0 review-packet-generator`,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return {
        source_url: currentUrl,
        source_evidence_type: "ambiguous",
        direct_source_verification_status: `http_${response.status}`,
        extraction_method: "official_fetch_http_error",
        extraction_quality: "low",
        extraction_confidence: 0,
        extraction_warnings: [`official URL returned HTTP ${response.status}`],
        clone_vs_inspiration_risk: cloneRiskFor(target, currentUrl, "", "", null).status,
        official_notes: [],
        official_top_notes: [],
        official_heart_notes: [],
        official_base_notes: [],
        evidence_payload: {},
        source_confidence: 0.6,
        source_verification_summary:
          "Official-domain URL could not be fetched successfully during dry generation.",
        reason: "Direct verification failed; hold for human source review.",
      };
    }
    const html = await response.text();
    return classifyOfficialPage(target, currentUrl, html);
  } catch (error) {
    return {
      source_url: currentUrl,
      source_evidence_type: "ambiguous",
      direct_source_verification_status: "fetch_error",
      extraction_method: "official_fetch_error",
      extraction_quality: "low",
      extraction_confidence: 0,
      extraction_warnings: ["official-domain URL fetch failed"],
      clone_vs_inspiration_risk: cloneRiskFor(target, currentUrl, "", "", null).status,
      official_notes: [],
      official_top_notes: [],
      official_heart_notes: [],
      official_base_notes: [],
      evidence_payload: { error_kind: error.name ?? "fetch_error" },
      source_confidence: 0.6,
      source_verification_summary:
        "Official-domain URL fetch failed during dry generation.",
      reason: "Direct verification failed; hold for human source review.",
    };
  }
}

async function inspectProviderSource(target, providerConfigured) {
  if (providerMode === "off") return null;
  if (!providerConfigured) {
    return {
      fragrance_id: target.id,
      name: target.name,
      brand: target.brand,
      provider: "Fragella",
      status: "not_configured",
      trust_lane: "provider_only_enrichment",
      source_confidence: null,
      notes: [],
      accords: [],
      reason:
        "Provider API key was not configured in the environment, so provider enrichment was not queried.",
    };
  }
  return {
    fragrance_id: target.id,
    name: target.name,
    brand: target.brand,
    provider: "Fragella",
    status: "provider_query_supported_but_not_performed_in_v1_default",
    trust_lane: "provider_only_enrichment",
    source_confidence: null,
    notes: [],
    accords: [],
    reason:
      "Provider data is intentionally kept out of official source registry payloads. Enable a dedicated provider run only after review.",
  };
}

function classifyOfficialPage(target, sourceUrl, html) {
  const text = htmlToText(html);
  const identityStatus = directIdentityStatus(target, text, sourceUrl);
  const pageTitle = extractTitle(html);
  const cloneRisk = cloneRiskFor(target, sourceUrl, html, text, pageTitle);
  const extraction = extractOfficialEvidenceFromHtml(html);
  const mergedWarnings = [...extraction.warnings, ...cloneRisk.warnings];

  if (identityStatus !== "exact") {
    return {
      source_url: sourceUrl,
      source_evidence_type: "identity_mismatch",
      direct_source_verification_status: "fetched_identity_not_exact",
      extraction_method: "identity_check_before_extraction",
      extraction_quality: "low",
      extraction_confidence: 0.2,
      extraction_warnings: ["exact product identity was not proven", ...cloneRisk.warnings],
      clone_vs_inspiration_risk: cloneRisk.status,
      official_notes: [],
      official_top_notes: [],
      official_heart_notes: [],
      official_base_notes: [],
      evidence_payload: {
        page_title: pageTitle,
        identity_status: identityStatus,
        clone_vs_inspiration_risk: cloneRisk,
      },
      source_confidence: 0.65,
      source_verification_summary:
        "Official-domain page was fetched, but exact product identity was not proven.",
      reason:
        "Exact fragrance identity was not proven from the official page text; capture requires human review.",
    };
  }

  const highQuality = extraction.quality === "high" && extraction.confidence >= 0.86;
  const hasPyramid = extraction.top.length || extraction.heart.length || extraction.base.length;
  if (hasPyramid && highQuality) {
    return {
      source_url: sourceUrl,
      source_evidence_type: "official_pyramid",
      direct_source_verification_status: "direct_product_page_verified",
      extraction_method: extraction.method,
      extraction_quality: extraction.quality,
      extraction_confidence: extraction.confidence,
      extraction_warnings: mergedWarnings,
      clone_vs_inspiration_risk: cloneRisk.status,
      official_notes: [],
      official_top_notes: extraction.top,
      official_heart_notes: extraction.heart,
      official_base_notes: extraction.base,
      evidence_payload: {
        page_title: pageTitle,
        extraction: extraction.method,
        extraction_quality: extraction.quality,
        extraction_confidence: extraction.confidence,
        extraction_warnings: mergedWarnings,
        clone_vs_inspiration_risk: cloneRisk,
      },
      source_confidence: 0.95,
      source_verification_summary:
        "Official brand product page was fetched and exposes labeled positional notes.",
      reason:
        "Official pyramid evidence is registry-safe for capture and may become helper-review material later.",
    };
  }

  if (extraction.notes.length && highQuality) {
    return {
      source_url: sourceUrl,
      source_evidence_type: extraction.isKeyNotes ? "official_key_notes" : "official_notes_only",
      direct_source_verification_status: "direct_product_page_verified",
      extraction_method: extraction.method,
      extraction_quality: extraction.quality,
      extraction_confidence: extraction.confidence,
      extraction_warnings: mergedWarnings,
      clone_vs_inspiration_risk: cloneRisk.status,
      official_notes: extraction.notes,
      official_top_notes: [],
      official_heart_notes: [],
      official_base_notes: [],
      evidence_payload: {
        page_title: pageTitle,
        extraction: extraction.method,
        extraction_quality: extraction.quality,
        extraction_confidence: extraction.confidence,
        extraction_warnings: mergedWarnings,
        clone_vs_inspiration_risk: cloneRisk,
      },
      source_confidence: 0.92,
      source_verification_summary:
        "Official brand product page was fetched and exposes notes without a top/heart/base pyramid.",
      reason:
        "Official notes-only evidence is registry-safe for capture, but it is not patch-safe without later helper review.",
    };
  }

  return {
    source_url: sourceUrl,
    source_evidence_type: extraction.quality === "medium" ? "ambiguous" : "official_prose_only",
    direct_source_verification_status: "direct_product_page_verified",
    extraction_method: extraction.method,
    extraction_quality: extraction.quality,
    extraction_confidence: extraction.confidence,
    extraction_warnings: mergedWarnings,
    clone_vs_inspiration_risk: cloneRisk.status,
    official_notes: [],
    official_top_notes: [],
    official_heart_notes: [],
    official_base_notes: [],
    evidence_payload: {
      page_title: pageTitle,
      extraction: extraction.method,
      extraction_quality: extraction.quality,
      extraction_confidence: extraction.confidence,
      extraction_warnings: mergedWarnings,
      rejected_note_candidates: extraction.rejected_candidates,
      clone_vs_inspiration_risk: cloneRisk,
    },
    source_confidence: extraction.quality === "medium" ? 0.7 : 0.82,
    source_verification_summary:
      "Official brand product page was fetched and exact identity was found, but no high-confidence structured note or pyramid list was extracted.",
    reason:
      "Evidence is prose-only or extraction quality is not high; hold for human review and do not generate note arrays.",
  };
}

function buildReviewRow(target, officialFinding, providerFinding, generatedAt) {
  const officialNotes = arr(officialFinding.official_notes);
  const officialTop = arr(officialFinding.official_top_notes);
  const officialHeart = arr(officialFinding.official_heart_notes);
  const officialBase = arr(officialFinding.official_base_notes);
  const combinedOfficial = [...officialNotes, ...officialTop, ...officialHeart, ...officialBase];
  const currentCombined = [
    ...arr(target.notes),
    ...arr(target.top_notes),
    ...arr(target.heart_notes),
    ...arr(target.base_notes),
  ];
  const normalizedOfficial = normalizeNotes(combinedOfficial);
  const normalizedCurrent = normalizeNotes(currentCombined);
  const comparisonStatus = compareNoteSets(normalizedCurrent, normalizedOfficial);
  const duplicateRisk = target.duplicate_risk_guess;
  const concentrationAmbiguity = target.concentration_ambiguity_guess;
  const identityMatchStatus = identityStatusFor(target, officialFinding, duplicateRisk, concentrationAmbiguity);
  const safetyBucket = safetyBucketFor(officialFinding, identityMatchStatus, duplicateRisk, concentrationAmbiguity);
  const lane = recommendedLaneFor(target, officialFinding, comparisonStatus, safetyBucket);
  const action = recommendedActionFor(target, officialFinding, comparisonStatus, safetyBucket);
  const helper = recommendedHelperFor(lane);
  const patchSafeNow = false;

  const base = {
    review_envelope: {
      generated_at: generatedAt,
      generator: VERSION,
      safety_bucket: safetyBucket,
      registry_safe_capture: Boolean(
        officialFinding.source_url &&
          ACCEPTED_REGISTRY_EVIDENCE_TYPES.has(officialFinding.source_evidence_type) &&
          ["GREEN_registry_safe_capture", "PURPLE_helper_review_candidate_later"].includes(safetyBucket),
      ),
      patch_safe_now: patchSafeNow,
      explicit_patch_safety_decision:
        "not patch-safe now; registry capture and later helper review only",
      direct_source_verification_status: officialFinding.direct_source_verification_status,
      extraction_method: officialFinding.extraction_method,
      extraction_quality: officialFinding.extraction_quality,
      extraction_confidence: officialFinding.extraction_confidence,
      extraction_warnings: arr(officialFinding.extraction_warnings),
      provider_lane_status: providerFinding?.status ?? "not_checked",
      reason_not_safe_to_patch: patchSafeNow
        ? null
        : "Autopilot V1 never marks rows patch-safe. Patch helpers require separate proofread and dry-run approval.",
    },
    fragrance_identity: {
      fragrance_id: target.id,
      name: target.name,
      brand: target.brand,
      concentration: target.concentration,
      family_key: target.family_key,
    },
    candidate_view_guard_result: {
      active_registry_evidence: false,
      source: "public.fragrance_official_source_registry_candidate_view_v1.active_capture_guard",
    },
    current_public_fragrances_snapshot: {
      notes: arr(target.notes),
      top_notes: arr(target.top_notes),
      heart_notes: arr(target.heart_notes),
      base_notes: arr(target.base_notes),
      accords: arr(target.accords),
      source_url: target.source_url,
      source_confidence: target.source_confidence,
      longevity_score: target.longevity_score,
      projection_score: target.projection_score,
      queue_state: target.queue_state,
      queue_lane: target.queue_lane,
    },
    official_source: {
      source_url: officialFinding.source_url,
      source_evidence_type: officialFinding.source_evidence_type,
      source_confidence: officialFinding.source_confidence,
      extraction_method: officialFinding.extraction_method,
      extraction_quality: officialFinding.extraction_quality,
      extraction_confidence: officialFinding.extraction_confidence,
      extraction_warnings: arr(officialFinding.extraction_warnings),
      official_notes: officialNotes,
      official_top_notes: officialTop,
      official_heart_notes: officialHeart,
      official_base_notes: officialBase,
      evidence_payload: officialFinding.evidence_payload,
      source_verification_summary: officialFinding.source_verification_summary,
    },
    normalized_comparison: {
      normalized_current_notes: normalizedCurrent,
      normalized_official_notes: normalizedOfficial,
      comparison_status: comparisonStatus,
    },
    risk: {
      duplicate_risk: duplicateRisk,
      concentration_ambiguity: concentrationAmbiguity,
      identity_match_status: identityMatchStatus,
      clone_vs_inspiration_risk: officialFinding.clone_vs_inspiration_risk ?? "unknown",
    },
    recommendation: {
      recommended_lane: lane,
      recommended_helper: helper,
      recommended_action: action,
      evidence_status: "active_if_recorded",
      review_status: "proposed_if_recorded",
      reason: officialFinding.reason,
    },
    hashes: {
      payload_hash_preview: hashObject({
        official_notes: normalizedOfficial,
        comparison_status: comparisonStatus,
        recommended_lane: lane,
        recommended_action: action,
      }),
      source_url_normalized: officialFinding.source_url ? normalizeUrl(officialFinding.source_url) : null,
    },
  };

  if (
    officialFinding.source_url &&
    ACCEPTED_REGISTRY_EVIDENCE_TYPES.has(officialFinding.source_evidence_type) &&
    ["GREEN_registry_safe_capture", "PURPLE_helper_review_candidate_later"].includes(safetyBucket)
  ) {
    base.helper_payload = {
      fragrance_id: target.id,
      expected_name: target.name,
      expected_brand: target.brand,
      source_type: "official_brand",
      source_url: officialFinding.source_url,
      source_confidence: officialFinding.source_confidence,
      source_evidence_type: officialFinding.source_evidence_type,
      official_notes: officialNotes,
      official_top_notes: officialTop,
      official_heart_notes: officialHeart,
      official_base_notes: officialBase,
      evidence_payload: officialFinding.evidence_payload ?? {},
      extraction_method: officialFinding.extraction_method ?? `${VERSION}_${officialFinding.direct_source_verification_status}`,
      source_verification_summary: officialFinding.source_verification_summary,
      comparison_status: comparisonStatus,
      identity_match_status: identityMatchStatus,
      duplicate_risk: duplicateRisk,
      concentration_ambiguity: concentrationAmbiguity,
      recommended_lane: lane,
      recommended_helper: null,
      recommended_action: action,
      reason: officialFinding.reason,
    };
  }

  return base;
}

function safetyBucketFor(finding, identityMatchStatus, duplicateRisk, concentrationAmbiguity) {
  if (duplicateRisk !== "none" || concentrationAmbiguity !== "none") {
    return "RED_blocked";
  }
  if (identityMatchStatus !== "exact" && identityMatchStatus !== "not_checked") {
    return "RED_blocked";
  }
  if (["clone_source_conflict", "identity_needs_review", "unknown"].includes(finding.clone_vs_inspiration_risk)) {
    return finding.clone_vs_inspiration_risk === "unknown" ? "YELLOW_human_review" : "RED_blocked";
  }
  const highQuality = finding.extraction_quality === "high" && Number(finding.extraction_confidence ?? 0) >= 0.86;
  if (finding.source_evidence_type === "official_pyramid") {
    return highQuality ? "PURPLE_helper_review_candidate_later" : "YELLOW_human_review";
  }
  if (finding.source_evidence_type === "official_notes_only" || finding.source_evidence_type === "official_key_notes") {
    return highQuality ? "GREEN_registry_safe_capture" : "YELLOW_human_review";
  }
  if (finding.source_evidence_type === "official_prose_only" || finding.source_evidence_type === "ambiguous") {
    return "YELLOW_human_review";
  }
  if (finding.source_evidence_type === "missing_official_source") {
    return "YELLOW_human_review";
  }
  return "RED_blocked";
}

function recommendedLaneFor(target, finding, comparisonStatus, safetyBucket) {
  if (safetyBucket === "RED_blocked") return "duplicate_collision_review";
  const completed = isTaxonomyComplete(target);
  if (finding.source_evidence_type === "official_pyramid") {
    return completed ? "completed_official_pyramid_patch" : "pre_complete_official_pyramid_backfill";
  }
  if (finding.source_evidence_type === "official_notes_only" && comparisonStatus === "exact_match") {
    return completed ? "completed_official_notes_exact_lineage" : "pre_complete_official_notes_backfill";
  }
  if (finding.source_evidence_type === "official_notes_only" || finding.source_evidence_type === "official_key_notes") {
    return completed ? "completed_official_notes_audit_only" : "pre_complete_official_notes_backfill";
  }
  if (finding.source_evidence_type === "official_prose_only" || finding.source_evidence_type === "ambiguous") {
    return "weak_source_manual_review";
  }
  return "weak_source_manual_review";
}

function recommendedActionFor(target, finding, comparisonStatus, safetyBucket) {
  if (safetyBucket === "RED_blocked") return "skip_identity_risk";
  if (finding.source_evidence_type === "official_pyramid") return "ready_for_dry_run";
  if (!isTaxonomyComplete(target) && (finding.source_evidence_type === "official_notes_only" || finding.source_evidence_type === "official_key_notes")) {
    return "ready_for_dry_run";
  }
  if (finding.source_evidence_type === "official_notes_only" && comparisonStatus === "exact_match") {
    return "ready_for_dry_run";
  }
  if (finding.source_evidence_type === "official_notes_only" || finding.source_evidence_type === "official_key_notes") {
    return "audit_only";
  }
  if (finding.source_evidence_type === "official_prose_only") return "skip_prose_only";
  if (finding.source_evidence_type === "ambiguous") return "skip_ambiguous";
  return "needs_human_review";
}

function isTaxonomyComplete(target) {
  return target.queue_state === "already_complete" && target.queue_lane === "complete_no_action";
}

function recommendedHelperFor(lane) {
  switch (lane) {
    case "completed_official_pyramid_patch":
      return "public.apply_completed_fragrance_official_source_patch_v1";
    case "completed_official_notes_exact_lineage":
    case "completed_official_notes_audit_only":
      return "public.apply_completed_fragrance_official_notes_only_patch_v1";
    case "pre_complete_official_pyramid_backfill":
      return "public.apply_fragrance_official_source_backfill_v1";
    case "pre_complete_official_notes_backfill":
      return "public.apply_fragrance_official_notes_backfill_v1";
    default:
      return null;
  }
}

function identityStatusFor(target, finding, duplicateRisk, concentrationAmbiguity) {
  if (duplicateRisk !== "none") return "flanker_risk";
  if (concentrationAmbiguity !== "none") return "concentration_ambiguous";
  if (finding.source_evidence_type === "identity_mismatch") return "mismatch";
  if (finding.direct_source_verification_status === "direct_product_page_verified") return "exact";
  return "not_checked";
}

function directIdentityStatus(target, pageText, sourceUrl) {
  const text = normText(pageText);
  const nameTokens = meaningfulTokens(target.name);
  const brandTokens = meaningfulTokens(target.brand);
  const matchedNameTokens = nameTokens.filter((token) => text.includes(token));
  const matchedBrandTokens = brandTokens.filter((token) => text.includes(token));
  const urlText = normText(sourceUrl);
  const urlNameMatches = nameTokens.filter((token) => urlText.includes(token));
  const nameOk =
    nameTokens.length === 0 ||
    matchedNameTokens.length >= Math.min(nameTokens.length, 2) ||
    urlNameMatches.length >= Math.min(nameTokens.length, 2);
  const brandOk = brandTokens.length === 0 || matchedBrandTokens.length > 0 || domainMatchesOfficial(target.brand, sourceUrl);
  if (nameOk && brandOk) return "exact";
  if (brandOk) return "brand_only_match";
  if (nameOk) return "name_only_match";
  return "mismatch";
}

function cloneRiskFor(target, sourceUrl, html, pageText, pageTitle) {
  const brand = normText(target.brand);
  const text = normText(`${sourceUrl ?? ""} ${pageTitle ?? ""} ${pageText ?? htmlToText(html ?? "")}`);
  const warnings = [];
  if (!CLONE_HOUSE_BRANDS.has(brand)) {
    return { status: "not_applicable", warnings };
  }

  if (!sourceUrl || !domainMatchesOfficial(target.brand, sourceUrl)) {
    return {
      status: "clone_source_conflict",
      warnings: ["clone_source_conflict"],
    };
  }

  const hasInspirationLanguage =
    /\binspired by\b|\bimpression of\b|\btype\b|\bdupe\b|\balternative to\b/.test(text);
  const targetTokens = meaningfulTokens(target.name);
  const sourceMatchesTarget =
    targetTokens.length === 0 || targetTokens.filter((token) => text.includes(token)).length >= Math.min(targetTokens.length, 2);

  if (hasInspirationLanguage && sourceMatchesTarget) {
    warnings.push("clone_house_inspiration_warning");
    return { status: "inspired_by_slug_present", warnings };
  }
  if (hasInspirationLanguage && !sourceMatchesTarget) {
    return {
      status: "identity_needs_review",
      warnings: ["clone_house_inspiration_warning", "clone_house_identity_needs_review"],
    };
  }
  if (sourceMatchesTarget) {
    return { status: "exact_clone_house_page", warnings };
  }
  return {
    status: "unknown",
    warnings: ["clone_house_identity_needs_review"],
  };
}

function extractOfficialEvidenceFromHtml(html) {
  const jsonLd = extractJsonLdEvidence(html);
  if (jsonLd.quality === "high") return jsonLd;

  const bounded = extractBoundedHtmlEvidence(html);
  if (bounded.quality === "high") return bounded;

  const rejected = [...jsonLd.rejected_candidates, ...bounded.rejected_candidates]
    .filter(uniqueByNorm)
    .slice(0, 30);
  const warnings = [...jsonLd.warnings, ...bounded.warnings].filter(uniqueByNorm);
  if (bounded.quality === "medium") {
    warnings.push("bounded_note_container_not_trusted");
  }
  return {
    notes: [],
    top: [],
    heart: [],
    base: [],
    isKeyNotes: false,
    method: rejected.length ? "structured_or_bounded_candidates_rejected" : "no_bounded_note_list_found",
    quality: rejected.length ? "medium" : "low",
    confidence: rejected.length ? 0.45 : 0.15,
    warnings: warnings.length
      ? warnings
      : ["no JSON-LD or bounded official note list was found"],
    rejected_candidates: rejected,
  };
}

function extractJsonLdEvidence(html) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => decodeHtmlEntities(match[1]).trim())
    .filter(Boolean);
  const buckets = emptyEvidenceBuckets();
  const rejected = [];
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script);
      for (const node of flattenJsonLd(parsed)) {
        collectJsonLdNotes(node, buckets, rejected);
      }
    } catch {
      rejected.push("invalid JSON-LD block");
    }
  }
  return finalizeExtraction("json_ld_structured_note_fields", buckets, rejected);
}

function collectJsonLdNotes(value, buckets, rejected) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdNotes(item, buckets, rejected);
    return;
  }

  const normalizedName = normText(value.name);
  if (value.value && noteBucketFromLabel(normalizedName)) {
    addNotesToBucket(noteBucketFromLabel(normalizedName), value.value, buckets, rejected);
  }

  for (const [key, child] of Object.entries(value)) {
    const bucket = noteBucketFromLabel(key);
    if (bucket) {
      addNotesToBucket(bucket, child, buckets, rejected);
      continue;
    }
    if (child && typeof child === "object") collectJsonLdNotes(child, buckets, rejected);
  }
}

function extractBoundedHtmlEvidence(html) {
  const buckets = emptyEvidenceBuckets();
  const rejected = [];

  for (const label of ["top notes", "top note", "head notes", "opening notes"]) {
    addNotesToBucket("top", extractListAfterLabel(html, label), buckets, rejected);
  }
  for (const label of ["heart notes", "heart note", "middle notes", "middle note"]) {
    addNotesToBucket("heart", extractListAfterLabel(html, label), buckets, rejected);
  }
  for (const label of ["base notes", "base note", "drydown notes"]) {
    addNotesToBucket("base", extractListAfterLabel(html, label), buckets, rejected);
  }
  for (const label of ["key notes", "main notes"]) {
    addNotesToBucket("key", extractListAfterLabel(html, label), buckets, rejected);
  }
  for (const label of ["fragrance notes", "notes"]) {
    addNotesToBucket("notes", extractListAfterLabel(html, label), buckets, rejected);
  }

  for (const segment of extractNoteContainers(html)) {
    const items = extractDiscreteHtmlItems(segment);
    if (items.length >= 2) addNotesToBucket("notes", items, buckets, rejected);
  }

  return finalizeExtraction("bounded_html_note_list", buckets, rejected);
}

function extractListAfterLabel(html, label) {
  const pattern = new RegExp(
    `${escapeRegExp(label)}[\\s\\S]{0,500}?<(ul|ol)[^>]*>([\\s\\S]{0,1800}?)<\\/\\1>`,
    "i",
  );
  const match = html.match(pattern);
  if (!match) return [];
  return extractDiscreteHtmlItems(match[2]);
}

function extractNoteContainers(html) {
  const segments = [];
  const containerPattern =
    /<(section|div|ul|ol)[^>]*(?:class|id|data-[a-z0-9_-]+)=["'][^"']*(?:note|notes|pyramid|olfactive)[^"']*["'][^>]*>([\s\S]{0,2500}?)<\/\1>/gi;
  for (const match of html.matchAll(containerPattern)) {
    segments.push(match[2]);
  }
  return segments.slice(0, 20);
}

function extractDiscreteHtmlItems(htmlSegment) {
  const items = [];
  const itemPatterns = [
    /<li[^>]*>([\s\S]*?)<\/li>/gi,
    /<(?:span|button|a|p|div)[^>]*(?:class|data-[a-z0-9_-]+)=["'][^"']*(?:note|ingredient|material|accord|chip)[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|button|a|p|div)>/gi,
  ];
  for (const pattern of itemPatterns) {
    for (const match of htmlSegment.matchAll(pattern)) {
      items.push(htmlToText(match[1]));
    }
  }
  return items;
}

function flattenJsonLd(value) {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  const graph = value["@graph"];
  return [value, ...(Array.isArray(graph) ? graph.flatMap(flattenJsonLd) : [])];
}

function noteBucketFromLabel(label) {
  const normalized = normText(label);
  if (/^(top|head|opening) notes?$/.test(normalized)) return "top";
  if (/^(heart|middle) notes?$/.test(normalized)) return "heart";
  if (/^(base|drydown) notes?$/.test(normalized)) return "base";
  if (/^(key|main) notes?$/.test(normalized)) return "key";
  if (/^(fragrance )?notes?$/.test(normalized)) return "notes";
  return null;
}

function emptyEvidenceBuckets() {
  return {
    notes: [],
    top: [],
    heart: [],
    base: [],
    key: [],
    extractionWarnings: [],
    tierLabelSeen: false,
  };
}

function normalizeTierLabel(label) {
  const normalized = normText(label);
  if (["top", "head", "opening"].includes(normalized)) return "top";
  if (["heart", "middle", "mid"].includes(normalized)) return "heart";
  if (["base", "drydown"].includes(normalized)) return "base";
  return null;
}

function addNotesToBucket(bucket, rawValue, buckets, rejected) {
  const { accepted, acceptedByTier, rejected: bad, warnings } = parseNoteCandidates(rawValue, bucket);
  if (!accepted.length && !bad.length && !Object.values(acceptedByTier).some((values) => values.length)) return;
  const targetBucket = bucket === "key" ? "notes" : bucket;
  buckets[targetBucket].push(...accepted);
  for (const [tier, values] of Object.entries(acceptedByTier)) {
    buckets[tier].push(...values);
  }
  rejected.push(...bad);
  buckets.extractionWarnings.push(...warnings);
  if (Object.values(acceptedByTier).some((values) => values.length)) {
    buckets.tierLabelSeen = true;
  }
  if (bucket === "key" && accepted.length) {
    buckets.isKeyNotes = true;
  }
}

function parseNoteCandidates(rawValue, sourceBucket = "notes") {
  const rawCandidates = flattenNoteValue(rawValue);
  const accepted = [];
  const acceptedByTier = {
    top: [],
    heart: [],
    base: [],
  };
  const rejected = [];
  const warnings = [];
  let activeTier = ["top", "heart", "base"].includes(sourceBucket) ? sourceBucket : null;
  for (const rawCandidate of rawCandidates) {
    const parsed = cleanNoteCandidate(rawCandidate);
    warnings.push(...parsed.warnings);
    if (parsed.tier) {
      activeTier = parsed.tier;
    }
    if (!parsed.value) continue;
    if (isValidNoteCandidate(parsed.value)) {
      const note = titleCaseNote(parsed.value);
      if (parsed.tier) {
        acceptedByTier[parsed.tier].push(note);
      } else if (activeTier && sourceBucket === "notes") {
        acceptedByTier[activeTier].push(note);
      } else {
        accepted.push(note);
      }
    } else {
      warnings.push("dirty_note_candidate_rejected");
      rejected.push(parsed.value);
    }
  }
  return {
    accepted: accepted.filter(uniqueByNorm),
    acceptedByTier: {
      top: acceptedByTier.top.filter(uniqueByNorm),
      heart: acceptedByTier.heart.filter(uniqueByNorm),
      base: acceptedByTier.base.filter(uniqueByNorm),
    },
    rejected: rejected.filter(uniqueByNorm),
    warnings: warnings.filter(uniqueByNorm),
  };
}

function flattenNoteValue(value) {
  if (Array.isArray(value)) return value.flatMap(flattenNoteValue);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(flattenNoteValue);
  }
  if (typeof value !== "string") return [];
  const stripped = htmlToText(value);
  if (!stripped) return [];
  if (/[,;•·\n+/|]/.test(stripped)) {
    return stripped.split(/,|;|•|·|\n|\+|\/|\|/g);
  }
  return [stripped];
}

function cleanNoteCandidate(value) {
  const warnings = [];
  let candidate = String(value ?? "")
    .replace(/\b(top|heart|middle|base|head|opening|drydown|fragrance|key|main)\s+notes?\b/gi, "")
    .replace(/\bnotes?\b\s*[:\-]?/gi, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let tier = null;

  const labelMatch = candidate.match(/^(top|head|opening|heart|middle|mid|base|drydown)(?:\s+notes?)?\s*[:\-–—]\s*(.*)$/i);
  if (labelMatch) {
    tier = normalizeTierLabel(labelMatch[1]);
    candidate = labelMatch[2].trim();
    warnings.push("tier_label_contamination");
  }

  if (/^[^\p{L}\p{N}]+/u.test(candidate)) {
    candidate = candidate.replace(/^[^\p{L}\p{N}]+/u, "").trim();
    warnings.push("leading_punctuation_cleaned");
  }
  if (/[:\-–—]+$/.test(candidate)) {
    candidate = candidate.replace(/[:\-–—]+$/g, "").trim();
    warnings.push("trailing_punctuation_cleaned");
  }
  if (!candidate && tier) {
    warnings.push("empty_label_fragment_ignored");
  }
  return {
    value: candidate,
    tier,
    warnings,
  };
}

function isValidNoteCandidate(value) {
  if (/^\s*[^\p{L}\p{N}]/u.test(value)) return false;
  if (/\b(top|heart|middle|mid|base)\s*:/i.test(value)) return false;
  const normalized = normText(value);
  if (!normalized) return false;
  if (value.length > 36) return false;
  if (/[.!?]/.test(value)) return false;
  if (/\d/.test(value)) return false;
  if (PROSE_FRAGMENT_PATTERNS.some((pattern) => pattern.test(value))) return false;
  if (/\b(with|at|from|for|to)\s+the\b/i.test(value)) return false;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 5) return false;
  if (NOTE_CONNECTOR_STARTS.has(words[0])) return false;
  if (words.some((word) => PROSE_VERBS.has(word))) return false;
  if (words.some((word) => ["you", "your", "this", "that", "behind", "senses"].includes(word))) {
    return false;
  }
  return /^[a-z0-9][a-z0-9 '\-]+[a-z0-9]$/.test(normalized);
}

function finalizeExtraction(method, buckets, rejected) {
  const notes = uniqueNotes(buckets.notes);
  const top = uniqueNotes(buckets.top);
  const heart = uniqueNotes(buckets.heart);
  const base = uniqueNotes(buckets.base);
  const rejectedCandidates = uniqueNotes(rejected);
  const hasPyramid = top.length || heart.length || base.length;
  const hasNotes = notes.length;
  const warnings = [];
  warnings.push(...arr(buckets.extractionWarnings));
  if (rejectedCandidates.length) {
    warnings.push("one or more note-like candidates were rejected as prose fragments");
  }
  if (buckets.tierLabelSeen) {
    warnings.push("tier_label_contamination_cleaned");
  }
  if (hasPyramid && (!top.length || !heart.length || !base.length)) {
    warnings.push("positional_structure_incomplete");
  }
  const completePyramid = hasPyramid && top.length && heart.length && base.length;
  const notesOnly = !hasPyramid && hasNotes;
  const quality =
    (completePyramid || notesOnly) && rejectedCandidates.length === 0
      ? "high"
      : rejectedCandidates.length || hasPyramid || hasNotes
        ? "medium"
        : "low";
  const confidence = quality === "high" ? 0.9 : quality === "medium" ? 0.45 : 0.15;
  return {
    notes,
    top,
    heart,
    base,
    isKeyNotes: Boolean(buckets.isKeyNotes),
    method,
    quality,
    confidence,
    warnings,
    rejected_candidates: rejectedCandidates,
  };
}

function uniqueNotes(notes) {
  return arr(notes).map(titleCaseNote).filter(uniqueByNorm);
}

function titleCaseNote(value) {
  const smallWords = new Set(["de", "du", "des", "la", "le", "of", "the", "and"]);
  return value
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && smallWords.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function uniqueByNorm(value, index, values) {
  const normalized = normText(value);
  return values.findIndex((candidate) => normText(candidate) === normalized) === index;
}

function htmlToText(html) {
  return decodeHtmlEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&eacute;/g, "é")
    .replace(/&Eacute;/g, "É")
    .replace(/&agrave;/g, "à")
    .replace(/&Agrave;/g, "À")
    .replace(/&uuml;/g, "ü")
    .replace(/&Uuml;/g, "Ü");
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? htmlToText(match[1]).slice(0, 160) : null;
}

function domainMatchesOfficial(brand, sourceUrl) {
  const domains = OFFICIAL_DOMAINS_BY_BRAND.get(normText(brand));
  if (!domains || !sourceUrl) return false;
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, "");
    return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function safeUrl(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ["fbclid", "gclid"].includes(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return value;
  }
}

function compareNoteSets(current, official) {
  if (official.length === 0 && current.length === 0) return "not_comparable";
  if (official.length === 0) return "not_comparable";
  if (current.length === 0) return "current_empty";
  const currentSet = new Set(current);
  const officialSet = new Set(official);
  const officialInCurrent = official.every((note) => currentSet.has(note));
  const currentInOfficial = current.every((note) => officialSet.has(note));
  if (officialInCurrent && currentInOfficial) return "exact_match";
  if (officialInCurrent) return "official_subset_of_current";
  if (currentInOfficial) return "current_subset_of_official";
  const overlap = official.some((note) => currentSet.has(note));
  return overlap ? "overlaps_but_not_subset" : "mismatch";
}

function normalizeNotes(notes) {
  return [...new Set(arr(notes).map((note) => normText(note)).filter(Boolean))].sort();
}

function arr(value) {
  return Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined) : [];
}

function normText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function meaningfulTokens(value) {
  const stop = new Set([
    "the",
    "and",
    "of",
    "de",
    "la",
    "le",
    "les",
    "eau",
    "parfum",
    "toilette",
    "pour",
    "homme",
    "femme",
    "men",
    "women",
    "edp",
    "edt",
    "extrait",
  ]);
  return normText(value)
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .filter((token) => !stop.has(token));
}

function buildDryRunSql(helperPayloads, label) {
  if (helperPayloads.length === 0) {
    return [
      "begin;",
      "",
      "select jsonb_build_object(",
      "  'dry_run', true,",
      "  'requested_count', 0,",
      "  'valid_count', 0,",
      "  'would_insert_count', 0,",
      "  'skipped_reason', 'no registry-safe official evidence payloads generated'",
      ") as dry_run_result;",
      "",
      "rollback;",
      "",
    ].join("\n");
  }
  const payload = JSON.stringify(helperPayloads, null, 2).replace(/\$/g, "\\u0024");
  return [
    "begin;",
    "",
    "select public.record_fragrance_official_source_evidence_v1(",
    "  $vesper_payload$",
    payload,
    "$vesper_payload$::jsonb,",
    `  '${sqlString(`codex_${VERSION}_${label}`)}',`,
    "  true",
    ") as dry_run_result;",
    "",
    "rollback;",
    "",
  ].join("\n");
}

function sqlString(value) {
  return String(value).replace(/'/g, "''");
}

function validateGeneratedFiles(helperPayloads, dryRunSql, registryRows) {
  const lowerSql = dryRunSql.toLowerCase();
  const forbiddenHits = FORBIDDEN_SQL_TOKENS.filter((token) => {
    if (token === "record_fragrance_official_source_evidence_v1") return false;
    return new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(lowerSql);
  });
  const duplicateEvidencePayloadKeys = helperPayloads.some((payload) => {
    const text = JSON.stringify(payload);
    return (text.match(/"evidence_payload"/g) ?? []).length !== 1;
  });
  const sqlPayloads = extractHelperPayloadsFromSql(dryRunSql);
  const payloadsMatchSql =
    helperPayloads.length === 0 ||
    JSON.stringify(sqlPayloads) === JSON.stringify(helperPayloads);
  const badProseFragmentHits = findBadOfficialNoteFragments(helperPayloads);
  const generatedText = JSON.stringify({ helperPayloads, registryRows }) + dryRunSql;
  const disallowedProviderAliasPattern = new RegExp("reg" + "rella", "gi");
  const disallowedProviderAliasHits = generatedText.match(disallowedProviderAliasPattern) ?? [];
  return {
    json_parse_ok: true,
    duplicate_json_keys_possible: false,
    duplicate_key_check:
      duplicateEvidencePayloadKeys ? "failed" : "passed_generated_by_object_serializer",
    registry_payload_count_ok: helperPayloads.length <= DEFAULT_MAX_REGISTRY_PAYLOADS,
    registry_payload_count: helperPayloads.length,
    sql_has_begin: /\bbegin\b/i.test(dryRunSql),
    sql_has_rollback: /\brollback\b/i.test(dryRunSql),
    sql_uses_dry_run_true: helperPayloads.length === 0 || /,\s*true\s*\)/i.test(dryRunSql),
    sql_calls_registry_helper_only_when_payloads_exist:
      helperPayloads.length > 0
        ? /record_fragrance_official_source_evidence_v1/i.test(dryRunSql)
        : !/record_fragrance_official_source_evidence_v1/i.test(dryRunSql),
    forbidden_sql_tokens: forbiddenHits,
    sql_payloads_match_standalone_json: payloadsMatchSql,
    patch_safe_now_true_count: registryRows.filter((row) => row.review_envelope.patch_safe_now).length,
    bad_prose_fragment_hits: badProseFragmentHits,
    disallowed_provider_alias_hit_count: disallowedProviderAliasHits.length,
  };
}

function findBadOfficialNoteFragments(helperPayloads) {
  const hits = [];
  const arrays = ["official_notes", "official_top_notes", "official_heart_notes", "official_base_notes"];
  for (const payload of helperPayloads) {
    for (const key of arrays) {
      for (const note of arr(payload[key])) {
        if (!isValidNoteCandidate(note)) {
          hits.push({
            fragrance_id: payload.fragrance_id,
            field: key,
            value: note,
          });
        }
      }
    }
  }
  return hits;
}

function extractHelperPayloadsFromSql(sql) {
  const match = sql.match(/\$vesper_payload\$([\s\S]*?)\$vesper_payload\$/);
  if (!match) return [];
  return JSON.parse(match[1]);
}

function buildReviewReport(data) {
  const {
    generatedAt,
    projectRef,
    linkedProject,
    selectedTargets,
    registryRows,
    providerRows,
    needsReviewRows,
    blockedRows,
    providerConfigured,
    validation,
  } = data;

  const bucketCounts = countBy(
    [...registryRows, ...needsReviewRows, ...blockedRows],
    (row) => row.review_envelope?.safety_bucket ?? "unknown",
  );
  const evidenceCounts = countBy(
    [...registryRows, ...needsReviewRows, ...blockedRows],
    (row) => row.official_source?.source_evidence_type ?? "unknown",
  );
  const laneCounts = countBy(
    registryRows,
    (row) => row.helper_payload?.recommended_lane ?? "not_registry_payload",
  );
  const extractionQualityCounts = countBy(
    [...registryRows, ...needsReviewRows, ...blockedRows],
    (row) => row.review_envelope?.extraction_quality ?? "unknown",
  );

  return `# Vesper Enrichment Autopilot V1 Review Packet

Generated: ${generatedAt}

## Repo / Project

- Local project ref: ${projectRef ?? "not found"}
- Linked project ref: ${linkedProject ?? "not found"}
- Batch label: ${batchLabel}
- Selected target count: ${selectedTargets.length}
- Registry payload count: ${registryRows.length}
- Provider rows: ${providerRows.length}
- Needs-review rows: ${needsReviewRows.length}
- Blocked rows: ${blockedRows.length}

## Existing Fragella Lane Findings

- Existing code contains a Fragella provider lane in \`supabase/functions/enrich-fragrances/index.ts\`.
- Existing code contains a Fragella image lane in \`supabase/functions/enrich-fragrance-images/index.ts\`.
- Provider data remains provider-derived intelligence only. It is not official source truth and is not included in official-source registry helper payloads.
- Provider API key presence: ${providerConfigured ? "configured by environment name only; value not printed" : "not configured or not exposed to this process"}.

## Generated Files

- \`${OUTPUT_PREFIX}_registry_payloads.json\`
- \`${OUTPUT_PREFIX}_dry_run.sql\`
- \`${OUTPUT_PREFIX}_review_report.md\`
- \`${OUTPUT_PREFIX}_provider_enrichment.json\`
- \`${OUTPUT_PREFIX}_needs_review.json\`
- \`${OUTPUT_PREFIX}_blocked.json\`

## Classification Summary

### Safety Buckets

${markdownCountTable(bucketCounts)}

### Evidence Types

${markdownCountTable(evidenceCounts)}

### Registry Payload Recommended Lanes

${markdownCountTable(laneCounts)}

### Extraction Quality

${markdownCountTable(extractionQualityCounts)}

## Dry-Run SQL Safety

- The generated SQL is a dry-run review artifact only.
- It uses \`begin\` / \`rollback\`.
- It passes \`p_dry_run = true\` when registry payloads exist.
- It never calls patch helpers, performance refresh helpers, queue refresh helpers, or migration commands.
- If no registry-safe official evidence payloads are generated, the SQL returns a dry-run summary object instead of calling the registry helper with an invalid empty payload array.

## Validation

\`\`\`json
${JSON.stringify(validation, null, 2)}
\`\`\`

## Batch Review Guidance

- GREEN rows are registry-safe captures only, not patch approval.
- PURPLE rows may be useful helper-review candidates later, but \`patch_safe_now\` remains false in this packet.
- BLUE provider rows are provider-only enrichment intelligence and must not be promoted as official truth.
- YELLOW rows need human official-source review.
- RED rows are blocked by identity, duplicate, flanker, or concentration risk.

## Mutation Safety Statement

This packet generation did not execute the generated SQL. It did not mutate \`public.fragrances\`, registry tables, taxonomy tables, queue tables, performance tables, provider tables, or UI files.
`;
}

function markdownCountTable(counts) {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "| bucket | count |\n|---|---:|\n| none | 0 |";
  return [
    "| bucket | count |",
    "|---|---:|",
    ...entries.map(([bucket, count]) => `| ${bucket} | ${count} |`),
  ].join("\n");
}

function countBy(rows, getKey) {
  return rows.reduce((acc, row) => {
    const key = getKey(row);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function hasProviderKey() {
  return Boolean(process.env.FRAGELLA_API_KEY);
}

function hashObject(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
