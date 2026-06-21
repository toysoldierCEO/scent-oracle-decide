#!/usr/bin/env node

import {
  buildFragellaCandidateProfileFlow,
  getFragellaProviderConfig,
  getVesperEnrichmentLaneOrder,
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
const laneOrder = getVesperEnrichmentLaneOrder();
const basePipeline = {
  real_pipeline_entrypoint_used: true,
  entrypoint: "tools/enrichment/fragella_vesperizer_pipeline_proof_v1.mjs",
  proof_wrapper_required: true,
  shared_provider_client_used: true,
  fragella_invoked: false,
  fragella_before_official_source: laneOrder[0] === "fragella_provider",
  provider_data_non_official: true,
  official_registry_eligible: false,
  catalog_mutations: false,
  official_registry_writes: false,
  metadata_writes: false,
  provider_table_writes: false,
  queue_writes: false,
};

if (!config.configured) {
  writeSummary({
    verdict: "BLOCKED",
    target,
    env: envSummary(),
    pipeline: {
      ...basePipeline,
      fragella_invoked: false,
    },
    fragella_fields: emptyFields(),
    candidate_profile_flow: emptyFlow(),
    safety: safetySummary(),
  });
  process.exitCode = 2;
} else {
  const result = await queryFragellaProvider(target, config, {
    maxQueries: 1,
    limit: 5,
    timeoutMs: 10000,
  });
  const normalized = result.ok ? normalizeFragellaProviderPayload(target, result.hit) : null;
  const flow = normalized ? buildFragellaCandidateProfileFlow(normalized) : null;
  const fields = flow?.profile_fields_present ?? emptyFields();

  writeSummary({
    verdict: result.ok ? "COMPLETE" : "PARTIAL",
    target,
    env: envSummary(),
    pipeline: {
      ...basePipeline,
      fragella_invoked: true,
      provider_http_status: result.http_status ?? null,
      provider_query_status: result.status,
    },
    fragella_fields: {
      identity: fields.identity,
      brand: fields.brand,
      image: fields.image,
      notes: fields.notes,
      top_notes: fields.top_notes,
      heart_notes: fields.heart_notes,
      base_notes: fields.base_notes,
      accords: fields.accords,
      concentration: fields.concentration,
      community_performance: fields.community_performance,
      vote_counts: fields.vote_counts,
    },
    candidate_profile_flow: flow?.candidate_profile_flow ?? emptyFlow(),
    safety: safetySummary(),
  });
}

function envSummary() {
  return {
    fragella_key_visible: Boolean(process.env.FRAGELLA_API_KEY),
    fragrella_compat_key_visible: Boolean(process.env.FRAGRELLA_API_KEY),
    selected_env_var: config.apiKeyEnvName ?? "none",
  };
}

function emptyFields() {
  return {
    identity: false,
    brand: false,
    image: false,
    notes: false,
    top_notes: false,
    heart_notes: false,
    base_notes: false,
    accords: false,
    concentration: false,
    community_performance: false,
    vote_counts: false,
  };
}

function emptyFlow() {
  return {
    identity_used: false,
    brand_used: false,
    image_used: false,
    notes_used: false,
    pyramid_used: false,
    accords_used: false,
    concentration_used: false,
    community_performance_used: false,
    wear_copy_if_missing: "Wear strength not verified",
  };
}

function safetySummary() {
  return {
    raw_secret_printed: false,
    raw_provider_payload_printed: false,
    fake_data_generated: false,
    env_file_committed: false,
  };
}

function writeSummary(summary) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
