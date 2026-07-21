import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.2";

import { resolveSoloWearGuide } from "../../../src/lib/soloWearGuide.ts";
import { resolveLayeringEligibility } from "../../../src/lib/wearModeEligibility.ts";
import {
  analyzeSmsMessage,
  collectMorningSmsFeedbackExclusionIds,
  createTextbeltProvider,
  extractSchedulerSecret,
  formatVesperMorningSms,
  isValidE164Phone,
  maskE164Phone,
  MORNING_SMS_LAYER_MODES,
  qualifyMorningSmsLayerModes,
  sha256Hex,
  isRetryableMorningSmsPreProviderFailure,
  verifySchedulerSecret,
  type MorningSmsLayerOption,
  type MorningSmsModeKey,
  type TextbeltProviderResult,
} from "../_shared/vesperMorningSms.ts";

type JsonRecord = Record<string, unknown>;

type ClaimedDelivery = {
  claim_token: string;
  user_id: string;
  local_date: string;
  timezone_name: string;
  local_delivery_time: string;
  recommendation_context: string;
  phone_e164: string;
  dry_run: boolean;
};

type FragranceProfile = {
  family_key?: string | null;
  family_label?: string | null;
  accords?: unknown;
  notes?: unknown;
  top_notes?: unknown;
  heart_notes?: unknown;
  middle_notes?: unknown;
  base_notes?: unknown;
};

const DEFAULT_LIMIT = 25;

function jsonResponse(body: JsonRecord, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function normalizeLimit(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(100, Math.round(numeric)));
}

function getTodayPick(payload: unknown) {
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as JsonRecord
    : {};
  const pick = record.today_pick && typeof record.today_pick === "object" && !Array.isArray(record.today_pick)
    ? record.today_pick as JsonRecord
    : null;
  if (!pick) return null;
  const fragranceId = normalizeText(pick.fragrance_id);
  const name = normalizeText(pick.name);
  if (!fragranceId || !name) return null;
  return {
    fragranceId,
    name,
    brand: normalizeText(pick.brand) || null,
    family_key: normalizeText(pick.family) || normalizeText(pick.family_key) || null,
  };
}

function readCollectionItems(payload: unknown) {
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as JsonRecord
    : {};
  return Array.isArray(record.items) ? record.items as JsonRecord[] : [];
}

function normalizeLayerModeRow(row: unknown, mode: MorningSmsModeKey): MorningSmsLayerOption | null {
  const record = row && typeof row === "object" && !Array.isArray(row)
    ? row as JsonRecord
    : {};
  const companionName = normalizeText(record.layer_name ?? record.name);
  if (!companionName) return null;
  return {
    mode,
    companionName,
    companionBrand: normalizeText(record.layer_brand ?? record.brand) || null,
    sprayGuidance: normalizeText(record.spray_guidance) || null,
    placementHint: normalizeText(record.placement_hint ?? record.placement_guidance) || null,
    whyItWorks: normalizeText(record.why_it_works ?? record.reason) || null,
  };
}

async function finishDelivery(
  adminClient: ReturnType<typeof createClient>,
  claimToken: string,
  status: "sent" | "failed" | "uncertain" | "skipped",
  details: {
    provider?: string | null;
    providerMessageId?: string | null;
    bodySha256?: string | null;
    bodyCharCount?: number | null;
    bodySegmentCount?: number | null;
    safeErrorCategory?: string | null;
  },
) {
  const { error } = await adminClient.rpc("finish_vesper_morning_sms_delivery_v1", {
    p_claim_token: claimToken,
    p_status: status,
    p_provider: details.provider ?? null,
    p_provider_message_id: details.providerMessageId ?? null,
    p_body_sha256: details.bodySha256 ?? null,
    p_body_char_count: details.bodyCharCount ?? null,
    p_body_segment_count: details.bodySegmentCount ?? null,
    p_safe_error_category: details.safeErrorCategory ?? null,
  });
  if (error) {
    console.error("[vesper-morning-sms] finish failed", { status, category: "ledger_finish_failed" });
  }
}

async function collectFeedbackExclusions(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  anchorId: string,
) {
  const { data, error } = await adminClient
    .from("layer_recommendation_feedback_v1")
    .select("feedback_type,anchor_fragrance_id,companion_fragrance_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[vesper-morning-sms] feedback exclusions unavailable", { category: "feedback_read_failed" });
    return [];
  }

  return collectMorningSmsFeedbackExclusionIds(Array.isArray(data) ? data as JsonRecord[] : [], anchorId);
}

async function readTodayFragranceProfile(
  adminClient: ReturnType<typeof createClient>,
  fragranceId: string,
): Promise<FragranceProfile | null> {
  const { data, error } = await adminClient
    .from("fragrances")
    .select("family_key,family_label,accords,notes,top_notes,heart_notes,middle_notes,base_notes")
    .eq("id", fragranceId)
    .maybeSingle();

  if (error || !data || typeof data !== "object") {
    console.error("[vesper-morning-sms] fragrance profile unavailable", { category: "fragrance_profile_read_failed" });
    return null;
  }

  return data as FragranceProfile;
}

async function buildMorningSmsForClaim(
  adminClient: ReturnType<typeof createClient>,
  claim: ClaimedDelivery,
  temperature: number | null,
) {
  const { data: contract, error: contractError } = await adminClient.rpc("get_signed_in_card_contract_v7", {
    p_user_id: claim.user_id,
    p_temperature: temperature,
    p_context: claim.recommendation_context,
    p_brand: null,
    p_wear_date: claim.local_date,
    p_queue_limit: 24,
  });

  if (contractError) {
    throw new Error("canonical_contract_failed");
  }

  const todayPick = getTodayPick(contract);
  if (!todayPick) {
    throw new Error("canonical_today_pick_missing");
  }

  const { data: collectionPayload, error: collectionError } = await adminClient.rpc("get_collection_wardrobe_v1", {
    p_user: claim.user_id,
    p_filter: "all",
    p_sort: "name",
  });
  if (collectionError) {
    throw new Error("collection_eligibility_failed");
  }

  const collectionItems = readCollectionItems(collectionPayload).map((item) => ({
    ...item,
    owned: item.collection_status ? undefined : true,
  }));
  const eligibility = resolveLayeringEligibility(collectionItems);
  const todayProfile = await readTodayFragranceProfile(adminClient, todayPick.fragranceId);

  const soloGuide = resolveSoloWearGuide({
    name: todayPick.name,
    brand: todayPick.brand,
    family: todayPick.family_key,
    family_key: todayProfile?.family_key ?? todayPick.family_key,
    family_label: todayProfile?.family_label ?? null,
    accords: todayProfile?.accords ?? null,
    notes: todayProfile?.notes ?? null,
    top_notes: todayProfile?.top_notes ?? null,
    heart_notes: todayProfile?.heart_notes ?? todayProfile?.middle_notes ?? null,
    middle_notes: todayProfile?.middle_notes ?? null,
    base_notes: todayProfile?.base_notes ?? null,
  });

  const modeOptions: MorningSmsLayerOption[] = [];
  if (eligibility.isLayeringUnlocked) {
    const excludeIds = await collectFeedbackExclusions(adminClient, claim.user_id, todayPick.fragranceId);
    for (const mode of MORNING_SMS_LAYER_MODES) {
      const { data, error } = await adminClient.rpc("get_layer_for_card_mode_v1", {
        p_user: claim.user_id,
        p_fragrance_id: todayPick.fragranceId,
        p_mode: mode,
        p_context: claim.recommendation_context,
        p_temperature: temperature,
        p_brand: null,
        p_wear_date: claim.local_date,
        p_exclude_fragrance_ids: excludeIds.length > 0 ? excludeIds : undefined,
      });
      if (error) {
        console.error("[vesper-morning-sms] mode unavailable", { mode, category: "mode_rpc_failed" });
        continue;
      }
      const row = Array.isArray(data) ? data[0] : data;
      const option = normalizeLayerModeRow(row, mode);
      if (option) modeOptions.push(option);
    }
  }

  const body = formatVesperMorningSms({
    todayPick,
    soloPlacement: soloGuide.placement,
    layeringUnlocked: eligibility.isLayeringUnlocked,
    modes: modeOptions,
  });

  return {
    body,
    todayPick,
    eligibility,
    qualifiedModeCount: qualifyMorningSmsLayerModes(modeOptions).length,
  };
}

async function handleDelivery(
  adminClient: ReturnType<typeof createClient>,
  provider: ReturnType<typeof createTextbeltProvider> | null,
  claim: ClaimedDelivery,
  options: { dryRun: boolean; temperature: number | null },
) {
  if (!isValidE164Phone(claim.phone_e164)) {
    if (!options.dryRun) {
      await finishDelivery(adminClient, claim.claim_token, "skipped", {
        safeErrorCategory: "invalid_phone",
      });
    }
    return { status: "skipped", safeErrorCategory: "invalid_phone", userId: claim.user_id };
  }

  let built: Awaited<ReturnType<typeof buildMorningSmsForClaim>>;
  try {
    built = await buildMorningSmsForClaim(adminClient, claim, options.temperature);
  } catch (error) {
    const safeErrorCategory = error instanceof Error ? error.message : "sms_build_failed";
    const deliveryStatus = isRetryableMorningSmsPreProviderFailure(safeErrorCategory) ? "failed" : "skipped";
    if (!options.dryRun) {
      await finishDelivery(
        adminClient,
        claim.claim_token,
        deliveryStatus,
        { safeErrorCategory },
      );
    }
    return { status: deliveryStatus, safeErrorCategory, userId: claim.user_id };
  }

  const metadata = analyzeSmsMessage(built.body);
  const bodySha256 = await sha256Hex(built.body);
  const safeBase = {
    userId: claim.user_id,
    localDate: claim.local_date,
    maskedPhone: maskE164Phone(claim.phone_e164),
    charCount: metadata.charCount,
    segmentCount: metadata.segmentCount,
    encoding: metadata.encoding,
    layeringUnlocked: built.eligibility.isLayeringUnlocked,
    eligibleCount: built.eligibility.eligibleCount,
    qualifiedModeCount: built.qualifiedModeCount,
  };

  if (options.dryRun) {
    return {
      ...safeBase,
      status: "dry_run",
      preview: built.body,
    };
  }

  if (!provider) {
    await finishDelivery(adminClient, claim.claim_token, "failed", {
      bodySha256,
      bodyCharCount: metadata.charCount,
      bodySegmentCount: metadata.segmentCount,
      safeErrorCategory: "missing_provider_secret",
    });
    return { ...safeBase, status: "failed", safeErrorCategory: "missing_provider_secret" };
  }

  const providerResult: TextbeltProviderResult = await provider.sendSms({
    phoneE164: claim.phone_e164,
    body: built.body,
  });

  await finishDelivery(adminClient, claim.claim_token, providerResult.status, {
    provider: "textbelt",
    providerMessageId: providerResult.providerId,
    bodySha256,
    bodyCharCount: metadata.charCount,
    bodySegmentCount: metadata.segmentCount,
    safeErrorCategory: providerResult.safeErrorCategory,
  });

  return {
    ...safeBase,
    status: providerResult.status,
    safeErrorCategory: providerResult.safeErrorCategory,
  };
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const schedulerSecret = Deno.env.get("VESPER_MORNING_SMS_SCHEDULER_SECRET");
  const auth = verifySchedulerSecret(
    extractSchedulerSecret(req.headers.get("x-vesper-scheduler-secret"), req.headers.get("authorization")),
    schedulerSecret,
  );
  if (!auth.ok) {
    return jsonResponse({ error: auth.category }, auth.status);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "endpoint_not_configured" }, 503);
  }

  const body = (await req.json().catch(() => ({}))) as JsonRecord;
  const dryRun = body.dryRun === true || body.dry_run === true;
  const textbeltKey = Deno.env.get("TEXTBELT_API_KEY") ?? "";
  if (!dryRun && !textbeltKey) {
    return jsonResponse({ error: "missing_provider_secret" }, 503);
  }

  const nowIso = normalizeText(body.now) || new Date().toISOString();
  const limit = normalizeLimit(body.limit);
  const userId = normalizeText(body.userId ?? body.user_id) || null;
  const temperature = normalizeOptionalNumber(body.temperatureF ?? body.temperature ?? body.temperature_f);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: claims, error: claimError } = await adminClient.rpc("claim_due_vesper_morning_sms_v1", {
    p_now: nowIso,
    p_limit: limit,
    p_dry_run: dryRun,
    p_user_id: userId,
  });

  if (claimError) {
    console.error("[vesper-morning-sms] claim failed", { category: "claim_failed" });
    return jsonResponse({ error: "claim_failed" }, 500);
  }

  const provider = dryRun ? null : createTextbeltProvider(textbeltKey);
  const claimedRows = (Array.isArray(claims) ? claims : []) as ClaimedDelivery[];
  const results = [];

  for (const claim of claimedRows) {
    results.push(await handleDelivery(adminClient, provider, claim, { dryRun, temperature }));
  }

  return jsonResponse({
    dryRun,
    claimedCount: claimedRows.length,
    results,
  }, 200);
});
