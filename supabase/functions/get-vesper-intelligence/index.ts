import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;

const MAX_FRAGRANCE_IDS = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_ORIGINS = new Set([
  "http://localhost:8080",
  "http://localhost:5173",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:5173",
  "https://id-preview--20427402-64b7-4dc9-80aa-727b1e4a3e69.lovable.app",
  "https://20427402-64b7-4dc9-80aa-727b1e4a3e69.lovableproject.com",
  "https://scent-oracle-decide.lovable.app",
]);

function buildCorsHeaders(origin: string | null) {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function jsonResponse(body: JsonRecord, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTextArray(value: unknown, limit = 24): string[] {
  if (!Array.isArray(value)) return [];
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const label = normalizeText(item);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(label);
    if (normalized.length >= limit) break;
  }

  return normalized;
}

function normalizePyramid(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { top: [], heart: [], base: [] };
  }
  const record = value as JsonRecord;
  return {
    top: normalizeTextArray(record.top, 16),
    heart: normalizeTextArray(record.heart, 16),
    base: normalizeTextArray(record.base, 16),
  };
}

function normalizeWarnings(value: unknown): string[] {
  return normalizeTextArray(value, 12);
}

function normalizeConfidence(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric));
}

function normalizeYear(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  return rounded >= 1900 && rounded <= 2100 ? rounded : null;
}

function normalizeConfidenceSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      release_year: null,
      perfumer_names: null,
      concentration: null,
    };
  }
  const record = value as JsonRecord;
  return {
    release_year: normalizeConfidence(record.release_year),
    perfumer_names: normalizeConfidence(record.perfumer_names),
    concentration: normalizeConfidence(record.concentration),
  };
}

function sanitizeResolverRow(row: JsonRecord) {
  return {
    fragrance_id: normalizeText(row.fragrance_id),
    fragrance_name: normalizeText(row.fragrance_name),
    brand: normalizeText(row.brand),
    intelligence_status: normalizeText(row.intelligence_status),
    primary_notes: normalizeTextArray(row.primary_notes),
    primary_pyramid: normalizePyramid(row.primary_pyramid),
    primary_accords: normalizeTextArray(row.primary_accords),
    intelligence_source_tier: normalizeText(row.intelligence_source_tier),
    intelligence_source_type: normalizeText(row.intelligence_source_type),
    intelligence_source_name: normalizeText(row.intelligence_source_name),
    intelligence_confidence: normalizeConfidence(row.intelligence_confidence),
    intelligence_warnings: normalizeWarnings(row.intelligence_warnings),
    source_disclaimer: normalizeText(row.source_disclaimer),
    official_registry_eligible: row.official_registry_eligible === true,
    patch_safe_now: row.patch_safe_now === true,
    usable_for_vesper_intelligence: row.usable_for_vesper_intelligence === true,
    limited_intel_reason: normalizeText(row.limited_intel_reason),
    updated_at: normalizeText(row.updated_at),
  };
}

function sanitizeMetadataResolverRow(row: JsonRecord) {
  return {
    fragrance_id: normalizeText(row.fragrance_id),
    resolved_release_year: normalizeYear(row.resolved_release_year),
    resolved_perfumer_names: normalizeTextArray(row.resolved_perfumer_names, 8),
    resolved_concentration: normalizeText(row.resolved_concentration),
    release_year_source_type: normalizeText(row.release_year_source_type),
    release_year_source_tier: normalizeText(row.release_year_source_tier),
    release_year_source_name: normalizeText(row.release_year_source_name),
    perfumer_source_type: normalizeText(row.perfumer_source_type),
    perfumer_source_tier: normalizeText(row.perfumer_source_tier),
    perfumer_source_name: normalizeText(row.perfumer_source_name),
    concentration_source_type: normalizeText(row.concentration_source_type),
    concentration_source_tier: normalizeText(row.concentration_source_tier),
    concentration_source_name: normalizeText(row.concentration_source_name),
    metadata_confidence_summary: normalizeConfidenceSummary(row.metadata_confidence_summary),
    metadata_warnings: normalizeWarnings(row.metadata_warnings),
    metadata_disclaimer: normalizeText(row.metadata_disclaimer),
    has_official_metadata: row.has_official_metadata === true,
    has_community_metadata: row.has_community_metadata === true,
    has_conflict_hold: row.has_conflict_hold === true,
    patch_safe_now: row.patch_safe_now === true,
    catalog_patch_ready: row.catalog_patch_ready === true,
    updated_at: normalizeText(row.updated_at),
  };
}

function sanitizeCommunityEvidenceRow(row: JsonRecord) {
  return {
    intelligence_id: normalizeText(row.intelligence_id),
    fragrance_id: normalizeText(row.fragrance_id),
    fragrance_name: normalizeText(row.fragrance_name),
    brand: normalizeText(row.brand),
    source_type: normalizeText(row.source_type),
    source_tier: normalizeText(row.source_tier),
    source_name: normalizeText(row.source_name),
    evidence_type: normalizeText(row.evidence_type),
    evidence_status: normalizeText(row.evidence_status),
    review_status: normalizeText(row.review_status),
    extraction_method: normalizeText(row.extraction_method),
    extraction_confidence: normalizeConfidence(row.extraction_confidence),
    extraction_warnings: normalizeWarnings(row.extraction_warnings),
    normalized_notes: normalizeTextArray(row.normalized_notes),
    normalized_pyramid: normalizePyramid(row.normalized_pyramid),
    normalized_accords: normalizeTextArray(row.normalized_accords),
    usable_for_vesper_intelligence: row.usable_for_vesper_intelligence === true,
    official_registry_eligible: row.official_registry_eligible === true,
    patch_safe_now: row.patch_safe_now === true,
    source_disclaimer: normalizeText(row.source_disclaimer),
    created_at: normalizeText(row.created_at),
    updated_at: normalizeText(row.updated_at),
  };
}

function readRequestedIds(body: JsonRecord): string[] {
  const rawIds = Array.isArray(body.fragrance_ids)
    ? body.fragrance_ids
    : Array.isArray(body.fragranceIds)
      ? body.fragranceIds
      : normalizeText(body.fragrance_id)
        ? [body.fragrance_id]
        : normalizeText(body.fragranceId)
          ? [body.fragranceId]
          : [];

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const rawId of rawIds) {
    const id = normalizeText(rawId);
    if (!id || !UUID_PATTERN.test(id)) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(id);
    if (ids.length >= MAX_FRAGRANCE_IDS) break;
  }

  return ids;
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ error: "Endpoint not configured" }, 503, corsHeaders);
    }

    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization.toLowerCase().startsWith("bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData?.user?.id) {
      return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
    }

    const body = (await req.json().catch(() => ({}))) as JsonRecord;
    const fragranceIds = readRequestedIds(body);
    if (fragranceIds.length === 0) {
      return jsonResponse({ error: "At least one valid fragrance_id is required." }, 400, corsHeaders);
    }

    const requestedLimit = Number(body.limit ?? fragranceIds.length);
    const limit = Math.min(
      MAX_FRAGRANCE_IDS,
      Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : fragranceIds.length),
      fragranceIds.length,
    );

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [
      { data, error },
      { data: metadataData, error: metadataError },
      { data: communityEvidenceData, error: communityEvidenceError },
    ] = await Promise.all([
      adminClient.rpc("get_fragrance_vesper_intelligence_v1", {
        p_fragrance_ids: fragranceIds,
        p_limit: limit,
      }),
      adminClient.rpc("get_fragrance_identity_metadata_resolver_v1", {
        p_fragrance_ids: fragranceIds,
        p_limit: limit,
      }),
      adminClient.rpc("get_approved_fragrance_provider_intelligence_v1", {
        p_fragrance_ids: fragranceIds,
        p_limit: Math.min(MAX_FRAGRANCE_IDS, fragranceIds.length * 4),
      }),
    ]);

    if (error) {
      return jsonResponse({ error: "Could not load Vesper intelligence." }, 502, corsHeaders);
    }

    const rows = (Array.isArray(data) ? data : [])
      .map((row) => sanitizeResolverRow(row as JsonRecord))
      .filter((row) => row.fragrance_id && row.intelligence_status);
    const metadataRows = metadataError
      ? []
      : (Array.isArray(metadataData) ? metadataData : [])
          .map((row) => sanitizeMetadataResolverRow(row as JsonRecord))
          .filter((row) => row.fragrance_id);
    const communityEvidenceRows = communityEvidenceError
      ? []
      : (Array.isArray(communityEvidenceData) ? communityEvidenceData : [])
          .map((row) => sanitizeCommunityEvidenceRow(row as JsonRecord))
          .filter((row) => (
            row.fragrance_id
            && row.review_status === "approved_for_internal_use"
            && row.evidence_status === "usable_non_official_intelligence"
            && row.usable_for_vesper_intelligence
            && !row.official_registry_eligible
            && !row.patch_safe_now
          ));

    return jsonResponse({
      rows,
      metadata_rows: metadataRows,
      community_evidence_rows: communityEvidenceRows,
      count: rows.length,
      metadata_count: metadataRows.length,
      community_evidence_count: communityEvidenceRows.length,
    }, 200, corsHeaders);
  } catch {
    return jsonResponse({ error: "Unexpected Vesper intelligence error." }, 500, corsHeaders);
  }
});
