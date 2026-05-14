import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type FragRow = {
  id: string;
  name: string;
  brand: string | null;
  family_key: string | null;
  notes: string[] | null;
  accords: string[] | null;
};

type MissingEnrichmentRow = {
  fragrance_id: string;
  name: string;
  brand: string | null;
  family_key: string | null;
  notes: string[] | null;
  accords: string[] | null;
  note_count: number | null;
  accord_count: number | null;
  gap_kind: string | null;
  enrichment_status: string | null;
  source_confidence: number | null;
};

type FragellaHit = Record<string, any>;

type TextEnrichmentRow = {
  fragrance_id: string;
  provider: string;
  status: string;
  source_url: string | null;
  source_confidence: number | null;
  match_name: string | null;
  match_brand: string | null;
  proposed_family_key: string | null;
  concentration: string | null;
  notes: string[];
  accords: string[];
  provider_payload: Record<string, any> | null;
  last_error: string | null;
  last_enriched_at: string | null;
  updated_at: string;
};

type ImageAssetPayloadRow = {
  fragrance_id: string;
  provider_payload: Record<string, any> | null;
};

type ExtractedEnrichment = {
  notes: string[];
  accords: string[];
  concentration: string | null;
  proposedFamilyKey: string | null;
  sourceUrl: string | null;
  topNotes: string[];
  middleNotes: string[];
  baseNotes: string[];
  providerConfidenceLabel: string | null;
  extractionPaths: {
    notes: string[];
    accords: string[];
    sourceUrl: string[];
  };
};

type ProductNameCompatibility = {
  compatible: boolean;
  overlapCount: number;
  odaraTokenCount: number;
  candidateTokenCount: number;
};

type IdentityDecision = {
  identityMatchStatus: "matched" | "conflict" | "insufficient_evidence";
  identityConflictReason: string | null;
  candidateName: string | null;
  candidateBrand: string | null;
  candidateSourceUrl: string | null;
  candidateScore: number;
  providerPayloadName: string | null;
  normalizedOdaraName: string;
  normalizedCandidateName: string;
  normalizedCandidateSourceSlug: string | null;
  providerProductKey: string | null;
};

const HIGH_CONFIDENCE_THRESHOLD = 0.78;
const REVIEW_CONFIDENCE_THRESHOLD = 0.58;
const FUNCTION_VERSION = "enrich-fragrances_v3";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function norm(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const PRODUCT_NAME_STOPWORDS = new Set([
  "unisex",
  "for",
  "men",
  "man",
  "male",
  "masculine",
  "women",
  "woman",
  "female",
  "feminine",
  "edp",
  "edt",
  "extrait",
  "parfum",
  "perfume",
  "cologne",
  "eau",
  "de",
  "the",
  "and",
  "s",
  "ml",
  "oz",
  "spray",
  "dp",
  "images",
  "image",
]);

function tokenizeNormalized(value: string): string[] {
  return value.split(/\s+/g).filter(Boolean);
}

function normalizeProductIdentity(value: unknown, brand: unknown = null): string {
  const brandTokens = new Set(tokenizeNormalized(norm(brand)));
  return tokenizeNormalized(norm(value))
    .filter((token) => !PRODUCT_NAME_STOPWORDS.has(token))
    .filter((token) => !/^\d+(ml|oz)$/.test(token))
    .filter((token) => !brandTokens.has(token))
    .join(" ");
}

function namesCompatible(odaraName: string, candidateName: string): ProductNameCompatibility {
  const odaraTokens = tokenizeNormalized(odaraName);
  const candidateTokens = tokenizeNormalized(candidateName);
  const candidateSet = new Set(candidateTokens);
  const overlapCount = odaraTokens.filter((token) => candidateSet.has(token)).length;
  const minTokenCount = Math.min(odaraTokens.length, candidateTokens.length);
  const exact = odaraName.length > 0 && odaraName === candidateName;
  const strongSubset = minTokenCount >= 2 && overlapCount === minTokenCount;

  return {
    compatible: exact || strongSubset,
    overlapCount,
    odaraTokenCount: odaraTokens.length,
    candidateTokenCount: candidateTokens.length,
  };
}

function brandsCompatible(odaraBrand: unknown, candidateBrand: unknown): boolean {
  const normalizedOdaraBrand = norm(odaraBrand);
  const normalizedCandidateBrand = norm(candidateBrand);
  if (!normalizedOdaraBrand || !normalizedCandidateBrand) return true;
  return normalizedOdaraBrand === normalizedCandidateBrand
    || normalizedOdaraBrand.includes(normalizedCandidateBrand)
    || normalizedCandidateBrand.includes(normalizedOdaraBrand);
}

function extractSourceIdentitySlug(sourceUrl: string | null, brand: unknown): string | null {
  if (!sourceUrl) return null;

  const decodeLoose = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  let pathText = sourceUrl;
  try {
    const parsed = new URL(sourceUrl);
    const segments = parsed.pathname.split("/").filter(Boolean).map(decodeLoose);
    const dpIndex = segments.findIndex((segment) => norm(segment) === "dp");
    const productSegment = dpIndex > 0
      ? segments[dpIndex - 1]
      : segments.slice().reverse().find((segment) => {
        const normalizedSegment = norm(segment);
        return normalizedSegment && !["images", "image", "api", "v1", "fragrances"].includes(normalizedSegment);
      });
    pathText = productSegment ?? parsed.pathname;
  } catch {
    pathText = sourceUrl;
  }

  const withoutExtension = pathText.replace(/\.[a-z0-9]+$/i, " ");
  const normalized = normalizeProductIdentity(withoutExtension, brand);
  return normalized.length > 0 ? normalized : null;
}

function collectCandidateSourceUrls(hit: FragellaHit, extracted: ExtractedEnrichment): string[] {
  return normalizeStringList(
    extracted.sourceUrl,
    hit["Purchase URL"],
    hit["purchase_url"],
    hit["purchaseUrl"],
    hit["URL"],
    hit["url"],
    hit["Link"],
    hit["link"],
    hit["Image URL"],
    hit["image_url"],
    hit["Image Fallbacks"],
    hit["image_fallbacks"],
  );
}

function getProviderProductKey(candidateBrand: string | null, normalizedCandidateName: string, sourceSlug: string | null): string | null {
  const productIdentity = normalizedCandidateName || sourceSlug;
  if (!productIdentity) return null;
  return `${norm(candidateBrand)}|${productIdentity}`;
}

function validateProviderIdentity(
  target: Pick<FragRow, "name" | "brand">,
  hit: FragellaHit,
  extracted: ExtractedEnrichment,
  candidateScore: number,
): IdentityDecision {
  const candidateName = firstNonEmptyString(hit.name, hit.Name, hit.title, hit.fragrance);
  const candidateBrand = firstNonEmptyString(hit.brand, hit.Brand, hit.brand_name);
  const providerPayloadName = firstNonEmptyString(hit.Name, hit.name, hit.title, hit.fragrance);
  const candidateSourceUrl = extracted.sourceUrl;
  const normalizedOdaraName = normalizeProductIdentity(target.name);
  const normalizedCandidateName = normalizeProductIdentity(candidateName ?? providerPayloadName, target.brand);
  const sourceSlugs = collectCandidateSourceUrls(hit, extracted)
    .map((url) => extractSourceIdentitySlug(url, target.brand))
    .filter((value): value is string => !!value);
  const normalizedCandidateSourceSlug = sourceSlugs[0] ?? null;
  const providerProductKey = getProviderProductKey(candidateBrand, normalizedCandidateName, normalizedCandidateSourceSlug);

  const conflict = (reason: string): IdentityDecision => ({
    identityMatchStatus: "conflict",
    identityConflictReason: reason,
    candidateName,
    candidateBrand,
    candidateSourceUrl,
    candidateScore,
    providerPayloadName,
    normalizedOdaraName,
    normalizedCandidateName,
    normalizedCandidateSourceSlug,
    providerProductKey,
  });

  if (!normalizedOdaraName) {
    return conflict("odara_name_missing");
  }

  if (!brandsCompatible(target.brand, candidateBrand)) {
    return conflict("candidate_brand_conflicts_with_odara_brand");
  }

  if (normalizedCandidateName) {
    const nameCompatibility = namesCompatible(normalizedOdaraName, normalizedCandidateName);
    if (!nameCompatibility.compatible) {
      return conflict("candidate_name_conflicts_with_odara_name");
    }
  }

  for (const sourceSlug of sourceSlugs) {
    const sourceCompatibility = namesCompatible(normalizedOdaraName, sourceSlug);
    if (!sourceCompatibility.compatible && sourceCompatibility.candidateTokenCount >= 2) {
      return conflict("source_url_slug_conflicts_with_odara_name");
    }
  }

  if (normalizedCandidateName || sourceSlugs.length > 0) {
    return {
      identityMatchStatus: "matched",
      identityConflictReason: null,
      candidateName,
      candidateBrand,
      candidateSourceUrl,
      candidateScore,
      providerPayloadName,
      normalizedOdaraName,
      normalizedCandidateName,
      normalizedCandidateSourceSlug,
      providerProductKey,
    };
  }

  return {
    identityMatchStatus: "insufficient_evidence",
    identityConflictReason: "candidate_identity_evidence_missing",
    candidateName,
    candidateBrand,
    candidateSourceUrl,
    candidateScore,
    providerPayloadName,
    normalizedOdaraName,
    normalizedCandidateName,
    normalizedCandidateSourceSlug,
    providerProductKey,
  };
}

function appendIdentityConflict(row: Record<string, any>, reason: string) {
  const existingReason = typeof row.identity_conflict_reason === "string" && row.identity_conflict_reason.length > 0
    ? row.identity_conflict_reason
    : null;
  row.identity_match_status = "conflict";
  row.identity_conflict_reason = existingReason && existingReason !== reason
    ? `${existingReason};${reason}`
    : reason;
  row.status = "identity_conflict";
  row.will_write = false;
  row.would_stage_review = false;
  row.stage_review_allowed = false;
  row.stage_review_reason = `identity_conflict:${row.identity_conflict_reason}`;
}

function registerProviderProductResult(
  buckets: Map<string, Record<string, any>[]>,
  row: Record<string, any>,
) {
  const providerProductKey = typeof row.provider_product_key === "string" ? row.provider_product_key : null;
  if (!providerProductKey) return;

  const bucket = buckets.get(providerProductKey) ?? [];
  bucket.push(row);
  buckets.set(providerProductKey, bucket);

  const distinctOdaraNames = new Set(
    bucket
      .map((entry) => String(entry.normalized_odara_name ?? ""))
      .filter(Boolean),
  );

  if (distinctOdaraNames.size <= 1) return;

  for (const entry of bucket) {
    appendIdentityConflict(entry, "duplicate_provider_product_reuse_in_request");
  }
}

function normalizeFamilyKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-");
  return normalized.length > 0 ? normalized : null;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function readNestedValue(obj: Record<string, any> | null | undefined, path: string[]): unknown {
  let current: any = obj;
  for (const part of path) {
    if (!current || typeof current !== "object" || !(part in current)) return null;
    current = current[part];
  }
  return current;
}

function splitLooseList(value: string): string[] {
  return value
    .split(/[,;|•·]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toTokenString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (value && typeof value === "object") {
    return firstNonEmptyString(
      (value as Record<string, any>).name,
      (value as Record<string, any>).label,
      (value as Record<string, any>).value,
      (value as Record<string, any>).note,
      (value as Record<string, any>).accord,
      (value as Record<string, any>).title,
    );
  }
  return null;
}

function normalizeStringList(...sources: unknown[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];

  const pushValue = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const entry of value) pushValue(entry);
      return;
    }

    if (typeof value === "string" && /[,;|•·]/.test(value)) {
      for (const entry of splitLooseList(value)) pushValue(entry);
      return;
    }

    const token = toTokenString(value);
    if (!token) return;

    const normalizedKey = norm(token);
    if (!normalizedKey || seen.has(normalizedKey)) return;
    seen.add(normalizedKey);
    next.push(token);
  };

  for (const source of sources) {
    pushValue(source);
  }

  return next;
}

function extractTextEnrichment(hit: FragellaHit) {
  const topNotes = normalizeStringList(
    hit["top_notes"],
    hit["topNotes"],
    hit["Top Notes"],
    readNestedValue(hit, ["Notes", "Top"]),
    readNestedValue(hit, ["notes", "top"]),
    readNestedValue(hit, ["details", "notes", "top"]),
  );
  const middleNotes = normalizeStringList(
    hit["middle_notes"],
    hit["middleNotes"],
    hit["heart_notes"],
    hit["heartNotes"],
    hit["Middle Notes"],
    hit["Heart Notes"],
    readNestedValue(hit, ["Notes", "Middle"]),
    readNestedValue(hit, ["Notes", "Heart"]),
    readNestedValue(hit, ["notes", "middle"]),
    readNestedValue(hit, ["notes", "heart"]),
    readNestedValue(hit, ["details", "notes", "middle"]),
    readNestedValue(hit, ["details", "notes", "heart"]),
  );
  const baseNotes = normalizeStringList(
    hit["base_notes"],
    hit["baseNotes"],
    hit["Base Notes"],
    readNestedValue(hit, ["Notes", "Base"]),
    readNestedValue(hit, ["notes", "base"]),
    readNestedValue(hit, ["details", "notes", "base"]),
  );
  const notes = normalizeStringList(
    hit["notes"],
    hit["Notes"],
    hit["note_list"],
    hit["noteList"],
    hit["fragrance_notes"],
    hit["fragranceNotes"],
    hit["General Notes"],
    hit["general_notes"],
    hit["generalNotes"],
    readNestedValue(hit, ["notes"]),
    readNestedValue(hit, ["fragrance", "notes"]),
    readNestedValue(hit, ["details", "notes"]),
    topNotes,
    middleNotes,
    baseNotes,
  );
  const accords = normalizeStringList(
    hit["accords"],
    hit["Accords"],
    hit["accord_list"],
    hit["accordList"],
    hit["main_accords"],
    hit["mainAccords"],
    hit["Main Accords"],
    hit["main accords"],
    Object.keys((hit["Main Accords Percentage"] && typeof hit["Main Accords Percentage"] === "object") ? hit["Main Accords Percentage"] : {}),
    readNestedValue(hit, ["accords"]),
    readNestedValue(hit, ["main_accords"]),
    readNestedValue(hit, ["details", "accords"]),
  );
  const concentration = firstNonEmptyString(
    hit["concentration"],
    hit["Concentration"],
    readNestedValue(hit, ["details", "concentration"]),
  );
  const proposedFamilyKey = normalizeFamilyKey(
    firstNonEmptyString(
      hit["family_key"],
      hit["familyKey"],
      hit["family"],
      hit["Family"],
      hit["style_family"],
      hit["styleFamily"],
    ),
  );
  const sourceUrl = firstNonEmptyString(
    hit["Purchase URL"],
    hit["purchase_url"],
    hit["purchaseUrl"],
    hit["URL"],
    hit["url"],
    hit["Link"],
    hit["link"],
    hit["Image URL"],
    hit["image_url"],
    readNestedValue(hit, ["links", "web"]),
  );
  const providerConfidenceLabel = firstNonEmptyString(
    hit["Confidence"],
    hit["confidence"],
    readNestedValue(hit, ["details", "confidence"]),
  );

  return {
    notes,
    accords,
    concentration,
    proposedFamilyKey,
    sourceUrl,
    topNotes,
    middleNotes,
    baseNotes,
    providerConfidenceLabel,
    extractionPaths: {
      notes: [
        "notes",
        "Notes",
        "note_list",
        "noteList",
        "fragrance_notes",
        "fragranceNotes",
        "General Notes",
        "general_notes",
        "generalNotes",
        "Notes.Top",
        "Notes.Middle",
        "Notes.Heart",
        "Notes.Base",
      ],
      accords: [
        "accords",
        "Accords",
        "accord_list",
        "accordList",
        "main_accords",
        "mainAccords",
        "Main Accords",
        "Main Accords Percentage",
      ],
      sourceUrl: [
        "Purchase URL",
        "URL",
        "Link",
        "Image URL",
        "links.web",
      ],
    },
  };
}

function extractionStrength(extracted: ExtractedEnrichment): number {
  return extracted.notes.length * 10
    + extracted.accords.length * 10
    + extracted.topNotes.length * 3
    + extracted.middleNotes.length * 3
    + extracted.baseNotes.length * 3
    + (extracted.sourceUrl ? 2 : 0)
    + (extracted.concentration ? 2 : 0);
}

function chooseBestExtraction(primary: ExtractedEnrichment, fallback: ExtractedEnrichment | null) {
  if (!fallback) return { extracted: primary, extractionSource: "search_hit" as const };
  if (extractionStrength(fallback) > extractionStrength(primary)) {
    return { extracted: fallback, extractionSource: "image_asset_payload" as const };
  }
  return { extracted: primary, extractionSource: "search_hit" as const };
}

function pickBestHit(
  hits: FragellaHit[],
  brand: string | null,
  name: string,
): { hit: FragellaHit; score: number } | null {
  if (!hits.length) return null;

  const normalizedBrand = norm(brand);
  const normalizedName = norm(name);
  let best: { hit: FragellaHit; score: number } | null = null;

  for (const hit of hits) {
    const hitBrand = norm(hit.brand ?? hit.Brand ?? hit["brand_name"] ?? "");
    const hitName = norm(hit.name ?? hit.Name ?? hit["title"] ?? hit["fragrance"] ?? "");
    const extracted = extractTextEnrichment(hit);

    let score = 0;
    if (hitBrand && hitBrand === normalizedBrand) score += 8;
    if (hitName && hitName === normalizedName) score += 10;

    if (hitBrand && normalizedBrand && (hitBrand.includes(normalizedBrand) || normalizedBrand.includes(hitBrand))) {
      score += 2;
    }
    if (hitName && normalizedName && (hitName.includes(normalizedName) || normalizedName.includes(hitName))) {
      score += 3;
    }

    if (extracted.notes.length > 0) score += 2;
    if (extracted.accords.length > 0) score += 2;
    if (extracted.concentration) score += 1;

    if (!best || score > best.score) {
      best = { hit, score };
    }
  }

  return best;
}

function mergeUnique(existing: string[], proposed: string[]): string[] {
  return normalizeStringList(existing, proposed);
}

function hasMeaningfulArray(values: string[]): boolean {
  return Array.isArray(values) && values.length > 0;
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function getStageReviewContext(stageReview: boolean, hasExplicitIds: boolean, dryRun: boolean) {
  const stageReviewAllowed = stageReview && hasExplicitIds;
  const stageReviewReason = !stageReview
    ? "stage_review_disabled"
    : !hasExplicitIds
      ? "explicit_ids_required"
      : dryRun
        ? "dry_run_preview_only"
        : "review_stage_write_only";

  return {
    stageReviewAllowed,
    stageReviewReason,
    wouldStageReview: stageReviewAllowed,
  };
}

serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const FRAGELLA_API_KEY = Deno.env.get("FRAGELLA_API_KEY") ?? "";

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY secrets.");
    }
    if (!FRAGELLA_API_KEY) {
      throw new Error("Missing FRAGELLA_API_KEY secret.");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const requestedFragranceIds = Array.isArray(body?.fragranceIds)
      ? body.fragranceIds.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const fragranceIds = [...new Set(requestedFragranceIds.map((value) => value.trim()))];
    const invalidIds = fragranceIds.filter((value) => !isUuid(value));
    const validFragranceIds = fragranceIds.filter((value) => isUuid(value));
    const limit = Math.min(10, Math.max(1, Number(body?.limit ?? 5)));
    const dryRun = Boolean(body?.dryRun ?? true);
    const force = Boolean(body?.force ?? false);
    const stageReview = Boolean(body?.stageReview ?? false);
    const minConfidence = Number(body?.minConfidence ?? REVIEW_CONFIDENCE_THRESHOLD);
    const writeThreshold = Number(body?.writeThreshold ?? HIGH_CONFIDENCE_THRESHOLD);
    const scopeMode = fragranceIds.length > 0 ? "explicit_ids" : "default_queue";
    const stageReviewContext = getStageReviewContext(stageReview, fragranceIds.length > 0, dryRun);

    if (stageReview && fragranceIds.length === 0) {
      return new Response(JSON.stringify({
        ok: false,
        dryRun,
        force,
        stageReview,
        requested_count: 0,
        picked: 0,
        results_count: 0,
        updated: 0,
        skipped_count: 0,
        invalid_ids: [],
        missing_ids: [],
        function_version: FUNCTION_VERSION,
        scope_mode: scopeMode,
        stage_review_allowed: stageReviewContext.stageReviewAllowed,
        stage_review_reason: stageReviewContext.stageReviewReason,
        error: "stageReview:true requires a non-empty fragranceIds array; default queue and batch review staging are disabled.",
        results: [],
      }, null, 2), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    let targets: FragRow[] = [];
    let missingIds: string[] = [];

    if (fragranceIds.length > 0) {
      if (validFragranceIds.length === 0) {
        return new Response(JSON.stringify({
          ok: true,
          dryRun,
          force,
          stageReview,
          requested_count: fragranceIds.length,
          picked: 0,
          results_count: 0,
          updated: 0,
          skipped_count: invalidIds.length,
          invalid_ids: invalidIds,
          missing_ids: [],
          function_version: FUNCTION_VERSION,
          scope_mode: scopeMode,
          stage_review_allowed: stageReviewContext.stageReviewAllowed,
          stage_review_reason: stageReviewContext.stageReviewReason,
          results: [],
        }, null, 2), {
          headers: { "Content-Type": "application/json" },
        });
      }

      const { data, error } = await supabase
        .from("fragrances")
        .select("id, name, brand, family_key, notes, accords")
        .in("id", validFragranceIds);
      if (error) throw error;
      const byId = new Map<string, FragRow>(((data ?? []) as FragRow[]).map((row) => [row.id, row]));
      missingIds = validFragranceIds.filter((value) => !byId.has(value));
      targets = validFragranceIds.flatMap((value) => {
        const row = byId.get(value);
        return row ? [row] : [];
      });
    } else {
      const { data, error } = await supabase
        .from("fragrances_missing_enrichment_v1")
        .select("fragrance_id, name, brand, family_key, notes, accords")
        .limit(limit);

      if (error) {
        const fallback = await supabase
          .from("fragrances")
          .select("id, name, brand, family_key, notes, accords")
          .or("notes.is.null,accords.is.null")
          .limit(limit);
        if (fallback.error) throw fallback.error;
        targets = (fallback.data ?? []) as FragRow[];
      } else {
        targets = ((data ?? []) as MissingEnrichmentRow[]).map((row) => ({
          id: row.fragrance_id,
          name: row.name,
          brand: row.brand,
          family_key: row.family_key,
          notes: row.notes,
          accords: row.accords,
        }));
      }
    }

    if (targets.length === 0) {
      return new Response(JSON.stringify({
        ok: true,
        dryRun,
        force,
        stageReview,
        requested_count: fragranceIds.length,
        picked: 0,
        results_count: 0,
        updated: 0,
        skipped_count: invalidIds.length + missingIds.length,
        invalid_ids: invalidIds,
        missing_ids: missingIds,
        function_version: FUNCTION_VERSION,
        scope_mode: scopeMode,
        stage_review_allowed: stageReviewContext.stageReviewAllowed,
        stage_review_reason: stageReviewContext.stageReviewReason,
        results: [],
      }, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: existingEnrichmentRows, error: enrichmentReadError } = await supabase
      .from("fragrance_text_enrichment")
      .select("fragrance_id, provider, status, source_url, source_confidence, match_name, match_brand, proposed_family_key, concentration, notes, accords, provider_payload, last_error, last_enriched_at, updated_at")
      .in("fragrance_id", targets.map((row) => row.id));

    if (enrichmentReadError && !/relation .* does not exist/i.test(enrichmentReadError.message ?? "")) {
      throw enrichmentReadError;
    }

    const existingById = new Map<string, TextEnrichmentRow>(
      ((existingEnrichmentRows ?? []) as TextEnrichmentRow[]).map((row) => [row.fragrance_id, row]),
    );

    const { data: imageAssetRows, error: imageAssetReadError } = await supabase
      .from("fragrance_image_assets")
      .select("fragrance_id, provider_payload")
      .in("fragrance_id", targets.map((row) => row.id));

    if (imageAssetReadError && !/relation .* does not exist/i.test(imageAssetReadError.message ?? "")) {
      throw imageAssetReadError;
    }

    const imagePayloadById = new Map<string, Record<string, any>>(
      ((imageAssetRows ?? []) as ImageAssetPayloadRow[])
        .filter((row) => !!row.provider_payload)
        .map((row) => [row.fragrance_id, row.provider_payload as Record<string, any>]),
    );

    const results: any[] = [];
    const providerProductResults = new Map<string, Record<string, any>[]>();
    let updated = 0;

    for (const target of targets) {
      const existing = existingById.get(target.id) ?? null;
      const existingNotes = normalizeStringList(target.notes ?? []);
      const existingAccords = normalizeStringList(target.accords ?? []);
      const existingFamilyKey = normalizeFamilyKey(target.family_key);

      const search = `${target.brand ?? ""} ${target.name}`.trim();
      const url = `https://api.fragella.com/api/v1/fragrances?search=${encodeURIComponent(search)}&limit=5`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "x-api-key": FRAGELLA_API_KEY,
          accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        const status = "error";
        const resultRow = {
          id: target.id,
          name: target.name,
          brand: target.brand,
          ok: false,
          status,
          dryRun,
          stageReview,
          would_stage_review: false,
          stage_review_allowed: false,
          stage_review_reason: "status_error_not_stageable",
          source_confidence: null,
          source_url: null,
          match_name: null,
          match_brand: null,
          candidate_name: null,
          candidate_brand: null,
          candidate_source_url: null,
          candidate_score: null,
          provider_payload_name: null,
          normalized_odara_name: normalizeProductIdentity(target.name),
          normalized_candidate_name: "",
          identity_match_status: "not_evaluated",
          identity_conflict_reason: "candidate_fetch_error",
          proposed_notes_count: 0,
          proposed_accords_count: 0,
          error: errorText.slice(0, 300),
        };
        if (!dryRun) {
          await supabase.from("fragrance_text_enrichment").upsert({
            fragrance_id: target.id,
            provider: "fragella",
            status,
            last_error: errorText.slice(0, 300),
            updated_at: new Date().toISOString(),
          }, { onConflict: "fragrance_id" });
        }
        results.push(resultRow);
        continue;
      }

      const payload = await response.json();
      const hits: FragellaHit[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.results)
          ? payload.results
          : Array.isArray(payload?.data)
            ? payload.data
            : [];

      const bestMatch = pickBestHit(hits, target.brand, target.name);
      if (!bestMatch) {
        const status = "no_match";
        if (!dryRun) {
          await supabase.from("fragrance_text_enrichment").upsert({
            fragrance_id: target.id,
            provider: "fragella",
            status,
            last_error: "No Fragella matches found",
            updated_at: new Date().toISOString(),
          }, { onConflict: "fragrance_id" });
        }
        results.push({
          id: target.id,
          name: target.name,
          brand: target.brand,
          ok: true,
          status,
          dryRun,
          stageReview,
          would_stage_review: false,
          stage_review_allowed: false,
          stage_review_reason: "status_no_match_not_stageable",
          source_confidence: null,
          source_url: null,
          match_name: null,
          match_brand: null,
          candidate_name: null,
          candidate_brand: null,
          candidate_source_url: null,
          candidate_score: null,
          provider_payload_name: null,
          normalized_odara_name: normalizeProductIdentity(target.name),
          normalized_candidate_name: "",
          identity_match_status: "not_evaluated",
          identity_conflict_reason: "no_provider_candidate",
          proposed_notes_count: 0,
          proposed_accords_count: 0,
          error: "No Fragella matches found",
        });
        continue;
      }

      const { hit, score } = bestMatch;
      const primaryExtracted = extractTextEnrichment(hit);
      const imagePayload = imagePayloadById.get(target.id) ?? null;
      const fallbackExtracted = imagePayload ? extractTextEnrichment(imagePayload) : null;
      const { extracted, extractionSource } = chooseBestExtraction(primaryExtracted, fallbackExtracted);
      let confidenceScore = score;
      if (extracted.notes.length > 0) confidenceScore += 2;
      if (extracted.accords.length > 0) confidenceScore += 2;
      if (extracted.concentration) confidenceScore += 1;
      const confidence = Number((Math.min(confidenceScore / 28, 1)).toFixed(3));
      const proposedNotes = extracted.notes;
      const proposedAccords = extracted.accords;
      const mergedNotes = mergeUnique(existingNotes, proposedNotes);
      const mergedAccords = mergeUnique(existingAccords, proposedAccords);
      const familyCandidate = !existingFamilyKey ? extracted.proposedFamilyKey : null;
      const sourceUrl = extracted.sourceUrl;
      const matchName = firstNonEmptyString(hit.name, hit.Name, hit.title, hit.fragrance);
      const matchBrand = firstNonEmptyString(hit.brand, hit.Brand, hit.brand_name);
      const identityDecision = validateProviderIdentity(target, hit, extracted, score);
      const identityStageable = identityDecision.identityMatchStatus === "matched";
      const hasUsableText = hasMeaningfulArray(proposedNotes) || hasMeaningfulArray(proposedAccords) || !!extracted.concentration || !!familyCandidate;
      const notesImproved = mergedNotes.length > existingNotes.length;
      const accordsImproved = mergedAccords.length > existingAccords.length;
      const familyImproved = !!familyCandidate;
      const shouldWriteToFragrance = identityStageable && confidence >= writeThreshold && (notesImproved || accordsImproved || familyImproved);

      let status: string = "needs_review";
      if (!identityStageable) {
        status = "identity_conflict";
      } else if (!hasUsableText) {
        status = "no_match";
      } else if (confidence < minConfidence) {
        status = "low_confidence";
      } else if (confidence < writeThreshold) {
        status = "needs_review";
      } else if (!shouldWriteToFragrance) {
        const providerAlreadyApplied = !!existing
          && existing.provider === "fragella"
          && normalizeStringList(existing.notes).join("|") === proposedNotes.join("|")
          && normalizeStringList(existing.accords).join("|") === proposedAccords.join("|")
          && (existing.source_url ?? null) === sourceUrl;
        status = providerAlreadyApplied ? "already_enriched" : "skipped_existing_good_data";
      } else {
        status = "enriched";
      }

      const rowStageReviewAllowed = stageReviewContext.stageReviewAllowed
        && identityStageable
        && !["no_match", "low_confidence", "identity_conflict"].includes(status);
      const rowStageReviewReason = !stageReviewContext.stageReviewAllowed
        ? stageReviewContext.stageReviewReason
        : !identityStageable
          ? `identity_conflict:${identityDecision.identityConflictReason ?? identityDecision.identityMatchStatus}`
          : ["no_match", "low_confidence"].includes(status)
            ? `status_${status}_not_stageable`
            : stageReviewContext.stageReviewReason;

      const preview = {
        id: target.id,
        name: target.name,
        brand: target.brand,
        ok: true,
        dryRun,
        stageReview,
        status,
        source_confidence: confidence,
        source_url: sourceUrl,
        match_name: matchName,
        match_brand: matchBrand,
        candidate_name: identityDecision.candidateName,
        candidate_brand: identityDecision.candidateBrand,
        candidate_source_url: identityDecision.candidateSourceUrl,
        candidate_score: identityDecision.candidateScore,
        provider_payload_name: identityDecision.providerPayloadName,
        normalized_odara_name: identityDecision.normalizedOdaraName,
        normalized_candidate_name: identityDecision.normalizedCandidateName,
        normalized_candidate_source_slug: identityDecision.normalizedCandidateSourceSlug,
        provider_product_key: identityDecision.providerProductKey,
        identity_match_status: identityDecision.identityMatchStatus,
        identity_conflict_reason: identityDecision.identityConflictReason,
        provider_confidence_label: extracted.providerConfidenceLabel,
        proposed_notes_count: proposedNotes.length,
        proposed_accords_count: proposedAccords.length,
        will_write: status === "enriched" && !dryRun && !stageReview && identityStageable,
        would_stage_review: rowStageReviewAllowed,
        stage_review_allowed: rowStageReviewAllowed,
        stage_review_reason: rowStageReviewReason,
        debug: {
          candidate_count: hits.length,
          best_candidate_score: score,
          extraction_status: hasUsableText ? "usable_text_found" : "no_usable_text",
          extraction_source: extractionSource,
          provider_payload_keys: Object.keys(hit).slice(0, 25),
          fallback_payload_keys: imagePayload ? Object.keys(imagePayload).slice(0, 25) : [],
          notes_extraction_paths_tried: extracted.extractionPaths.notes,
          accords_extraction_paths_tried: extracted.extractionPaths.accords,
          source_url_paths_tried: extracted.extractionPaths.sourceUrl,
          detail_fetch_attempted: false,
          detail_fetch_status: "not_implemented",
        },
        patch: {
          notes: proposedNotes,
          accords: proposedAccords,
          merged_notes: mergedNotes,
          merged_accords: mergedAccords,
          concentration: extracted.concentration,
          proposed_family_key: familyCandidate,
          top_notes: extracted.topNotes,
          middle_notes: extracted.middleNotes,
          base_notes: extracted.baseNotes,
        },
      };

      if (fragranceIds.length > 0) {
        registerProviderProductResult(providerProductResults, preview);
      }

      if (!dryRun) {
        const liveIdentityStageable = preview.identity_match_status === "matched";
        const persistenceStatus = preview.status === "identity_conflict" ? "low_confidence" : preview.status;
        const lastError = preview.status === "identity_conflict"
          ? `identity_conflict:${preview.identity_conflict_reason ?? "candidate_identity_conflict"}`
          : preview.status === "no_match"
            ? "No usable enrichment fields found"
            : null;
        const enrichmentPatch = {
          fragrance_id: target.id,
          provider: "fragella",
          status: persistenceStatus,
          source_url: sourceUrl,
          source_confidence: confidence,
          match_name: matchName,
          match_brand: matchBrand,
          proposed_family_key: familyCandidate,
          concentration: extracted.concentration,
          notes: liveIdentityStageable ? proposedNotes : [],
          accords: liveIdentityStageable ? proposedAccords : [],
          provider_payload: hit,
          last_error: lastError,
          last_enriched_at: persistenceStatus === "enriched" || persistenceStatus === "already_enriched" || persistenceStatus === "skipped_existing_good_data"
            ? new Date().toISOString()
            : null,
          updated_at: new Date().toISOString(),
        };

        const { error: enrichmentWriteError } = await supabase
          .from("fragrance_text_enrichment")
          .upsert(enrichmentPatch, { onConflict: "fragrance_id" });

        if (enrichmentWriteError) {
          results.push({
            ...preview,
            status: "error",
            error: enrichmentWriteError.message,
            will_write: false,
          });
          continue;
        }

        if (!stageReview && preview.status === "enriched" && liveIdentityStageable) {
          const fragrancePatch: Record<string, unknown> = {};
          if (notesImproved) fragrancePatch.notes = mergedNotes;
          if (accordsImproved) fragrancePatch.accords = mergedAccords;
          if (familyImproved && !existingFamilyKey) fragrancePatch.family_key = familyCandidate;

          if (Object.keys(fragrancePatch).length > 0) {
            const { error: fragranceWriteError } = await supabase
              .from("fragrances")
              .update(fragrancePatch)
              .eq("id", target.id);

            if (fragranceWriteError) {
              results.push({
                ...preview,
                status: "error",
                error: fragranceWriteError.message,
                will_write: false,
              });
              continue;
            }
          }

          updated += 1;
        }
      }

      results.push(preview);
    }

    return new Response(JSON.stringify({
      ok: true,
      dryRun,
      force,
      stageReview,
      requested_count: fragranceIds.length,
      picked: targets.length,
      results_count: results.length,
      updated,
      skipped_count: invalidIds.length + missingIds.length,
      invalid_ids: invalidIds,
      missing_ids: missingIds,
      function_version: FUNCTION_VERSION,
      scope_mode: scopeMode,
      stage_review_allowed: stageReviewContext.stageReviewAllowed,
      stage_review_reason: stageReviewContext.stageReviewReason,
      minConfidence,
      writeThreshold,
      results,
    }, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error: String((error as any)?.message ?? error),
    }, null, 2), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
