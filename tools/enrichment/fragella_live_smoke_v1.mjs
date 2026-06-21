#!/usr/bin/env node

import {
  getFragellaProviderConfig,
  loadFragellaLocalEnv,
  normalizeFragellaProviderPayload,
  queryFragellaProvider,
} from "./fragella_provider_client_v1.mjs";

const target = {
  name: "Sienna Brume",
  brand: "Mihan Aromatics",
};

loadFragellaLocalEnv();

const config = getFragellaProviderConfig();
const envSummary = {
  FRAGELLA_API_KEY_visible: Boolean(process.env.FRAGELLA_API_KEY),
  FRAGRELLA_API_KEY_visible: Boolean(process.env.FRAGRELLA_API_KEY),
  selected_env_var: config.apiKeyEnvName ?? "none",
  provider_mode: config.configured ? "enabled" : "disabled",
};

const baseSummary = {
  provider: "Fragella",
  target,
  env: envSummary,
  safety: {
    catalog_mutations: "none",
    official_registry_writes: "none",
    metadata_writes: "none",
    provider_table_writes: "none",
    queue_writes: "none",
    raw_secret_printed: false,
    raw_provider_payload_printed: false,
    fake_data_generated: false,
  },
};

if (!config.configured) {
  writeSummary({
    verdict: "BLOCKED",
    ...baseSummary,
    smoke: {
      ran: false,
      query_attempted: false,
      query_status: "not_configured",
      http_status: null,
      identity_returned: false,
      brand_returned: false,
      image_returned: false,
      notes_returned: false,
      pyramid_returned: false,
      accords_returned: false,
      concentration_returned: false,
      community_performance_returned: false,
      vote_counts_returned: false,
    },
    pipeline: pipelineSummary(),
  });
  process.exitCode = 2;
} else {
  const result = await queryFragellaProvider(target, config, {
    maxQueries: 1,
    limit: 5,
    timeoutMs: 10000,
  });
  const normalized = result.ok ? normalizeFragellaProviderPayload(target, result.hit) : null;
  const performance = normalized?.community_performance ?? null;

  writeSummary({
    verdict: result.ok ? "COMPLETE" : "PARTIAL",
    ...baseSummary,
    smoke: {
      ran: true,
      query_attempted: true,
      query_status: result.status,
      http_status: result.http_status ?? null,
      identity_returned: Boolean(normalized?.match_name),
      brand_returned: Boolean(normalized?.match_brand),
      image_returned: Boolean(normalized?.image_url),
      notes_returned: Boolean(normalized && (
        normalized.notes.length
        || normalized.top_notes.length
        || normalized.heart_notes.length
        || normalized.base_notes.length
      )),
      pyramid_returned: Boolean(normalized && (
        normalized.top_notes.length
        || normalized.heart_notes.length
        || normalized.base_notes.length
      )),
      accords_returned: Boolean(normalized?.accords.length),
      concentration_returned: Boolean(normalized?.concentration),
      community_performance_returned: Boolean(performance),
      vote_counts_returned: Boolean(performance && (
        performance.longevity_votes_total
        || performance.projection_votes_total
        || performance.sillage_votes_total
      )),
    },
    pipeline: pipelineSummary(),
  });
}

function pipelineSummary() {
  return {
    fragella_before_official_source: true,
    provider_data_non_official: true,
    official_registry_eligible: false,
    official_registry_untouched: true,
    catalog_mutations: "none",
  };
}

function writeSummary(summary) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
