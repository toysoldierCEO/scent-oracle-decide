#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const VERSION = "vesperizer_intake_autopilot_v1";
const SUPABASE_CLI = "supabase@2.106.0";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const FETCH_TIMEOUT_MS = 8000;

const TERMINAL_STATES = new Set([
  "matched_existing_catalog",
  "canonical_candidate_ready",
  "evidence_capture_ready",
  "profile_completion_ready",
  "resolve_plan_ready",
  "needs_review_with_reason",
  "source_not_found_after_attempts",
]);

const OPEN_INTAKE_STATUSES = new Set(["pending", "searching", "needs_review"]);
const RESOLVED_INTAKE_STATUSES = new Set(["matched_existing", "canonical_created", "resolved"]);

const OFFICIAL_DOMAINS_BY_BRAND = new Map([
  ["alexandria", ["alexandriafragrances.com"]],
  ["alexandria fragrances", ["alexandriafragrances.com"]],
  ["chanel", ["chanel.com"]],
  ["creed", ["creedfragrances.com", "creedboutique.com"]],
  ["dior", ["dior.com"]],
  ["diptyque", ["diptyqueparis.com"]],
  ["goldfield banks", ["goldfieldandbanks.com", "us.goldfieldandbanks.com"]],
  ["goldfield & banks", ["goldfieldandbanks.com", "us.goldfieldandbanks.com"]],
  ["goldfield and banks", ["goldfieldandbanks.com", "us.goldfieldandbanks.com"]],
  ["guerlain", ["guerlain.com"]],
  ["heeley", ["jamesheeley.com"]],
  ["jean paul gaultier", ["jeanpaulgaultier.com"]],
  ["le labo", ["lelabofragrances.com"]],
  ["maison francis kurkdjian", ["franciskurkdjian.com"]],
  ["parfums de marly", ["parfums-de-marly.com"]],
  ["prada", ["prada-beauty.com", "prada.com"]],
  ["tom ford", ["tomfordbeauty.com", "tomford.com"]],
  ["versace", ["versace.com"]],
  ["xerjoff", ["xerjoff.com"]],
  ["yves saint laurent", ["yslbeautyus.com", "yslbeauty.com"]],
]);

const args = parseArgs(process.argv.slice(2));
const dryRun = args["dry-run"] !== "false" && args.live !== "true";
const limit = Math.min(positiveInt(args.limit, DEFAULT_LIMIT), MAX_LIMIT);
const outputPrefix = args["output-prefix"] ?? `proposed_intake_autopilot_${timestampForFile()}`;

main().catch((error) => {
  console.error(`[${VERSION}] failed: ${error?.stack || error?.message || String(error)}`);
  process.exitCode = 1;
});

async function main() {
  const startedAt = new Date().toISOString();
  if (!dryRun) {
    throw new Error("Live execution is not supported in Intake Autopilot V1. Re-run with --dry-run.");
  }

  const projectRef = readLinkedProjectRef();
  if (!projectRef) {
    throw new Error("Missing linked Supabase project ref at supabase/.temp/project-ref.");
  }

  const targets = await loadIntakeTargets();
  const canonicalCandidates = [];
  const evidenceCandidates = [];
  const metadataCandidates = [];
  const resolvePlans = [];
  const needsReview = [];
  const sourceNotFound = [];
  const summaries = [];

  for (const target of targets) {
    const catalogMatches = await findCatalogMatches(target);
    const primaryMatch = pickPrimaryCatalogMatch(target, catalogMatches);
    const sourceDiscovery = primaryMatch?.exact
      ? { attempts: [], best: null, status: "skipped_existing_catalog" }
      : await discoverSources(target);

    const classification = classifyTarget(target, catalogMatches, primaryMatch, sourceDiscovery);
    summaries.push(classification.summary);

    if (classification.canonicalCandidate) canonicalCandidates.push(classification.canonicalCandidate);
    evidenceCandidates.push(...classification.evidenceCandidates);
    metadataCandidates.push(...classification.metadataCandidates);
    if (classification.resolvePlan) resolvePlans.push(classification.resolvePlan);
    if (classification.needsReview) needsReview.push(classification.needsReview);
    if (classification.sourceNotFound) sourceNotFound.push(classification.sourceNotFound);
  }

  const finishedAt = new Date().toISOString();
  const summary = {
    version: VERSION,
    dry_run: true,
    linked_project_ref: projectRef,
    started_at: startedAt,
    finished_at: finishedAt,
    target_count: targets.length,
    state_counts: countBy(summaries, (item) => item.state),
    canonical_candidate_count: canonicalCandidates.length,
    evidence_candidate_count: evidenceCandidates.length,
    metadata_candidate_count: metadataCandidates.length,
    resolve_plan_count: resolvePlans.length,
    needs_review_count: needsReview.length,
    source_not_found_count: sourceNotFound.length,
    inspected: summaries,
    generated_files: pathsFor(outputPrefix),
    safety: {
      live_writes_performed: false,
      public_fragrances_mutated: false,
      registry_provider_metadata_writes: false,
      resolve_helper_called_live: false,
      queue_or_performance_refresh: false,
      recommendation_or_layer_eligibility_forced: false,
    },
  };

  writeArtifacts(outputPrefix, {
    summary,
    canonicalCandidates,
    evidenceCandidates,
    metadataCandidates,
    resolvePlans,
    needsReview,
    sourceNotFound,
  });

  console.log(JSON.stringify(summary, null, 2));
}

async function loadIntakeTargets() {
  const intakeId = stringArg("intake-id");
  const targetName = stringArg("target-name");
  const targetBrand = stringArg("target-brand");

  if (intakeId) {
    assertUuid(intakeId, "--intake-id");
    return queryIntakes(`
      select ${intakeProjectionSql()}
      from public.fragrance_intake_requests_v1 i
      where i.id = ${sqlString(intakeId)}::uuid
      limit 1
    `);
  }

  if (targetName || targetBrand) {
    if (!targetName || !targetBrand) {
      throw new Error("--target-name and --target-brand must be supplied together.");
    }
    const targets = await queryIntakes(`
      select ${intakeProjectionSql()}
      from public.fragrance_intake_requests_v1 i
      where ${sqlNormalizeText("i.submitted_name")} = ${sqlString(normalizeIdentity(targetName))}
        and ${sqlNormalizeText("i.submitted_brand")} = ${sqlString(normalizeIdentity(targetBrand))}
      order by i.created_at desc
      limit 5
    `);
    if (targets.length > 0) return targets;

    return [{
      id: `ad_hoc:${normalizeIdentity(targetBrand)}:${normalizeIdentity(targetName)}`,
      submitted_name: targetName,
      submitted_brand: targetBrand,
      submitted_concentration: null,
      submitted_source_url: null,
      desired_status: "review_only",
      request_status: "ad_hoc_review",
      canonical_fragrance_id: null,
      limited_intel: true,
      created_at: null,
      updated_at: null,
      resolved_at: null,
      canonical_collection_status: null,
      canonical: null,
      is_ad_hoc: true,
    }];
  }

  return queryIntakes(`
    select ${intakeProjectionSql()}
    from public.fragrance_intake_requests_v1 i
    where i.request_status in ('pending', 'searching', 'needs_review')
    order by i.created_at asc
    limit ${limit}
  `);
}

async function queryIntakes(sql) {
  const wrapped = `
    with target_rows as (
      ${sql}
    )
    select coalesce(jsonb_agg(to_jsonb(target_rows)), '[]'::jsonb) as rows
    from target_rows;
  `;
  const result = runSupabaseJsonQuery(wrapped);
  const rows = firstJsonField(result, "rows");
  return Array.isArray(rows) ? rows : [];
}

function intakeProjectionSql() {
  return `
    i.id,
    i.submitted_name,
    i.submitted_brand,
    i.submitted_concentration,
    i.submitted_source_url,
    i.desired_status,
    i.request_status,
    i.canonical_fragrance_id,
    i.limited_intel,
    i.created_at,
    i.updated_at,
    i.resolved_at,
    (
      select uc.status
      from public.user_collection uc
      where uc.user_id = i.user_id
        and uc.fragrance_id = i.canonical_fragrance_id
      order by uc.updated_at desc nulls last, uc.created_at desc
      limit 1
    ) as canonical_collection_status,
    (
      select to_jsonb(f)
      from (
        select
          f.id,
          f.name,
          f.brand,
          f.family_key,
          f.notes,
          f.top_notes,
          f.heart_notes,
          f.base_notes,
          f.accords,
          f.concentration,
          f.release_year,
          f.perfumer,
          f.longevity_score,
          f.projection_score,
          f.source_url,
          f.source_confidence
        from public.fragrances f
        where f.id = i.canonical_fragrance_id
      ) f
    ) as canonical
  `;
}

async function findCatalogMatches(target) {
  const name = target.submitted_name ?? "";
  const brand = target.submitted_brand ?? "";
  const normalizedName = normalizeIdentity(name);
  const normalizedBrand = normalizeIdentity(brand);
  const brandTokens = significantTokens(brand);

  const sql = `
    with candidates as (
      select
        f.id,
        f.name,
        f.brand,
        f.family_key,
        f.notes,
        f.top_notes,
        f.heart_notes,
        f.base_notes,
        f.accords,
        f.concentration,
        f.release_year,
        f.perfumer,
        f.longevity_score,
        f.projection_score,
        f.source_url,
        f.source_confidence,
        ${sqlNormalizeText("f.name")} as normalized_name,
        ${sqlNormalizeText("f.brand")} as normalized_brand
      from public.fragrances f
      where ${sqlNormalizeText("f.name")} = ${sqlString(normalizedName)}
         or lower(f.name) like ${sqlString(`%${name.toLowerCase().replaceAll("%", "")}%`)}
      limit 25
    )
    select coalesce(jsonb_agg(to_jsonb(candidates)), '[]'::jsonb) as rows
    from candidates;
  `;
  const result = runSupabaseJsonQuery(sql);
  const rows = firstJsonField(result, "rows");
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const exactName = row.normalized_name === normalizedName;
    const exactBrand = row.normalized_brand === normalizedBrand;
    const nearBrand = !exactBrand && brandTokens.some((token) => row.normalized_brand?.includes(token));
    return {
      ...row,
      exact_name_match: exactName,
      exact_brand_match: exactBrand,
      near_brand_match: nearBrand,
      exact: exactName && exactBrand,
      confidence: exactName && exactBrand ? 0.99 : exactName && nearBrand ? 0.76 : 0.45,
    };
  });
}

function pickPrimaryCatalogMatch(target, matches) {
  if (target.canonical) {
    return {
      ...target.canonical,
      exact: true,
      exact_name_match: true,
      exact_brand_match: true,
      near_brand_match: false,
      confidence: 1,
      linked_from_intake: true,
    };
  }
  return [...matches].sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

async function discoverSources(target) {
  const attempts = [];
  const sourceUrl = cleanUrl(target.submitted_source_url);
  const candidateUrls = [];
  if (sourceUrl) candidateUrls.push(sourceUrl);
  candidateUrls.push(...officialCandidateUrls(target.submitted_brand, target.submitted_name));

  for (const url of unique(candidateUrls).slice(0, 4)) {
    const authority = classifySourceAuthority(target.submitted_brand, url);
    if (!authority.allowed) {
      attempts.push({ url, status: "skipped_non_official_or_unsafe", authority });
      continue;
    }

    try {
      const fetched = await fetchText(url);
      const identity = evaluateSourceIdentity(target, fetched.text, url);
      const attempt = {
        url,
        status: fetched.ok ? "fetched" : "fetch_failed",
        http_status: fetched.status,
        source_type: authority.sourceType,
        source_authority: authority.label,
        identity,
      };
      attempts.push(attempt);
      if (fetched.ok && identity.exact_name_support && identity.brand_support) {
        return { attempts, best: attempt, status: "official_source_found" };
      }
    } catch (error) {
      attempts.push({
        url,
        status: "fetch_error",
        error: safeError(error),
        source_type: authority.sourceType,
        source_authority: authority.label,
      });
    }
  }

  return {
    attempts,
    best: attempts.find((attempt) => attempt.identity?.exact_name_support) ?? null,
    status: attempts.length > 0 ? "no_exact_source_support" : "no_source_candidates",
  };
}

function classifyTarget(target, catalogMatches, primaryMatch, sourceDiscovery) {
  const normalizedName = normalizeIdentity(target.submitted_name);
  const normalizedBrand = normalizeIdentity(target.submitted_brand);
  const existingCanonical = primaryMatch?.exact ? primaryMatch : null;
  const sourceSummary = summarizeSourceDiscovery(sourceDiscovery);
  const baseSummary = {
    intake_id: target.id,
    submitted_name: target.submitted_name,
    submitted_brand: target.submitted_brand,
    desired_status: target.desired_status,
    request_status: target.request_status,
    canonical_fragrance_id: target.canonical_fragrance_id,
    user_facing_card_should_still_say_vesperizing: false,
    confidence: 0,
    state: null,
    reason: null,
    next_action: null,
    source_summary: sourceSummary,
  };

  if (existingCanonical) {
    const profile = summarizeCatalogProfile(existingCanonical, target.canonical_collection_status);
    const state = target.canonical_fragrance_id ? "matched_existing_catalog" : "resolve_plan_ready";
    const summary = {
      ...baseSummary,
      state,
      canonical_fragrance_id: existingCanonical.id,
      confidence: existingCanonical.confidence ?? 0.99,
      reason: target.canonical_fragrance_id
        ? "Intake is already linked to a canonical catalog fragrance."
        : "Exact catalog match exists; resolution can be reviewed separately.",
      next_action: target.canonical_fragrance_id
        ? (profile.recommendation_ready ? "no_live_action_needed" : "profile_or_performance_review_before_recommendations")
        : "review_resolve_helper_dry_run_before_live_link",
      user_facing_card_should_still_say_vesperizing: false,
      canonical_profile: profile,
    };
    return {
      summary,
      canonicalCandidate: null,
      evidenceCandidates: [],
      metadataCandidates: [],
      resolvePlan: target.canonical_fragrance_id ? null : {
        intake_id: target.id,
        submitted_name: target.submitted_name,
        submitted_brand: target.submitted_brand,
        canonical_fragrance_id: existingCanonical.id,
        canonical_name: existingCanonical.name,
        canonical_brand: existingCanonical.brand,
        dry_run_only: true,
        next_action: "run resolve_fragrance_intake_request_v1 with p_dry_run=true in a separate reviewed step",
      },
      needsReview: null,
      sourceNotFound: null,
    };
  }

  if (sourceDiscovery.status === "official_source_found") {
    const best = sourceDiscovery.best;
    const canonicalCandidate = {
      intake_id: target.id,
      submitted_name: target.submitted_name,
      submitted_brand: target.submitted_brand,
      normalized_name: normalizedName,
      normalized_brand: normalizedBrand,
      source_url: best.url,
      source_type: "official_brand",
      candidate_status: "review_required",
      confidence: best.identity.confidence,
      reason: "Official source supports exact identity; no exact catalog row found.",
      fields_to_keep_null: ["release_year", "performance", "layering", "recommendation_eligibility"],
    };
    const evidenceCandidate = {
      intake_id: target.id,
      source_url: best.url,
      source_type: "official_brand",
      evidence_status: "candidate_only",
      patch_safe_now: false,
      identity_support: best.identity,
      next_action: "manual evidence extraction/review before any registry write",
    };
    const metadataCandidate = {
      intake_id: target.id,
      source_url: best.url,
      source_type: "official_brand",
      metadata_status: "candidate_only",
      allowed_fields: ["concentration", "perfumer_names"],
      disallowed_fields_without_explicit_support: ["release_year", "performance"],
      patch_safe_now: false,
    };
    const summary = {
      ...baseSummary,
      state: "canonical_candidate_ready",
      confidence: best.identity.confidence,
      reason: "Official source supports a canonical candidate; catalog create remains review-only.",
      next_action: "review canonical candidate and source-backed evidence packet",
      user_facing_card_should_still_say_vesperizing: true,
    };
    return {
      summary,
      canonicalCandidate,
      evidenceCandidates: [evidenceCandidate],
      metadataCandidates: [metadataCandidate],
      resolvePlan: null,
      needsReview: null,
      sourceNotFound: null,
    };
  }

  const nearMatches = catalogMatches.filter((match) => match.exact_name_match || match.near_brand_match);
  if (nearMatches.length > 0) {
    const summary = {
      ...baseSummary,
      state: "needs_review_with_reason",
      confidence: Math.max(...nearMatches.map((match) => match.confidence)),
      reason: "Near catalog match or partial identity match found; exact identity is not safe enough for automatic resolution.",
      next_action: "manual catalog identity review",
      user_facing_card_should_still_say_vesperizing: true,
    };
    return {
      summary,
      canonicalCandidate: null,
      evidenceCandidates: [],
      metadataCandidates: [],
      resolvePlan: null,
      needsReview: {
        ...summary,
        near_matches: nearMatches.map((match) => ({
          fragrance_id: match.id,
          name: match.name,
          brand: match.brand,
          confidence: match.confidence,
          exact_name_match: match.exact_name_match,
          exact_brand_match: match.exact_brand_match,
          near_brand_match: match.near_brand_match,
        })),
      },
      sourceNotFound: null,
    };
  }

  const summary = {
    ...baseSummary,
    state: "source_not_found_after_attempts",
    confidence: 0.2,
    reason: "No exact catalog match and no exact official source support found during bounded dry-run discovery.",
    next_action: "manual source search or add exact official URL to intake",
    user_facing_card_should_still_say_vesperizing: true,
  };
  return {
    summary,
    canonicalCandidate: null,
    evidenceCandidates: [],
    metadataCandidates: [],
    resolvePlan: null,
    needsReview: null,
    sourceNotFound: summary,
  };
}

function summarizeCatalogProfile(row, collectionStatus) {
  const hasFamily = !!clean(row.family_key);
  const hasNotes = arrayLength(row.notes) > 0
    || arrayLength(row.top_notes) + arrayLength(row.heart_notes) + arrayLength(row.base_notes) > 0;
  const hasPerformance = row.longevity_score != null || row.projection_score != null;
  const sourceBackedProfile = !!clean(row.source_url) && hasNotes;
  return {
    name: row.name,
    brand: row.brand,
    family_key_present: hasFamily,
    source_backed_profile_present: sourceBackedProfile,
    notes_present: hasNotes,
    concentration: row.concentration ?? null,
    release_year_present: row.release_year != null,
    perfumer_catalog_present: !!clean(row.perfumer),
    performance_present: hasPerformance,
    collection_status: collectionStatus ?? null,
    recommendation_ready: Boolean(collectionStatus && hasFamily && hasNotes && hasPerformance),
    layer_ready: Boolean(collectionStatus && hasFamily && hasNotes && hasPerformance),
    recommendation_gate_reason: hasPerformance
      ? "trusted_profile_and_performance_present"
      : "performance_intel_pending",
  };
}

function officialCandidateUrls(brand, name) {
  const domains = OFFICIAL_DOMAINS_BY_BRAND.get(normalizeBrandKey(brand)) ?? [];
  const slug = slugifyProductName(name);
  const urls = [];
  for (const domain of domains) {
    urls.push(`https://${domain}/products/${slug}`);
    urls.push(`https://${domain}/product/${slug}`);
  }
  return urls;
}

function classifySourceAuthority(brand, url) {
  const parsed = safeParseUrl(url);
  if (!parsed || parsed.protocol !== "https:") {
    return { allowed: false, sourceType: "unsafe_url", label: "unsafe_or_non_https_url" };
  }
  const allowedDomains = OFFICIAL_DOMAINS_BY_BRAND.get(normalizeBrandKey(brand)) ?? [];
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const official = allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  if (!official) {
    return { allowed: false, sourceType: "non_official", label: `host_not_in_official_domain_allowlist:${host}` };
  }
  return { allowed: true, sourceType: "official_brand", label: host };
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": `${VERSION} dry-run source review`,
        "accept": "text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.4",
      },
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text: text.slice(0, 500000),
    };
  } finally {
    clearTimeout(timer);
  }
}

function evaluateSourceIdentity(target, sourceText, url) {
  const haystack = normalizeIdentity(stripHtml(sourceText));
  const nameKey = normalizeIdentity(target.submitted_name);
  const brandKey = normalizeIdentity(target.submitted_brand);
  const nameSupport = nameKey && haystack.includes(nameKey);
  const brandSupport = brandKey && haystack.includes(brandKey.replace(/^goldfieldbanks$/, "goldfieldbanks"));
  const urlSupport = normalizeIdentity(url).includes(nameKey);
  const exactName = Boolean(nameSupport || urlSupport);
  const exactBrand = Boolean(brandSupport || classifySourceAuthority(target.submitted_brand, url).allowed);
  return {
    exact_name_support: exactName,
    brand_support: exactBrand,
    url_identity_support: Boolean(urlSupport),
    confidence: exactName && exactBrand ? 0.86 : exactName ? 0.55 : 0.25,
  };
}

function summarizeSourceDiscovery(sourceDiscovery) {
  return {
    status: sourceDiscovery.status,
    attempts_count: sourceDiscovery.attempts?.length ?? 0,
    best_url: sourceDiscovery.best?.url ?? null,
    best_source_type: sourceDiscovery.best?.source_type ?? null,
    best_identity_support: sourceDiscovery.best?.identity ?? null,
  };
}

function writeArtifacts(prefix, artifacts) {
  const paths = pathsFor(prefix);
  for (const path of Object.values(paths)) {
    mkdirSync(dirname(path), { recursive: true });
  }
  writeMarkdown(paths.summary, artifacts.summary);
  writeJson(paths.canonicalCandidates, artifacts.canonicalCandidates);
  writeJson(paths.evidenceCandidates, artifacts.evidenceCandidates);
  writeJson(paths.metadataCandidates, artifacts.metadataCandidates);
  writeJson(paths.resolvePlans, artifacts.resolvePlans);
  writeJson(paths.needsReview, artifacts.needsReview);
  writeJson(paths.sourceNotFound, artifacts.sourceNotFound);
}

function writeMarkdown(path, summary) {
  const lines = [
    `# Intake Autopilot Dry Run`,
    ``,
    `- version: ${summary.version}`,
    `- dry_run: ${summary.dry_run}`,
    `- linked_project_ref: ${summary.linked_project_ref}`,
    `- target_count: ${summary.target_count}`,
    `- canonical_candidate_count: ${summary.canonical_candidate_count}`,
    `- evidence_candidate_count: ${summary.evidence_candidate_count}`,
    `- metadata_candidate_count: ${summary.metadata_candidate_count}`,
    `- resolve_plan_count: ${summary.resolve_plan_count}`,
    `- needs_review_count: ${summary.needs_review_count}`,
    `- source_not_found_count: ${summary.source_not_found_count}`,
    ``,
    `## State Counts`,
    ``,
    "```json",
    JSON.stringify(summary.state_counts, null, 2),
    "```",
    ``,
    `## Inspected Intakes`,
    ``,
    "```json",
    JSON.stringify(summary.inspected, null, 2),
    "```",
    ``,
    `## Safety`,
    ``,
    "```json",
    JSON.stringify(summary.safety, null, 2),
    "```",
  ];
  writeFileSync(path, `${lines.join("\n")}\n`);
}

function pathsFor(prefix) {
  return {
    summary: `${prefix}_summary.md`,
    canonicalCandidates: `${prefix}_canonical_candidates.json`,
    evidenceCandidates: `${prefix}_evidence_candidates.json`,
    metadataCandidates: `${prefix}_metadata_candidates.json`,
    resolvePlans: `${prefix}_resolve_plans.json`,
    needsReview: `${prefix}_needs_review.json`,
    sourceNotFound: `${prefix}_source_not_found.json`,
  };
}

function runSupabaseJsonQuery(sql) {
  const result = spawnSync(
    "npx",
    ["-y", SUPABASE_CLI, "db", "query", "--linked", "-o", "json", sql],
    {
      cwd: process.cwd(),
      env: { ...process.env, SUPABASE_CLI_DISABLE_TELEMETRY: "1" },
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 20,
    },
  );
  if (result.status !== 0) {
    throw new Error(`Supabase query failed: ${redact(result.stderr || result.stdout)}`);
  }
  const parsed = parseJsonFromOutput(result.stdout);
  if (!parsed) {
    throw new Error(`Supabase query did not return JSON: ${redact(result.stdout.slice(0, 1000))}`);
  }
  return parsed;
}

function firstJsonField(result, fieldName) {
  return result?.rows?.[0]?.[fieldName] ?? null;
}

function parseJsonFromOutput(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < firstBrace) return null;
  return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function stringArg(name) {
  const value = args[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function timestampForFile() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function readLinkedProjectRef() {
  const path = "supabase/.temp/project-ref";
  if (!existsSync(path)) return null;
  const ref = readFileSync(path, "utf8").trim();
  return /^[a-z0-9]{20}$/.test(ref) ? ref : null;
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function sqlNormalizeText(expression) {
  return `regexp_replace(lower(replace(coalesce(${expression}, ''), '&', 'and')), '[^a-z0-9]+', '', 'g')`;
}

function assertUuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a UUID.`);
  }
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function arrayLength(value) {
  return Array.isArray(value) ? value.filter((item) => clean(item)).length : 0;
}

function normalizeIdentity(value) {
  return String(value ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}

function normalizeBrandKey(value) {
  return String(value ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function significantTokens(value) {
  return normalizeBrandKey(value)
    .split(" ")
    .filter((token) => token.length >= 4 && !["and", "the"].includes(token))
    .map((token) => token.replace(/[^a-z0-9]/g, ""));
}

function slugifyProductName(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanUrl(value) {
  const text = clean(value);
  if (!text) return null;
  const parsed = safeParseUrl(text);
  return parsed?.protocol === "https:" ? parsed.toString() : null;
}

function safeParseUrl(value) {
  try {
    return new URL(String(value ?? ""));
  } catch {
    return null;
  }
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function countBy(items, selector) {
  const counts = {};
  for (const item of items) {
    const key = selector(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  for (const state of TERMINAL_STATES) {
    if (!Object.hasOwn(counts, state)) counts[state] = 0;
  }
  return counts;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function safeError(error) {
  return String(error?.message || error || "unknown_error").slice(0, 240);
}

function redact(value) {
  return String(value ?? "")
    .replace(/eyJ[a-zA-Z0-9._-]+/g, "[redacted-jwt]")
    .replace(/service[_-]?role[a-zA-Z0-9._=-]*/gi, "service_role[redacted]");
}
