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

const HIGH_CONFIDENCE_THRESHOLD = 0.78;
const REVIEW_CONFIDENCE_THRESHOLD = 0.58;
const FUNCTION_VERSION = "enrich-fragrances_v2";
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
  const notes = normalizeStringList(
    hit["notes"],
    hit["Notes"],
    hit["note_list"],
    hit["noteList"],
    hit["fragrance_notes"],
    hit["fragranceNotes"],
    readNestedValue(hit, ["notes"]),
    readNestedValue(hit, ["fragrance", "notes"]),
    readNestedValue(hit, ["details", "notes"]),
  );
  const accords = normalizeStringList(
    hit["accords"],
    hit["Accords"],
    hit["accord_list"],
    hit["accordList"],
    hit["main_accords"],
    hit["mainAccords"],
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
    hit["URL"],
    hit["url"],
    hit["Link"],
    hit["link"],
    readNestedValue(hit, ["links", "web"]),
  );

  return {
    notes,
    accords,
    concentration,
    proposedFamilyKey,
    sourceUrl,
  };
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
    const minConfidence = Number(body?.minConfidence ?? REVIEW_CONFIDENCE_THRESHOLD);
    const writeThreshold = Number(body?.writeThreshold ?? HIGH_CONFIDENCE_THRESHOLD);
    const scopeMode = fragranceIds.length > 0 ? "explicit_ids" : "default_queue";

    let targets: FragRow[] = [];
    let missingIds: string[] = [];

    if (fragranceIds.length > 0) {
      if (validFragranceIds.length === 0) {
        return new Response(JSON.stringify({
          ok: true,
          dryRun,
          force,
          requested_count: fragranceIds.length,
          picked: 0,
          results_count: 0,
          updated: 0,
          skipped_count: invalidIds.length,
          invalid_ids: invalidIds,
          missing_ids: [],
          function_version: FUNCTION_VERSION,
          scope_mode: scopeMode,
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
        requested_count: fragranceIds.length,
        picked: 0,
        results_count: 0,
        updated: 0,
        skipped_count: invalidIds.length + missingIds.length,
        invalid_ids: invalidIds,
        missing_ids: missingIds,
        function_version: FUNCTION_VERSION,
        scope_mode: scopeMode,
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

    const results: any[] = [];
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
          source_confidence: null,
          source_url: null,
          match_name: null,
          match_brand: null,
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
          source_confidence: null,
          source_url: null,
          match_name: null,
          match_brand: null,
          proposed_notes_count: 0,
          proposed_accords_count: 0,
          error: "No Fragella matches found",
        });
        continue;
      }

      const { hit, score } = bestMatch;
      const extracted = extractTextEnrichment(hit);
      const confidence = Number((Math.min(score / 28, 1)).toFixed(3));
      const proposedNotes = extracted.notes;
      const proposedAccords = extracted.accords;
      const mergedNotes = mergeUnique(existingNotes, proposedNotes);
      const mergedAccords = mergeUnique(existingAccords, proposedAccords);
      const familyCandidate = !existingFamilyKey ? extracted.proposedFamilyKey : null;
      const sourceUrl = extracted.sourceUrl;
      const matchName = firstNonEmptyString(hit.name, hit.Name, hit.title, hit.fragrance);
      const matchBrand = firstNonEmptyString(hit.brand, hit.Brand, hit.brand_name);
      const hasUsableText = hasMeaningfulArray(proposedNotes) || hasMeaningfulArray(proposedAccords) || !!extracted.concentration || !!familyCandidate;
      const notesImproved = mergedNotes.length > existingNotes.length;
      const accordsImproved = mergedAccords.length > existingAccords.length;
      const familyImproved = !!familyCandidate;
      const shouldWriteToFragrance = confidence >= writeThreshold && (notesImproved || accordsImproved || familyImproved);

      let status: string = "needs_review";
      if (!hasUsableText) {
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

      const preview = {
        id: target.id,
        name: target.name,
        brand: target.brand,
        ok: true,
        dryRun,
        status,
        source_confidence: confidence,
        source_url: sourceUrl,
        match_name: matchName,
        match_brand: matchBrand,
        proposed_notes_count: proposedNotes.length,
        proposed_accords_count: proposedAccords.length,
        will_write: status === "enriched" && !dryRun,
        patch: {
          notes: proposedNotes,
          accords: proposedAccords,
          merged_notes: mergedNotes,
          merged_accords: mergedAccords,
          concentration: extracted.concentration,
          proposed_family_key: familyCandidate,
        },
      };

      if (!dryRun) {
        const lastError = status === "no_match" ? "No usable enrichment fields found" : null;
        const enrichmentPatch = {
          fragrance_id: target.id,
          provider: "fragella",
          status,
          source_url: sourceUrl,
          source_confidence: confidence,
          match_name: matchName,
          match_brand: matchBrand,
          proposed_family_key: familyCandidate,
          concentration: extracted.concentration,
          notes: proposedNotes,
          accords: proposedAccords,
          provider_payload: hit,
          last_error: lastError,
          last_enriched_at: status === "enriched" || status === "already_enriched" || status === "skipped_existing_good_data"
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

        if (status === "enriched") {
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
      requested_count: fragranceIds.length,
      picked: targets.length,
      results_count: results.length,
      updated,
      skipped_count: invalidIds.length + missingIds.length,
      invalid_ids: invalidIds,
      missing_ids: missingIds,
      function_version: FUNCTION_VERSION,
      scope_mode: scopeMode,
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
