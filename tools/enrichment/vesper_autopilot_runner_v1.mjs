#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const VERSION = "vesper_autopilot_runner_v1";
const SUPABASE_CLI = "supabase@2.106.0";
const MAX_REGISTRY_PAYLOADS = 50;
const DEFAULT_BATCH_LABEL = "auto_002";
const DEFAULT_MAX_TARGETS = 100;
const DEFAULT_MAX_REGISTRY_PAYLOADS = 50;
const REGISTRY_HELPER_NAME = "public.record_fragrance_official_source_evidence_v1";
const LIVE_EXECUTION_DISABLED_REASON =
  "live-registry execution is disabled in V1 because the approved dry-run SQL includes begin/rollback; V1 only emits a validated live SQL proposal derived by flipping p_dry_run true to false.";

const FORBIDDEN_LIVE_SQL_TOKENS = [
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

const args = parseArgs(process.argv.slice(2));
const mode = args.mode ?? "generate-only";
const batchLabel = args["batch-label"] ?? DEFAULT_BATCH_LABEL;
const maxTargets = positiveInt(args["max-targets"], DEFAULT_MAX_TARGETS);
const maxRegistryPayloads = Math.min(
  positiveInt(args["max-registry-payloads"], DEFAULT_MAX_REGISTRY_PAYLOADS),
  MAX_REGISTRY_PAYLOADS,
);
const prefix = args.prefix ?? prefixForBatchLabel(batchLabel);
const paths = pathsFor(prefix);

main().catch((error) => {
  console.error(`[${VERSION}] failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});

async function main() {
  const startedAt = new Date().toISOString();
  const state = {
    startedAt,
    finishedAt: null,
    mode,
    batchLabel,
    prefix,
    commands: [],
    packetValidation: null,
    dryRunValidation: null,
    dryRunSummary: null,
    liveWriteSummary: null,
    generationSummary: null,
    liveVerification: null,
    gitStatus: null,
    failures: [],
  };

  if (!["generate-only", "dry-run", "live-registry"].includes(mode)) {
    state.failures.push(`Unsupported mode: ${mode}`);
    finish(state);
    process.exitCode = 1;
    return;
  }

  if (mode === "generate-only" || mode === "dry-run") {
    runGeneration(state);
    if (state.failures.length > 0) {
      finish(state);
      process.exitCode = 1;
      return;
    }
    runPacketValidation(state);
    if (!validationPassed(state.packetValidation)) {
      state.failures.push("Packet validation failed; stopping before SQL execution.");
      finish(state);
      process.exitCode = 1;
      return;
    }
  }

  if (mode === "dry-run") {
    runDryRunSql(state);
    runDryRunValidation(state);
    if (!validationPassed(state.dryRunValidation)) {
      state.failures.push("Dry-run output validation failed.");
      finish(state);
      process.exitCode = 1;
      return;
    }
  }

  if (mode === "live-registry") {
    runPacketValidation(state);
    runDryRunValidation(state);
    if (!validationPassed(state.packetValidation) || !validationPassed(state.dryRunValidation)) {
      state.failures.push("Live registry mode requires existing passing packet and dry-run validation.");
      finish(state);
      process.exitCode = 1;
      return;
    }
    runLiveRegistryWrite(state);
    if (state.failures.length > 0) {
      finish(state);
      process.exitCode = 1;
      return;
    }
  }

  finish(state);
  process.exitCode = state.failures.length === 0 ? 0 : 1;
}

function runGeneration(state) {
  const commandArgs = [
    "tools/enrichment/vesper_enrichment_autopilot_v1.mjs",
    "--batch-label",
    batchLabel,
    "--max-targets",
    String(maxTargets),
    "--max-registry-payloads",
    String(maxRegistryPayloads),
  ];
  passThroughArg(commandArgs, "allow-official-fetch");
  passThroughArg(commandArgs, "provider-mode");
  passThroughArg(commandArgs, "brand-allowlist");

  const result = runCommand(state, "node", commandArgs, "generate autopilot packet");
  if (result.status !== 0) {
    state.failures.push("Generator failed.");
    return;
  }

  const parsed = parseJsonFromPossiblyNoisyText(result.stdout);
  if (parsed.ok) {
    state.generationSummary = parsed.value;
  } else {
    state.generationSummary = { parse_error: parsed.reason };
  }
}

function runPacketValidation(state) {
  const result = runCommand(
    state,
    "node",
    [
      "tools/enrichment/vesper_autopilot_validate_v1.mjs",
      "--mode",
      "packet",
      "--batch-label",
      batchLabel,
      "--prefix",
      prefix,
    ],
    "validate generated packet",
  );
  state.packetValidation = summarizeValidationOutput(result);
  if (result.status !== 0) {
    state.failures.push("Packet validator exited non-zero.");
  }
}

function runDryRunSql(state) {
  if (!existsSync(paths.dryRunSql)) {
    state.failures.push(`Dry-run SQL does not exist: ${paths.dryRunSql}`);
    return;
  }
  const result = runCommand(
    state,
    "npx",
    ["-y", SUPABASE_CLI, "db", "query", "--linked", "-f", paths.dryRunSql, "-o", "json"],
    "run registry dry-run SQL",
    { maxBuffer: 1024 * 1024 * 20 },
  );
  const parsed = parseJsonFromPossiblyNoisyText(result.stdout);
  if (result.status === 0 && parsed.ok) {
    writeJson(paths.dryRunOutput, parsed.value);
    state.dryRunSummary = summarizeDryRunResult(extractDryRunResult(parsed.value));
    return;
  }

  const fallback = runDryRunRpcFallback(state, result, parsed.reason);
  if (fallback.ok) {
    writeJson(paths.dryRunOutput, fallback.output);
    state.dryRunSummary = summarizeDryRunResult(extractDryRunResult(fallback.output));
    return;
  }

  writeJson(paths.dryRunOutput, {
    parse_error: parsed.reason,
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
    fallback_error: fallback.reason,
  });
  state.failures.push(`Dry-run output JSON parse failed: ${parsed.reason}`);
  if (result.status !== 0) {
    state.failures.push("Dry-run SQL command exited non-zero.");
  }
  state.failures.push(`Dry-run RPC fallback failed: ${fallback.reason}`);
}

function runDryRunRpcFallback(state, failedSqlResult, parseReason) {
  const projectRef = readProjectRef();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!projectRef || !serviceRoleKey) {
    return {
      ok: false,
      reason: "SUPABASE_SERVICE_ROLE_KEY or local project ref unavailable for read-only dry-run RPC fallback",
    };
  }

  let registryPacket;
  let helperPayloads;
  let actorLabel;
  try {
    registryPacket = readJson(paths.registryPayloads);
    helperPayloads = helperPayloadsFromPacket(registryPacket);
    actorLabel = extractActorLabelFromDryRunSql(readFileSync(paths.dryRunSql, "utf8"));
  } catch (error) {
    return { ok: false, reason: `could not prepare dry-run RPC payload: ${error.message}` };
  }
  if (!helperPayloads.length) {
    return { ok: false, reason: "no helper payloads available for dry-run RPC fallback" };
  }
  if (!actorLabel) {
    return { ok: false, reason: "could not extract actor label from approved dry-run SQL" };
  }

  const script = `
    import { readFileSync } from 'node:fs';
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const response = await fetch(input.url, {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: 'Bearer ' + key,
        accept: 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        p_evidence_payloads: input.payloads,
        p_actor_label: input.actorLabel,
        p_dry_run: true
      })
    });
    const text = await response.text();
    if (!response.ok) {
      console.error('PostgREST dry-run RPC failed: HTTP ' + response.status);
      console.error(text.slice(0, 500));
      process.exit(1);
    }
    process.stdout.write(text);
  `;
  const url = `https://${projectRef}.supabase.co/rest/v1/rpc/record_fragrance_official_source_evidence_v1`;
  const result = spawnSync("node", ["--input-type=module", "-e", script], {
    encoding: "utf8",
    input: JSON.stringify({
      url,
      payloads: helperPayloads,
      actorLabel,
    }),
    env: {
      ...process.env,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    },
    maxBuffer: 1024 * 1024 * 20,
  });
  state.commands.push({
    label: "run registry dry-run RPC fallback",
    command: "node",
    args: ["--input-type=module", "-e", "[dry-run RPC fallback script redacted]", "< approved payload stdin"],
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  });

  if (result.status !== 0) {
    return {
      ok: false,
      reason: result.stderr || `dry-run RPC fallback exited ${result.status}`,
    };
  }
  const parsed = parseJsonFromPossiblyNoisyText(result.stdout);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: `dry-run RPC fallback returned non-JSON output after SQL transport failed (${parseReason}): ${parsed.reason}`,
    };
  }
  return {
    ok: true,
    output: { dry_run_result: parsed.value },
    prior_sql_status: failedSqlResult.status,
  };
}

function runDryRunValidation(state) {
  const result = runCommand(
    state,
    "node",
    [
      "tools/enrichment/vesper_autopilot_validate_v1.mjs",
      "--mode",
      "dry-run",
      "--batch-label",
      batchLabel,
      "--prefix",
      prefix,
      "--dry-run-output",
      paths.dryRunOutput,
    ],
    "validate dry-run output",
  );
  state.dryRunValidation = summarizeValidationOutput(result);
  if (result.status !== 0) {
    state.failures.push("Dry-run validator exited non-zero.");
  }
}

function runLiveRegistryWrite(state) {
  const registryPacket = readJson(paths.registryPayloads);
  const helperPayloads = helperPayloadsFromPacket(registryPacket);
  if (helperPayloads.length === 0) {
    state.failures.push("Live registry mode refused: no helper payloads.");
    return;
  }

  if (!existsSync(paths.dryRunSql)) {
    state.failures.push(`Live registry mode refused: approved dry-run SQL is missing: ${paths.dryRunSql}`);
    return;
  }

  const dryRunSql = readFileSync(paths.dryRunSql, "utf8");
  const liveSqlBuild = buildLiveRegistrySqlFromDryRun(dryRunSql);
  if (!liveSqlBuild.ok) {
    state.failures.push(`Live registry mode refused: ${liveSqlBuild.reason}`);
    return;
  }

  const liveSql = liveSqlBuild.sql;
  const liveSqlValidation = validateLiveSqlProposal({
    dryRunSql,
    liveSql,
    helperPayloads,
  });
  writeFileSync(paths.liveWriteSql, liveSql);

  state.liveWriteSummary = {
    execution: "disabled_in_v1",
    live_sql_path: paths.liveWriteSql,
    live_sql_validation: liveSqlValidation,
    reason: LIVE_EXECUTION_DISABLED_REASON,
  };

  if (!liveSqlValidation.ok) {
    state.failures.push(`Live SQL proposal validation failed: ${liveSqlValidation.errors.join("; ")}`);
    return;
  }

  state.failures.push(LIVE_EXECUTION_DISABLED_REASON);
}

function finish(state) {
  state.finishedAt = new Date().toISOString();
  state.gitStatus = runGitStatus();
  const finalReport = buildFinalReport(state);
  writeFileSync(paths.finalStatus, finalReport);
  console.log(finalReport);
}

function buildLiveRegistrySqlFromDryRun(dryRunSql) {
  const helperCallPattern =
    /public\.record_fragrance_official_source_evidence_v1\(\s*\$vesper_payload\$[\s\S]*?\$vesper_payload\$::jsonb,\s*'[^']*',\s*(true)\s*\)\s+as\s+dry_run_result/i;
  const matches = [...dryRunSql.matchAll(new RegExp(helperCallPattern.source, "gi"))];
  if (matches.length !== 1) {
    return {
      ok: false,
      reason: `expected exactly one registry helper dry-run call with p_dry_run=true, found ${matches.length}`,
    };
  }

  const liveSql = dryRunSql.replace(helperCallPattern, (match) => match.replace(/\btrue\b(?=\s*\)\s+as\s+dry_run_result)/i, "false"));
  if (liveSql === dryRunSql) {
    return { ok: false, reason: "could not flip p_dry_run=true to p_dry_run=false" };
  }
  return { ok: true, sql: liveSql };
}

function validateLiveSqlProposal({ dryRunSql, liveSql, helperPayloads }) {
  const errors = [];
  const warnings = [];
  const helperPayloadsInDryRun = extractHelperPayloadsFromSql(dryRunSql);
  const helperPayloadsInLiveSql = extractHelperPayloadsFromSql(liveSql);

  if (!differsOnlyByDryRunBoolean(dryRunSql, liveSql)) {
    errors.push("live SQL differs from dry-run SQL by more than p_dry_run true -> false");
  }
  if (!liveSql.includes(REGISTRY_HELPER_NAME)) {
    errors.push("live SQL does not call the registry evidence helper");
  }
  if ((liveSql.match(/record_fragrance_official_source_evidence_v1\s*\(/gi) ?? []).length !== 1) {
    errors.push("live SQL must contain exactly one registry helper call");
  }
  if (stableStringify(helperPayloadsInDryRun) !== stableStringify(helperPayloads)) {
    errors.push("dry-run SQL payload does not match registry payload JSON");
  }
  if (stableStringify(helperPayloadsInLiveSql) !== stableStringify(helperPayloads)) {
    errors.push("live SQL payload does not match registry payload JSON");
  }
  if (helperPayloadsInLiveSql.length !== helperPayloads.length) {
    errors.push("live SQL helper payload count does not match registry payload count");
  }
  if (/record_fragrance_official_source_evidence_v1[\s\S]*,\s*true\s*\)\s+as\s+dry_run_result/i.test(liveSql)) {
    errors.push("live SQL still contains p_dry_run=true");
  }
  if (!/record_fragrance_official_source_evidence_v1[\s\S]*,\s*false\s*\)\s+as\s+dry_run_result/i.test(liveSql)) {
    errors.push("live SQL does not contain p_dry_run=false in the registry helper call");
  }

  for (const token of FORBIDDEN_LIVE_SQL_TOKENS) {
    if (new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(liveSql)) {
      errors.push(`live SQL contains forbidden mutation token: ${token}`);
    }
  }
  for (const call of FORBIDDEN_HELPER_OR_REFRESH_CALLS) {
    if (new RegExp(`\\b${escapeRegExp(call)}\\b`, "i").test(liveSql)) {
      errors.push(`live SQL contains forbidden helper or refresh call: ${call}`);
    }
  }
  if (/(insert|update|delete|truncate|alter)\s+(?:table\s+)?public\.fragrances\b/i.test(liveSql)) {
    errors.push("live SQL appears to mutate public.fragrances");
  }
  if (/\bmigration\b|\bdb\s+(push|pull)\b|\bmigration\s+up\b/i.test(liveSql)) {
    errors.push("live SQL contains migration-like wording");
  }
  if (/\brollback\s*;/i.test(liveSql)) {
    warnings.push("live SQL proposal still contains rollback because V1 derives it by changing only p_dry_run; live execution is disabled");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    helper_payload_count: helperPayloads.length,
    dry_run_sql_payload_count: helperPayloadsInDryRun.length,
    live_sql_payload_count: helperPayloadsInLiveSql.length,
    derived_by_single_boolean_flip: differsOnlyByDryRunBoolean(dryRunSql, liveSql),
  };
}

function extractHelperPayloadsFromSql(sql) {
  const marker = "$vesper_payload$";
  const first = sql.indexOf(marker);
  if (first === -1) return [];
  const second = sql.indexOf(marker, first + marker.length);
  if (second === -1) return [];
  return JSON.parse(sql.slice(first + marker.length, second).trim());
}

function differsOnlyByDryRunBoolean(dryRunSql, liveSql) {
  const dryMarker = "__VESPER_DRY_RUN_BOOL__";
  const liveMarker = "__VESPER_DRY_RUN_BOOL__";
  const normalizedDry = dryRunSql.replace(
    /record_fragrance_official_source_evidence_v1([\s\S]*?),\s*true\s*\)\s+as\s+dry_run_result/i,
    `record_fragrance_official_source_evidence_v1$1, ${dryMarker}) as dry_run_result`,
  );
  const normalizedLive = liveSql.replace(
    /record_fragrance_official_source_evidence_v1([\s\S]*?),\s*false\s*\)\s+as\s+dry_run_result/i,
    `record_fragrance_official_source_evidence_v1$1, ${liveMarker}) as dry_run_result`,
  );
  return normalizedDry === normalizedLive;
}

function queryFragrancesFingerprint(state, label) {
  const sql = `
    select jsonb_build_object(
      'row_count', count(*),
      'checksum', md5(coalesce(string_agg(
        concat_ws('|',
          id::text,
          coalesce(name, ''),
          coalesce(brand, ''),
          coalesce(family_key, ''),
          coalesce(array_to_string(notes, ','), ''),
          coalesce(array_to_string(top_notes, ','), ''),
          coalesce(array_to_string(heart_notes, ','), ''),
          coalesce(array_to_string(base_notes, ','), ''),
          coalesce(array_to_string(accords, ','), ''),
          coalesce(source_url, ''),
          coalesce(source_confidence::text, ''),
          coalesce(longevity_score::text, ''),
          coalesce(projection_score::text, '')
        ),
        '||' order by id::text
      ), ''))
    ) as public_fragrances_fingerprint
    from public.fragrances;
  `;
  const result = runCommand(
    state,
    "npx",
    ["-y", SUPABASE_CLI, "db", "query", "--linked", "-o", "json", "--sql", sql],
    `read public.fragrances fingerprint ${label}`,
    { maxBuffer: 1024 * 1024 * 20 },
  );
  if (result.status !== 0) {
    state.failures.push(`Could not read public.fragrances fingerprint ${label}.`);
    return null;
  }
  const parsed = parseJsonFromPossiblyNoisyText(result.stdout);
  const rows = parsed.ok ? parsed.value?.rows : null;
  return rows?.[0]?.public_fragrances_fingerprint ?? null;
}

function queryActiveRegistryCount(state, label) {
  const sql = `
    select count(*)::int as active_registry_count
    from public.fragrance_official_source_registry_candidate_view_v1
    where active_capture_guard is true;
  `;
  const result = runCommand(
    state,
    "npx",
    ["-y", SUPABASE_CLI, "db", "query", "--linked", "-o", "json", "--sql", sql],
    `read active registry count ${label}`,
    { maxBuffer: 1024 * 1024 * 20 },
  );
  if (result.status !== 0) {
    state.failures.push(`Could not read active registry count ${label}.`);
    return null;
  }
  const parsed = parseJsonFromPossiblyNoisyText(result.stdout);
  const rows = parsed.ok ? parsed.value?.rows : null;
  return Number(rows?.[0]?.active_registry_count ?? Number.NaN);
}

function buildFinalReport(state) {
  const packet = existsSync(paths.registryPayloads) ? readJson(paths.registryPayloads) : null;
  const provider = existsSync(paths.providerEnrichment) ? readJson(paths.providerEnrichment) : null;
  const needsReview = existsSync(paths.needsReview) ? readJson(paths.needsReview) : null;
  const blocked = existsSync(paths.blocked) ? readJson(paths.blocked) : null;
  const registryRows = arrayRows(packet);
  const allRows = [
    ...registryRows,
    ...arrayRows(needsReview),
    ...arrayRows(blocked),
  ];
  const evidenceCounts = countBy(allRows, (row) => row?.official_source?.source_evidence_type ?? "unknown");
  const bucketCounts = countBy(allRows, (row) => row?.review_envelope?.safety_bucket ?? "unknown");
  const failures = state.failures.length ? state.failures : ["none"];
  const verdict = state.failures.length === 0 ? "PASS" : "FAIL";
  const safeNextAction = safeNextActionFor(state, verdict);

  return `# Vesper Autopilot Runner V1 Final Status

Generated: ${state.finishedAt}

## Verdict

- VERDICT: ${verdict}
- Safe next action: ${safeNextAction}
- Runner: ${VERSION}
- Mode: ${state.mode}
- Batch label: ${state.batchLabel}
- Packet prefix: ${state.prefix}

## Counts

- Registry payload count: ${registryRows.length}
- Provider-only count: ${arrayRows(provider).length}
- Needs-review count: ${arrayRows(needsReview).length}
- Blocked count: ${arrayRows(blocked).length}

## Evidence Type Counts

${markdownCountTable(evidenceCounts)}

## Safety Bucket Counts

${markdownCountTable(bucketCounts)}

## Validation Checks

### Packet Validation

${validationMarkdown(state.packetValidation)}

### Dry-Run Validation

${validationMarkdown(state.dryRunValidation)}

## Failed Rows / Reasons

${failures.map((failure) => `- ${failure}`).join("\n")}

## Dry-Run Summary

\`\`\`json
${JSON.stringify(state.dryRunSummary ?? null, null, 2)}
\`\`\`

## Live-Write Summary

\`\`\`json
${JSON.stringify(state.liveWriteSummary ?? null, null, 2)}
\`\`\`

## public.fragrances Checksum Verification

\`\`\`json
${JSON.stringify(state.liveVerification ?? "not run", null, 2)}
\`\`\`

## Commands

${state.commands.map(commandRecordToMarkdown).join("\n\n")}

## Git Status

\`\`\`text
${state.gitStatus}
\`\`\`
`;
}

function validationMarkdown(validation) {
  if (!validation) return "not run";
  return [
    `- Verdict: ${validation.verdict ?? "unknown"}`,
    `- Checks passed: ${validation.checksPassed ?? "unknown"}`,
    `- Checks failed: ${validation.checksFailed ?? "unknown"}`,
    "",
    "```text",
    validation.stdout.trim(),
    "```",
  ].join("\n");
}

function commandRecordToMarkdown(record) {
  return [
    `### ${record.label}`,
    "",
    "```bash",
    `${record.command} ${record.args.map(shellQuote).join(" ")}`.trim(),
    "```",
    "",
    `exit status: ${record.status}`,
  ].join("\n");
}

function safeNextActionFor(state, verdict) {
  if (verdict !== "PASS") return "Revise autopilot packet/tooling before continuing";
  if (state.mode === "generate-only") return "Proceed with runner dry-run mode";
  if (state.mode === "dry-run") return "Proofread dry-run output; V1 live-registry mode emits a validated proposal only";
  if (state.mode === "live-registry") return "Verify registry candidate view and prepare the next batch";
  return "Review output";
}

function summarizeValidationOutput(result) {
  const stdout = result.stdout ?? "";
  return {
    status: result.status,
    verdict: captureLine(stdout, /^VERDICT:\s*(.+)$/m),
    checksPassed: numberFromLine(stdout, /^checks passed:\s*(\d+)$/m),
    checksFailed: numberFromLine(stdout, /^checks failed:\s*(\d+)$/m),
    stdout,
    stderr: result.stderr ?? "",
  };
}

function summarizeDryRunResult(result) {
  if (!result) return null;
  return {
    dry_run: result.dry_run,
    requested_count: result.requested_count,
    valid_count: result.valid_count,
    rejected_count: result.rejected_count,
    would_insert_count: result.would_insert_count,
    would_skip_duplicate_count: result.would_skip_duplicate_count,
    would_supersede_count: result.would_supersede_count,
    statuses: Array.isArray(result.results)
      ? result.results.map((row) => ({
          fragrance_id: row.fragrance_id,
          status: row.status,
          source_url_normalized: row.source_url_normalized,
        }))
      : [],
  };
}

function validationPassed(validation) {
  return validation?.status === 0 && validation?.verdict === "PASS" && validation?.checksFailed === 0;
}

function runCommand(state, command, commandArgs, label, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    env: {
      ...process.env,
      SUPABASE_CLI_DISABLE_TELEMETRY: "1",
    },
    maxBuffer: options.maxBuffer ?? 1024 * 1024 * 10,
  });
  state.commands.push({
    label,
    command,
    args: commandArgs,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  });
  return result;
}

function runGitStatus() {
  const result = spawnSync("git", ["status", "--short", "--branch"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trimEnd();
}

function readProjectRef() {
  const path = "supabase/.temp/project-ref";
  return existsSync(path) ? readFileSync(path, "utf8").trim() : null;
}

function extractActorLabelFromDryRunSql(sql) {
  return sql.match(/record_fragrance_official_source_evidence_v1\([\s\S]*?\$vesper_payload\$::jsonb,\s*'([^']+)'/i)?.[1]
    ?.replace(/''/g, "'") ?? null;
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

function passThroughArg(commandArgs, key) {
  if (args[key] === undefined) return;
  commandArgs.push(`--${key}`, args[key]);
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function prefixForBatchLabel(label) {
  const match = String(label).match(/(\d+)$/);
  if (!match) return `proposed_autopilot_batch_${label}`;
  return `proposed_autopilot_batch_${match[1].padStart(3, "0")}`;
}

function pathsFor(filePrefix) {
  return {
    registryPayloads: `${filePrefix}_registry_payloads.json`,
    dryRunSql: `${filePrefix}_dry_run.sql`,
    dryRunOutput: `${filePrefix}_dry_run_output.json`,
    liveWriteSql: `${filePrefix}_live_write.sql`,
    reviewReport: `${filePrefix}_review_report.md`,
    providerEnrichment: `${filePrefix}_provider_enrichment.json`,
    needsReview: `${filePrefix}_needs_review.json`,
    blocked: `${filePrefix}_blocked.json`,
    finalStatus: `${filePrefix}_final_status.md`,
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function parseJsonFromPossiblyNoisyText(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty output" };
  const firstBrace = trimmed.indexOf("{");
  const firstBracket = trimmed.indexOf("[");
  const start =
    firstBrace === -1 ? firstBracket : firstBracket === -1 ? firstBrace : Math.min(firstBrace, firstBracket);
  if (start < 0) return { ok: false, reason: "no JSON object or array found" };
  try {
    return { ok: true, value: JSON.parse(trimmed.slice(start)) };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

function extractDryRunResult(output) {
  if (output?.dry_run_result) return output.dry_run_result;
  if (output?.dry_run === true) return output;
  if (Array.isArray(output?.rows)) {
    for (const row of output.rows) {
      const result = extractDryRunResult(row);
      if (result) return result;
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

function extractLiveWriteResult(output) {
  if (output?.live_write_result) return output.live_write_result;
  if (Array.isArray(output?.rows)) {
    for (const row of output.rows) {
      if (row?.live_write_result) return row.live_write_result;
    }
  }
  if (Array.isArray(output)) {
    for (const row of output) {
      const result = extractLiveWriteResult(row);
      if (result) return result;
    }
  }
  return null;
}

function helperPayloadsFromPacket(packet) {
  return arrayRows(packet)
    .map((row) => row.helper_payload)
    .filter(Boolean);
}

function arrayRows(packet) {
  return Array.isArray(packet?.rows) ? packet.rows : [];
}

function countBy(rows, getKey) {
  return rows.reduce((acc, row) => {
    const key = getKey(row);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
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

function captureLine(text, regex) {
  return String(text ?? "").match(regex)?.[1]?.trim() ?? null;
}

function numberFromLine(text, regex) {
  const value = captureLine(text, regex);
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sqlString(value) {
  return String(value).replace(/'/g, "''");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hashObject(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

void hashObject;
