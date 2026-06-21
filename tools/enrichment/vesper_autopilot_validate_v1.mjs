#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const VERSION = "vesper_autopilot_validate_v1";
const MAX_REGISTRY_PAYLOADS = 50;

const REQUIRED_PACKET_SUFFIXES = [
  "registry_payloads.json",
  "dry_run.sql",
  "review_report.md",
  "provider_enrichment.json",
  "needs_review.json",
  "blocked.json",
];

const OFFICIAL_NOTE_ARRAY_FIELDS = [
  "official_notes",
  "official_top_notes",
  "official_heart_notes",
  "official_base_notes",
];

const FORBIDDEN_SQL_TOKENS = [
  "insert",
  "update",
  "delete",
  "truncate",
  "alter",
  "grant",
  "revoke",
];

const FORBIDDEN_HELPER_OR_REFRESH_CALLS = [
  "apply_completed_fragrance_official_source_patch_v1",
  "apply_completed_fragrance_official_notes_only_patch_v1",
  "apply_fragrance_official_source_backfill_v1",
  "apply_fragrance_official_notes_backfill_v1",
  "refresh_taxonomy_operationalization_queue_current_v1",
  "refresh_fragrance_performance_features_v1",
];

const CLONE_HOUSE_BRANDS = [
  "alexandria",
  "alexandria fragrances",
  "dua",
  "the dua brand",
  "maison alhambra",
];

const OFFICIAL_REGISTRY_SOURCE_TIERS = new Set([
  "official_pyramid",
  "official_key_notes",
  "official_notes_only",
  "official_prose_only",
]);

const NON_OFFICIAL_SOURCE_TIERS = new Set([
  "retailer_pyramid_evidence",
  "retailer_structured_notes",
  "professional_provider_pyramid",
  "community_provider_consensus",
  "missing_official_source",
  "ambiguous",
]);

const DIRTY_NOTE_PATTERNS = [
  { label: "tier_label_contamination", pattern: /\b(?:Top|Heart|Middle|Mid|Base)\s*:/i },
  { label: "marketing_clause_take_over", pattern: /\btake over\b/i },
  { label: "marketing_clause_what_you_need", pattern: /\bwhat you need\b/i },
  { label: "marketing_clause_perfectly_balanced", pattern: /\bperfectly balanced\b/i },
  { label: "marketing_clause_comforting_embrace", pattern: /\bcomforting embrace\b/i },
  { label: "marketing_clause_may_not_return", pattern: /\bmay not return\b/i },
  { label: "marketing_clause_brings_a_sort", pattern: /\bbrings? a sort\b/i },
  { label: "marketing_clause_senses", pattern: /\bsenses?\b/i },
  { label: "marketing_clause_inspired_by", pattern: /\binspired by\b/i },
  { label: "marketing_clause_impression_of", pattern: /\bimpression of\b/i },
  { label: "marketing_clause_leaving_behind", pattern: /\bleaving behind\b/i },
  { label: "marketing_clause_designed_to", pattern: /\bdesigned to\b/i },
  { label: "marketing_clause_crafted_to", pattern: /\bcrafted to\b/i },
];

const PROSE_VERBS = new Set([
  "are",
  "balanced",
  "be",
  "been",
  "being",
  "bring",
  "brings",
  "can",
  "comforting",
  "create",
  "creates",
  "designed",
  "embrace",
  "evoke",
  "evokes",
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

const CATEGORY_OR_ACCORD_NOTE_VALUES = new Set([
  "aromatic",
  "aquatic accord",
  "aquatic accords",
  "citrus",
  "floral",
  "fresh",
  "fresh spicy",
  "fruity",
  "herbal",
  "musky",
  "powdery",
  "smoky",
  "soft spicy",
  "spicy",
  "warm spicy",
  "woody",
]);

const args = parseArgs(process.argv.slice(2));
const mode = args.mode ?? "packet";
const batchLabel = args["batch-label"] ?? "auto_001";
const prefix = args.prefix ?? prefixForBatchLabel(batchLabel);
const allowPatchSafe = args["allow-patch-safe"] === "true";

main();

function main() {
  const report = createReport(mode, prefix);

  try {
    if (mode === "packet") {
      validatePacket(report);
    } else if (mode === "dry-run") {
      validateDryRunOutput(report);
    } else {
      fail(report, "cli", "mode", `Unsupported mode: ${mode}`);
    }
  } catch (error) {
    fail(report, "runtime", "unexpected_error", error?.stack || error?.message || String(error));
  }

  printReport(report);
  process.exitCode = report.failed.length === 0 ? 0 : 1;
}

function validatePacket(report) {
  const files = requiredFiles(prefix);
  validateRequiredFiles(report, files);
  if (report.failed.length > 0) return;

  const registryPacket = readJsonWithDuplicateCheck(report, files.registry, "registry_payloads");
  const providerPacket = readJsonWithDuplicateCheck(report, files.provider, "provider_enrichment");
  const needsReviewPacket = readJsonWithDuplicateCheck(report, files.needsReview, "needs_review");
  const blockedPacket = readJsonWithDuplicateCheck(report, files.blocked, "blocked");
  const sql = readFileSync(files.sql, "utf8");
  const reportText = readFileSync(files.report, "utf8");

  validateNoRegrella(report, files, reportText, sql);
  validateRegistryPacket(report, registryPacket);
  validateProviderPacket(report, providerPacket);
  validateReviewBuckets(report, registryPacket);
  validateOfficialNoteCleanliness(report, registryPacket);
  validateCloneHouseWarnings(report, registryPacket);
  validateSql(report, sql, registryPacket);

  report.counts.registryPayloadCount = helperPayloadsFromPacket(registryPacket).length;
  report.counts.providerRowsCount = arrayRows(providerPacket).length;
  report.counts.needsReviewCount = arrayRows(needsReviewPacket).length;
  report.counts.blockedCount = arrayRows(blockedPacket).length;
}

function validateDryRunOutput(report) {
  const outputPath = args["dry-run-output"];
  if (!outputPath) {
    fail(report, "dry-run", "missing_output_path", "Pass --dry-run-output /path/to/output.json");
    return;
  }

  const files = requiredFiles(prefix);
  validateRequiredFiles(report, {
    registry: files.registry,
  });
  if (!existsSync(outputPath)) {
    fail(report, "dry-run", "missing_output_file", `Dry-run output file does not exist: ${outputPath}`);
    return;
  }
  if (report.failed.length > 0) return;

  const registryPacket = readJsonWithDuplicateCheck(report, files.registry, "registry_payloads");
  const helperPayloads = helperPayloadsFromPacket(registryPacket);
  const outputText = readFileSync(outputPath, "utf8");
  const output = parseJsonFromPossiblyNoisyText(outputText);
  if (!output.ok) {
    fail(report, "dry-run", "parse_output", output.reason);
    return;
  }

  const dryRunResult = extractDryRunResult(output.value);
  if (!dryRunResult) {
    fail(report, "dry-run", "missing_dry_run_result", "Could not find dry_run_result in output JSON");
    return;
  }

  const expectedCount = helperPayloads.length;
  report.counts.registryPayloadCount = expectedCount;
  report.counts.providerRowsCount = null;
  report.counts.needsReviewCount = null;
  report.counts.blockedCount = null;

  exactCheck(report, "dry-run", "dry_run_true", dryRunResult.dry_run, true);
  exactCheck(report, "dry-run", "requested_count", dryRunResult.requested_count, expectedCount);
  exactCheck(report, "dry-run", "valid_count", dryRunResult.valid_count, expectedCount);
  exactCheck(report, "dry-run", "rejected_count", expectedCount === 0 ? (dryRunResult.rejected_count ?? 0) : dryRunResult.rejected_count, 0);
  exactCheck(report, "dry-run", "would_insert_count", dryRunResult.would_insert_count, expectedCount);
  exactCheck(
    report,
    "dry-run",
    "would_skip_duplicate_count",
    expectedCount === 0 ? (dryRunResult.would_skip_duplicate_count ?? 0) : dryRunResult.would_skip_duplicate_count,
    0,
  );
  exactCheck(
    report,
    "dry-run",
    "would_supersede_count",
    expectedCount === 0 ? (dryRunResult.would_supersede_count ?? 0) : dryRunResult.would_supersede_count,
    0,
  );

  const results = Array.isArray(dryRunResult.results) ? dryRunResult.results : [];
  exactCheck(report, "dry-run", "result_count", results.length, expectedCount);

  const expectedByFragranceId = new Map(
    helperPayloads.map((payload) => [
      payload.fragrance_id,
      normalizeSourceUrl(payload.source_url),
    ]),
  );

  results.forEach((result, index) => {
    const rowLabel = result.fragrance_id || `result[${index}]`;
    if (result.status !== "would_insert") {
      fail(report, "dry-run", "unexpected_status", `${rowLabel}: expected status would_insert, got ${result.status}`);
    } else {
      pass(report, "dry-run", "status_would_insert", `${rowLabel}: status would_insert`);
    }

    if (!result.evidence_hash) {
      fail(report, "dry-run", "missing_evidence_hash", `${rowLabel}: missing evidence_hash`);
    } else {
      pass(report, "dry-run", "evidence_hash_present", `${rowLabel}: evidence_hash present`);
    }

    if (!expectedByFragranceId.has(result.fragrance_id)) {
      fail(report, "dry-run", "unexpected_fragrance_id", `${rowLabel}: fragrance_id is not present in packet helper payloads`);
      return;
    }

    pass(report, "dry-run", "fragrance_id_aligned", `${rowLabel}: fragrance_id matches packet`);
    const expectedUrl = expectedByFragranceId.get(result.fragrance_id);
    const actualUrl = normalizeSourceUrl(result.source_url_normalized);
    if (actualUrl && expectedUrl && actualUrl !== expectedUrl) {
      fail(report, "dry-run", "source_url_mismatch", `${rowLabel}: expected ${expectedUrl}, got ${actualUrl}`);
    } else {
      pass(report, "dry-run", "source_url_aligned", `${rowLabel}: source URL matches packet`);
    }
  });
}

function validateRequiredFiles(report, files) {
  for (const [key, filePath] of Object.entries(files)) {
    if (existsSync(filePath)) {
      pass(report, "files", "exists", `${key}: ${filePath}`);
    } else {
      fail(report, "files", "missing", `${key}: ${filePath}`);
    }
  }
}

function readJsonWithDuplicateCheck(report, filePath, label) {
  const text = readFileSync(filePath, "utf8");
  const duplicateKeys = findDuplicateJsonKeys(text);
  if (duplicateKeys.length > 0) {
    for (const duplicate of duplicateKeys.slice(0, 25)) {
      fail(report, label, "duplicate_json_key", `${filePath}: duplicate key "${duplicate.key}" near ${duplicate.path}`);
    }
  } else {
    pass(report, label, "duplicate_json_key_check", `${filePath}: no duplicate keys detected`);
  }

  try {
    const parsed = JSON.parse(text);
    pass(report, label, "json_parse", `${filePath}: JSON parsed`);
    return parsed;
  } catch (error) {
    fail(report, label, "json_parse", `${filePath}: ${error.message}`);
    return null;
  }
}

function validateRegistryPacket(report, packet) {
  if (!packet) return;
  const rows = arrayRows(packet);
  const helperPayloads = helperPayloadsFromPacket(packet);
  if (helperPayloads.length <= MAX_REGISTRY_PAYLOADS) {
    pass(report, "registry", "payload_count", `registry payload count ${helperPayloads.length} <= ${MAX_REGISTRY_PAYLOADS}`);
  } else {
    fail(report, "registry", "payload_count", `registry payload count ${helperPayloads.length} exceeds ${MAX_REGISTRY_PAYLOADS}`);
  }

  rows.forEach((row, index) => {
    const rowLabel = rowLabelFromRow(row, index);
    const patchSafeNow = row?.review_envelope?.patch_safe_now;
    if (patchSafeNow === true && !allowPatchSafe) {
      fail(report, "registry", "patch_safe_now", `${rowLabel}: patch_safe_now=true without --allow-patch-safe true`);
    } else {
      pass(report, "registry", "patch_safe_now", `${rowLabel}: patch_safe_now is not true`);
    }

    if (!row.helper_payload) {
      fail(report, "registry", "helper_payload", `${rowLabel}: missing helper_payload`);
    } else {
      pass(report, "registry", "helper_payload", `${rowLabel}: helper_payload present`);
      if (row?.official_registry_eligible === false || row?.trust_lane === "non_official_source_intelligence") {
        fail(report, "registry", "non_official_row_in_registry_packet", `${rowLabel}: non-official row leaked into registry packet`);
      } else {
        pass(report, "registry", "non_official_row_in_registry_packet", `${rowLabel}: registry row is not marked non-official`);
      }
      if (row.helper_payload.source_type !== "official_brand") {
        fail(report, "registry", "official_only_helper", `${rowLabel}: helper_payload source_type must be official_brand`);
      } else {
        pass(report, "registry", "official_only_helper", `${rowLabel}: helper_payload source_type official_brand`);
      }
      if (!OFFICIAL_REGISTRY_SOURCE_TIERS.has(row.helper_payload.source_evidence_type)) {
        fail(
          report,
          "registry",
          "official_only_source_tier",
          `${rowLabel}: helper_payload source_evidence_type is not an official registry tier`,
        );
      } else {
        pass(report, "registry", "official_only_source_tier", `${rowLabel}: helper_payload source tier is official`);
      }
    }
  });
}

function validateProviderPacket(report, packet) {
  if (!packet) return;
  const rows = arrayRows(packet);
  rows.forEach((row, index) => {
    const rowLabel = row?.name ? `${row.name} / ${row.brand ?? "unknown brand"}` : `provider[${index}]`;
    const provider = String(row?.provider ?? "");
    const isFragella = /fragr?ella/i.test(provider);
    const isVesperSourceTier = /^Vesper /i.test(provider);
    if (!isFragella && !isVesperSourceTier) {
      fail(report, "provider", "provider_identity", `${rowLabel}: provider must be Fragella or Vesper source-tier research`);
    } else {
      pass(report, "provider", "provider_identity", `${rowLabel}: provider identity allowed`);
    }

    if (isFragella && row?.trust_lane === "provider_only_enrichment") {
      pass(report, "provider", "trust_lane", `${rowLabel}: provider-only trust lane`);
    } else if (isVesperSourceTier && row?.trust_lane === "non_official_source_intelligence") {
      pass(report, "provider", "trust_lane", `${rowLabel}: non-official source intelligence trust lane`);
    } else {
      fail(report, "provider", "trust_lane", `${rowLabel}: unexpected trust_lane ${row?.trust_lane}`);
    }

    if (row?.source_type === "official_brand" || row?.source_evidence_type || row?.official_notes || row?.official_top_notes) {
      fail(report, "provider", "official_contamination", `${rowLabel}: provider row contains official-source fields`);
    } else {
      pass(report, "provider", "official_contamination", `${rowLabel}: no official-source fields`);
    }

    if (row?.official_source_url) {
      fail(report, "provider", "official_url_contamination", `${rowLabel}: provider row contains official_source_url`);
    } else {
      pass(report, "provider", "official_url_contamination", `${rowLabel}: no official source URL`);
    }

    if (isVesperSourceTier) {
      if (!NON_OFFICIAL_SOURCE_TIERS.has(row?.source_tier)) {
        fail(report, "provider", "non_official_source_tier", `${rowLabel}: unsupported non-official source_tier ${row?.source_tier}`);
      } else {
        pass(report, "provider", "non_official_source_tier", `${rowLabel}: non-official source tier allowed`);
      }
      if (row?.official_registry_eligible !== false) {
        fail(report, "provider", "registry_exclusion", `${rowLabel}: non-official row must set official_registry_eligible=false`);
      } else {
        pass(report, "provider", "registry_exclusion", `${rowLabel}: excluded from official registry`);
      }
      if (row?.patch_safe_now === true) {
        fail(report, "provider", "patch_safe_now", `${rowLabel}: non-official intelligence cannot be patch_safe_now`);
      } else {
        pass(report, "provider", "patch_safe_now", `${rowLabel}: not patch-safe`);
      }
    }
  });
}

function validateReviewBuckets(report, packet) {
  if (!packet) return;
  const rows = arrayRows(packet);
  rows.forEach((row, index) => {
    const rowLabel = rowLabelFromRow(row, index);
    const bucket = row?.review_envelope?.safety_bucket ?? "";
    if (!/^GREEN_|^PURPLE_/.test(bucket)) {
      return;
    }
    const quality = row?.review_envelope?.extraction_quality ?? row?.official_source?.extraction_quality;
    const confidence = Number(row?.review_envelope?.extraction_confidence ?? row?.official_source?.extraction_confidence ?? 0);
    if (quality !== "high") {
      fail(report, "quality", "green_purple_quality", `${rowLabel}: ${bucket} requires high extraction_quality, got ${quality}`);
    } else {
      pass(report, "quality", "green_purple_quality", `${rowLabel}: ${bucket} extraction_quality high`);
    }
    if (confidence < 0.85) {
      fail(report, "quality", "green_purple_confidence", `${rowLabel}: ${bucket} requires extraction_confidence >= 0.85, got ${confidence}`);
    } else {
      pass(report, "quality", "green_purple_confidence", `${rowLabel}: ${bucket} extraction_confidence ${confidence}`);
    }
  });
}

function validateOfficialNoteCleanliness(report, packet) {
  if (!packet) return;
  const rows = arrayRows(packet);
  rows.forEach((row, index) => {
    const rowLabel = rowLabelFromRow(row, index);
    const noteSources = [
      ["helper_payload", row.helper_payload],
      ["official_source", row.official_source],
    ];
    for (const [sourceLabel, source] of noteSources) {
      if (!source) continue;
      for (const field of OFFICIAL_NOTE_ARRAY_FIELDS) {
        const notes = Array.isArray(source[field]) ? source[field] : [];
        notes.forEach((note, noteIndex) => {
          const problem = noteCleanlinessProblem(note);
          const notePath = `${rowLabel}.${sourceLabel}.${field}[${noteIndex}]`;
          if (problem) {
            fail(report, "notes", problem.code, `${notePath}: "${note}" (${problem.reason})`);
          } else {
            pass(report, "notes", "clean_note_value", `${notePath}: "${note}"`);
          }
        });
      }
    }
  });
}

function validateCloneHouseWarnings(report, packet) {
  if (!packet) return;
  const rows = arrayRows(packet);
  rows.forEach((row, index) => {
    const rowLabel = rowLabelFromRow(row, index);
    const brand = String(row?.fragrance_identity?.brand ?? row?.helper_payload?.expected_brand ?? "").toLowerCase();
    const isCloneHouse = CLONE_HOUSE_BRANDS.some((cloneBrand) => brand === cloneBrand || brand.includes(cloneBrand));
    if (!isCloneHouse) return;

    const warnings = [
      ...(row?.review_envelope?.extraction_warnings ?? []),
      ...(row?.official_source?.extraction_warnings ?? []),
      ...(row?.helper_payload?.evidence_payload?.extraction_warnings ?? []),
      ...(row?.helper_payload?.evidence_payload?.clone_vs_inspiration_risk?.warnings ?? []),
    ].map((warning) => String(warning).toLowerCase());
    if (warnings.includes("clone_house_inspiration_warning")) {
      pass(report, "clone", "clone_house_warning", `${rowLabel}: clone/inspiration warning surfaced`);
    } else {
      fail(report, "clone", "clone_house_warning", `${rowLabel}: clone-house row is missing clone_house_inspiration_warning`);
    }
  });
}

function validateSql(report, sql, registryPacket) {
  const sqlLower = sql.toLowerCase();
  const helperPayloads = helperPayloadsFromPacket(registryPacket);
  if (/\bbegin\s*;/.test(sqlLower)) {
    pass(report, "sql", "begin", "SQL has begin");
  } else {
    fail(report, "sql", "begin", "SQL is missing begin");
  }
  if (/\brollback\s*;/.test(sqlLower)) {
    pass(report, "sql", "rollback", "SQL has rollback");
  } else {
    fail(report, "sql", "rollback", "SQL is missing rollback");
  }

  if (helperPayloads.length === 0) {
    if (/record_fragrance_official_source_evidence_v1\s*\(/i.test(sql)) {
      fail(report, "sql", "registry_helper_call", "Zero-payload SQL should not call registry evidence helper");
    } else {
      pass(report, "sql", "registry_helper_call", "Zero-payload SQL returns summary without registry helper call");
    }
    if (/'dry_run'\s*,\s*true/i.test(sql) && /'requested_count'\s*,\s*0/i.test(sql)) {
      pass(report, "sql", "dry_run_true", "Zero-payload SQL returns dry_run=true and requested_count=0");
    } else {
      fail(report, "sql", "dry_run_true", "Zero-payload SQL must return dry_run=true and requested_count=0");
    }
    if (/record_fragrance_official_source_evidence_v1[\s\S]*,\s*false\s*\)/i.test(sql)) {
      fail(report, "sql", "dry_run_false", "SQL contains registry helper p_dry_run=false");
    } else {
      pass(report, "sql", "dry_run_false", "SQL does not use p_dry_run=false");
    }
  } else if (/record_fragrance_official_source_evidence_v1\s*\(/i.test(sql)) {
    pass(report, "sql", "registry_helper_call", "SQL calls registry evidence helper");
    if (/record_fragrance_official_source_evidence_v1[\s\S]*,\s*true\s*\)\s+as\s+dry_run_result/i.test(sql)) {
      pass(report, "sql", "dry_run_true", "Registry helper call uses p_dry_run=true");
    } else {
      fail(report, "sql", "dry_run_true", "Could not verify registry helper p_dry_run=true");
    }
    if (/record_fragrance_official_source_evidence_v1[\s\S]*,\s*false\s*\)\s+as\s+dry_run_result/i.test(sql)) {
      fail(report, "sql", "dry_run_false", "SQL contains registry helper p_dry_run=false");
    } else {
      pass(report, "sql", "dry_run_false", "SQL does not use p_dry_run=false");
    }
  } else {
    fail(report, "sql", "registry_helper_call", "SQL does not call registry evidence helper");
  }

  for (const token of FORBIDDEN_SQL_TOKENS) {
    const pattern = new RegExp(`\\b${escapeRegExp(token)}\\b`, "i");
    if (pattern.test(sql)) {
      fail(report, "sql", "forbidden_mutation_token", `SQL contains forbidden token: ${token}`);
    } else {
      pass(report, "sql", "forbidden_mutation_token", `SQL does not contain forbidden token: ${token}`);
    }
  }

  for (const call of FORBIDDEN_HELPER_OR_REFRESH_CALLS) {
    if (new RegExp(`\\b${escapeRegExp(call)}\\b`, "i").test(sql)) {
      fail(report, "sql", "forbidden_helper_or_refresh", `SQL contains forbidden call: ${call}`);
    } else {
      pass(report, "sql", "forbidden_helper_or_refresh", `SQL does not contain forbidden call: ${call}`);
    }
  }

  if (/(insert|update|delete|truncate|alter)\s+(?:table\s+)?public\.fragrances\b/i.test(sql)) {
    fail(report, "sql", "public_fragrances_mutation", "SQL appears to mutate public.fragrances");
  } else {
    pass(report, "sql", "public_fragrances_mutation", "SQL does not mutate public.fragrances");
  }

  if (helperPayloads.length === 0) {
    pass(report, "sql", "payload_alignment", "Zero-payload SQL has no helper payloads to align");
    return;
  }

  const embeddedPayload = extractSqlVesperPayload(sql);
  if (!embeddedPayload.ok) {
    fail(report, "sql", "embedded_payload", embeddedPayload.reason);
    return;
  }
  const duplicateKeys = findDuplicateJsonKeys(embeddedPayload.text);
  if (duplicateKeys.length > 0) {
    duplicateKeys.slice(0, 25).forEach((duplicate) => {
      fail(report, "sql", "embedded_duplicate_json_key", `duplicate key "${duplicate.key}" near ${duplicate.path}`);
    });
  } else {
    pass(report, "sql", "embedded_duplicate_json_key", "SQL embedded JSON has no duplicate keys detected");
  }

  let sqlPayloads;
  try {
    sqlPayloads = JSON.parse(embeddedPayload.text);
    pass(report, "sql", "embedded_payload_parse", "SQL embedded JSON parsed");
  } catch (error) {
    fail(report, "sql", "embedded_payload_parse", error.message);
    return;
  }

  if (stableStringify(sqlPayloads) === stableStringify(helperPayloads)) {
    pass(report, "sql", "payload_alignment", "SQL helper payloads match standalone JSON helper payloads row-for-row");
  } else {
    fail(report, "sql", "payload_alignment", "SQL helper payloads do not match standalone JSON helper payloads");
  }
}

function validateNoRegrella(report, files, reportText, sql) {
  const checks = [
    ["dry_run.sql", sql],
    ["review_report.md", reportText],
  ];
  for (const [key, filePath] of Object.entries(files)) {
    if (filePath.endsWith(".json")) {
      checks.push([key, readFileSync(filePath, "utf8")]);
    }
  }
  checks.forEach(([label, text]) => {
    if (/regrella/i.test(text)) {
      fail(report, "terminology", "regrella", `${label}: contains Regrella wording`);
    } else {
      pass(report, "terminology", "regrella", `${label}: no Regrella wording`);
    }
  });
}

function exactCheck(report, category, check, actual, expected) {
  if (actual === expected) {
    pass(report, category, check, `${check}: ${actual}`);
  } else {
    fail(report, category, check, `${check}: expected ${expected}, got ${actual}`);
  }
}

function noteCleanlinessProblem(value) {
  if (typeof value !== "string") {
    return { code: "note_not_string", reason: "note value is not a string" };
  }
  const note = value.trim();
  if (!note) {
    return { code: "empty_note", reason: "empty after trim" };
  }
  if (/^[^\p{L}\p{N}]+/u.test(note)) {
    return { code: "leading_punctuation", reason: "starts with punctuation" };
  }
  for (const dirty of DIRTY_NOTE_PATTERNS) {
    if (dirty.pattern.test(note)) {
      return { code: dirty.label, reason: `matched ${dirty.label}` };
    }
  }
  if (CATEGORY_OR_ACCORD_NOTE_VALUES.has(note.toLowerCase())) {
    return { code: "category_or_accord_tag", reason: "category/accord label is not a discrete note material" };
  }
  const words = note.split(/\s+/).filter(Boolean);
  if (words.length > 5 || note.length > 48) {
    return { code: "note_too_long", reason: "too long to be a safe discrete note/material value" };
  }
  const lowerWords = words.map((word) => word.toLowerCase().replace(/[^a-z]/g, ""));
  if (lowerWords.some((word) => PROSE_VERBS.has(word))) {
    return { code: "prose_verb_fragment", reason: "contains prose-like verb" };
  }
  return null;
}

function extractSqlVesperPayload(sql) {
  const marker = "$vesper_payload$";
  const first = sql.indexOf(marker);
  if (first === -1) {
    return { ok: false, reason: "SQL is missing $vesper_payload$ marker" };
  }
  const second = sql.indexOf(marker, first + marker.length);
  if (second === -1) {
    return { ok: false, reason: "SQL has an opening $vesper_payload$ marker but no closing marker" };
  }
  return { ok: true, text: sql.slice(first + marker.length, second).trim() };
}

function helperPayloadsFromPacket(packet) {
  return arrayRows(packet)
    .map((row) => row.helper_payload)
    .filter(Boolean);
}

function arrayRows(packet) {
  return Array.isArray(packet?.rows) ? packet.rows : [];
}

function rowLabelFromRow(row, index) {
  const identity = row?.fragrance_identity ?? {};
  return `${identity.name ?? row?.helper_payload?.expected_name ?? "row"} / ${identity.brand ?? row?.helper_payload?.expected_brand ?? "unknown brand"} [${index}]`;
}

function requiredFiles(filePrefix) {
  return {
    registry: `${filePrefix}_registry_payloads.json`,
    sql: `${filePrefix}_dry_run.sql`,
    report: `${filePrefix}_review_report.md`,
    provider: `${filePrefix}_provider_enrichment.json`,
    needsReview: `${filePrefix}_needs_review.json`,
    blocked: `${filePrefix}_blocked.json`,
  };
}

function prefixForBatchLabel(label) {
  const match = String(label).match(/(\d+)$/);
  if (!match) return `proposed_autopilot_batch_${label}`;
  return `proposed_autopilot_batch_${match[1].padStart(3, "0")}`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function parseJsonFromPossiblyNoisyText(text) {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "Output file is empty" };
  const firstBrace = trimmed.indexOf("{");
  const firstBracket = trimmed.indexOf("[");
  const firstJsonIndex =
    firstBrace === -1 ? firstBracket : firstBracket === -1 ? firstBrace : Math.min(firstBrace, firstBracket);
  if (firstJsonIndex === -1) {
    return { ok: false, reason: "Output does not contain a JSON object or array" };
  }
  const jsonText = trimmed.slice(firstJsonIndex);
  try {
    return { ok: true, value: JSON.parse(jsonText) };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

function extractDryRunResult(output) {
  if (output?.dry_run_result) return output.dry_run_result;
  if (output?.dry_run === true) return output;
  if (Array.isArray(output?.rows)) {
    for (const row of output.rows) {
      if (row?.dry_run_result) return row.dry_run_result;
      if (row?.dry_run === true) return row;
    }
  }
  if (Array.isArray(output)) {
    for (const row of output) {
      const result = extractDryRunResult(row);
      if (result) return result;
    }
  }
  return null;
}

function normalizeSourceUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const parsed = new URL(String(rawUrl));
    parsed.hash = "";
    parsed.search = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return String(rawUrl).trim().toLowerCase().replace(/\/+$/, "");
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function findDuplicateJsonKeys(text) {
  const duplicates = [];
  const stack = [];
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (char === "{") {
      stack.push({ type: "object", keys: new Map(), expecting: "key", path: pathFromStack(stack) });
      i += 1;
      continue;
    }
    if (char === "[") {
      stack.push({ type: "array", expecting: "value", path: pathFromStack(stack) });
      i += 1;
      continue;
    }
    if (char === "}" || char === "]") {
      stack.pop();
      markValueConsumed(stack.at(-1));
      i += 1;
      continue;
    }
    if (char === ",") {
      const top = stack.at(-1);
      if (top?.type === "object") top.expecting = "key";
      if (top?.type === "array") top.expecting = "value";
      i += 1;
      continue;
    }
    if (char === ":") {
      const top = stack.at(-1);
      if (top?.type === "object" && top.expecting === "colon") top.expecting = "value";
      i += 1;
      continue;
    }
    if (char === '"') {
      const parsed = readJsonStringToken(text, i);
      const top = stack.at(-1);
      const nextChar = nextNonWhitespaceChar(text, parsed.end);
      if (top?.type === "object" && top.expecting === "key" && nextChar === ":") {
        const prior = top.keys.get(parsed.value);
        if (prior !== undefined) {
          duplicates.push({
            key: parsed.value,
            path: `${top.path || "$"}.${parsed.value}`,
            firstOffset: prior,
            duplicateOffset: i,
          });
        } else {
          top.keys.set(parsed.value, i);
        }
        top.expecting = "colon";
      } else {
        markValueConsumed(top);
      }
      i = parsed.end;
      continue;
    }
    if (/[tfn\-0-9]/.test(char)) {
      i = skipJsonPrimitive(text, i);
      markValueConsumed(stack.at(-1));
      continue;
    }
    i += 1;
  }
  return duplicates;
}

function pathFromStack(stack) {
  if (stack.length === 0) return "$";
  return `$[depth:${stack.length}]`;
}

function readJsonStringToken(text, start) {
  let i = start + 1;
  let value = "";
  while (i < text.length) {
    const char = text[i];
    if (char === "\\") {
      const escape = text[i + 1];
      value += char + (escape ?? "");
      i += 2;
      continue;
    }
    if (char === '"') {
      let parsedValue = value;
      try {
        parsedValue = JSON.parse(text.slice(start, i + 1));
      } catch {
        // Keep the raw value when the surrounding JSON is invalid; JSON.parse will report later.
      }
      return { value: parsedValue, end: i + 1 };
    }
    value += char;
    i += 1;
  }
  return { value, end: i };
}

function nextNonWhitespaceChar(text, start) {
  for (let i = start; i < text.length; i += 1) {
    if (!/\s/.test(text[i])) return text[i];
  }
  return "";
}

function skipJsonPrimitive(text, start) {
  let i = start;
  while (i < text.length && !/[\s,\]\}]/.test(text[i])) i += 1;
  return i;
}

function markValueConsumed(top) {
  if (!top) return;
  if (top.type === "object" && top.expecting === "value") top.expecting = "commaOrEnd";
  if (top.type === "array" && top.expecting === "value") top.expecting = "commaOrEnd";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createReport(reportMode, filePrefix) {
  return {
    mode: reportMode,
    prefix: filePrefix,
    counts: {
      registryPayloadCount: null,
      providerRowsCount: null,
      needsReviewCount: null,
      blockedCount: null,
    },
    passed: [],
    failed: [],
  };
}

function pass(report, category, check, message) {
  report.passed.push({ category, check, message });
}

function fail(report, category, check, message) {
  report.failed.push({ category, check, message });
}

function printReport(report) {
  const verdict = report.failed.length === 0 ? "PASS" : "FAIL";
  const nextStep =
    verdict === "PASS" && report.mode === "packet"
      ? "Proceed with generated dry-run SQL only"
      : verdict === "PASS" && report.mode === "dry-run"
        ? "Proofread dry-run output; V1 live-registry runner emits a validated proposal only"
        : "Revise before proceeding";

  console.log(`VERDICT: ${verdict}`);
  console.log(`validator: ${VERSION}`);
  console.log(`mode: ${report.mode}`);
  console.log(`packet_prefix: ${report.prefix}`);
  console.log(`registry payload count: ${formatNullable(report.counts.registryPayloadCount)}`);
  console.log(`provider rows count: ${formatNullable(report.counts.providerRowsCount)}`);
  console.log(`needs-review count: ${formatNullable(report.counts.needsReviewCount)}`);
  console.log(`blocked count: ${formatNullable(report.counts.blockedCount)}`);
  console.log(`checks passed: ${report.passed.length}`);
  console.log(`checks failed: ${report.failed.length}`);
  if (report.failed.length > 0) {
    console.log("failed checks:");
    report.failed.forEach((failure, index) => {
      console.log(`${index + 1}. [${failure.category}/${failure.check}] ${failure.message}`);
    });
  }
  console.log(`safe next step: ${nextStep}`);
}

function formatNullable(value) {
  return value === null || value === undefined ? "n/a" : String(value);
}
