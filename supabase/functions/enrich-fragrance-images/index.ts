import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type FragRow = {
  id: string;
  name: string;
  brand: string;
};

type FragellaHit = Record<string, any>;

type ImageAssetRow = {
  fragrance_id: string;
  image_url: string | null;
  thumbnail_url: string | null;
  image_source: string;
  source_url: string | null;
  source_confidence: number | null;
  provider_payload: Record<string, any> | null;
  updated_at: string;
};

function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function readNestedString(obj: Record<string, any> | null | undefined, path: string[]): string | null {
  let current: any = obj;
  for (const part of path) {
    if (!current || typeof current !== "object" || !(part in current)) return null;
    current = current[part];
  }
  return typeof current === "string" && current.trim().length > 0 ? current.trim() : null;
}

function extractImageCandidates(hit: FragellaHit): { imageUrl: string | null; thumbnailUrl: string | null } {
  const transparentImageUrl = firstNonEmptyString(
    hit["Image URL Transparent"],
    hit["image_url_transparent"],
    hit["imageUrlTransparent"],
    hit["transparent_image_url"],
    hit["transparentImageUrl"],
    hit["fragella_transparent_image_url"],
    hit["fragellaTransparentImageUrl"],
    readNestedString(hit, ["image", "transparent_url"]),
    readNestedString(hit, ["image", "transparentUrl"]),
    readNestedString(hit, ["photo", "transparent_url"]),
    readNestedString(hit, ["photo", "transparentUrl"]),
    readNestedString(hit, ["preview", "image_url_transparent"]),
    readNestedString(hit, ["preview", "transparentImageUrl"]),
  );

  const standardImageUrl = firstNonEmptyString(
    hit["Image URL"],
    hit["image_url"],
    hit["imageUrl"],
    hit["bottle_image_url"],
    hit["bottleImageUrl"],
    hit["fragrance_image_url"],
    hit["fragranceImageUrl"],
    hit["photo_url"],
    hit["photoUrl"],
    hit["image"],
    hit["photo"],
    hit["thumbnail"],
    readNestedString(hit, ["image", "url"]),
    readNestedString(hit, ["image", "src"]),
    readNestedString(hit, ["photo", "url"]),
    readNestedString(hit, ["photo", "src"]),
    readNestedString(hit, ["preview", "image_url"]),
    readNestedString(hit, ["preview", "photo_url"]),
    readNestedString(hit, ["media", "image_url"]),
    readNestedString(hit, ["media", "photo_url"]),
  );
  const imageUrl = transparentImageUrl ?? standardImageUrl;

  const thumbnailUrl = firstNonEmptyString(
    hit["thumbnail_url"],
    hit["thumbnailUrl"],
    readNestedString(hit, ["thumbnail", "url"]),
    readNestedString(hit, ["thumbnail", "src"]),
    readNestedString(hit, ["preview", "thumbnail_url"]),
    standardImageUrl,
    imageUrl,
  );

  return { imageUrl, thumbnailUrl };
}

function pickBestHit(
  hits: FragellaHit[],
  brand: string,
  name: string,
): { hit: FragellaHit; score: number } | null {
  if (!hits.length) return null;

  const normalizedBrand = norm(brand);
  const normalizedName = norm(name);
  let best: { hit: FragellaHit; score: number } | null = null;

  for (const hit of hits) {
    const hitBrand = norm(hit.brand ?? hit.Brand ?? hit["Brand"] ?? "");
    const hitName = norm(hit.name ?? hit.Name ?? hit["Name"] ?? hit.title ?? "");
    const { imageUrl } = extractImageCandidates(hit);

    let score = 0;
    if (hitBrand && hitBrand === normalizedBrand) score += 6;
    if (hitName && hitName === normalizedName) score += 8;

    if (hitBrand && normalizedBrand && (hitBrand.includes(normalizedBrand) || normalizedBrand.includes(hitBrand))) {
      score += 2;
    }
    if (hitName && normalizedName && (hitName.includes(normalizedName) || normalizedName.includes(hitName))) {
      score += 3;
    }

    if (imageUrl) score += 4;

    if (!best || score > best.score) {
      best = { hit, score };
    }
  }

  return best;
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
    const fragranceIds = Array.isArray(body?.fragranceIds)
      ? body.fragranceIds.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const limit = Math.min(10, Math.max(1, Number(body?.limit ?? 1)));
    const dryRun = Boolean(body?.dryRun ?? false);
    const force = Boolean(body?.force ?? false);

    let targets: FragRow[] = [];

    if (fragranceIds.length > 0) {
      const { data, error } = await supabase
        .from("fragrances")
        .select("id, name, brand")
        .in("id", fragranceIds);
      if (error) throw error;
      targets = (data ?? []) as FragRow[];
    } else {
      const { data, error } = await supabase
        .from("fragrances")
        .select("id, name, brand")
        .limit(limit);
      if (error) throw error;
      targets = (data ?? []) as FragRow[];
    }

    if (targets.length === 0) {
      return new Response(JSON.stringify({ ok: true, picked: 0, results: [] }, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: existingRows, error: existingError } = await supabase
      .from("fragrance_image_assets")
      .select("fragrance_id, image_url, thumbnail_url, image_source, source_url, source_confidence, provider_payload, updated_at")
      .in("fragrance_id", targets.map((row) => row.id));

    if (existingError && !/relation .* does not exist/i.test(existingError.message ?? "")) {
      throw existingError;
    }

    const existingById = new Map<string, ImageAssetRow>(
      ((existingRows ?? []) as ImageAssetRow[]).map((row) => [row.fragrance_id, row]),
    );

    const results: any[] = [];
    let updated = 0;

    for (const target of targets) {
      const existing = existingById.get(target.id) ?? null;
      if (existing?.image_url && !force) {
        results.push({
          fragrance_id: target.id,
          name: target.name,
          brand: target.brand,
          ok: true,
          skipped: true,
          reason: "Existing image asset preserved",
          image_url: existing.image_url,
        });
        continue;
      }

      const search = `${target.brand} ${target.name}`.trim();
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
        results.push({
          fragrance_id: target.id,
          name: target.name,
          brand: target.brand,
          ok: false,
          status: response.status,
          error: errorText.slice(0, 300),
        });
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
        results.push({
          fragrance_id: target.id,
          name: target.name,
          brand: target.brand,
          ok: false,
          error: "No Fragella matches found",
        });
        continue;
      }

      const { hit, score } = bestMatch;
      const { imageUrl, thumbnailUrl } = extractImageCandidates(hit);
      if (!imageUrl) {
        results.push({
          fragrance_id: target.id,
          name: target.name,
          brand: target.brand,
          ok: false,
          error: "Best Fragella match had no image URL",
          match_brand: hit.brand ?? hit.Brand ?? null,
          match_name: hit.name ?? hit.Name ?? hit.title ?? null,
        });
        continue;
      }

      const sourceUrl = firstNonEmptyString(hit["URL"], hit["url"], hit["Link"], hit["link"]);
      const confidence = Number((Math.min(score / 20, 1)).toFixed(3));
      const patch = {
        fragrance_id: target.id,
        image_url: imageUrl,
        thumbnail_url: thumbnailUrl,
        image_source: "fragella",
        source_url: sourceUrl,
        source_confidence: confidence,
        provider_payload: hit,
        updated_at: new Date().toISOString(),
      };

      if (!dryRun) {
        const { error: upsertError } = await supabase
          .from("fragrance_image_assets")
          .upsert(patch, { onConflict: "fragrance_id" });
        if (upsertError) {
          results.push({
            fragrance_id: target.id,
            name: target.name,
            brand: target.brand,
            ok: false,
            error: upsertError.message,
          });
          continue;
        }
        updated += 1;
      }

      results.push({
        fragrance_id: target.id,
        name: target.name,
        brand: target.brand,
        ok: true,
        image_url: imageUrl,
        thumbnail_url: thumbnailUrl,
        match_brand: hit.brand ?? hit.Brand ?? null,
        match_name: hit.name ?? hit.Name ?? hit.title ?? null,
        source_url: sourceUrl,
        confidence,
        dryRun,
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      picked: targets.length,
      updated,
      dryRun,
      force,
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
