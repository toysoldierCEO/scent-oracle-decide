import { useState, useRef, useCallback, useEffect, useMemo, useDeferredValue } from "react";
import type { User } from "@supabase/supabase-js";
import { normalizeNotes } from "@/lib/normalizeNotes";
import { odaraSupabase } from "@/lib/odara-client";
import LayerCard from "@/components/LayerCard";
import HeartReactionButton, { type HeartState } from "@/components/card-system/HeartReactionButton";
import FloatingActionLabel from "@/components/card-system/FloatingActionLabel";
import { SprayDots, deriveSprayCountsFromLayerMode } from "@/components/card-system/SprayDots";
import { LAYER_MODE_ORDER, type LayerMood, type LayerModes, type InteractionType, type SprayPattern } from "@/components/ModeSelector";
import { normalizeOracleHomePayload } from "@/lib/normalizeOracleHomePayload";
import { odaraDebugLog } from "@/lib/odara-debug";
import { haptic } from "@/lib/haptics";
import {
  expandAndDeduplicateScentIntelDisplayTerms,
  normalizeScentIntelChipSlug,
  resolveCanonicalScentIntelSlug,
} from "@/lib/scentIntelChipTerms";
import {
  CARD_ACTION_BUTTON_BASE_CLASS,
  CARD_ACTION_BUTTON_BASE_STYLE,
  CARD_ACTION_BUTTON_INACTIVE_STYLE,
} from "@/components/card-system/tokens";


// NOTE: guest-content.ts is INTENTIONALLY no longer imported.
// Guest mode renders strictly from the backend payload returned by
// get_guest_oracle_home_v1 (today_pick, layer, alternates, layer_modes,
// layer_mode_order, ui_default_mode, hero_tokens, layer_tokens,
// accord_tokens). Do NOT reintroduce frontend curation here.

type GuestModeKey = 'balance' | 'bold' | 'smooth' | 'wild';
const GUEST_DEFAULT_MODE_ORDER: GuestModeKey[] = ['balance', 'bold', 'smooth', 'wild'];
const LAYER_MOOD_ALIASES: Record<string, LayerMood> = {
  balance: 'balance',
  balanced: 'balance',
  bold: 'bold',
  smooth: 'smooth',
  wild: 'wild',
};

const REASON_CHIP_LABELS = [
  'Signature',
  'Rain-Ready',
  'Cool-Day Warmth',
  'Warm-Day Fresh',
  'All-Day Drydown',
  'Quiet Projection',
  'Rotation Balance',
  'Smooth Drydown',
  'Soft Edge',
  'Dark Polish',
  'Deep Drydown',
] as const;

type ReasonChipLabel = typeof REASON_CHIP_LABELS[number];

const REASON_CHIP_EXPLANATIONS: Record<ReasonChipLabel, string> = {
  'Signature': 'This sits close to the center of what you consistently reach for.',
  'Rain-Ready': 'Damp air won’t flatten this one; it keeps its shape when the weather turns wet.',
  'Cool-Day Warmth': 'Cooler air lets the warmer parts of this scent show up without feeling heavy.',
  'Warm-Day Fresh': 'Heat can thicken denser scents, so this one wins by staying lighter and cleaner in warm air.',
  'All-Day Drydown': 'The drydown is the strength here; it stays good long after the opening fades.',
  'Quiet Projection': 'It stays present without filling the room, which is why it wins today.',
  'Rotation Balance': 'You’ve leaned one way lately, and this restores balance without feeling random.',
  'Smooth Drydown': 'The finish is soft and blended, which is the main reason it works today.',
  'Soft Edge': 'There’s definition here, but it’s rounded enough to stay easy to wear.',
  'Dark Polish': 'Richer darker notes win here, but they stay refined instead of rough.',
  'Deep Drydown': 'The later hours are the payoff here; the base gets fuller and more resonant as it wears.',
};

const REASON_CHIP_LABEL_SET = new Set<string>(REASON_CHIP_LABELS);

type GuestRenderSource =
  | 'guest_main_bundle'
  | 'guest_selected_alternate'
  | 'guest_skip_target'
  | 'guest_back_restore';

interface GuestResolverState {
  source: GuestRenderSource;
  selectedMood: GuestModeKey;
  activeLayerIdx: number;
}

interface ResolvedGuestCardVM {
  source: GuestRenderSource;
  selectedAlternateIndex: number | null;
  selectedMode: GuestModeKey;
  activeLayerIndex: number;
  hero: any | null;
  heroTokens: any[];
  layer: any | null;
  layerTokens: any[];
  layerModes: Record<GuestModeKey, any | null>;
  modeOrder: GuestModeKey[];
  modeLayerStack: any[];
  alternates: any[];
  renderedFromFullBundle: boolean;
  reasonChipLabel: ReasonChipLabel | null;
  reasonChipExplanation: string | null;
}

interface LocalModeHistoryEntry<Mood> {
  mood: Mood;
  layerIndex: number;
}

function normalizeLayerMoodKey(value: unknown): LayerMood | null {
  if (typeof value !== 'string') return null;
  const normalized = LAYER_MOOD_ALIASES[value.trim().toLowerCase()];
  return normalized ?? null;
}

function normalizeLayerMoodList(values: unknown[]): LayerMood[] {
  const seen = new Set<LayerMood>();
  const normalized: LayerMood[] = [];
  for (const value of values) {
    const mood = normalizeLayerMoodKey(value);
    if (!mood || seen.has(mood)) continue;
    seen.add(mood);
    normalized.push(mood);
  }
  return normalized;
}

function getNormalizedLayerModeBlock(
  layerModes: Record<string, any> | null | undefined,
  mood: unknown,
) {
  const normalizedMood = normalizeLayerMoodKey(mood);
  if (!normalizedMood || !layerModes || typeof layerModes !== 'object') return null;
  if (normalizedMood === 'balance') {
    return layerModes.balance ?? layerModes.balanced ?? null;
  }
  return layerModes[normalizedMood] ?? null;
}

function layerModeBlockToStack(block: any): any[] {
  if (Array.isArray(block?.layers)) return block.layers;
  return block ? [block] : [];
}

function readTrimmedLayerText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return '';
}

function normalizeOdaraAuthUserId(value: unknown) {
  const normalized = readTrimmedLayerText(value);
  return normalized || null;
}

function useOdaraActiveSessionUser({
  userId,
  isGuestMode,
  scope,
}: {
  userId: string | null;
  isGuestMode: boolean;
  scope: string;
}) {
  const [activeSessionUser, setActiveSessionUser] = useState<User | null>(null);
  const [sessionResolved, setSessionResolved] = useState<boolean>(isGuestMode);

  useEffect(() => {
    let active = true;

    const applySessionUser = (nextUser: User | null) => {
      if (!active) return;
      setActiveSessionUser(nextUser);
      setSessionResolved(true);
    };

    if (isGuestMode) {
      applySessionUser(null);
      return () => {
        active = false;
      };
    }

    setSessionResolved(false);

    const { data: { subscription } } = odaraSupabase.auth.onAuthStateChange((_event, session) => {
      applySessionUser(session?.user ?? null);
    });

    odaraSupabase.auth.getSession()
      .then(({ data }) => {
        applySessionUser(data?.session?.user ?? null);
      })
      .catch(() => {
        applySessionUser(null);
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [isGuestMode]);

  const activeSessionUserId = normalizeOdaraAuthUserId(activeSessionUser?.id);
  const propUserId = normalizeOdaraAuthUserId(userId);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (isGuestMode) return;
    if (!propUserId || !activeSessionUserId) return;
    if (propUserId === activeSessionUserId) return;
    console.warn('[Odara] private auth user mismatch suppressed', {
      scope,
      propUserPresent: true,
      sessionUserPresent: true,
      usingSessionUserId: true,
    });
  }, [activeSessionUserId, isGuestMode, propUserId, scope]);

  return {
    activeSessionUser,
    activeSessionUserId,
    sessionResolved,
  };
}

function normalizeSearchFamilyKey(value: unknown) {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-');
}

function getFamilyLabelText(familyKey: string) {
  const normalized = normalizeSearchFamilyKey(familyKey);
  if (!normalized) return '';
  return FAMILY_LABELS[normalized] ?? normalized.toUpperCase();
}

function readPositiveLayerCount(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.round(value);
    }
    if (typeof value === 'string') {
      const match = value.trim().match(/^(\d{1,2})$/);
      if (match) {
        const parsed = Number.parseInt(match[1], 10);
        if (parsed > 0) return parsed;
      }
    }
  }
  return null;
}

const SPRAY_PATTERN_NAME_TO_KEY: Record<string, string> = {
  'anchor halo': 'anchor_halo',
  'split trail': 'split_trail',
  'soft veil': 'soft_veil',
  'wrist accent': 'wrist_accent',
  'trail boost': 'trail_boost',
  'close wear': 'skin_lock',
  'skin lock': 'skin_lock',
  'bright lift': 'bright_lift',
  deepen: 'deepen',
  'not a layer': 'not_a_layer',
};

const SPRAY_PATTERN_KEY_TO_NAME: Record<string, string> = {
  anchor_halo: 'Anchor Halo',
  split_trail: 'Split Trail',
  soft_veil: 'Soft Veil',
  wrist_accent: 'Wrist Accent',
  trail_boost: 'Trail Boost',
  skin_lock: 'Close Wear',
  bright_lift: 'Bright Lift',
  deepen: 'Deepen',
  not_a_layer: 'Not a Layer',
};

function normalizeSprayPatternKey(value: unknown) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return SPRAY_PATTERN_KEY_TO_NAME[normalized] ? normalized : '';
}

function normalizeSprayPatternName(value: unknown) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const fromKey = SPRAY_PATTERN_KEY_TO_NAME[normalizeSprayPatternKey(trimmed)];
  if (fromKey) return fromKey;
  const fromNameKey = SPRAY_PATTERN_NAME_TO_KEY[trimmed.toLowerCase()];
  return fromNameKey ? SPRAY_PATTERN_KEY_TO_NAME[fromNameKey] : '';
}

function readSprayPatternBoolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
}

function normalizeLayerSprayPattern(value: any): SprayPattern | null {
  if (!value || typeof value !== 'object') return null;

  const rawPattern = value.spray_pattern ?? value.sprayPattern ?? null;
  const rawObject = rawPattern && typeof rawPattern === 'object' ? rawPattern : null;
  const rawKey = rawObject?.key ?? rawObject?.pattern_key ?? value.spray_pattern_key ?? value.sprayPatternKey;
  const rawName = rawObject?.name ?? rawObject?.display_name ?? value.spray_pattern_name ?? value.sprayPatternName ?? value.application_style;
  const keyFromName = typeof rawName === 'string' ? SPRAY_PATTERN_NAME_TO_KEY[rawName.trim().toLowerCase()] : '';
  const key = normalizeSprayPatternKey(rawKey) || keyFromName || '';
  const name = normalizeSprayPatternName(rawName) || (key ? SPRAY_PATTERN_KEY_TO_NAME[key] : '');
  if (!key || !name) return null;

  const isLayerAllowed = readSprayPatternBoolean(rawObject?.is_layer_allowed ?? rawObject?.isLayerAllowed ?? value.is_layer_allowed);
  const anchorSprays = readPositiveLayerCount(rawObject?.anchor_sprays, rawObject?.anchorSprays, value.anchor_sprays, value.anchorSprays);
  const layerSprays = readPositiveLayerCount(rawObject?.layer_sprays, rawObject?.layerSprays, value.layer_sprays, value.layerSprays);

  return {
    key,
    name,
    placement: readTrimmedLayerText(rawObject?.placement, rawObject?.placement_hint, value.placement_hint, value.placementHint),
    anchor_placement_text: readTrimmedLayerText(
      rawObject?.anchor_placement_text,
      rawObject?.anchorPlacementText,
      value.anchor_placement_text,
      value.anchorPlacementText,
    ),
    layer_placement_text: readTrimmedLayerText(
      rawObject?.layer_placement_text,
      rawObject?.layerPlacementText,
      value.layer_placement_text,
      value.layerPlacementText,
    ),
    halo: readTrimmedLayerText(rawObject?.halo, value.halo),
    trail: readTrimmedLayerText(rawObject?.trail, value.trail),
    why_it_works: readTrimmedLayerText(rawObject?.why_it_works, rawObject?.whyItWorks, value.why_it_works, value.whyItWorks, value.reason),
    anchor_sprays: anchorSprays,
    layer_sprays: layerSprays,
    spray_ratio: readTrimmedLayerText(rawObject?.spray_ratio, rawObject?.sprayRatio, value.ratio_hint, value.ratioHint),
    is_layer_allowed: isLayerAllowed,
  };
}

function normalizeLayerTeachingFields(value: any) {
  return {
    reason: readTrimmedLayerText(value?.reason, value?.explanation),
    why_it_works: readTrimmedLayerText(value?.why_it_works, value?.whyItWorks, value?.why),
    ratio_hint: readTrimmedLayerText(value?.ratio_hint, value?.ratioHint, value?.ratio),
    application_style: readTrimmedLayerText(
      value?.application_style,
      value?.applicationStyle,
      value?.instructions,
      value?.layer_instructions,
    ),
    placement_hint: readTrimmedLayerText(
      value?.placement_hint,
      value?.placementHint,
      value?.placement_guidance,
      value?.placement,
    ),
    spray_guidance: readTrimmedLayerText(
      value?.spray_guidance,
      value?.spray_logic,
      value?.sprayLogic,
    ),
  };
}

function layerTextSignalsDominanceFailure(...values: unknown[]) {
  return values.some((value) => {
    if (typeof value !== 'string') return false;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    return (
      normalized.includes('dominance swap')
      || normalized.includes('likely to dominate the blend')
      || normalized.includes('become the dominant scent')
      || normalized.includes('replace the anchor')
      || normalized.includes('take over the anchor')
      || normalized.includes('take over the blend')
      || normalized.includes('overpower the anchor')
      || normalized.includes('overpower the main scent')
      || normalized.includes('scent mutiny')
    );
  });
}

function isUnsafeDominanceSwapLayerPayload(value: any) {
  if (!value || typeof value !== 'object') return false;
  const teaching = normalizeLayerTeachingFields(value);
  const sprayPattern = normalizeLayerSprayPattern(value);
  if (sprayPattern?.key === 'not_a_layer' || sprayPattern?.is_layer_allowed === false) {
    return true;
  }
  return layerTextSignalsDominanceFailure(
    teaching.reason,
    teaching.why_it_works,
    teaching.ratio_hint,
    teaching.application_style,
    teaching.placement_hint,
    teaching.spray_guidance,
    value?.reason,
    value?.why_it_works,
    value?.whyItWorks,
    value?.why,
    value?.explanation,
    value?.support_role_estimate,
    value?.supportRoleEstimate,
    value?.dominant_name_estimate,
    value?.dominantNameEstimate,
    value?.masking_risk_band_estimate,
    value?.maskingRiskBandEstimate,
  );
}

function readTrimmedImageUrl(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (
      /^https?:\/\//i.test(trimmed)
      || trimmed.startsWith('/')
      || trimmed.startsWith('data:image/')
      || trimmed.startsWith('blob:')
    ) {
      return trimmed;
    }
  }
  return null;
}

function readTransparentBottleImageUrlFromObject(value: any): string | null {
  if (!value || typeof value !== 'object') return null;
  return readTrimmedImageUrl(
    value.image_url_transparent,
    value.imageUrlTransparent,
    value.transparent_image_url,
    value.transparentImageUrl,
    value.fragella_transparent_image_url,
    value.fragellaTransparentImageUrl,
    value['Image URL Transparent'],
    value['image URL Transparent'],
    value['Transparent Image URL'],
    value.preview?.image_url_transparent,
    value.preview?.imageUrlTransparent,
    value.preview?.transparent_image_url,
    value.preview?.transparentImageUrl,
    value.preview?.['Image URL Transparent'],
    value.provider_payload?.image_url_transparent,
    value.provider_payload?.imageUrlTransparent,
    value.provider_payload?.transparent_image_url,
    value.provider_payload?.transparentImageUrl,
    value.provider_payload?.fragella_transparent_image_url,
    value.provider_payload?.['Image URL Transparent'],
    value.provider_payload?.['image URL Transparent'],
    value.provider_payload?.['Transparent Image URL'],
    value.image?.transparent_url,
    value.image?.transparentUrl,
    value.photo?.transparent_url,
    value.photo?.transparentUrl,
  );
}

function readRegularBottleImageUrlFromObject(value: any): string | null {
  if (!value || typeof value !== 'object') return null;
  return readTrimmedImageUrl(
    value.image_url,
    value.imageUrl,
    value.bottle_image_url,
    value.bottleImageUrl,
    value.fragrance_image_url,
    value.fragranceImageUrl,
    value.photo_url,
    value.photoUrl,
    value.thumbnail_url,
    value.thumbnailUrl,
    value['Image URL'],
    value['image URL'],
    value.provider_payload?.image_url,
    value.provider_payload?.imageUrl,
    value.provider_payload?.['Image URL'],
    value.provider_payload?.['image URL'],
    value.image,
    value.photo,
    value.thumbnail,
    value.preview?.image_url,
    value.preview?.imageUrl,
    value.preview?.thumbnail_url,
    value.preview?.thumbnailUrl,
    value.preview?.photo_url,
    value.preview?.photoUrl,
    value.image?.url,
    value.image?.src,
    value.photo?.url,
    value.photo?.src,
    value.thumbnail?.url,
    value.thumbnail?.src,
  );
}

function readBottleImageUrlFromObject(value: any): string | null {
  return readTransparentBottleImageUrlFromObject(value) ?? readRegularBottleImageUrlFromObject(value);
}

function resolveBottleImageUrl(...sources: any[]): string | null {
  const visited = new Set<any>();
  const queue = [...sources];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    if (typeof current === 'string') {
      const resolved = readTrimmedImageUrl(current);
      if (resolved) return resolved;
      continue;
    }

    if (typeof current !== 'object') continue;

    const direct = readBottleImageUrlFromObject(current);
    if (direct) return direct;

    queue.push(
      current.preview,
      current.hero,
      current.layer,
      current.fragrance,
      current.main_bundle?.hero,
      current.main_bundle?.layer,
    );
  }

  return null;
}

function resolveReasonChip(
  rawLabel: unknown,
  rawExplanation: unknown,
): { label: ReasonChipLabel; explanation: string | null } | null {
  if (typeof rawLabel !== 'string') return null;
  const trimmedLabel = rawLabel.trim();
  if (!REASON_CHIP_LABEL_SET.has(trimmedLabel)) return null;
  const label = trimmedLabel as ReasonChipLabel;
  const explanation = typeof rawExplanation === 'string' && rawExplanation.trim().length > 0
    ? rawExplanation.trim()
    : REASON_CHIP_EXPLANATIONS[label];
  return { label, explanation };
}

function readReasonChipFromSources(
  ...sources: any[]
): { label: ReasonChipLabel; explanation: string | null } | null {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    const resolved = resolveReasonChip(source.reason_chip_label, source.reason_chip_explanation);
    if (resolved) return resolved;
  }
  return null;
}

function resolveGuestCardVM(
  payload: any,
  selectedAlternateIdx: number | null,
  state: GuestResolverState,
): ResolvedGuestCardVM | null {
  const main: any = payload?.main_bundle ?? null;
  if (!main?.hero) return null;

  const altBundles: any[] = Array.isArray(payload?.alternate_bundles) ? payload.alternate_bundles : [];
  const bundle: any = selectedAlternateIdx === null ? main : (altBundles[selectedAlternateIdx] ?? null);
  if (!bundle?.hero) return null;

  const modeOrderRaw: any[] = Array.isArray(bundle?.layer_mode_order) && bundle.layer_mode_order.length > 0
    ? bundle.layer_mode_order
    : Array.isArray(main?.layer_mode_order) && main.layer_mode_order.length > 0
      ? main.layer_mode_order
      : GUEST_DEFAULT_MODE_ORDER;
  const modeOrder = normalizeLayerMoodList(modeOrderRaw) as GuestModeKey[];
  const layerModesObj: Record<string, any> = bundle?.layer_modes && typeof bundle.layer_modes === 'object'
    ? bundle.layer_modes
    : {};
  const defaultMode = (normalizeLayerMoodKey(bundle?.ui_default_mode)
    ?? modeOrder.find((mode) => !!getNormalizedLayerModeBlock(layerModesObj, mode))
    ?? 'balance') as GuestModeKey;

  let selectedMode = (normalizeLayerMoodKey(state.selectedMood) ?? defaultMode) as GuestModeKey;
  if (!getNormalizedLayerModeBlock(layerModesObj, selectedMode)) {
    selectedMode = defaultMode;
  }
  if (!getNormalizedLayerModeBlock(layerModesObj, selectedMode)) {
    selectedMode = (modeOrder.find((mode) => !!getNormalizedLayerModeBlock(layerModesObj, mode)) ?? defaultMode) as GuestModeKey;
  }

  const selectedModeBlock = getNormalizedLayerModeBlock(layerModesObj, selectedMode);
  const modeLayerStack = layerModeBlockToStack(selectedModeBlock);
  let activeLayerIndex = state.activeLayerIdx;
  if (activeLayerIndex < 0 || activeLayerIndex >= modeLayerStack.length) {
    activeLayerIndex = 0;
  }

  const layerFromMode = modeLayerStack[activeLayerIndex] ?? null;
  const layer = layerFromMode ?? bundle?.layer ?? null;
  const heroTokens = Array.isArray(bundle?.hero_tokens)
    ? bundle.hero_tokens
    : Array.isArray(bundle?.hero?.tokens)
      ? bundle.hero.tokens
      : [];
  const layerTokens = resolveGuestLayerTokens(
    layer,
    bundle?.hero ?? null,
    Array.isArray(layerFromMode?.tokens) && layerFromMode.tokens.length > 0
      ? layerFromMode.tokens
      : Array.isArray(bundle?.layer_tokens)
        ? bundle.layer_tokens
        : Array.isArray(bundle?.layer?.tokens)
          ? bundle.layer.tokens
          : [],
  );
  const reasonChip = readReasonChipFromSources(bundle?.hero, bundle, main?.hero, main, payload);

  return {
    source: state.source,
    selectedAlternateIndex: selectedAlternateIdx,
    selectedMode,
    activeLayerIndex,
    hero: bundle.hero ?? null,
    heroTokens,
    layer,
    layerTokens,
    layerModes: {
      balance: getNormalizedLayerModeBlock(layerModesObj, 'balance'),
      bold: getNormalizedLayerModeBlock(layerModesObj, 'bold'),
      smooth: getNormalizedLayerModeBlock(layerModesObj, 'smooth'),
      wild: getNormalizedLayerModeBlock(layerModesObj, 'wild'),
    },
    modeOrder,
    modeLayerStack,
    alternates: altBundles,
    renderedFromFullBundle: true,
    reasonChipLabel: reasonChip?.label ?? null,
    reasonChipExplanation: reasonChip?.explanation ?? null,
  };
}

function guestLayerToModeEntry(layer: any): NonNullable<LayerModes[LayerMood]> | null {
  if (!layer) return null;
  const id = layer.fragrance_id ?? layer.layer_fragrance_id ?? layer.id ?? '';
  const name = layer.name ?? layer.layer_name ?? '';
  if (!id && !name) return null;
  if (isUnsafeDominanceSwapLayerPayload(layer)) return null;
  const teaching = normalizeLayerTeachingFields(layer);
  const sprayPattern = normalizeLayerSprayPattern(layer);
  return {
    id,
    name,
    brand: layer.brand ?? layer.layer_brand ?? null,
    family_key: layer.family ?? layer.family_key ?? layer.layer_family ?? '',
    image_url: resolveBottleImageUrl(layer),
    notes: Array.isArray(layer.notes) ? layer.notes : Array.isArray(layer.layer_notes) ? layer.layer_notes : null,
    accords: Array.isArray(layer.accords) ? layer.accords : Array.isArray(layer.layer_accords) ? layer.layer_accords : null,
    interactionType: (layer.interaction_type ?? layer.layer_mode ?? layer.mode ?? 'balance') as InteractionType,
    reason: teaching.reason,
    why_it_works: teaching.why_it_works,
    projection: typeof layer.projection === 'number' ? layer.projection : null,
    ratio_hint: teaching.ratio_hint || undefined,
    application_style: teaching.application_style || undefined,
    placement_hint: teaching.placement_hint || undefined,
    spray_guidance: teaching.spray_guidance || undefined,
    spray_pattern: sprayPattern,
    spray_pattern_key: layer.spray_pattern_key ?? layer.sprayPatternKey ?? sprayPattern?.key ?? null,
    spray_pattern_name: layer.spray_pattern_name ?? layer.sprayPatternName ?? sprayPattern?.name ?? null,
    halo: layer.halo ?? sprayPattern?.halo ?? null,
    trail: layer.trail ?? sprayPattern?.trail ?? null,
    anchor_sprays: readPositiveLayerCount(
      sprayPattern?.anchor_sprays,
      layer.anchor_sprays,
      layer.anchorSprays,
      layer.hero_sprays,
      layer.heroSprays,
      layer.main_sprays,
      layer.mainSprays,
      layer.base_sprays,
      layer.baseSprays,
      layer?.anchor?.sprays,
      layer?.hero?.sprays,
      layer?.main?.sprays,
      layer?.base?.sprays,
    ),
    layer_sprays: readPositiveLayerCount(
      sprayPattern?.layer_sprays,
      layer.layer_sprays,
      layer.layerSprays,
      layer.top_sprays,
      layer.topSprays,
      layer.support_sprays,
      layer.supportSprays,
      layer?.layer?.sprays,
      layer?.top?.sprays,
      layer?.support?.sprays,
    ),
    spray_map: layer.spray_map ?? layer.sprayMap ?? null,
    zone_spray_map: layer.zone_spray_map ?? layer.zoneSprayMap ?? null,
  };
}

function guestLayerModesToModeSelector(layerModes: Record<GuestModeKey, any | null>): LayerModes {
  const pickModeSeed = (mood: LayerMood) => {
    const block = getNormalizedLayerModeBlock(layerModes, mood);
    const stack = layerModeBlockToStack(block);
    return stack[0] ?? null;
  };
  return {
    balance: guestLayerToModeEntry(pickModeSeed('balance')),
    bold: guestLayerToModeEntry(pickModeSeed('bold')),
    smooth: guestLayerToModeEntry(pickModeSeed('smooth')),
    wild: guestLayerToModeEntry(pickModeSeed('wild')),
  };
}

function resolveGuestLayerTokens(
  layer: any,
  hero: any,
  rawTokens: any[] | null | undefined,
) {
  if (Array.isArray(rawTokens) && rawTokens.length > 0) {
    return rawTokens;
  }
  const normalizedLayer = guestLayerToModeEntry(layer);
  if (!normalizedLayer) return [];
  const sharedKeys = buildSharedTokenKeySet(
    hero?.notes,
    hero?.accords,
    normalizedLayer.notes ?? [],
    normalizedLayer.accords ?? [],
  );
  return buildSemanticSurfaceTokens(
    normalizedLayer.notes ?? [],
    normalizedLayer.accords ?? [],
    sharedKeys,
    4,
  );
}

interface GuestBottle {
  fragrance_id: string | null;
  name: string;
  brand: string;
  bind_status?: 'bound' | 'pending_catalog' | 'duplicate_review' | null;
  reason?: string | null;
  why_it_works?: string | null;
  family?: string | null;
  /** When tapped from alternates, carries the alternate's nested layer bundle so the
   *  layer card can render the alternate's real backend layer (not the main mode). */
  layer?: any | null;
}



/* ── Fragrance family → color mapping ── */
const FAMILY_COLORS: Record<string, string> = {
  "oud-amber": "#D4A373", "fresh-blue": "#4DA3FF", "tobacco-boozy": "#8B5E3C",
  "sweet-gourmand": "#C77DFF", "dark-leather": "#5A3A2E", "woody-clean": "#7FAF8E",
  "citrus-cologne": "#F4D35E", "floral-musk": "#C4A0B9", "citrus-aromatic": "#B8C94E",
  "fresh-citrus": "#F4D35E", "spicy-warm": "#D4713B", "fresh-aquatic": "#5BC0DE",
  "earthy-patchouli": "#8B7355", "aromatic-fougere": "#6B8E6B", "floral-rich": "#D4839E",
  "green-earthy": "#6B8E5A",
};

const FAMILY_TINTS: Record<string, { bg: string; glow: string; border: string }> = {
  "oud-amber":       { bg: "rgba(192,138,62,0.10)",  glow: "rgba(192,138,62,0.22)",  border: "rgba(192,138,62,0.18)" },
  "fresh-blue":      { bg: "rgba(91,155,213,0.08)",  glow: "rgba(91,155,213,0.18)",  border: "rgba(91,155,213,0.14)" },
  "tobacco-boozy":   { bg: "rgba(107,66,38,0.10)",   glow: "rgba(107,66,38,0.22)",   border: "rgba(107,66,38,0.16)" },
  "sweet-gourmand":  { bg: "rgba(212,160,86,0.08)",  glow: "rgba(212,160,86,0.18)",  border: "rgba(212,160,86,0.14)" },
  "dark-leather":    { bg: "rgba(139,58,58,0.08)",   glow: "rgba(139,58,58,0.18)",   border: "rgba(139,58,58,0.14)" },
  "woody-clean":     { bg: "rgba(107,155,122,0.08)", glow: "rgba(107,155,122,0.18)", border: "rgba(107,155,122,0.14)" },
  "citrus-cologne":  { bg: "rgba(232,212,77,0.07)",  glow: "rgba(232,212,77,0.15)",  border: "rgba(232,212,77,0.12)" },
  "floral-musk":     { bg: "rgba(196,160,185,0.07)", glow: "rgba(196,160,185,0.15)", border: "rgba(196,160,185,0.12)" },
  "citrus-aromatic": { bg: "rgba(184,201,78,0.07)",  glow: "rgba(184,201,78,0.15)",  border: "rgba(184,201,78,0.12)" },
  "fresh-citrus":    { bg: "rgba(232,212,77,0.07)",  glow: "rgba(232,212,77,0.15)",  border: "rgba(232,212,77,0.12)" },
  "spicy-warm":      { bg: "rgba(212,113,59,0.08)",  glow: "rgba(212,113,59,0.18)",  border: "rgba(212,113,59,0.14)" },
  "fresh-aquatic":   { bg: "rgba(91,192,222,0.08)",  glow: "rgba(91,192,222,0.18)",  border: "rgba(91,192,222,0.14)" },
  "earthy-patchouli":{ bg: "rgba(139,115,85,0.08)",  glow: "rgba(139,115,85,0.18)",  border: "rgba(139,115,85,0.14)" },
  "aromatic-fougere":{ bg: "rgba(107,142,107,0.08)", glow: "rgba(107,142,107,0.18)", border: "rgba(107,142,107,0.14)" },
  "floral-rich":     { bg: "rgba(212,131,158,0.07)", glow: "rgba(212,131,158,0.15)", border: "rgba(212,131,158,0.12)" },
  "green-earthy":    { bg: "rgba(107,142,90,0.07)",  glow: "rgba(107,142,90,0.15)",  border: "rgba(107,142,90,0.12)" },
};

const DEFAULT_TINT = { bg: "rgba(255,255,255,0.03)", glow: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.08)" };

const FAMILY_LABELS: Record<string, string> = {
  "oud-amber": "OUD-AMBER", "fresh-blue": "FRESH-BLUE", "woody-clean": "WOODY-CLEAN",
  "sweet-gourmand": "SWEET-GOURMAND", "dark-leather": "DARK-LEATHER", "tobacco-boozy": "TOBACCO-BOOZY",
  "floral-musk": "FLORAL-MUSK", "citrus-aromatic": "CITRUS-AROMATIC", "citrus-cologne": "CITRUS-COLOGNE",
  "fresh-citrus": "FRESH-CITRUS", "spicy-warm": "SPICY-WARM", "fresh-aquatic": "FRESH-AQUATIC",
  "earthy-patchouli": "EARTHY-PATCHOULI", "aromatic-fougere": "AROMATIC-FOUGÈRE",
  "floral-rich": "FLORAL-RICH", "green-earthy": "GREEN-EARTHY",
};

const CONTEXTS = ["daily", "work", "hangout", "date"] as const;
const VESPER_WORDMARK_LETTERS = ['V', 'E', 'S', 'P', 'E', 'R'] as const;
const FORECAST_RAIL_TRACK_TOP_PX = 38;

function formatOccasionLabel(value: string) {
  if (!value) return 'Daily';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const ODARA_MENU_ITEMS = [
  { label: 'My Collection', guestRestricted: true },
  { label: 'Saved', guestRestricted: true },
  { label: 'Scent History', guestRestricted: true },
  { label: 'Planner', guestRestricted: true },
  { label: 'Daisy Chain', guestRestricted: true },
  { label: 'How Odara Works', guestRestricted: false },
  { label: 'Feedback', guestRestricted: false },
  { label: 'Settings', guestRestricted: true },
  { label: 'Profile / Sign in', guestRestricted: false },
] as const;

function getDisplayName(name: string | null | undefined, brand?: string | null): string {
  if (!name) return 'Unknown';
  let display = name
    .replace(/\s+(for\s+(Men|Women|Him|Her|Unisex)|Eau\s+de\s+(Parfum|Toilette|Cologne)|EDP|EDT)\s*$/i, '')
    .trim();
  if (brand) {
    const brandRegex = new RegExp(`\\s+${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    display = display.replace(brandRegex, '').trim();
  }
  return display;
}

type WardrobeRoleKey =
  | 'fresh-clean'
  | 'citrus-bright'
  | 'woody-everyday'
  | 'sweet-comfort'
  | 'tobacco-boozy'
  | 'oud-amber'
  | 'dark-leather';

type WardrobeCoverageState = 'filled' | 'partial' | 'open';

interface WardrobeCollectionItem {
  fragrance_id: string;
  name: string;
  brand: string | null;
  family_key: string | null;
  notes: string[];
  accords: string[];
  projection: number | null;
  status: string;
  statusRank: number;
}

interface WardrobeRoleDefinition {
  key: WardrobeRoleKey;
  label: string;
  color: string;
  meaning: string;
  whyItMatters: string;
  openDirection: string;
  openUseCase: string;
  primaryFamilies: string[];
  partialFamilies: string[];
}

interface WardrobeRoleCoverage {
  role: WardrobeRoleDefinition;
  score: number;
  coverageState: WardrobeCoverageState;
  coveredBy: WardrobeCollectionItem | null;
}

interface WardrobeBalanceSummary {
  roles: WardrobeRoleCoverage[];
  collectionSize: number;
  filledCount: number;
  partialCount: number;
  centerTitle: string;
  centerSubtitle: string | null;
  introCopy: string;
  strongestCoverage: WardrobeRoleCoverage | null;
  openRoles: WardrobeRoleCoverage[];
  nextBestRole: WardrobeRoleCoverage | null;
}

const WARDROBE_STATUS_RANK: Record<string, number> = {
  signature: 0,
  owned: 1,
};

const WARDROBE_ROLE_PRIORITY: WardrobeRoleKey[] = [
  'citrus-bright',
  'fresh-clean',
  'woody-everyday',
  'sweet-comfort',
  'tobacco-boozy',
  'oud-amber',
  'dark-leather',
];

const WARDROBE_ROLES: WardrobeRoleDefinition[] = [
  {
    key: 'fresh-clean',
    label: 'Fresh / Clean',
    color: '#88A8B6',
    meaning: 'A clean easy lane that keeps the wardrobe light on skin and effortless to reach for.',
    whyItMatters: 'This role gives the wardrobe a reset point for clearer daytime wear and lighter settings.',
    openDirection: 'Your next best addition should be a clean fresh scent for reset days and easy everyday wear.',
    openUseCase: 'Useful for reset days, clean daytime wear, and lighter settings.',
    primaryFamilies: ['fresh-blue', 'fresh-aquatic'],
    partialFamilies: ['floral-musk', 'woody-clean'],
  },
  {
    key: 'citrus-bright',
    label: 'Citrus / Bright',
    color: '#C6B16D',
    meaning: 'A brighter lane built around lift, clarity, and a cleaner opening in warm air.',
    whyItMatters: 'This role helps the wardrobe stay alive in heat, daytime wear, and cleaner social settings.',
    openDirection: 'Your next best addition should be a bright daytime scent for warm weather and reset days.',
    openUseCase: 'Useful for warm weather, brighter openings, and daytime clarity.',
    primaryFamilies: ['citrus-cologne', 'citrus-aromatic', 'fresh-citrus'],
    partialFamilies: ['fresh-blue', 'aromatic-fougere'],
  },
  {
    key: 'woody-everyday',
    label: 'Woody / Everyday',
    color: '#8A9D87',
    meaning: 'A grounded middle lane with structure, versatility, and an easy everyday reach.',
    whyItMatters: 'This role gives the wardrobe a dependable center that can move across more contexts without strain.',
    openDirection: 'Your next best addition should be a versatile woody scent that can carry everyday wear with more structure.',
    openUseCase: 'Useful for daily wear, work settings, and a steadier center of gravity.',
    primaryFamilies: ['woody-clean', 'aromatic-fougere', 'green-earthy'],
    partialFamilies: ['earthy-patchouli', 'citrus-aromatic', 'floral-musk'],
  },
  {
    key: 'sweet-comfort',
    label: 'Sweet / Comfort',
    color: '#B894B0',
    meaning: 'A softer comfort lane that brings warmth, roundness, and an easier emotional pull.',
    whyItMatters: 'This role keeps the wardrobe from feeling all edge or all freshness by adding a calmer comfort register.',
    openDirection: 'Your next best addition should be a softer comfort scent with warmth and a smoother emotional pull.',
    openUseCase: 'Useful for comfort wear, evening ease, and softer colder-weather rotation.',
    primaryFamilies: ['sweet-gourmand'],
    partialFamilies: ['floral-rich', 'spicy-warm', 'tobacco-boozy'],
  },
  {
    key: 'tobacco-boozy',
    label: 'Tobacco / Boozy',
    color: '#A77A63',
    meaning: 'A richer textured lane with smoke, warmth, and a more social evening character.',
    whyItMatters: 'This role gives the wardrobe a more relaxed darker register when cleaner lanes feel too restrained.',
    openDirection: 'Your next best addition should be a richer tobacco-leaning scent for evening depth and a looser social feel.',
    openUseCase: 'Useful for evenings, cooler air, and a richer social register.',
    primaryFamilies: ['tobacco-boozy'],
    partialFamilies: ['spicy-warm', 'dark-leather', 'earthy-patchouli'],
  },
  {
    key: 'oud-amber',
    label: 'Oud / Amber',
    color: '#B28B65',
    meaning: 'A deep resinous lane with warmth, weight, and a more formal darker polish.',
    whyItMatters: 'This role gives the wardrobe its denser evening base when richer settings call for more gravity.',
    openDirection: 'Your next best addition should be an ambered evening scent that adds resinous depth without roughness.',
    openUseCase: 'Useful for colder evenings, dressier settings, and deeper drydowns.',
    primaryFamilies: ['oud-amber'],
    partialFamilies: ['sweet-gourmand', 'dark-leather', 'spicy-warm'],
  },
  {
    key: 'dark-leather',
    label: 'Dark / Leather',
    color: '#7A665B',
    meaning: 'A darker lane built on leathered texture, edge, and a more defined after-hours silhouette.',
    whyItMatters: 'This role gives the wardrobe a sharper darker contour when softer or fresher lanes are not enough.',
    openDirection: 'Your next best addition should be a darker leathered scent that adds sharper after-hours definition.',
    openUseCase: 'Useful for after-hours wear, darker texture, and a more defined silhouette.',
    primaryFamilies: ['dark-leather'],
    partialFamilies: ['oud-amber', 'tobacco-boozy', 'earthy-patchouli'],
  },
] as const;

function getWardrobeRolePriority(roleKey: WardrobeRoleKey): number {
  const idx = WARDROBE_ROLE_PRIORITY.indexOf(roleKey);
  return idx === -1 ? WARDROBE_ROLE_PRIORITY.length : idx;
}

function dedupeWardrobeItems(items: WardrobeCollectionItem[]): WardrobeCollectionItem[] {
  const byIdentity = new Map<string, WardrobeCollectionItem>();
  for (const item of items) {
    const identityKey = `${item.name.trim().toLowerCase()}|${(item.brand ?? '').trim().toLowerCase()}`;
    const existing = byIdentity.get(identityKey);
    if (!existing) {
      byIdentity.set(identityKey, item);
      continue;
    }
    const shouldReplace =
      item.statusRank < existing.statusRank ||
      (item.statusRank === existing.statusRank && (item.projection ?? 0) > (existing.projection ?? 0));
    if (shouldReplace) {
      byIdentity.set(identityKey, item);
    }
  }
  return Array.from(byIdentity.values());
}

function getWardrobeRoleScore(role: WardrobeRoleDefinition, item: WardrobeCollectionItem): number {
  const familyKey = item.family_key ?? '';
  if (!familyKey) return 0;
  let base = 0;
  if (role.primaryFamilies.includes(familyKey)) {
    base = 1;
  } else if (role.partialFamilies.includes(familyKey)) {
    base = 0.56;
  }
  if (base === 0) return 0;

  const signatureBoost = item.status === 'signature' ? 0.06 : 0;
  const projectionBoost = typeof item.projection === 'number'
    ? Math.max(0, Math.min(item.projection / 40, 0.08))
    : 0;
  return Math.min(1.08, base + signatureBoost + projectionBoost);
}

function pickNextWardrobeRole(roles: WardrobeRoleCoverage[], collectionSize: number): WardrobeRoleCoverage | null {
  const notFilled = roles.filter((role) => role.coverageState !== 'filled');
  const primaryOpen = notFilled.filter((role) => role.coverageState === 'open');
  const candidatePool = primaryOpen.length > 0 ? primaryOpen : notFilled.length > 0 ? notFilled : roles;
  if (candidatePool.length === 0) return null;

  const smallWardrobePriority = collectionSize <= 3
    ? ['citrus-bright', 'fresh-clean', 'woody-everyday', 'sweet-comfort', 'tobacco-boozy', 'oud-amber', 'dark-leather']
    : WARDROBE_ROLE_PRIORITY;

  return [...candidatePool].sort((a, b) => {
    const aPriority = smallWardrobePriority.indexOf(a.role.key);
    const bPriority = smallWardrobePriority.indexOf(b.role.key);
    if (aPriority !== bPriority) return aPriority - bPriority;
    if (a.coverageState !== b.coverageState) {
      const aWeight = a.coverageState === 'open' ? 0 : a.coverageState === 'partial' ? 1 : 2;
      const bWeight = b.coverageState === 'open' ? 0 : b.coverageState === 'partial' ? 1 : 2;
      return aWeight - bWeight;
    }
    return a.score - b.score;
  })[0] ?? null;
}

function buildWardrobeBalanceSummary(items: WardrobeCollectionItem[]): WardrobeBalanceSummary {
  const roles = WARDROBE_ROLES.map((role) => {
    const contributors = items
      .map((item) => ({ item, score: getWardrobeRoleScore(role, item) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.item.statusRank !== b.item.statusRank) return a.item.statusRank - b.item.statusRank;
        return (b.item.projection ?? 0) - (a.item.projection ?? 0);
      });

    const top = contributors[0] ?? null;
    const score = top?.score ?? 0;
    const coverageState: WardrobeCoverageState =
      score >= 0.94 ? 'filled' : score >= 0.45 ? 'partial' : 'open';

    return {
      role,
      score,
      coverageState,
      coveredBy: top?.item ?? null,
    } satisfies WardrobeRoleCoverage;
  });

  const filledCount = roles.filter((role) => role.coverageState === 'filled').length;
  const partialCount = roles.filter((role) => role.coverageState === 'partial').length;
  const collectionSize = items.length;
  const centerTitle = collectionSize <= 3
    ? 'Focused capsule'
    : `${filledCount} / ${WARDROBE_ROLES.length} roles covered`;
  const centerSubtitle = collectionSize <= 3
    ? `${filledCount} / ${WARDROBE_ROLES.length} roles covered`
    : partialCount > 0
      ? `${partialCount} role${partialCount === 1 ? '' : 's'} in overlap`
      : 'Balanced wardrobe';

  let introCopy = 'Your wardrobe has enough range to show where coverage is settled and where one open role can add balance.';
  if (collectionSize === 1) {
    introCopy = 'Your wardrobe has one clear anchor. Odara can still help you wear it with more intention.';
  } else if (collectionSize >= 2 && collectionSize <= 3) {
    introCopy = 'Your wardrobe is focused. Odara will map your strongest roles and identify the one addition that would expand it most.';
  } else if (collectionSize >= 10) {
    introCopy = 'Your wardrobe has enough range to analyze balance, overlap, and underused lanes.';
  }

  const strongestCoverage = [...roles]
    .filter((role) => role.coverageState !== 'open')
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return getWardrobeRolePriority(a.role.key) - getWardrobeRolePriority(b.role.key);
    })[0] ?? null;

  const openRoles = [...roles]
    .filter((role) => role.coverageState !== 'filled')
    .sort((a, b) => {
      if (a.coverageState !== b.coverageState) {
        return a.coverageState === 'open' ? -1 : 1;
      }
      if (a.score !== b.score) return a.score - b.score;
      return getWardrobeRolePriority(a.role.key) - getWardrobeRolePriority(b.role.key);
    });

  return {
    roles,
    collectionSize,
    filledCount,
    partialCount,
    centerTitle,
    centerSubtitle,
    introCopy,
    strongestCoverage,
    openRoles,
    nextBestRole: pickNextWardrobeRole(roles, collectionSize),
  };
}

function polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number) {
  const angleInRadians = (angleInDegrees - 90) * (Math.PI / 180.0);
  return {
    x: cx + (radius * Math.cos(angleInRadians)),
    y: cy + (radius * Math.sin(angleInRadians)),
  };
}

function describeArc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return [
    'M', start.x, start.y,
    'A', radius, radius, 0, largeArcFlag, 0, end.x, end.y,
  ].join(' ');
}

/* ── Types ── */
export interface OraclePick {
  fragrance_id: string; name: string; family: string; reason: string;
  brand: string; notes: string[]; accords: string[];
  reason_chip_label?: string | null;
  reason_chip_explanation?: string | null;
}

export interface OracleLayer {
  fragrance_id: string; name: string; family: string; brand: string;
  notes: string[]; accords: string[]; reason: string;
  ratio_hint?: string;
  application_style?: string;
  placement_hint?: string;
  spray_guidance?: string;
  why_it_works?: string;
  layer_score?: number;
  layer_mode?: string;
  spray_pattern?: SprayPattern | null;
  spray_pattern_key?: string | null;
  spray_pattern_name?: string | null;
  halo?: string | null;
  trail?: string | null;
  anchor_sprays?: number | null;
  layer_sprays?: number | null;
}

export interface OracleAlternate {
  fragrance_id: string; name: string; family: string; reason: string;
  brand?: string; notes?: string[]; accords?: string[]; image_url?: string;
  reason_chip_label?: string | null;
  reason_chip_explanation?: string | null;
}

/** Home hero payload shape from get_todays_oracle_home_v1 / get_guest_oracle_home_v1.
 *  Backend contract v3 sends the hero balance layer in multiple redundant shapes —
 *  see normalizeOracleHomePayload for the canonical resolution order. */
export interface OracleResult {
  today_pick: OraclePick;
  layer: OracleLayer | null;
  /** v3 mirror of `layer` — must agree with payload.layer */
  oracle_layer?: OracleLayer | null;
  /** v3 explicit balance-mode block — must agree with layer_modes.balance */
  seeded_balance_mode?: any;
  alternates: OracleAlternate[];
  ui_default_mode?: string;
  layer_mode_contract?: string;
  layer_modes?: {
    balance?: any;
    bold?: any;
    smooth?: any;
    wild?: any;
  };
  // ── Guest-mode fields (from get_guest_oracle_home_v1) ──
  style_key?: string;
  style_name?: string;
  style_descriptor?: string;
  style_blurb?: string;
  context_key?: string;
  context_note?: string | null;
  weekday_slot?: string | null;
  guest_mode_contract?: string | null;
  accord_tokens?: Array<{
    token_rank: number;
    token_key: string;
    token_label: string;
    color_hex: string;
    phase_hint?: string;
  }>;
  hero_tokens?: Array<any>;
  layer_tokens?: Array<any>;
  layer_mode_order?: string[];
}

/** Backend mood-mode entry from get_layer_for_card_mode_v1 */
interface BackendModeEntry {
  mode: string;
  layer_fragrance_id: string;
  layer_name: string;
  layer_brand: string;
  layer_family: string;
  image_url?: string | null;
  layer_notes: string[];
  layer_accords: string[];
  layer_score: number;
  reason: string;
  why_it_works: string;
  ratio_hint: string;
  application_style: string;
  placement_hint: string;
  spray_guidance: string;
  spray_pattern?: SprayPattern | null;
  spray_pattern_key?: string | null;
  spray_pattern_name?: string | null;
  halo?: string | null;
  trail?: string | null;
  anchor_sprays?: number | null;
  layer_sprays?: number | null;
  spray_map?: unknown;
  zone_spray_map?: unknown;
  interaction_type: string;
}

/** A card from get_home_card_queue_v1 */
interface QueueCard {
  queue_rank: number;
  fragrance_id: string;
  name: string;
  brand: string;
  family_key: string;
  source: string;
  why_this: string;
  collection_status: string;
  is_in_collection: boolean;
  preview: any;
  notes?: string[] | null;
  accords?: string[] | null;
  reason_chip_label?: string | null;
  reason_chip_explanation?: string | null;
}

type FragranceTimelineSource = 'official_note_pyramid' | 'source_description' | 'inferred_from_notes' | 'none';
type FragrancePerformanceSource = 'direct' | 'derived' | 'estimated' | 'projection_fallback' | 'unknown';

interface FragranceDetail {
  id: string;
  name: string;
  brand: string | null;
  family_key: string | null;
  family_color_token?: string | null;
  wardrobe_role_key?: string | null;
  wardrobe_role_label?: string | null;
  role_confidence?: string | null;
  role_source?: string | null;
  release_year?: number | null;
  concentration?: string | null;
  perfumer?: string | null;
  short_description?: string | null;
  description_source?: string | null;
  description_generated_at?: string | null;
  timeline_source?: FragranceTimelineSource | null;
  notes: string[];
  accords: string[];
  top_notes?: string[];
  middle_notes?: string[];
  base_notes?: string[];
  longevity_score?: number | null;
  longevity_source?: FragrancePerformanceSource | null;
  projection_score?: number | null;
  projection_source?: FragrancePerformanceSource | null;
  odor_impact_score?: number | null;
  density_score?: number | null;
  transparency_score?: number | null;
  beast_mode_score?: number | null;
  trail_source?: FragrancePerformanceSource | null;
  why_it_fits_wardrobe?: string | null;
  source_confidence?: string | null;
  retired?: boolean;
  rating?: number | null;
  profile_loaded?: boolean;
  image_url: string | null;
  thumbnail_url: string | null;
  image_source?: string | null;
  source_page_url?: string | null;
  image_license_status?: string | null;
  image_last_checked_at?: string | null;
}

/** Normalized card for display — shared between hero and queue */
interface DisplayCard {
  fragrance_id: string;
  name: string;
  family: string;
  reason: string;
  brand: string;
  image_url?: string | null;
  notes: string[];
  accords: string[];
  reason_chip_label?: string | null;
  reason_chip_explanation?: string | null;
  isHero: boolean; // true = oracle hero, false = queue card
}

interface OdaraSearchFragranceResult {
  fragrance_id: string;
  title: string;
  brand: string;
  family_key: string;
  subtitle: string;
  supporting_text: string;
  notes: string[];
  accords: string[];
  image_url: string | null;
  source: 'search_rpc' | 'catalog_fallback';
}

function normalizeOdaraSearchQuery(query: string) {
  return query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeOdaraSearchFragranceResult(
  raw: any,
  source: OdaraSearchFragranceResult['source'],
): OdaraSearchFragranceResult | null {
  const payload = raw?.payload && typeof raw.payload === 'object' ? raw.payload : null;
  const fragranceId = typeof raw?.fragrance_id === 'string'
    ? raw.fragrance_id.trim()
    : typeof raw?.id === 'string'
      ? raw.id.trim()
      : '';
  const title = readTrimmedLayerText(raw?.title, raw?.name);
  if (!fragranceId || !title) return null;

  const brand = readTrimmedLayerText(raw?.brand, payload?.brand);
  const familyKey = normalizeSearchFamilyKey(
    readTrimmedLayerText(raw?.family_key, raw?.family, payload?.family_key, payload?.family),
  );
  const subtitle = readTrimmedLayerText(
    raw?.subtitle,
    [brand, familyKey ? getFamilyLabelText(familyKey) : '']
      .filter(Boolean)
      .join(' · '),
  );

  return {
    fragrance_id: fragranceId,
    title,
    brand,
    family_key: familyKey,
    subtitle,
    supporting_text: readTrimmedLayerText(raw?.supporting_text),
    notes: sanitizeTokenSource(raw?.notes ?? payload?.notes),
    accords: sanitizeTokenSource(raw?.accords ?? payload?.accords),
    image_url: resolveBottleImageUrl(raw, payload),
    source,
  };
}

function searchResultToDisplayCard(result: OdaraSearchFragranceResult): DisplayCard {
  return {
    fragrance_id: result.fragrance_id,
    name: result.title,
    family: result.family_key,
    reason: 'Added from search for this card.',
    brand: result.brand,
    image_url: result.image_url,
    notes: sanitizeTokenSource(result.notes),
    accords: sanitizeTokenSource(result.accords),
    reason_chip_label: null,
    reason_chip_explanation: null,
    isHero: false,
  };
}

const MAX_SESSION_HISTORY = 30;

type HistoryEntry = {
  card: DisplayCard;
  queuePointerBefore: number;
  promotedAltId: string | null;
  selectedMood: LayerMood | null;
  resolvedVisibleModeEntry: BackendModeEntry | null;
};

interface OdaraScreenProps {
  oracle: OracleResult | null;
  oracleLoading: boolean;
  oracleError: string | null;
  onSignOut: () => void;
  selectedContext: string;
  onContextChange: (ctx: string) => void;
  selectedDate: string;
  onDateChange: (date: string) => void;
  onAccept: (fragranceId: string, layerFragranceId: string | null) => Promise<void>;
  onSkip: (fragranceId: string) => Promise<OracleResult | null>;
  userId: string | null;
  resolvedTemperature: number;
  /** Guest mode: read-only, no signed-in RPCs (queue/alternates/mood). Render strictly from raw payload. */
  isGuestMode?: boolean;
}

/* ── Forecast days ──
 * Local-date parsing only. Never use toISOString() for UI day labels or
 * selected-day matching — that introduces UTC drift near day boundaries
 * and makes the card header date and calendar highlight disagree. */
function fmtLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseLocalDateKey(dateStr: string) {
  return new Date(`${dateStr}T12:00:00`);
}

function buildForecastDays(selectedDate: string) {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();
  const todayStr = fmtLocalDateStr(today);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const dateStr = fmtLocalDateStr(d);
    return {
      label: dayNames[d.getDay()],
      day: d.getDate(),
      dateStr,
      isToday: dateStr === todayStr,
      isSelected: dateStr === selectedDate,
    };
  });
}

function buildForwardRailDays(selectedDate: string) {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();
  const todayStr = fmtLocalDateStr(today);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dateStr = fmtLocalDateStr(d);
    return {
      label: dayNames[d.getDay()],
      day: d.getDate(),
      dateStr,
      isToday: dateStr === todayStr,
      isSelected: dateStr === selectedDate,
    };
  });
}

function getDateLabel(dateStr: string) {
  const d = parseLocalDateKey(dateStr);
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return `${days[d.getDay()]} · ${d.getDate()}`;
}

function getPreviousDateKey(dateStr: string) {
  const d = parseLocalDateKey(dateStr);
  d.setDate(d.getDate() - 1);
  return fmtLocalDateStr(d);
}

function getNextDateKey(dateStr: string) {
  const d = parseLocalDateKey(dateStr);
  d.setDate(d.getDate() + 1);
  return fmtLocalDateStr(d);
}

/* ── Lock state type ── */
type LockState = 'neutral' | 'locked' | 'skipping';
type SignedInCarryoverTarget = 'off' | 'hero' | 'layer';

/* ── Gesture constants ──
 * Card approval is a double-tap (click-based).
 * Swipe-up-to-lock is REMOVED and must not be reintroduced.
 * Horizontal day-swipes remain active on the hero card.
 * Vertical swipe-to-skip is intentionally disabled.
 */
// Hero-card horizontal day-swipe rules live in src/lib/day-swipe.ts so they
// can be unit-tested in isolation. Re-export the runtime constants used here.
import {
  shouldLockHorizontal as shouldLockHorizontalDaySwipe,
  clampDayDragOffset,
  resolveDayCommit,
  DAY_SWIPE_MAX_OFFSET,
} from '@/lib/day-swipe';

function backendModeEntryToLayerMode(
  entry: BackendModeEntry | null | undefined,
): NonNullable<LayerModes[LayerMood]> | null {
  if (!entry) return null;
  if (isUnsafeDominanceSwapLayerPayload(entry)) return null;
  const sprayPattern = normalizeLayerSprayPattern(entry);

  return {
    id: entry.layer_fragrance_id,
    name: entry.layer_name || '',
    brand: entry.layer_brand || '',
    family_key: entry.layer_family || '',
    image_url: entry.image_url ?? null,
    notes: Array.isArray(entry.layer_notes) ? entry.layer_notes : [],
    accords: Array.isArray(entry.layer_accords) ? entry.layer_accords : [],
    interactionType: (entry.interaction_type as InteractionType) || 'balance',
    reason: entry.reason || '',
    why_it_works: entry.why_it_works || '',
    projection: null,
    ratio_hint: entry.ratio_hint || '',
    application_style: entry.application_style || '',
    placement_hint: entry.placement_hint || '',
    spray_guidance: entry.spray_guidance || '',
    spray_pattern: sprayPattern,
    spray_pattern_key: entry.spray_pattern_key ?? sprayPattern?.key ?? null,
    spray_pattern_name: entry.spray_pattern_name ?? sprayPattern?.name ?? null,
    halo: entry.halo ?? sprayPattern?.halo ?? null,
    trail: entry.trail ?? sprayPattern?.trail ?? null,
    anchor_sprays: entry.anchor_sprays ?? sprayPattern?.anchor_sprays ?? null,
    layer_sprays: entry.layer_sprays ?? sprayPattern?.layer_sprays ?? null,
    spray_map: entry.spray_map ?? null,
    zone_spray_map: entry.zone_spray_map ?? null,
  };
}

function buildMoodLaneKey(
  slotPrefix: string,
  fragranceId: string,
  mood: LayerMood,
) {
  return `${slotPrefix}|${fragranceId}|${mood}`;
}

function modeValueToBackendModeEntry(
  value: any,
  mood: LayerMood,
): BackendModeEntry | null {
  if (!value || typeof value !== 'object') return null;
  if (isUnsafeDominanceSwapLayerPayload(value)) return null;

  const layerFragranceId = value.layer_fragrance_id ?? value.fragrance_id ?? value.id ?? '';
  const layerName = value.layer_name ?? value.name ?? '';
  if (!layerFragranceId && !layerName) return null;
  const teaching = normalizeLayerTeachingFields(value);
  const sprayPattern = normalizeLayerSprayPattern(value);

  return {
    mode: mood,
    layer_fragrance_id: layerFragranceId,
    layer_name: layerName,
    layer_brand: value.layer_brand ?? value.brand ?? '',
    layer_family: value.layer_family ?? value.family ?? value.family_key ?? '',
    image_url: resolveBottleImageUrl(value),
    layer_notes: Array.isArray(value.layer_notes) ? value.layer_notes : Array.isArray(value.notes) ? value.notes : [],
    layer_accords: Array.isArray(value.layer_accords) ? value.layer_accords : Array.isArray(value.accords) ? value.accords : [],
    layer_score: value.layer_score ?? 0,
    reason: teaching.reason,
    why_it_works: teaching.why_it_works,
    ratio_hint: teaching.ratio_hint,
    application_style: teaching.application_style,
    placement_hint: teaching.placement_hint,
    spray_guidance: teaching.spray_guidance,
    spray_pattern: sprayPattern,
    spray_pattern_key: value.spray_pattern_key ?? value.sprayPatternKey ?? sprayPattern?.key ?? null,
    spray_pattern_name: value.spray_pattern_name ?? value.sprayPatternName ?? sprayPattern?.name ?? null,
    halo: value.halo ?? sprayPattern?.halo ?? null,
    trail: value.trail ?? sprayPattern?.trail ?? null,
    anchor_sprays: readPositiveLayerCount(
      sprayPattern?.anchor_sprays,
      value.anchor_sprays,
      value.anchorSprays,
      value.hero_sprays,
      value.heroSprays,
      value.main_sprays,
      value.mainSprays,
      value.base_sprays,
      value.baseSprays,
      value?.anchor?.sprays,
      value?.hero?.sprays,
      value?.main?.sprays,
      value?.base?.sprays,
    ),
    layer_sprays: readPositiveLayerCount(
      sprayPattern?.layer_sprays,
      value.layer_sprays,
      value.layerSprays,
      value.top_sprays,
      value.topSprays,
      value.support_sprays,
      value.supportSprays,
      value?.layer?.sprays,
      value?.top?.sprays,
      value?.support?.sprays,
    ),
    spray_map: value.spray_map ?? value.sprayMap ?? null,
    zone_spray_map: value.zone_spray_map ?? value.zoneSprayMap ?? null,
    interaction_type: value.interaction_type ?? value.interactionType ?? value.layer_mode ?? value.mode ?? mood,
  };
}

/** Convert a signed-in layer payload entry from the canonical home contract
 *  into the LayerMode shape consumed by LayerCard. This may be the top-level
 *  `layer` object or a deferred/lazy `layer_modes[mood].layers[idx]` entry.
 *  Pure mapping — no inference. */
function v6LayerToLayerMode(
  layer: any,
  mood: LayerMood,
): NonNullable<LayerModes[LayerMood]> | null {
  if (!layer || typeof layer !== 'object') return null;
  if (isUnsafeDominanceSwapLayerPayload(layer)) return null;
  const id = layer.fragrance_id ?? layer.layer_fragrance_id ?? layer.id ?? '';
  const name = layer.name ?? layer.layer_name ?? '';
  if (!id && !name) return null;
  const teaching = normalizeLayerTeachingFields(layer);
  const sprayPattern = normalizeLayerSprayPattern(layer);
  return {
    id,
    name,
    brand: layer.brand ?? layer.layer_brand ?? '',
    family_key: layer.family ?? layer.family_key ?? layer.layer_family ?? '',
    image_url: resolveBottleImageUrl(layer),
    notes: Array.isArray(layer.notes) ? layer.notes : Array.isArray(layer.layer_notes) ? layer.layer_notes : [],
    accords: Array.isArray(layer.accords) ? layer.accords : Array.isArray(layer.layer_accords) ? layer.layer_accords : [],
    interactionType: ((layer.interaction_type ?? layer.interactionType ?? layer.layer_mode ?? layer.mode ?? mood) as InteractionType) || mood,
    reason: teaching.reason,
    why_it_works: teaching.why_it_works,
    projection: layer.projection ?? null,
    ratio_hint: teaching.ratio_hint,
    application_style: teaching.application_style,
    placement_hint: teaching.placement_hint,
    spray_guidance: teaching.spray_guidance,
    spray_pattern: sprayPattern,
    spray_pattern_key: layer.spray_pattern_key ?? layer.sprayPatternKey ?? sprayPattern?.key ?? null,
    spray_pattern_name: layer.spray_pattern_name ?? layer.sprayPatternName ?? sprayPattern?.name ?? null,
    halo: layer.halo ?? sprayPattern?.halo ?? null,
    trail: layer.trail ?? sprayPattern?.trail ?? null,
    anchor_sprays: readPositiveLayerCount(
      sprayPattern?.anchor_sprays,
      layer.anchor_sprays,
      layer.anchorSprays,
      layer.hero_sprays,
      layer.heroSprays,
      layer.main_sprays,
      layer.mainSprays,
      layer.base_sprays,
      layer.baseSprays,
      layer?.anchor?.sprays,
      layer?.hero?.sprays,
      layer?.main?.sprays,
      layer?.base?.sprays,
    ),
    layer_sprays: readPositiveLayerCount(
      sprayPattern?.layer_sprays,
      layer.layer_sprays,
      layer.layerSprays,
      layer.top_sprays,
      layer.topSprays,
      layer.support_sprays,
      layer.supportSprays,
      layer?.layer?.sprays,
      layer?.top?.sprays,
      layer?.support?.sprays,
    ),
    spray_map: layer.spray_map ?? layer.sprayMap ?? null,
    zone_spray_map: layer.zone_spray_map ?? layer.zoneSprayMap ?? null,
  } as any;
}

// (oracleModeEntryToLayerMode removed — Effect 2 now pre-seeds cache directly)

function normalizeAlternateRow(row: any): OracleAlternate | null {
  if (!row) return null;

  const preview = row.preview ?? {};
  const fragrance_id = row.fragrance_id ?? row.alternate_fragrance_id ?? row.alt_fragrance_id ?? null;
  const name = row.name ?? row.alternate_name ?? row.alt_name ?? row.fragrance_name ?? null;
  const family = row.family ?? row.family_key ?? row.alternate_family ?? row.alt_family ?? '';
  const reason = row.reason ?? row.why_this ?? row.why ?? '';
  const brand = row.brand ?? row.alternate_brand ?? row.alt_brand ?? undefined;
  const notes = Array.isArray(row.notes)
    ? row.notes
    : Array.isArray(preview.notes)
      ? preview.notes
      : undefined;
  const accords = Array.isArray(row.accords)
    ? row.accords
    : Array.isArray(preview.accords)
      ? preview.accords
      : undefined;

  if (!fragrance_id || !name) return null;
  if (isTemporarilySuppressedRotationFragrance({ fragrance_id, name, brand })) return null;

  return {
    fragrance_id,
    name,
    family,
    reason,
    brand,
    image_url: resolveBottleImageUrl(row, preview),
    notes,
    accords,
    reason_chip_label: row.reason_chip_label ?? preview.reason_chip_label ?? null,
    reason_chip_explanation: row.reason_chip_explanation ?? preview.reason_chip_explanation ?? null,
  };
}

/** Convert a QueueCard to a DisplayCard */
function queueCardToDisplay(qc: QueueCard): DisplayCard {
  const preview = qc.preview ?? {};
  return {
    fragrance_id: qc.fragrance_id,
    name: qc.name ?? '',
    family: qc.family_key ?? '',
    reason: qc.why_this ?? '',
    brand: qc.brand ?? '',
    image_url: resolveBottleImageUrl(qc, preview),
    notes: Array.isArray(qc.notes) ? qc.notes : Array.isArray(preview.notes) ? preview.notes : [],
    accords: Array.isArray(qc.accords) ? qc.accords : Array.isArray(preview.accords) ? preview.accords : [],
    reason_chip_label: qc.reason_chip_label ?? preview.reason_chip_label ?? null,
    reason_chip_explanation: qc.reason_chip_explanation ?? preview.reason_chip_explanation ?? null,
    isHero: false,
  };
}

function normalizeQueueCardRow(row: any): QueueCard | null {
  if (!row || typeof row !== 'object') return null;

  const preview = row.preview ?? {};
  const fragranceId = row.fragrance_id ?? preview.fragrance_id ?? null;
  if (typeof fragranceId !== 'string' || fragranceId.trim().length === 0) return null;

  return {
    queue_rank: typeof row.queue_rank === 'number' ? row.queue_rank : 0,
    fragrance_id: fragranceId,
    name: row.name ?? preview.name ?? '',
    brand: row.brand ?? preview.brand ?? '',
    family_key: row.family_key ?? row.family ?? preview.family_key ?? '',
    source: row.source ?? preview.source ?? '',
    why_this: row.why_this ?? preview.why_this ?? '',
    collection_status: row.collection_status ?? preview.collection_status ?? '',
    is_in_collection: row.is_in_collection ?? preview.is_in_collection ?? false,
    preview,
    notes: Array.isArray(row.notes) ? row.notes : null,
    accords: Array.isArray(row.accords) ? row.accords : null,
    reason_chip_label: row.reason_chip_label ?? preview.reason_chip_label ?? null,
    reason_chip_explanation: row.reason_chip_explanation ?? preview.reason_chip_explanation ?? null,
  };
}

function sanitizeTokenSource(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const normalized: string[] = [];

  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) normalized.push(trimmed);
      continue;
    }

    if (value && typeof value === 'object') {
      const candidate = (value as any)?.token_label ?? (value as any)?.label ?? (value as any)?.name ?? null;
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed) normalized.push(trimmed);
      }
    }
  }

  return normalized;
}

function buildFallbackRailTokens(
  accords: string[] | null | undefined,
  notes: string[] | null | undefined,
): any[] {
  const labels = [
    ...normalizeNotes(sanitizeTokenSource(accords), 4),
    ...normalizeNotes(sanitizeTokenSource(notes), 4),
  ];
  const uniqueLabels: string[] = [];
  const seen = new Set<string>();

  for (const rawLabel of labels) {
    const label = typeof rawLabel === 'string' ? rawLabel.trim() : '';
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueLabels.push(label);
    if (uniqueLabels.length >= 4) break;
  }

  return uniqueLabels.map((label, idx) => ({
    token_key: `fallback_${idx}_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    token_label: label,
    label,
    color_hex: '#b8b0a4',
  }));
}

const SEMANTIC_TOKEN_COLORS = {
  spice: '#D4713B',
  citrus: '#F4D35E',
  woody: '#7FAF8E',
  amber: '#D4A373',
  leather: '#8B5E3C',
  gourmand: '#C77DFF',
  floral: '#D4839E',
  clean: '#C4A0B9',
  tobacco: '#8B5E3C',
  green: '#6B8E6B',
  aquatic: '#5BC0DE',
  fruity: '#E38BA8',
  default: '#B8B0A4',
} as const;

const SEMANTIC_TOKEN_MATCHERS: Array<{ color: keyof typeof SEMANTIC_TOKEN_COLORS; pattern: RegExp }> = [
  { color: 'spice', pattern: /cardamom|pepper|cinnamon|saffron|clove|nutmeg|ginger|anise|spice/i },
  { color: 'citrus', pattern: /bergamot|lemon|lime|grapefruit|orange|mandarin|citron|yuzu|citrus/i },
  { color: 'woody', pattern: /oud|agarwood|patchouli|vetiver|cedar|sandalwood|cashmeran|guaiac|wood/i },
  { color: 'amber', pattern: /amber|resin|incense|labdanum|benzoin|myrrh|olibanum/i },
  { color: 'leather', pattern: /leather|suede/i },
  { color: 'gourmand', pattern: /vanilla|caramel|praline|coffee|cocoa|chocolate|tonka|sugar|gourmand/i },
  { color: 'floral', pattern: /rose|jasmine|iris|lily|neroli|orange blossom|tuberose|violet|floral/i },
  { color: 'clean', pattern: /musk|aldehyde|soap|soapy|laundry|clean/i },
  { color: 'tobacco', pattern: /tobacco|smoke|smoky|birch tar|tar/i },
  { color: 'green', pattern: /green|herb|herbal|aromatic|lavender|rosemary|sage|basil|mint|fougere/i },
  { color: 'aquatic', pattern: /aquatic|marine|ozonic|ocean|sea|water|fresh|rain/i },
  { color: 'fruity', pattern: /apple|pear|peach|plum|berry|berries|fig|fruit|fruity|pineapple|mango|cherry/i },
];

function normalizeSemanticTokenLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const normalized = normalizeNotes([trimmed], 1)[0] ?? trimmed.toLowerCase();
  return normalized.trim().toLowerCase();
}

function resolveSemanticTokenColor(label: string): string {
  const normalized = normalizeSemanticTokenLabel(label);
  const matched = SEMANTIC_TOKEN_MATCHERS.find(({ pattern }) => pattern.test(normalized));
  return matched ? SEMANTIC_TOKEN_COLORS[matched.color] : SEMANTIC_TOKEN_COLORS.default;
}

function resolvePreferredDisplayLabels(
  notes: string[] | null | undefined,
  accords: string[] | null | undefined,
  max = 8,
): string[] {
  const noteLabels = sanitizeTokenSource(notes);
  if (noteLabels.length > 0) {
    return normalizeNotes(noteLabels, max);
  }

  const accordLabels = sanitizeTokenSource(accords);
  if (accordLabels.length > 0) {
    return normalizeNotes(accordLabels, max);
  }

  return [];
}

function buildSharedTokenKeySet(
  heroNotes: string[] | null | undefined,
  heroAccords: string[] | null | undefined,
  layerNotes: string[] | null | undefined,
  layerAccords: string[] | null | undefined,
): Set<string> {
  const heroLabels = resolvePreferredDisplayLabels(heroNotes, heroAccords, 8);
  const layerLabels = resolvePreferredDisplayLabels(layerNotes, layerAccords, 8);
  const layerKeys = new Set(layerLabels.map(normalizeSemanticTokenLabel).filter(Boolean));

  return new Set(
    heroLabels
      .map(normalizeSemanticTokenLabel)
      .filter((key) => key && layerKeys.has(key)),
  );
}

function buildSemanticSurfaceTokens(
  notes: string[] | null | undefined,
  accords: string[] | null | undefined,
  sharedKeys: Set<string> = new Set(),
  max = 4,
): any[] {
  const labels = resolvePreferredDisplayLabels(notes, accords, 8);
  const orderedKeys = new Set<string>();
  const sharedLabels: string[] = [];
  const uniqueLabels: string[] = [];

  for (const rawLabel of labels) {
    const trimmed = typeof rawLabel === 'string' ? rawLabel.trim() : '';
    if (!trimmed) continue;
    const key = normalizeSemanticTokenLabel(trimmed);
    if (!key || orderedKeys.has(key)) continue;
    orderedKeys.add(key);
    if (sharedKeys.has(key)) {
      sharedLabels.push(trimmed);
    } else {
      uniqueLabels.push(trimmed);
    }
  }

  return [...sharedLabels, ...uniqueLabels].slice(0, max).map((label, idx) => {
    const key = normalizeSemanticTokenLabel(label);
    return {
      token_key: `semantic_${idx}_${key.replace(/[^a-z0-9]+/g, '_')}`,
      token_label: label,
      label,
      color_hex: resolveSemanticTokenColor(label),
      is_shared: sharedKeys.has(key),
    };
  });
}

function hasRenderableRailTokens(
  accords: string[] | null | undefined,
  notes: string[] | null | undefined,
): boolean {
  return buildFallbackRailTokens(accords, notes).length > 0;
}

function hasResolvedFamilyValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasResolvedImageValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function displayCardNeedsDetailHydration(card: DisplayCard | null | undefined): boolean {
  if (!card) return false;
  return !hasResolvedFamilyValue(card.family)
    || !hasRenderableRailTokens(card.accords, card.notes)
    || !hasResolvedImageValue(card.image_url);
}

function layerModeNeedsDetailHydration(layer: NonNullable<LayerModes[LayerMood]> | null | undefined): boolean {
  if (!layer) return false;
  return !hasResolvedFamilyValue(layer.family_key)
    || !hasRenderableRailTokens(layer.accords, layer.notes)
    || !hasResolvedImageValue(layer.image_url);
}

function pickPreferredRailSource(
  currentAccords: string[] | null | undefined,
  currentNotes: string[] | null | undefined,
  detailAccords: string[] | null | undefined,
  detailNotes: string[] | null | undefined,
) {
  const currentAccordsSanitized = sanitizeTokenSource(currentAccords);
  const currentNotesSanitized = sanitizeTokenSource(currentNotes);
  const detailAccordsSanitized = sanitizeTokenSource(detailAccords);
  const detailNotesSanitized = sanitizeTokenSource(detailNotes);

  const currentTokenCount = buildFallbackRailTokens(currentAccordsSanitized, currentNotesSanitized).length;
  const detailTokenCount = buildFallbackRailTokens(detailAccordsSanitized, detailNotesSanitized).length;

  if (detailTokenCount > currentTokenCount) {
    return {
      accords: detailAccordsSanitized,
      notes: detailNotesSanitized,
    };
  }

  return {
    accords: currentAccordsSanitized,
    notes: currentNotesSanitized,
  };
}

function resolveDisplayCardWithDetails(
  card: DisplayCard,
  detail: FragranceDetail | null | undefined,
): DisplayCard {
  const cardNotes = sanitizeTokenSource(card.notes);
  const cardAccords = sanitizeTokenSource(card.accords);
  if (!detail) {
    return {
      ...card,
      image_url: card.image_url ?? null,
      reason: resolveHydratedHeroReason(card, null),
      notes: cardNotes,
      accords: cardAccords,
    };
  }
  const preferredRail = pickPreferredRailSource(
    cardAccords,
    cardNotes,
    detail.accords,
    detail.notes,
  );
  return {
    ...card,
    name: card.name || detail.name || '',
    brand: card.brand || detail.brand || '',
    family: card.family || detail.family_key || '',
    image_url: card.image_url ?? detail.image_url ?? null,
    reason: resolveHydratedHeroReason(card, detail),
    notes: preferredRail.notes,
    accords: preferredRail.accords,
  };
}

function resolveQueuedHeroDisplayWithDetails(
  card: DisplayCard,
  detail: FragranceDetail | null | undefined,
): DisplayCard {
  const previewNotes = sanitizeTokenSource(card.notes);
  const previewAccords = sanitizeTokenSource(card.accords);
  const previewTokens = buildFallbackRailTokens(previewAccords, previewNotes);

  if (!detail) {
    return {
      ...card,
      image_url: card.image_url ?? null,
      reason: resolveHydratedHeroReason(card, null),
      notes: previewNotes,
      accords: previewAccords,
    };
  }

  const detailNotes = sanitizeTokenSource(detail.notes);
  const detailAccords = sanitizeTokenSource(detail.accords);
  const detailTokens = buildFallbackRailTokens(detailAccords, detailNotes);
  const useDetailRail = detailTokens.length > 0 || previewTokens.length === 0;

  return {
    ...card,
    name: card.name || detail.name || '',
    brand: card.brand || detail.brand || '',
    family: detail.family_key || card.family || '',
    image_url: card.image_url ?? detail.image_url ?? null,
    reason: resolveHydratedHeroReason(card, detail),
    notes: useDetailRail ? detailNotes : previewNotes,
    accords: useDetailRail ? detailAccords : previewAccords,
  };
}

function mergeQueuedHeroCardSources(
  ...cards: Array<DisplayCard | null | undefined>
): DisplayCard | null {
  const sources = cards.filter(Boolean) as DisplayCard[];
  if (sources.length === 0) return null;

  const base = sources[0];
  let bestAccords = sanitizeTokenSource(base.accords);
  let bestNotes = sanitizeTokenSource(base.notes);
  let bestTokenCount = buildFallbackRailTokens(bestAccords, bestNotes).length;

  for (const source of sources.slice(1)) {
    const accords = sanitizeTokenSource(source.accords);
    const notes = sanitizeTokenSource(source.notes);
    const tokenCount = buildFallbackRailTokens(accords, notes).length;
    if (tokenCount > bestTokenCount) {
      bestAccords = accords;
      bestNotes = notes;
      bestTokenCount = tokenCount;
    }
  }

  const resolvedReasonChip = readReasonChipFromSources(...sources);

  return {
    ...base,
    name: sources.find((source) => source.name)?.name ?? '',
    brand: sources.find((source) => source.brand)?.brand ?? '',
    family: sources.find((source) => typeof source.family === 'string' && source.family.trim().length > 0)?.family ?? '',
    image_url: sources.find((source) => hasResolvedImageValue(source.image_url))?.image_url ?? null,
    reason: sources.find((source) => source.reason)?.reason ?? '',
    notes: bestNotes,
    accords: bestAccords,
    reason_chip_label: resolvedReasonChip?.label ?? null,
    reason_chip_explanation: resolvedReasonChip?.explanation ?? null,
  };
}

function areSameDisplayCards(a: DisplayCard | null | undefined, b: DisplayCard | null | undefined) {
  if (a === b) return true;
  if (!a || !b) return false;
  const aNotes = sanitizeTokenSource(a.notes);
  const bNotes = sanitizeTokenSource(b.notes);
  const aAccords = sanitizeTokenSource(a.accords);
  const bAccords = sanitizeTokenSource(b.accords);
  return (
    a.fragrance_id === b.fragrance_id &&
    a.name === b.name &&
    a.brand === b.brand &&
    a.family === b.family &&
    (a.image_url ?? null) === (b.image_url ?? null) &&
    a.reason_chip_label === b.reason_chip_label &&
    a.reason_chip_explanation === b.reason_chip_explanation &&
    aNotes.length === bNotes.length &&
    aNotes.every((note, idx) => note === bNotes[idx]) &&
    aAccords.length === bAccords.length &&
    aAccords.every((accord, idx) => accord === bAccords[idx])
  );
}

function areSameDisplayCardLists(
  a: Array<DisplayCard | null | undefined> | null | undefined,
  b: Array<DisplayCard | null | undefined> | null | undefined,
) {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  if (left.length !== right.length) return false;
  return left.every((entry, index) => areSameDisplayCards(entry ?? null, right[index] ?? null));
}

function areSameOracleAlternates(
  a: OracleAlternate[] | null | undefined,
  b: OracleAlternate[] | null | undefined,
) {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return (
      (entry?.fragrance_id ?? null) === (other?.fragrance_id ?? null)
      && (entry?.name ?? '') === (other?.name ?? '')
      && (entry?.brand ?? '') === (other?.brand ?? '')
      && (entry?.family ?? '') === (other?.family ?? '')
      && (entry?.reason ?? '') === (other?.reason ?? '')
      && (entry?.reason_chip_label ?? null) === (other?.reason_chip_label ?? null)
      && (entry?.reason_chip_explanation ?? null) === (other?.reason_chip_explanation ?? null)
    );
  });
}

function areSameLayerIndexMap(
  current: Record<LayerMood, number>,
  next: Record<LayerMood, number>,
) {
  return (
    current.balance === next.balance
    && current.bold === next.bold
    && current.smooth === next.smooth
    && current.wild === next.wild
  );
}

const DEFAULT_LAYER_INDEX_MAP: Record<LayerMood, number> = {
  balance: 0,
  bold: 0,
  smooth: 0,
  wild: 0,
};

const DEFAULT_MODE_LOADING_STATE: Record<LayerMood, boolean> = {
  balance: false,
  bold: false,
  smooth: false,
  wild: false,
};

const DEFAULT_MODE_ERROR_STATE: Record<LayerMood, string | null> = {
  balance: null,
  bold: null,
  smooth: null,
  wild: null,
};

function areSameModeLoadingMap(
  current: Record<LayerMood, boolean>,
  next: Record<LayerMood, boolean>,
) {
  return (
    current.balance === next.balance
    && current.bold === next.bold
    && current.smooth === next.smooth
    && current.wild === next.wild
  );
}

function areSameModeErrorMap(
  current: Record<LayerMood, string | null>,
  next: Record<LayerMood, string | null>,
) {
  return (
    current.balance === next.balance
    && current.bold === next.bold
    && current.smooth === next.smooth
    && current.wild === next.wild
  );
}

function areSameStringLists(
  current: string[] | null | undefined,
  next: string[] | null | undefined,
) {
  const left = Array.isArray(current) ? current : [];
  const right = Array.isArray(next) ? next : [];
  if (left.length !== right.length) return false;
  return left.every((entry, index) => entry === right[index]);
}

function areSameMoonMarkerState(
  current: {
    left: number;
    topY: number;
    weekNotches: number[];
    moonLitFrac: number;
    moonWaxing: boolean;
  } | null,
  next: {
    left: number;
    topY: number;
    weekNotches: number[];
    moonLitFrac: number;
    moonWaxing: boolean;
  } | null,
) {
  if (current === next) return true;
  if (!current || !next) return false;
  return (
    Math.abs(current.left - next.left) < 0.25
    && Math.abs(current.topY - next.topY) < 0.25
    && areSameStringLists(
      current.weekNotches.map((value) => value.toFixed(2)),
      next.weekNotches.map((value) => value.toFixed(2)),
    )
    && Math.abs(current.moonLitFrac - next.moonLitFrac) < 0.0001
    && current.moonWaxing === next.moonWaxing
  );
}

function getOdaraLunarPhaseForDate(dateStr: string) {
  const parsed = new Date(`${dateStr}T12:00:00`);
  const d = isNaN(parsed.getTime()) ? new Date() : parsed;
  const SYNODIC = 29.530588853;
  const refMs = Date.UTC(2000, 0, 6, 18, 14, 0);
  const daysSince = (d.getTime() - refMs) / 86400000;
  const phaseFrac = ((daysSince % SYNODIC) + SYNODIC) % SYNODIC / SYNODIC;
  return {
    lit: (1 - Math.cos(2 * Math.PI * phaseFrac)) / 2,
    waxing: phaseFrac < 0.5,
  };
}

const OdaraDayMoonPhaseIcon: React.FC<{ dateStr: string; isActive?: boolean }> = ({
  dateStr,
  isActive = false,
}) => {
  const { lit, waxing } = getOdaraLunarPhaseForDate(dateStr);
  const D = 13;
  const C = D / 2;
  const R = 5.7;
  const rx = R * Math.abs(1 - 2 * lit);
  const litRectX = waxing ? C : 0;
  const ellipseAdds = lit >= 0.5;
  const safeId = dateStr.replace(/[^a-zA-Z0-9_-]/g, '');
  const maskId = `odara-day-moon-${safeId}-${waxing ? 'wx' : 'wn'}-${ellipseAdds ? 'g' : 'c'}`;
  return (
    <svg
      aria-hidden
      width={D}
      height={D}
      viewBox={`0 0 ${D} ${D}`}
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{
        opacity: isActive ? 0.78 : 0.56,
        filter: isActive
          ? 'drop-shadow(0 0 3px rgba(246,242,232,0.20))'
          : 'drop-shadow(0 0 2px rgba(246,242,232,0.12))',
      }}
    >
      <defs>
        <radialGradient id={`${maskId}-surface`} cx="35%" cy="24%" r="72%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.98)" />
          <stop offset="54%" stopColor="rgba(220,218,210,0.88)" />
          <stop offset="100%" stopColor="rgba(135,135,132,0.70)" />
        </radialGradient>
        <mask id={maskId}>
          <rect x="0" y="0" width={D} height={D} fill="black" />
          <rect x={litRectX} y="0" width={C} height={D} fill="white" />
          <ellipse cx={C} cy={C} rx={rx} ry={R} fill={ellipseAdds ? 'white' : 'black'} />
        </mask>
        <clipPath id={`${maskId}-clip`}>
          <circle cx={C} cy={C} r={R} />
        </clipPath>
      </defs>
      <circle
        cx={C}
        cy={C}
        r={R}
        fill={isActive ? 'rgba(18,19,23,0.84)' : 'rgba(20,22,26,0.82)'}
        stroke={isActive ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.18)'}
        strokeWidth="0.45"
      />
      <circle cx={C} cy={C} r={R} fill={`url(#${maskId}-surface)`} mask={`url(#${maskId})`} />
      <g clipPath={`url(#${maskId}-clip)`} opacity="0.18">
        <circle cx="4.4" cy="4.2" r="0.55" fill="rgba(66,68,72,0.75)" />
        <circle cx="8.2" cy="5.7" r="0.42" fill="rgba(66,68,72,0.62)" />
        <circle cx="6.2" cy="8.1" r="0.5" fill="rgba(66,68,72,0.58)" />
      </g>
    </svg>
  );
};

function normalizeFragranceIdentityText(value: string | null | undefined) {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const TEMPORARILY_SUPPRESSED_ROTATION_FRAGRANCES = [
  {
    id: '9befd638-82c6-486e-89f7-f26a8ecef0b4',
    name: 'Sugi Noir',
    brand: 'Alexandria Fragrances',
  },
  {
    id: 'af5d280b-dc4d-4013-8450-dffc49587f0b',
    name: 'Trepak',
    brand: 'Alexandria Fragrances',
  },
] as const;

function isTemporarilySuppressedRotationFragrance(
  candidate: { fragrance_id?: string | null; id?: string | null; name?: string | null; brand?: string | null } | null | undefined,
) {
  if (!candidate) return false;

  const candidateId = candidate.fragrance_id ?? candidate.id ?? null;
  if (candidateId && TEMPORARILY_SUPPRESSED_ROTATION_FRAGRANCES.some((entry) => entry.id === candidateId)) {
    return true;
  }

  const candidateName = normalizeFragranceIdentityText(candidate.name);
  const candidateBrand = normalizeFragranceIdentityText(candidate.brand);
  if (!candidateName || !candidateBrand) return false;

  return TEMPORARILY_SUPPRESSED_ROTATION_FRAGRANCES.some((entry) => (
    normalizeFragranceIdentityText(entry.name) === candidateName
    && normalizeFragranceIdentityText(entry.brand) === candidateBrand
  ));
}

function isSameFragranceIdentity(
  a: { fragrance_id?: string | null; id?: string | null; name?: string | null; brand?: string | null } | null | undefined,
  b: { fragrance_id?: string | null; id?: string | null; name?: string | null; brand?: string | null } | null | undefined,
) {
  if (!a || !b) return false;

  const aId = a.fragrance_id ?? a.id ?? null;
  const bId = b.fragrance_id ?? b.id ?? null;
  if (aId && bId) return aId === bId;

  const aName = normalizeFragranceIdentityText(a.name);
  const bName = normalizeFragranceIdentityText(b.name);
  const aBrand = normalizeFragranceIdentityText(a.brand);
  const bBrand = normalizeFragranceIdentityText(b.brand);

  return !!aName && !!bName && !!aBrand && !!bBrand && aName === bName && aBrand === bBrand;
}

function isSameRenderableFragranceIdentity(
  a: { fragrance_id?: string | null; id?: string | null; name?: string | null; brand?: string | null } | null | undefined,
  b: { fragrance_id?: string | null; id?: string | null; name?: string | null; brand?: string | null } | null | undefined,
) {
  if (isSameFragranceIdentity(a, b)) return true;

  const aName = normalizeFragranceIdentityText(a?.name);
  const bName = normalizeFragranceIdentityText(b?.name);
  if (!aName || !bName || aName !== bName) return false;

  const aBrand = normalizeFragranceIdentityText(a?.brand);
  const bBrand = normalizeFragranceIdentityText(b?.brand);
  if (aBrand && bBrand) {
    return aBrand === bBrand;
  }

  return true;
}

function filterAlternatesAgainstVisibleScents<T>(
  alternates: T[],
  getIdentity: (alternate: T) => { fragrance_id?: string | null; id?: string | null; name?: string | null; brand?: string | null } | null | undefined,
  excluded: Array<{ fragrance_id?: string | null; id?: string | null; name?: string | null; brand?: string | null } | null | undefined>,
) {
  const filtered: T[] = [];

  for (const alternate of alternates) {
    const identity = getIdentity(alternate);
    if (!identity) continue;
    if (excluded.some((candidate) => isSameRenderableFragranceIdentity(identity, candidate))) {
      continue;
    }
    filtered.push(alternate);
  }

  return filtered;
}

function isSameBackendModeEntryIdentity(
  a: BackendModeEntry | null | undefined,
  b: BackendModeEntry | null | undefined,
) {
  return isSameFragranceIdentity(
    a ? { fragrance_id: a.layer_fragrance_id, name: a.layer_name, brand: a.layer_brand } : null,
    b ? { fragrance_id: b.layer_fragrance_id, name: b.layer_name, brand: b.layer_brand } : null,
  );
}

function appendUniqueBackendModeEntries(
  existing: BackendModeEntry[],
  additions: Array<BackendModeEntry | null | undefined>,
) {
  const next = [...existing];
  for (const addition of additions) {
    if (!addition) continue;
    if (next.some((current) => isSameBackendModeEntryIdentity(current, addition))) continue;
    next.push(addition);
  }
  return next;
}

function pickFirstUniqueDisplayCard(
  candidates: Array<DisplayCard | null | undefined>,
  against: { fragrance_id?: string | null; id?: string | null; name?: string | null; brand?: string | null } | null | undefined,
) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (isTemporarilySuppressedRotationFragrance(candidate)) continue;
    if (!isSameFragranceIdentity(candidate, against)) {
      return candidate;
    }
  }
  return null;
}

function pickFirstDisplayCardExcluding(
  candidates: Array<DisplayCard | null | undefined>,
  excluded: Array<{ fragrance_id?: string | null; id?: string | null; name?: string | null; brand?: string | null } | null | undefined>,
) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (isTemporarilySuppressedRotationFragrance(candidate)) continue;
    if (excluded.some((blocked) => isSameFragranceIdentity(candidate, blocked))) continue;
    return candidate;
  }
  return null;
}

function resolveLayerModeWithDetails(
  layer: NonNullable<LayerModes[LayerMood]> | null | undefined,
  detail: FragranceDetail | null | undefined,
): NonNullable<LayerModes[LayerMood]> | null {
  if (!layer) return null;
  const layerNotes = sanitizeTokenSource(layer.notes);
  const layerAccords = sanitizeTokenSource(layer.accords);
  if (!detail) {
    return {
      ...layer,
      image_url: layer.image_url ?? null,
      notes: layerNotes,
      accords: layerAccords,
      top_notes: layer.top_notes ?? null,
      middle_notes: layer.middle_notes ?? null,
      base_notes: layer.base_notes ?? null,
    };
  }
  const preferredRail = pickPreferredRailSource(
    layerAccords,
    layerNotes,
    detail.accords,
    detail.notes,
  );
  return {
    ...layer,
    name: layer.name || detail.name || '',
    brand: layer.brand || detail.brand || '',
    family_key: layer.family_key || detail.family_key || '',
    image_url: layer.image_url ?? detail.image_url ?? null,
    notes: preferredRail.notes,
    accords: preferredRail.accords,
    top_notes: sanitizeTokenSource(detail.top_notes),
    middle_notes: sanitizeTokenSource(detail.middle_notes),
    base_notes: sanitizeTokenSource(detail.base_notes),
  };
}

/** Convert an OraclePick to a DisplayCard (hero) */
function heroToDisplay(pick: OraclePick): DisplayCard {
  return {
    ...pick,
    image_url: resolveBottleImageUrl(pick),
    isHero: true,
  };
}

/** Tracks locked scent colors per day+context for weekly lane rendering */
type LockedLaneInfo = { mainColor: string; layerColor: string | null };
type LockedSelectionsMap = Record<string, LockedLaneInfo>; // key = "dateStr:context"
type PersistedLayerModeSnapshot = NonNullable<LayerModes[LayerMood]>;
type PersistedResolvedHeroRailSnapshot = {
  familyLabel: string;
  familyColor: string;
  reasonChip: { label: string; explanation: string | null } | null;
  tokens: any[];
};
type PersistedResolvedCurrentCardSnapshot = {
  fragrance_id: string;
  name: string;
  brand: string;
  family: string;
  image_url: string | null;
  familyLabel: string;
  familyColor: string;
  reason_chip_label: string | null;
  reason_chip_explanation: string | null;
  notes: string[];
  accords: string[];
  layer: PersistedLayerModeSnapshot | null;
  layerFamilyKey: string;
  layerFamilyLabel: string;
  layerTokens: any[];
  layerModes: Record<LayerMood, PersistedLayerModeSnapshot | null>;
  alternates: OracleAlternate[];
  selectedMode: LayerMood;
  resolvedHeroRail: PersistedResolvedHeroRailSnapshot | null;
  visibleCardId: string;
  isHeroCard: boolean;
};

type SignedInDayState = {
  lockState: LockState;
  daisyChainEnabled: boolean | null;
  carryoverMode: SignedInCarryoverTarget;
  carryoverOrigin: 'manual' | 'inherited' | null;
  carryoverNextDayRole: 'main' | 'layer' | null;
  carryoverSourceDateKey: string | null;
  carryoverTargetDateKey: string | null;
  carryoverContextKey: string | null;
  carryoverSelectedCard: DisplayCard | null;
  resolvedHeroCard: DisplayCard | null;
  resolvedLayerCard: DisplayCard | null;
  carryoverHeroCard: DisplayCard | null;
  carryoverLayerCard: DisplayCard | null;
  lockedCard: DisplayCard | null;
  lockedLayerCard: DisplayCard | null;
  lockedLayerMode: PersistedLayerModeSnapshot | null;
  lockedResolvedCurrentCard: PersistedResolvedCurrentCardSnapshot | null;
  lockedContext: string | null;
  lockedMood: LayerMood;
  lockedPromotedAltId: string | null;
  manualHeroCard: DisplayCard | null;
  manualLayerCard: DisplayCard | null;
  preferenceMoments: PersistedPreferenceMoment[];
};

type SignedInDayStateMap = Record<string, SignedInDayState>; // key = "dateStr:context"
type SignedInResolvedDayDecision = {
  visibleCard: DisplayCard | null;
  forcedLayerCarryCard: DisplayCard | null;
  selectedMood: LayerMood;
  promotedAltId: string | null;
  source: 'locked' | 'manual' | 'carryover-main' | 'carryover-layer' | 'oracle';
};

type SignedInSearchPreviewSnapshot = {
  visibleCard: DisplayCard | null;
  forcedLayerCarryCard: DisplayCard | null;
  selectedMood: LayerMood;
  layerIdxByMood: Record<LayerMood, number>;
  promotedAltId: string | null;
  resolvedDayDecisionSource: SignedInResolvedDayDecision['source'];
  alternates: OracleAlternate[];
  alternatesOwnerId: string | null;
};

type FragranceImageAsset = {
  fragrance_id: string;
  image_url: string | null;
  image_url_transparent?: string | null;
  thumbnail_url: string | null;
  image_source?: string | null;
  source_url?: string | null;
  updated_at?: string | null;
  provider_payload?: Record<string, unknown> | null;
};

type SignedInVerifiedPredecessorBaton = {
  selectedSource: Exclude<SignedInCarryoverTarget, 'off'>;
  carriedCard: DisplayCard;
  nextDayRole: 'main' | 'layer';
  previousHeroCard: DisplayCard | null;
  previousLayerCard: DisplayCard | null;
  excludedPreviousCard: DisplayCard | null;
};

type SignedInResolvedLockTruth = {
  lockedCard: DisplayCard;
  lockedLayerCard: DisplayCard | null;
  lockedLayerMode: PersistedLayerModeSnapshot | null;
  lockedResolvedCurrentCard: PersistedResolvedCurrentCardSnapshot | null;
  lockedContext: string | null;
  lockedMood: LayerMood;
  lockedPromotedAltId: string | null;
};

type PersistedPreferenceMomentState = 'liked' | 'loved';

type PersistedPreferenceMomentFragrance = {
  fragrance_id: string;
  name: string;
  brand: string | null;
  family_key: string | null;
  image_url: string | null;
};

type PersistedPreferenceMoment = {
  fragrance_id: string;
  preference_state: PersistedPreferenceMomentState;
  source: string | null;
  created_at: string | null;
  context_key: string | null;
  date_key: string | null;
  mode: LayerMood | null;
  main: PersistedPreferenceMomentFragrance;
  layer: PersistedPreferenceMomentFragrance | null;
};

const ODARA_SIGNED_IN_DAY_MEMORY_TABLE = 'odara_signed_in_day_memory';
const ODARA_SIGNED_IN_DAY_MEMORY_DEFAULT_CONTEXT = 'daily';

function preferenceStateToHeartState(value: unknown): HeartState {
  return value === 'loved' ? 2 : value === 'liked' ? 1 : 0;
}

function preferenceStateToNegativeState(value: unknown): OdaraNegativeState {
  return value === 'disliked' ? 2 : value === 'not_for_me' ? 1 : 0;
}

function heartStateToPreferenceState(value: HeartState): 'neutral' | 'liked' | 'loved' {
  return value === 2 ? 'loved' : value === 1 ? 'liked' : 'neutral';
}

function negativeStateToPreferenceState(value: OdaraNegativeState): 'neutral' | 'not_for_me' | 'disliked' {
  return value === 2 ? 'disliked' : value === 1 ? 'not_for_me' : 'neutral';
}

function createDefaultSignedInDayState(): SignedInDayState {
  return {
    lockState: 'neutral',
    daisyChainEnabled: null,
    carryoverMode: 'off',
    carryoverOrigin: null,
    carryoverNextDayRole: null,
    carryoverSourceDateKey: null,
    carryoverTargetDateKey: null,
    carryoverContextKey: null,
    carryoverSelectedCard: null,
    resolvedHeroCard: null,
    resolvedLayerCard: null,
    carryoverHeroCard: null,
    carryoverLayerCard: null,
    lockedCard: null,
    lockedLayerCard: null,
    lockedLayerMode: null,
    lockedResolvedCurrentCard: null,
    lockedContext: null,
    lockedMood: 'balance',
    lockedPromotedAltId: null,
    manualHeroCard: null,
    manualLayerCard: null,
    preferenceMoments: [],
  };
}

function normalizePersistedPreferenceMomentState(value: unknown): PersistedPreferenceMomentState | null {
  return value === 'loved' ? 'loved' : value === 'liked' ? 'liked' : null;
}

function buildPreferenceMomentFragranceSnapshot(value: {
  fragrance_id?: string | null;
  id?: string | null;
  name?: string | null;
  brand?: string | null;
  family?: string | null;
  family_key?: string | null;
  image_url?: string | null;
} | null | undefined): PersistedPreferenceMomentFragrance | null {
  if (!value) return null;
  const fragrance_id = readTrimmedLayerText(value.fragrance_id, value.id);
  const name = readTrimmedLayerText(value.name);
  if (!fragrance_id || !name) return null;
  return {
    fragrance_id,
    name,
    brand: readTrimmedLayerText(value.brand) || null,
    family_key: normalizeSearchFamilyKey(readTrimmedLayerText(value.family_key, value.family)),
    image_url: readTrimmedImageUrl(value.image_url),
  };
}

function toPersistedPreferenceMoment(moment: PersistedPreferenceMoment | null | undefined) {
  if (!moment) return null;
  const preferenceState = normalizePersistedPreferenceMomentState(moment.preference_state);
  const main = buildPreferenceMomentFragranceSnapshot(moment.main);
  const layer = buildPreferenceMomentFragranceSnapshot(moment.layer);
  const fragranceId = readTrimmedLayerText(moment.fragrance_id, main?.fragrance_id);
  if (!preferenceState || !fragranceId || !main) return null;
  return {
    fragrance_id: fragranceId,
    preference_state: preferenceState,
    source: readTrimmedLayerText(moment.source) || null,
    created_at: readTrimmedLayerText(moment.created_at) || null,
    context_key: readTrimmedLayerText(moment.context_key) ? normalizePersistedContextKey(moment.context_key) : null,
    date_key: readTrimmedLayerText(moment.date_key) || null,
    mode: moment.mode ? normalizePersistedMood(moment.mode) : null,
    main,
    layer,
  };
}

function fromPersistedPreferenceMoment(raw: any): PersistedPreferenceMoment | null {
  if (!raw || typeof raw !== 'object') return null;
  const preferenceState = normalizePersistedPreferenceMomentState(raw.preference_state);
  const main = buildPreferenceMomentFragranceSnapshot(raw.main);
  const layer = buildPreferenceMomentFragranceSnapshot(raw.layer);
  const fragranceId = readTrimmedLayerText(raw.fragrance_id, main?.fragrance_id);
  if (!preferenceState || !fragranceId || !main) return null;
  return {
    fragrance_id: fragranceId,
    preference_state: preferenceState,
    source: readTrimmedLayerText(raw.source) || null,
    created_at: readTrimmedLayerText(raw.created_at) || null,
    context_key: readTrimmedLayerText(raw.context_key) ? normalizePersistedContextKey(raw.context_key) : null,
    date_key: readTrimmedLayerText(raw.date_key) || null,
    mode: normalizeLayerMoodKey(raw.mode) ?? null,
    main,
    layer,
  };
}

function areSamePreferenceMoments(
  a: PersistedPreferenceMoment[] | null | undefined,
  b: PersistedPreferenceMoment[] | null | undefined,
) {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

function upsertPreferenceMoment(
  moments: PersistedPreferenceMoment[] | null | undefined,
  moment: PersistedPreferenceMoment | null | undefined,
) {
  const normalizedMoment = toPersistedPreferenceMoment(moment);
  const existing = Array.isArray(moments)
    ? moments
        .map((entry) => toPersistedPreferenceMoment(entry))
        .filter((entry): entry is NonNullable<typeof entry> => !!entry)
    : [];

  if (!normalizedMoment) return existing;

  const next = [
    normalizedMoment,
    ...existing.filter((entry) => entry.fragrance_id !== normalizedMoment.fragrance_id),
  ];

  return next.slice(0, 12);
}

function normalizePersistedLockState(value: unknown): LockState {
  return value === 'locked' ? 'locked' : 'neutral';
}

function normalizePersistedCarryoverTarget(value: unknown): SignedInCarryoverTarget {
  return value === 'hero' || value === 'layer' ? value : 'off';
}

function normalizePersistedCarryoverOrigin(value: unknown): SignedInDayState['carryoverOrigin'] {
  return value === 'manual' || value === 'inherited' ? value : null;
}

function normalizePersistedNextDayRole(value: unknown): SignedInDayState['carryoverNextDayRole'] {
  return value === 'main' || value === 'layer' ? value : null;
}

function normalizePersistedMood(value: unknown): LayerMood {
  return normalizeLayerMoodKey(value) ?? 'balance';
}

function normalizePersistedLockedContext(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function normalizePersistedContextKey(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().toLowerCase()
    : ODARA_SIGNED_IN_DAY_MEMORY_DEFAULT_CONTEXT;
}

function readSignedInOracleSlotMeta(value: unknown): { contextKey: string | null; wearDate: string | null } {
  if (!value || typeof value !== 'object') {
    return { contextKey: null, wearDate: null };
  }

  const top = value as Record<string, unknown>;
  const raw = top.__v6 && typeof top.__v6 === 'object'
    ? top.__v6 as Record<string, unknown>
    : top;

  const rawContext = (
    (typeof raw.requested_context === 'string' && raw.requested_context.trim().length > 0 ? raw.requested_context : null)
    ?? (typeof raw.context_key === 'string' && raw.context_key.trim().length > 0 ? raw.context_key : null)
    ?? (typeof top.requested_context === 'string' && top.requested_context.trim().length > 0 ? top.requested_context : null)
    ?? (typeof top.context_key === 'string' && top.context_key.trim().length > 0 ? top.context_key : null)
  );

  const rawWearDate = (
    (typeof raw.wear_date === 'string' && raw.wear_date.trim().length > 0 ? raw.wear_date : null)
    ?? (typeof top.wear_date === 'string' && top.wear_date.trim().length > 0 ? top.wear_date : null)
  );

  return {
    contextKey: rawContext ? normalizePersistedContextKey(rawContext) : null,
    wearDate: rawWearDate,
  };
}

function signedInOracleMatchesRequestedSlot(
  value: unknown,
  selectedContext: string,
  selectedDate: string,
) {
  const meta = readSignedInOracleSlotMeta(value);
  if (meta.contextKey && meta.contextKey !== normalizePersistedContextKey(selectedContext)) {
    return false;
  }
  if (meta.wearDate && meta.wearDate !== selectedDate) {
    return false;
  }
  return true;
}

function buildSignedInDayStateSlotKey(dateKey: string, contextKey: string) {
  return `${dateKey}:${normalizePersistedContextKey(contextKey)}`;
}

function buildSignedInMoodCycleMemoryKey(slotKey: string, anchorId: string | null | undefined) {
  return `${slotKey}|${anchorId ?? 'none'}`;
}

function parseSignedInDayStateSlotKey(slotKey: string) {
  if (typeof slotKey !== 'string' || slotKey.length < 10) {
    return {
      dateKey: '',
      contextKey: ODARA_SIGNED_IN_DAY_MEMORY_DEFAULT_CONTEXT,
    };
  }

  const dateKey = slotKey.slice(0, 10);
  const contextKey = normalizePersistedContextKey(slotKey.slice(11));
  return { dateKey, contextKey };
}

function normalizePersistedInteractionType(value: unknown): InteractionType {
  return value === 'amplify' || value === 'contrast' || value === 'balance'
    ? value
    : 'balance';
}

function toPersistedDisplayCard(card: DisplayCard | null | undefined) {
  if (!card) return null;
  return {
    fragrance_id: card.fragrance_id ?? '',
    name: card.name ?? '',
    family: card.family ?? '',
    reason: card.reason ?? '',
    brand: card.brand ?? '',
    image_url: card.image_url ?? null,
    notes: sanitizeTokenSource(card.notes),
    accords: sanitizeTokenSource(card.accords),
    reason_chip_label: card.reason_chip_label ?? null,
    reason_chip_explanation: card.reason_chip_explanation ?? null,
    isHero: !!card.isHero,
  };
}

function fromPersistedDisplayCard(raw: any): DisplayCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const fragrance_id = typeof raw.fragrance_id === 'string' ? raw.fragrance_id.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!fragrance_id || !name) return null;
  return {
    fragrance_id,
    name,
    family: typeof raw.family === 'string' ? raw.family : '',
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    brand: typeof raw.brand === 'string' ? raw.brand : '',
    image_url: readBottleImageUrlFromObject(raw),
    notes: sanitizeTokenSource(raw.notes),
    accords: sanitizeTokenSource(raw.accords),
    reason_chip_label: typeof raw.reason_chip_label === 'string' ? raw.reason_chip_label : null,
    reason_chip_explanation: typeof raw.reason_chip_explanation === 'string' ? raw.reason_chip_explanation : null,
    isHero: raw.isHero === true,
  };
}

function toPersistedLayerModeSnapshot(
  layer: NonNullable<LayerModes[LayerMood]> | null | undefined,
): PersistedLayerModeSnapshot | null {
  if (!layer?.id || !layer?.name) return null;
  return {
    id: layer.id,
    name: layer.name ?? '',
    brand: layer.brand ?? '',
    family_key: layer.family_key ?? '',
    image_url: layer.image_url ?? null,
    notes: sanitizeTokenSource(layer.notes),
    accords: sanitizeTokenSource(layer.accords),
    interactionType: normalizePersistedInteractionType(layer.interactionType),
    reason: layer.reason ?? '',
    why_it_works: layer.why_it_works ?? '',
    projection: typeof layer.projection === 'number' ? layer.projection : null,
    ratio_hint: layer.ratio_hint ?? '',
    application_style: layer.application_style ?? '',
    placement_hint: layer.placement_hint ?? '',
    spray_guidance: layer.spray_guidance ?? '',
    spray_pattern: (layer as any).spray_pattern ?? null,
    spray_pattern_key: (layer as any).spray_pattern_key ?? (layer as any).sprayPatternKey ?? null,
    spray_pattern_name: (layer as any).spray_pattern_name ?? (layer as any).sprayPatternName ?? null,
    halo: (layer as any).halo ?? null,
    trail: (layer as any).trail ?? null,
    anchor_sprays: readPositiveLayerCount((layer as any).anchor_sprays, (layer as any).anchorSprays),
    layer_sprays: readPositiveLayerCount((layer as any).layer_sprays, (layer as any).layerSprays),
    spray_map: (layer as any).spray_map ?? (layer as any).sprayMap ?? null,
    zone_spray_map: (layer as any).zone_spray_map ?? (layer as any).zoneSprayMap ?? null,
  };
}

function clonePersistableUnknownArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    try {
      return JSON.parse(JSON.stringify(entry));
    } catch {
      return entry;
    }
  });
}

function toPersistedOracleAlternate(alternate: OracleAlternate | null | undefined) {
  if (!alternate?.fragrance_id || !alternate?.name) return null;
  return {
    fragrance_id: alternate.fragrance_id,
    name: alternate.name,
    family: alternate.family ?? '',
    reason: alternate.reason ?? '',
    brand: alternate.brand ?? '',
    notes: sanitizeTokenSource(alternate.notes),
    accords: sanitizeTokenSource(alternate.accords),
    reason_chip_label: alternate.reason_chip_label ?? null,
    reason_chip_explanation: alternate.reason_chip_explanation ?? null,
  };
}

function fromPersistedOracleAlternate(raw: any): OracleAlternate | null {
  if (!raw || typeof raw !== 'object') return null;
  const fragrance_id = typeof raw.fragrance_id === 'string' ? raw.fragrance_id.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!fragrance_id || !name) return null;
  return {
    fragrance_id,
    name,
    family: typeof raw.family === 'string' ? raw.family : '',
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    brand: typeof raw.brand === 'string' ? raw.brand : '',
    notes: sanitizeTokenSource(raw.notes),
    accords: sanitizeTokenSource(raw.accords),
    reason_chip_label: typeof raw.reason_chip_label === 'string' ? raw.reason_chip_label : null,
    reason_chip_explanation: typeof raw.reason_chip_explanation === 'string' ? raw.reason_chip_explanation : null,
  };
}

function toPersistedResolvedHeroRailSnapshot(value: any): PersistedResolvedHeroRailSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  return {
    familyLabel: typeof value.familyLabel === 'string' ? value.familyLabel : '',
    familyColor: typeof value.familyColor === 'string' ? value.familyColor : '#888',
    reasonChip: value.reasonChip && typeof value.reasonChip === 'object'
      ? {
          label: typeof value.reasonChip.label === 'string' ? value.reasonChip.label : '',
          explanation: typeof value.reasonChip.explanation === 'string'
            ? value.reasonChip.explanation
            : null,
        }
      : null,
    tokens: clonePersistableUnknownArray(value.tokens),
  };
}

function fromPersistedResolvedHeroRailSnapshot(value: any): PersistedResolvedHeroRailSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const familyColor = typeof value.familyColor === 'string' && value.familyColor.trim().length > 0
    ? value.familyColor
    : '#888';
  const reasonChip = value.reasonChip && typeof value.reasonChip === 'object'
    ? {
        label: typeof value.reasonChip.label === 'string' ? value.reasonChip.label : '',
        explanation: typeof value.reasonChip.explanation === 'string'
          ? value.reasonChip.explanation
          : null,
      }
    : null;
  return {
    familyLabel: typeof value.familyLabel === 'string' ? value.familyLabel : '',
    familyColor,
    reasonChip: reasonChip?.label ? reasonChip : null,
    tokens: clonePersistableUnknownArray(value.tokens),
  };
}

function toPersistedResolvedCurrentCardSnapshot(value: any): PersistedResolvedCurrentCardSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const fragrance_id = typeof value.fragrance_id === 'string' ? value.fragrance_id.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!fragrance_id || !name) return null;
  return {
    fragrance_id,
    name,
    brand: typeof value.brand === 'string' ? value.brand : '',
    family: typeof value.family === 'string' ? value.family : '',
    image_url: readBottleImageUrlFromObject(value),
    familyLabel: typeof value.familyLabel === 'string' ? value.familyLabel : '',
    familyColor: typeof value.familyColor === 'string' ? value.familyColor : '#888',
    reason_chip_label: typeof value.reason_chip_label === 'string' ? value.reason_chip_label : null,
    reason_chip_explanation: typeof value.reason_chip_explanation === 'string'
      ? value.reason_chip_explanation
      : null,
    notes: sanitizeTokenSource(value.notes),
    accords: sanitizeTokenSource(value.accords),
    layer: toPersistedLayerModeSnapshot(value.layer),
    layerFamilyKey: typeof value.layerFamilyKey === 'string' ? value.layerFamilyKey : '',
    layerFamilyLabel: typeof value.layerFamilyLabel === 'string' ? value.layerFamilyLabel : '',
    layerTokens: clonePersistableUnknownArray(value.layerTokens),
    layerModes: {
      balance: toPersistedLayerModeSnapshot(value.layerModes?.balance),
      bold: toPersistedLayerModeSnapshot(value.layerModes?.bold),
      smooth: toPersistedLayerModeSnapshot(value.layerModes?.smooth),
      wild: toPersistedLayerModeSnapshot(value.layerModes?.wild),
    },
    alternates: Array.isArray(value.alternates)
      ? value.alternates
          .map((alternate: any) => fromPersistedOracleAlternate(toPersistedOracleAlternate(alternate)))
          .filter((alternate: OracleAlternate | null): alternate is OracleAlternate => !!alternate)
      : [],
    selectedMode: normalizePersistedMood(value.selectedMode),
    resolvedHeroRail: toPersistedResolvedHeroRailSnapshot(value.resolvedHeroRail),
    visibleCardId: typeof value.visibleCardId === 'string' && value.visibleCardId.trim().length > 0
      ? value.visibleCardId
      : fragrance_id,
    isHeroCard: value.isHeroCard === true,
  };
}

function fromPersistedResolvedCurrentCardSnapshot(value: any): PersistedResolvedCurrentCardSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const fragrance_id = typeof value.fragrance_id === 'string' ? value.fragrance_id.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!fragrance_id || !name) return null;
  return {
    fragrance_id,
    name,
    brand: typeof value.brand === 'string' ? value.brand : '',
    family: typeof value.family === 'string' ? value.family : '',
    image_url: readBottleImageUrlFromObject(value),
    familyLabel: typeof value.familyLabel === 'string' ? value.familyLabel : '',
    familyColor: typeof value.familyColor === 'string' ? value.familyColor : '#888',
    reason_chip_label: typeof value.reason_chip_label === 'string' ? value.reason_chip_label : null,
    reason_chip_explanation: typeof value.reason_chip_explanation === 'string'
      ? value.reason_chip_explanation
      : null,
    notes: sanitizeTokenSource(value.notes),
    accords: sanitizeTokenSource(value.accords),
    layer: fromPersistedLayerModeSnapshot(value.layer),
    layerFamilyKey: typeof value.layerFamilyKey === 'string' ? value.layerFamilyKey : '',
    layerFamilyLabel: typeof value.layerFamilyLabel === 'string' ? value.layerFamilyLabel : '',
    layerTokens: clonePersistableUnknownArray(value.layerTokens),
    layerModes: {
      balance: fromPersistedLayerModeSnapshot(value.layerModes?.balance),
      bold: fromPersistedLayerModeSnapshot(value.layerModes?.bold),
      smooth: fromPersistedLayerModeSnapshot(value.layerModes?.smooth),
      wild: fromPersistedLayerModeSnapshot(value.layerModes?.wild),
    },
    alternates: Array.isArray(value.alternates)
      ? value.alternates
          .map((alternate: any) => fromPersistedOracleAlternate(alternate))
          .filter((alternate: OracleAlternate | null): alternate is OracleAlternate => !!alternate)
      : [],
    selectedMode: normalizePersistedMood(value.selectedMode),
    resolvedHeroRail: fromPersistedResolvedHeroRailSnapshot(value.resolvedHeroRail),
    visibleCardId: typeof value.visibleCardId === 'string' && value.visibleCardId.trim().length > 0
      ? value.visibleCardId
      : fragrance_id,
    isHeroCard: value.isHeroCard === true,
  };
}

function fromPersistedLayerModeSnapshot(raw: any): PersistedLayerModeSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!id || !name) return null;
  return {
    id,
    name,
    brand: typeof raw.brand === 'string' ? raw.brand : '',
    family_key: typeof raw.family_key === 'string' ? raw.family_key : '',
    image_url: readBottleImageUrlFromObject(raw),
    notes: sanitizeTokenSource(raw.notes),
    accords: sanitizeTokenSource(raw.accords),
    interactionType: normalizePersistedInteractionType(raw.interactionType),
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    why_it_works: typeof raw.why_it_works === 'string' ? raw.why_it_works : '',
    projection: typeof raw.projection === 'number' ? raw.projection : null,
    ratio_hint: typeof raw.ratio_hint === 'string' ? raw.ratio_hint : '',
    application_style: typeof raw.application_style === 'string' ? raw.application_style : '',
    placement_hint: typeof raw.placement_hint === 'string' ? raw.placement_hint : '',
    spray_guidance: typeof raw.spray_guidance === 'string' ? raw.spray_guidance : '',
    spray_pattern: normalizeLayerSprayPattern(raw),
    spray_pattern_key: typeof raw.spray_pattern_key === 'string' ? raw.spray_pattern_key : null,
    spray_pattern_name: typeof raw.spray_pattern_name === 'string' ? raw.spray_pattern_name : null,
    halo: typeof raw.halo === 'string' ? raw.halo : null,
    trail: typeof raw.trail === 'string' ? raw.trail : null,
    anchor_sprays: readPositiveLayerCount(raw.anchor_sprays, raw.anchorSprays),
    layer_sprays: readPositiveLayerCount(raw.layer_sprays, raw.layerSprays),
    spray_map: raw.spray_map ?? raw.sprayMap ?? null,
    zone_spray_map: raw.zone_spray_map ?? raw.zoneSprayMap ?? null,
  };
}

function areSameLayerModeSnapshots(
  a: PersistedLayerModeSnapshot | null | undefined,
  b: PersistedLayerModeSnapshot | null | undefined,
) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.brand === b.brand &&
    a.family_key === b.family_key &&
    a.image_url === b.image_url &&
    a.interactionType === b.interactionType &&
    a.reason === b.reason &&
    a.why_it_works === b.why_it_works &&
    a.projection === b.projection &&
    a.ratio_hint === b.ratio_hint &&
    a.application_style === b.application_style &&
    a.placement_hint === b.placement_hint &&
    a.spray_guidance === b.spray_guidance &&
    JSON.stringify((a as any).spray_pattern ?? null) === JSON.stringify((b as any).spray_pattern ?? null) &&
    ((a as any).spray_pattern_key ?? null) === ((b as any).spray_pattern_key ?? null) &&
    ((a as any).spray_pattern_name ?? null) === ((b as any).spray_pattern_name ?? null) &&
    ((a as any).halo ?? null) === ((b as any).halo ?? null) &&
    ((a as any).trail ?? null) === ((b as any).trail ?? null) &&
    ((a as any).anchor_sprays ?? null) === ((b as any).anchor_sprays ?? null) &&
    ((a as any).layer_sprays ?? null) === ((b as any).layer_sprays ?? null) &&
    JSON.stringify((a as any).spray_map ?? null) === JSON.stringify((b as any).spray_map ?? null) &&
    JSON.stringify((a as any).zone_spray_map ?? null) === JSON.stringify((b as any).zone_spray_map ?? null) &&
    JSON.stringify(a.notes) === JSON.stringify(b.notes) &&
    JSON.stringify(a.accords) === JSON.stringify(b.accords)
  );
}

function areSameResolvedCurrentCardSnapshots(
  a: PersistedResolvedCurrentCardSnapshot | null | undefined,
  b: PersistedResolvedCurrentCardSnapshot | null | undefined,
) {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function serializeSignedInDayStateForStorage(state: SignedInDayState) {
  const normalizedLockState = normalizePersistedLockState(state.lockState);
  const rawDaisyChainEnabled = state.daisyChainEnabled === true ? true : state.daisyChainEnabled === false ? false : null;
  const normalizedCarryoverMode = normalizePersistedCarryoverTarget(state.carryoverMode);
  const carryoverSourceDateKey = typeof state.carryoverSourceDateKey === 'string' && state.carryoverSourceDateKey.trim().length > 0
    ? state.carryoverSourceDateKey
    : null;
  const carryoverTargetDateKey = typeof state.carryoverTargetDateKey === 'string' && state.carryoverTargetDateKey.trim().length > 0
    ? state.carryoverTargetDateKey
    : null;
  const carryoverContextKey = typeof state.carryoverContextKey === 'string' && state.carryoverContextKey.trim().length > 0
    ? normalizePersistedContextKey(state.carryoverContextKey)
    : null;
  const persistActiveCarryover = rawDaisyChainEnabled === true
    && normalizedCarryoverMode !== 'off'
    && !!carryoverSourceDateKey
    && !!carryoverTargetDateKey;
  const daisyChainEnabled = rawDaisyChainEnabled;
  const carryoverMode = persistActiveCarryover ? normalizePersistedCarryoverTarget(state.carryoverMode) : 'off';
  const carryoverOrigin = persistActiveCarryover ? normalizePersistedCarryoverOrigin(state.carryoverOrigin) : null;
  const carryoverNextDayRole = persistActiveCarryover ? normalizePersistedNextDayRole(state.carryoverNextDayRole) : null;
  const lockedCard = normalizedLockState === 'locked' ? toPersistedDisplayCard(state.lockedCard) : null;
  const lockedLayerCard = normalizedLockState === 'locked' ? toPersistedDisplayCard(state.lockedLayerCard) : null;
  const lockedLayerMode = normalizedLockState === 'locked' ? toPersistedLayerModeSnapshot(state.lockedLayerMode) : null;
  const lockedResolvedCurrentCard = normalizedLockState === 'locked'
    ? toPersistedResolvedCurrentCardSnapshot(state.lockedResolvedCurrentCard)
    : null;

  return {
    lockState: normalizedLockState,
    daisyChainEnabled,
    carryoverMode,
    carryoverOrigin,
    carryoverNextDayRole,
    carryoverSourceDateKey: persistActiveCarryover ? carryoverSourceDateKey : null,
    carryoverTargetDateKey: persistActiveCarryover ? carryoverTargetDateKey : null,
    carryoverContextKey: persistActiveCarryover ? carryoverContextKey : null,
    carryoverSelectedCard: persistActiveCarryover ? toPersistedDisplayCard(state.carryoverSelectedCard) : null,
    resolvedHeroCard: persistActiveCarryover ? toPersistedDisplayCard(state.resolvedHeroCard) : null,
    resolvedLayerCard: persistActiveCarryover ? toPersistedDisplayCard(state.resolvedLayerCard) : null,
    carryoverHeroCard: persistActiveCarryover ? toPersistedDisplayCard(state.carryoverHeroCard) : null,
    carryoverLayerCard: persistActiveCarryover ? toPersistedDisplayCard(state.carryoverLayerCard) : null,
    lockedCard,
    lockedLayerCard,
    lockedLayerMode,
    lockedResolvedCurrentCard,
    lockedContext: normalizedLockState === 'locked' ? normalizePersistedLockedContext(state.lockedContext) : null,
    lockedMood: normalizedLockState === 'locked' ? normalizePersistedMood(state.lockedMood) : 'balance',
    lockedPromotedAltId: normalizedLockState === 'locked' ? (state.lockedPromotedAltId ?? null) : null,
    manualHeroCard: null,
    manualLayerCard: null,
    preferenceMoments: Array.isArray(state.preferenceMoments)
      ? state.preferenceMoments
          .map((moment) => toPersistedPreferenceMoment(moment))
          .filter((moment): moment is NonNullable<typeof moment> => !!moment)
      : [],
  };
}

function deserializeSignedInDayStateFromStorage(raw: any): SignedInDayState {
  const base = createDefaultSignedInDayState();
  if (!raw || typeof raw !== 'object') return base;

  const lockState = normalizePersistedLockState(raw.lockState);
  const rawDaisyChainEnabled = raw.daisyChainEnabled === true ? true : raw.daisyChainEnabled === false ? false : null;
  const carryoverSourceDateKey = typeof raw.carryoverSourceDateKey === 'string' && raw.carryoverSourceDateKey.trim().length > 0
    ? raw.carryoverSourceDateKey
    : null;
  const carryoverTargetDateKey = typeof raw.carryoverTargetDateKey === 'string' && raw.carryoverTargetDateKey.trim().length > 0
    ? raw.carryoverTargetDateKey
    : null;
  const carryoverContextKey = typeof raw.carryoverContextKey === 'string' && raw.carryoverContextKey.trim().length > 0
    ? normalizePersistedContextKey(raw.carryoverContextKey)
    : null;
  const persistedCarryoverAllowed = rawDaisyChainEnabled === true
    && normalizePersistedCarryoverTarget(raw.carryoverMode) !== 'off'
    && !!carryoverSourceDateKey
    && !!carryoverTargetDateKey;
  const daisyChainEnabled = rawDaisyChainEnabled;

  return {
    lockState,
    daisyChainEnabled,
    carryoverMode: persistedCarryoverAllowed ? normalizePersistedCarryoverTarget(raw.carryoverMode) : 'off',
    carryoverOrigin: persistedCarryoverAllowed ? normalizePersistedCarryoverOrigin(raw.carryoverOrigin) : null,
    carryoverNextDayRole: persistedCarryoverAllowed ? normalizePersistedNextDayRole(raw.carryoverNextDayRole) : null,
    carryoverSourceDateKey: persistedCarryoverAllowed ? carryoverSourceDateKey : null,
    carryoverTargetDateKey: persistedCarryoverAllowed ? carryoverTargetDateKey : null,
    carryoverContextKey: persistedCarryoverAllowed ? carryoverContextKey : null,
    carryoverSelectedCard: persistedCarryoverAllowed ? fromPersistedDisplayCard(raw.carryoverSelectedCard) : null,
    resolvedHeroCard: persistedCarryoverAllowed
      ? (fromPersistedDisplayCard(raw.resolvedHeroCard) ?? fromPersistedDisplayCard(raw.carryoverHeroCard))
      : null,
    resolvedLayerCard: persistedCarryoverAllowed
      ? (fromPersistedDisplayCard(raw.resolvedLayerCard) ?? fromPersistedDisplayCard(raw.carryoverLayerCard))
      : null,
    carryoverHeroCard: persistedCarryoverAllowed
      ? (fromPersistedDisplayCard(raw.carryoverHeroCard) ?? fromPersistedDisplayCard(raw.resolvedHeroCard))
      : null,
    carryoverLayerCard: persistedCarryoverAllowed
      ? (fromPersistedDisplayCard(raw.carryoverLayerCard) ?? fromPersistedDisplayCard(raw.resolvedLayerCard))
      : null,
    lockedCard: lockState === 'locked' ? fromPersistedDisplayCard(raw.lockedCard) : null,
    lockedLayerCard: lockState === 'locked' ? fromPersistedDisplayCard(raw.lockedLayerCard) : null,
    lockedLayerMode: lockState === 'locked' ? fromPersistedLayerModeSnapshot(raw.lockedLayerMode) : null,
    lockedResolvedCurrentCard: lockState === 'locked'
      ? fromPersistedResolvedCurrentCardSnapshot(raw.lockedResolvedCurrentCard)
      : null,
    lockedContext: lockState === 'locked' ? normalizePersistedLockedContext(raw.lockedContext) : null,
    lockedMood: lockState === 'locked' ? normalizePersistedMood(raw.lockedMood) : 'balance',
    lockedPromotedAltId: lockState === 'locked' && typeof raw.lockedPromotedAltId === 'string'
      ? raw.lockedPromotedAltId
      : null,
    manualHeroCard: null,
    manualLayerCard: null,
    preferenceMoments: Array.isArray(raw.preferenceMoments)
      ? raw.preferenceMoments
          .map((moment: any) => fromPersistedPreferenceMoment(moment))
          .filter((moment: PersistedPreferenceMoment | null): moment is PersistedPreferenceMoment => !!moment)
      : [],
  };
}

function isPersistableSignedInDayState(state: SignedInDayState): boolean {
  const serialized = serializeSignedInDayStateForStorage(state);
  return (
    serialized.lockState === 'locked'
    || serialized.daisyChainEnabled !== null
    || serialized.carryoverMode !== 'off'
    || serialized.carryoverOrigin !== null
    || serialized.carryoverNextDayRole !== null
    || !!serialized.carryoverSourceDateKey
    || !!serialized.carryoverTargetDateKey
    || !!serialized.carryoverContextKey
    || !!serialized.carryoverSelectedCard
    || !!serialized.carryoverHeroCard
    || !!serialized.carryoverLayerCard
    || !!serialized.lockedCard
    || !!serialized.lockedLayerCard
    || !!serialized.lockedLayerMode
    || !!serialized.lockedResolvedCurrentCard
    || serialized.lockedPromotedAltId !== null
    || (Array.isArray(serialized.preferenceMoments) && serialized.preferenceMoments.length > 0)
  );
}

function hasHydratedRuntimeSignedInDayState(state: SignedInDayState | null | undefined): boolean {
  if (!state) return false;
  return (
    isPersistableSignedInDayState(state)
    || !!state.resolvedHeroCard
    || !!state.resolvedLayerCard
    || !!state.manualHeroCard
    || !!state.manualLayerCard
  );
}

function stableSerializeSignedInDayState(state: SignedInDayState): string {
  return JSON.stringify(serializeSignedInDayStateForStorage(state));
}

function resolveCarryoverSelectedCard(dayState: SignedInDayState | null | undefined): DisplayCard | null {
  if (!dayState || dayState.daisyChainEnabled !== true || dayState.carryoverMode === 'off') return null;
  return dayState.carryoverSelectedCard
    ?? (
      dayState.carryoverMode === 'hero'
        ? (dayState.resolvedHeroCard ?? dayState.carryoverHeroCard)
        : dayState.carryoverMode === 'layer'
          ? (dayState.resolvedLayerCard ?? dayState.carryoverLayerCard)
          : null
    )
    ?? null;
}

function resolveCarryoverNextDayRole(source: SignedInCarryoverTarget): 'main' | 'layer' | null {
  if (source === 'hero') return 'layer';
  if (source === 'layer') return 'main';
  return null;
}

function resolveNextSignedInCarryoverTarget(
  state: {
    enabled: boolean;
    mode: SignedInCarryoverTarget;
    origin: SignedInDayState['carryoverOrigin'];
    selectedCard: DisplayCard | null;
  },
  hasLayer: boolean,
): SignedInCarryoverTarget {
  if (!state.enabled || state.mode === 'off' || !state.selectedCard) {
    return 'hero';
  }

  if (state.mode === 'hero') {
    return hasLayer ? 'layer' : 'off';
  }

  return 'off';
}

function getSignedInCarryoverFeedbackLabel(target: SignedInCarryoverTarget): string {
  if (target === 'hero') return 'Carry main';
  if (target === 'layer') return 'Carry layer';
  return 'Off';
}

function resolveVerifiedPredecessorBaton(
  dayState: SignedInDayState | null | undefined,
  expectedTargetDateKey: string,
  expectedContextKey: string,
): SignedInVerifiedPredecessorBaton | null {
  if (!dayState || dayState.daisyChainEnabled !== true) return null;
  if (!dayState.carryoverSourceDateKey || !dayState.carryoverTargetDateKey) return null;
  if (dayState.carryoverTargetDateKey !== expectedTargetDateKey) return null;
  if (dayState.carryoverSourceDateKey !== getPreviousDateKey(expectedTargetDateKey)) return null;

  const normalizedExpectedContextKey = normalizePersistedContextKey(expectedContextKey);
  if (dayState.carryoverContextKey && dayState.carryoverContextKey !== normalizedExpectedContextKey) {
    return null;
  }

  const selectedSource = dayState.carryoverMode === 'hero' || dayState.carryoverMode === 'layer'
    ? dayState.carryoverMode
    : 'off';
  if (selectedSource === 'off') return null;

  const nextDayRole = dayState.carryoverNextDayRole ?? resolveCarryoverNextDayRole(selectedSource);
  if (!nextDayRole) return null;

  const previousHeroCard = dayState.resolvedHeroCard ?? dayState.carryoverHeroCard ?? null;
  const previousLayerCard = dayState.resolvedLayerCard ?? dayState.carryoverLayerCard ?? null;
  const carriedCard = selectedSource === 'hero'
    ? (previousHeroCard ?? dayState.carryoverSelectedCard)
    : (previousLayerCard ?? dayState.carryoverSelectedCard);

  if (!carriedCard) return null;
  if (isTemporarilySuppressedRotationFragrance(carriedCard)) return null;

  return {
    selectedSource,
    carriedCard,
    nextDayRole,
    previousHeroCard,
    previousLayerCard,
    excludedPreviousCard: selectedSource === 'hero' ? previousLayerCard : previousHeroCard,
  };
}

function resolveSignedInLockedTruth(
  dayState: SignedInDayState | null | undefined,
): SignedInResolvedLockTruth | null {
  if (!dayState || dayState.lockState !== 'locked' || !dayState.lockedCard) return null;

  const lockedMood = normalizePersistedMood(dayState.lockedMood);
  const lockedLayerMode = dayState.lockedLayerMode
    ?? toLayerModeFromDisplayCard(dayState.lockedLayerCard, lockedMood);

  return {
    lockedCard: dayState.lockedCard,
    lockedLayerCard: dayState.lockedLayerCard ?? null,
    lockedLayerMode,
    lockedResolvedCurrentCard: dayState.lockedResolvedCurrentCard ?? null,
    lockedContext: normalizePersistedLockedContext(dayState.lockedContext),
    lockedMood,
    lockedPromotedAltId: dayState.lockedPromotedAltId ?? null,
  };
}

function buildLockedMainCardRender(
  lockedTruth: SignedInResolvedLockTruth,
): {
  activeHero: DisplayCard;
  heroFamilyKey: string;
  heroFamilyColor: string;
  heroFamilyLabel: string;
  activeHeroTokens: any[];
  activeReasonChip: { label: string; explanation: string | null } | null;
  activeLayer: PersistedLayerModeSnapshot | null;
  activeLayerFamilyKey: string;
  activeLayerFamilyLabel: string;
  activeLayerTokens: any[];
  layerModes: LayerModes;
  selectedMode: LayerMood;
  visibleCardId: string;
  isLocked: true;
  activeAlternates: OracleAlternate[];
  reasonChipLabel: string | null;
  reasonChipExplanation: string | null;
  queuedSurfacesReady: true;
  duplicateResolution: {
    kind: 'none';
    replacementMain: null;
    preferredLayerIndex: null;
  };
  resolvedCurrentCard: PersistedResolvedCurrentCardSnapshot & { resolvedHeroRail: PersistedResolvedHeroRailSnapshot | null };
} | null {
  const snapshot = lockedTruth.lockedResolvedCurrentCard;
  if (!snapshot) return null;

  const heroFamilyKey = snapshot.family || lockedTruth.lockedCard.family || '';
  const heroFamilyColor = snapshot.resolvedHeroRail?.familyColor
    ?? snapshot.familyColor
    ?? (heroFamilyKey ? (FAMILY_COLORS[heroFamilyKey] ?? '#888') : '#888');
  const heroFamilyLabel = snapshot.resolvedHeroRail?.familyLabel
    ?? snapshot.familyLabel
    ?? (heroFamilyKey ? (FAMILY_LABELS[heroFamilyKey] ?? heroFamilyKey.toUpperCase()) : '');
  const activeHero: DisplayCard = {
    ...lockedTruth.lockedCard,
    family: heroFamilyKey,
    image_url: snapshot.image_url ?? lockedTruth.lockedCard.image_url ?? null,
    notes: sanitizeTokenSource(snapshot.notes),
    accords: sanitizeTokenSource(snapshot.accords),
    reason_chip_label: snapshot.reason_chip_label ?? lockedTruth.lockedCard.reason_chip_label ?? null,
    reason_chip_explanation: snapshot.reason_chip_explanation ?? lockedTruth.lockedCard.reason_chip_explanation ?? null,
    isHero: snapshot.isHeroCard || lockedTruth.lockedCard.isHero,
  };
  const activeLayer = lockedTruth.lockedLayerMode ?? snapshot.layer ?? toLayerModeFromDisplayCard(lockedTruth.lockedLayerCard, lockedTruth.lockedMood);
  const activeAlternates = filterAlternatesAgainstVisibleScents(
    Array.isArray(snapshot.alternates) ? snapshot.alternates : [],
    (alternate) => alternate,
    [activeHero, activeLayer],
  );
  const resolvedCurrentCard = {
    ...snapshot,
    notes: sanitizeTokenSource(snapshot.notes),
    accords: sanitizeTokenSource(snapshot.accords),
    layer: activeLayer ?? null,
    layerModes: snapshot.layerModes ?? { balance: null, bold: null, smooth: null, wild: null },
    alternates: activeAlternates,
    selectedMode: lockedTruth.lockedMood,
    resolvedHeroRail: snapshot.resolvedHeroRail ?? null,
  };

  return {
    activeHero,
    heroFamilyKey,
    heroFamilyColor,
    heroFamilyLabel,
    activeHeroTokens: Array.isArray(snapshot.resolvedHeroRail?.tokens) ? snapshot.resolvedHeroRail.tokens : [],
    activeReasonChip: snapshot.resolvedHeroRail?.reasonChip ?? null,
    activeLayer: activeLayer ?? null,
    activeLayerFamilyKey: snapshot.layerFamilyKey ?? activeLayer?.family_key ?? '',
    activeLayerFamilyLabel: snapshot.layerFamilyLabel
      || (snapshot.layerFamilyKey ? (FAMILY_LABELS[snapshot.layerFamilyKey] ?? snapshot.layerFamilyKey.toUpperCase()) : ''),
    activeLayerTokens: Array.isArray(snapshot.layerTokens) ? snapshot.layerTokens : [],
    layerModes: resolvedCurrentCard.layerModes,
    selectedMode: lockedTruth.lockedMood,
    visibleCardId: snapshot.visibleCardId || activeHero.fragrance_id,
    isLocked: true,
    activeAlternates,
    reasonChipLabel: snapshot.resolvedHeroRail?.reasonChip?.label ?? snapshot.reason_chip_label ?? null,
    reasonChipExplanation: snapshot.resolvedHeroRail?.reasonChip?.explanation ?? snapshot.reason_chip_explanation ?? null,
    queuedSurfacesReady: true,
    duplicateResolution: {
      kind: 'none',
      replacementMain: null,
      preferredLayerIndex: null,
    },
    resolvedCurrentCard,
  };
}

function resolveSignedInDayDecision(
  currentDayState: SignedInDayState,
  hasCurrentDayState: boolean,
  previousDayState: SignedInDayState,
  oraclePick: OraclePick | null | undefined,
  defaultMood: LayerMood,
  currentDateKey: string,
  currentContextKey: string,
): SignedInResolvedDayDecision {
  const oracleVisibleCard = oraclePick ? heroToDisplay(oraclePick) : null;
  const eligibleOracleVisibleCard = oracleVisibleCard && !isTemporarilySuppressedRotationFragrance(oracleVisibleCard)
    ? oracleVisibleCard
    : null;
  const lockedTruth = resolveSignedInLockedTruth(currentDayState);
  if (lockedTruth) {
    return {
      visibleCard: lockedTruth.lockedCard,
      forcedLayerCarryCard: lockedTruth.lockedLayerCard,
      selectedMood: lockedTruth.lockedMood ?? defaultMood,
      promotedAltId: lockedTruth.lockedPromotedAltId,
      source: 'locked',
    };
  }

  if (currentDayState.manualHeroCard) {
    return {
      visibleCard: currentDayState.manualHeroCard,
      forcedLayerCarryCard: currentDayState.manualLayerCard,
      selectedMood: defaultMood,
      promotedAltId: null,
      source: 'manual',
    };
  }

  if (hasCurrentDayState && currentDayState.daisyChainEnabled === false) {
    return {
      visibleCard: eligibleOracleVisibleCard,
      forcedLayerCarryCard: null,
      selectedMood: defaultMood,
      promotedAltId: null,
      source: 'oracle',
    };
  }

  const predecessorBaton = resolveVerifiedPredecessorBaton(previousDayState, currentDateKey, currentContextKey);

  if (predecessorBaton?.nextDayRole === 'main') {
    return {
      visibleCard: predecessorBaton.carriedCard,
      forcedLayerCarryCard: null,
      selectedMood: defaultMood,
      promotedAltId: null,
      source: 'carryover-main',
    };
  }

  if (predecessorBaton?.nextDayRole === 'layer') {
    return {
      visibleCard: eligibleOracleVisibleCard,
      forcedLayerCarryCard: predecessorBaton.carriedCard,
      selectedMood: defaultMood,
      promotedAltId: null,
      source: 'carryover-layer',
    };
  }

  return {
    visibleCard: eligibleOracleVisibleCard,
    forcedLayerCarryCard: null,
    selectedMood: defaultMood,
    promotedAltId: null,
    source: 'oracle',
  };
}

function toDisplayCardFromResolvedCurrentCard(card: any | null | undefined): DisplayCard | null {
  if (!card?.fragrance_id || !card?.name) return null;
  return {
    fragrance_id: card.fragrance_id,
    name: card.name ?? '',
    family: card.family ?? '',
    reason: card.reason ?? '',
    brand: card.brand ?? '',
    image_url: card.image_url ?? null,
    notes: Array.isArray(card.notes) ? card.notes : [],
    accords: Array.isArray(card.accords) ? card.accords : [],
    reason_chip_label: card.reason_chip_label ?? null,
    reason_chip_explanation: card.reason_chip_explanation ?? null,
    isHero: !!card.isHeroCard,
  };
}

function toDisplayCardFromLayerMode(layer: any | null | undefined): DisplayCard | null {
  const fragranceId = layer?.id ?? layer?.fragrance_id ?? layer?.layer_fragrance_id ?? null;
  if (!fragranceId || !layer?.name) return null;
  return {
    fragrance_id: fragranceId,
    name: layer.name ?? '',
    family: layer.family_key ?? layer.family ?? '',
    reason: layer.reason ?? layer.why_it_works ?? '',
    brand: layer.brand ?? layer.layer_brand ?? '',
    image_url: layer.image_url ?? null,
    notes: Array.isArray(layer.notes) ? layer.notes : [],
    accords: Array.isArray(layer.accords) ? layer.accords : [],
    reason_chip_label: null,
    reason_chip_explanation: null,
    isHero: false,
  };
}

function toLayerModeFromDisplayCard(
  card: DisplayCard | null | undefined,
  mood: LayerMood,
): NonNullable<LayerModes[LayerMood]> | null {
  if (!card?.fragrance_id || !card?.name) return null;
  return {
    id: card.fragrance_id,
    name: card.name,
    brand: card.brand ?? '',
    family_key: card.family ?? '',
    image_url: card.image_url ?? null,
    notes: Array.isArray(card.notes) ? card.notes : [],
    accords: Array.isArray(card.accords) ? card.accords : [],
    interactionType: mood,
    reason: card.reason ?? '',
    why_it_works: card.reason ?? '',
    projection: null,
    ratio_hint: '',
    application_style: '',
    placement_hint: '',
    spray_guidance: '',
  } as any;
}

function buildManualLayerModesFromDisplayCard(
  card: DisplayCard | null | undefined,
): LayerModes {
  return {
    balance: toLayerModeFromDisplayCard(card, 'balance'),
    bold: toLayerModeFromDisplayCard(card, 'bold'),
    smooth: toLayerModeFromDisplayCard(card, 'smooth'),
    wild: toLayerModeFromDisplayCard(card, 'wild'),
  };
}

function findFirstUniqueLayerModeCandidate(
  layerBlock: any,
  mood: LayerMood,
  against: { fragrance_id?: string | null; id?: string | null; name?: string | null; brand?: string | null } | null | undefined,
): { index: number; layer: NonNullable<LayerModes[LayerMood]> } | null {
  if (!layerBlock) return null;

  const stack = Array.isArray(layerBlock.layers) ? layerBlock.layers : [layerBlock];
  for (let index = 0; index < stack.length; index += 1) {
    const candidate = v6LayerToLayerMode(stack[index], mood);
    if (!candidate) continue;
    if (!isSameFragranceIdentity(candidate, against)) {
      return { index, layer: candidate };
    }
  }

  return null;
}

function findFirstAllowedLayerModeCandidate(
  layerBlock: any,
  mood: LayerMood,
  excluded: Array<{ fragrance_id?: string | null; id?: string | null; name?: string | null; brand?: string | null } | null | undefined>,
): { index: number; layer: NonNullable<LayerModes[LayerMood]> } | null {
  if (!layerBlock) return null;

  const stack = Array.isArray(layerBlock.layers) ? layerBlock.layers : [layerBlock];
  for (let index = 0; index < stack.length; index += 1) {
    const candidate = v6LayerToLayerMode(stack[index], mood);
    if (!candidate) continue;
    if (excluded.some((blocked) => isSameFragranceIdentity(candidate, blocked))) continue;
    return { index, layer: candidate };
  }

  return null;
}

/* ------------------------------------------------------------------
 * OdaraMenuDestination — Profile / Planner / Settings pages
 * Inherits ODARA home visual language: dark atmosphere, restrained
 * glow, grouped inset blocks, calm hierarchy. Not a generic settings
 * clone.
 * ------------------------------------------------------------------ */
type OdaraMenuPage = 'profile' | 'planner' | 'settings' | 'collection';
type OdaraMenuRootPage = Exclude<OdaraMenuPage, 'collection'>;

interface OdaraMenuRow {
  label: string;
  hint?: string;
}
interface OdaraMenuGroup {
  eyebrow?: string;
  emphasis?: boolean;
  rows: OdaraMenuRow[];
}

const ODARA_MENU_PAGE_CONFIG: Record<OdaraMenuRootPage, { title: string; subtitle: string; groups: OdaraMenuGroup[] }> = {
  profile: {
    title: 'Profile',
    subtitle: 'Your live wardrobe',
    groups: [
      {
        eyebrow: 'Dossier',
        emphasis: true,
        rows: [
          { label: 'Collection' },
          { label: 'Collection Coverage' },
        ],
      },
      {
        eyebrow: 'Library',
        rows: [
          { label: 'Saved' },
          { label: 'Scent History' },
          { label: 'Preferences' },
        ],
      },
    ],
  },
  planner: {
    title: 'Planner',
    subtitle: 'Forecast and intention',
    groups: [
      {
        eyebrow: 'Forecast',
        emphasis: true,
        rows: [{ label: 'This Week' }],
      },
      {
        eyebrow: 'Controls',
        rows: [
          { label: 'Locked Days' },
          { label: 'Daisy Chain' },
        ],
      },
    ],
  },
  settings: {
    title: 'Settings',
    subtitle: 'App and account',
    groups: [
      {
        rows: [
          { label: 'Help' },
          { label: 'Feedback' },
        ],
      },
      {
        rows: [
          { label: 'App Settings' },
          { label: 'Account' },
        ],
      },
    ],
  },
};

/* Shared chrome for menu destination pages — back + ODARA wordmark + title. */
const OdaraDestinationChrome: React.FC<{
  title?: string;
  eyebrow?: string;
  onClose: () => void;
  onHome?: () => void;
  onSearch?: () => void;
  centerHeader?: boolean;
  children: React.ReactNode;
}> = ({ title, eyebrow, onClose, onHome, onSearch, centerHeader, children }) => (
  <div
    className="fixed inset-0 z-[60] overflow-y-auto"
    style={{
      background:
        'radial-gradient(120% 80% at 50% -10%, rgba(28,26,32,0.92) 0%, rgba(10,10,12,0.96) 55%, rgba(6,6,8,0.98) 100%)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      fontFamily: "'Geist Sans', system-ui, sans-serif",
    }}
    role="dialog"
    aria-label={title || eyebrow || 'VESPER'}
  >
    <div
      className="mx-auto flex w-full max-w-md flex-col px-4 pb-12"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
    >
      <div className="relative mb-5 flex items-center justify-between min-h-[40px]">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center text-foreground/70 transition-colors hover:text-foreground/95"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Go to Today's Pick"
          onClick={onHome ?? onClose}
          className="absolute left-1/2 -translate-x-1/2 rounded-full px-3 py-2 text-center text-[19px] font-semibold uppercase tracking-[0.46em] text-foreground/95 transition-colors hover:text-[#f8e5b9] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/22"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          VESPER
        </button>
        {onSearch ? (
          <button
            type="button"
            aria-label="Search fragrances"
            onClick={onSearch}
            className="flex h-10 w-10 items-center justify-center text-foreground/70 transition-colors hover:text-foreground/95"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </button>
        ) : (
          <div className="h-10 w-10" />
        )}
      </div>
      {(eyebrow || title) && (
        <div className={`${title ? 'mb-6' : 'mb-4'} px-1 ${centerHeader ? 'text-center' : ''}`}>
          {eyebrow && (
            <div className={`${title ? 'mb-1.5' : ''} text-[10px] font-medium uppercase tracking-[0.36em] text-foreground/40`}>
              {eyebrow}
            </div>
          )}
          {title && (
            <h1
              className="text-[28px] leading-[1.05] text-foreground/95"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: '-0.01em' }}
            >
              {title}
            </h1>
          )}
        </div>
      )}
      {children}
    </div>
  </div>
);

const OdaraInsetGroup: React.FC<{
  eyebrow?: string;
  emphasis?: boolean;
  children: React.ReactNode;
}> = ({ eyebrow, emphasis, children }) => {
  const insetVisual = getOdaraGlassCardVisualRecipe(DEFAULT_TINT, emphasis ? 'hero' : 'collection');

  return (
  <div>
    {eyebrow && (
      <div className="mb-2 px-2 text-[10px] font-medium uppercase tracking-[0.32em] text-foreground/40">
        {eyebrow}
      </div>
    )}
    <div
      className="relative overflow-hidden rounded-[20px]"
      style={{
        ...insetVisual.surfaceStyle,
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
      }}
    >
      <div className={insetVisual.atmosphereClassName} style={{ ...insetVisual.atmosphereStyle, opacity: emphasis ? 0.2 : 0.14 }} />
      <div className="relative z-[1]">
      {children}
      </div>
    </div>
  </div>
  );
};

const OdaraInsetRow: React.FC<{
  label: string;
  hint?: string;
  emphasis?: boolean;
  isFirst?: boolean;
  onClick?: () => void;
}> = ({ label, hint, emphasis, isFirst, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex w-full items-center justify-between px-4 py-3.5 text-left transition-colors hover:bg-white/[0.03] active:bg-white/[0.05]"
    style={{ borderTop: isFirst ? 'none' : '1px solid rgba(255,255,255,0.05)' }}
  >
    <div className="flex min-w-0 flex-col">
      <span
        className={`text-[15px] ${emphasis ? 'text-foreground/95' : 'text-foreground/82'}`}
        style={{ letterSpacing: '0.005em' }}
      >
        {label}
      </span>
      {hint && (
        <span className="mt-0.5 text-[11px] text-foreground/40" style={{ letterSpacing: '0.01em' }}>
          {hint}
        </span>
      )}
    </div>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/28">
      <path d="M9 6l6 6-6 6" />
    </svg>
  </button>
);

/* ------------------------------------------------------------------
 * OdaraProfilePage — premium scent dossier
 * ------------------------------------------------------------------ */
type OdaraProfileInsight = {
  value: string | null;
  confidence: string | null;
  source: string | null;
  empty_reason: string | null;
};

type OdaraProfileDossierPayload = {
  profile_contract_version: string;
  surface_type: 'signed_in' | 'guest';
  computed_at: string;
  profile_identity: {
    display_name: string | null;
    initials: string | null;
    status_label: string | null;
  };
  collection_summary: {
    bottle_count: number;
    source: string | null;
    enough_data: boolean;
    empty_reason: string | null;
  };
  family_balance: {
    dominant_family: string | null;
    dominant_family_key: string | null;
    family_counts: Array<{ family_key: string; label: string; count: number; pct: number; family_color_token?: string | null }>;
    coverage_copy: string | null;
    enough_data: boolean;
    empty_reason: string | null;
  };
  insights: {
    lean: OdaraProfileInsight;
    texture: OdaraProfileInsight;
    dominant_family: OdaraProfileInsight;
    layering: OdaraProfileInsight;
    day_night: OdaraProfileInsight;
    signature_gravity: OdaraProfileInsight;
  };
  library: {
    collection_count: number;
    saved_count: number;
    history_count: number;
    recipes_count: number;
    liked_count?: number;
    loved_count?: number;
    wear_more_count?: number;
    favorite_count?: number;
    retired_count?: number;
    preference_count?: number;
    saved_empty_reason: string | null;
    history_empty_reason: string | null;
  };
  preference_summary?: {
    liked_count: number;
    loved_count: number;
    wear_more_count?: number;
    favorite_count?: number;
    retired_count?: number;
    preference_count: number;
    favorite_lane: string | null;
    favorite_lane_confidence: string | null;
    favorite_lane_empty_reason: string | null;
    house_gravity: string | null;
    house_gravity_confidence: string | null;
    house_gravity_empty_reason: string | null;
  };
  mode_context_summary?: {
    mode_lock_counts: Record<string, number>;
    context_lock_counts: Record<string, number>;
    most_locked_mode: string | null;
    most_locked_context: string | null;
    enough_data: boolean;
    empty_reason: string | null;
  };
  data_quality: {
    has_collection: boolean;
    has_history: boolean;
    has_wear_trials: boolean;
    has_saved: boolean;
    has_preferences?: boolean;
    has_guest_collection: boolean;
  };
};

type OdaraProfileSavedItemKind = 'saved_recipe' | 'saved_layer_combo' | 'saved_layer';

type OdaraProfileSavedItemPayload = {
  item_kind: OdaraProfileSavedItemKind;
  item_id: string;
  title: string | null;
  subtitle: string | null;
  created_at: string | null;
  updated_at: string | null;
  wear_date: string | null;
  context_key: string | null;
  ratio_a: number | null;
  ratio_b: number | null;
  application_style: string | null;
  notes: string | null;
  liked: boolean | null;
  main_fragrance_id: string | null;
  layer_fragrance_id: string | null;
  main_name: string | null;
  layer_name: string | null;
  main_brand: string | null;
  layer_brand: string | null;
  mode: string | null;
  source_table: string | null;
};

type OdaraProfileSavedItemsPayload = {
  saved_item_contract_version: string;
  items: OdaraProfileSavedItemPayload[];
};

type OdaraCollectionPreferenceState = 'neutral' | 'liked' | 'loved' | 'not_for_me' | 'disliked';

type OdaraCollectionItem = {
  fragrance_id: string | null;
  name: string | null;
  brand: string | null;
  family_key: string | null;
  family_label: string | null;
  family_color_token?: string | null;
  wardrobe_role_key?: string | null;
  wardrobe_role_label?: string | null;
  role_confidence?: string | null;
  role_source?: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  collection_status: string | null;
  primary_season?: string | null;
  collection_created_at?: string | null;
  collection_updated_at?: string | null;
  preference_state: OdaraCollectionPreferenceState;
  rating?: number | null;
  wear_more?: boolean;
  favorite?: boolean;
  retired?: boolean;
  is_rated?: boolean;
  default_rank?: number | null;
};

type OdaraCollectionPayload = {
  collection_contract_version: string;
  surface_type: 'signed_in' | 'guest';
  read_only?: boolean;
  items: OdaraCollectionItem[];
  summary: {
    owned_count: number;
    signature_count?: number;
    liked_count: number;
    loved_count: number;
    rated_count?: number;
    wear_more_count?: number;
    favorite_count?: number;
    retired_count?: number;
    preference_count: number;
  };
  empty_reason: string | null;
};

type OdaraCollectionRatingWriteResult = {
  fragrance_id: string;
  rating: number;
  rating_source: string | null;
  rating_context: string | null;
  updated_at: string | null;
  rated_count: number;
};

type OdaraCollectionRatingReasonWriteResult = {
  fragrance_id: string;
  rating: number;
  reason_key: string;
  rating_source: string | null;
  rating_context: string | null;
  created_at: string | null;
};

type OdaraCollectionRetiredWriteResult = {
  fragrance_id: string;
  retired: boolean;
  favorite?: boolean;
  wear_more?: boolean;
  removed: boolean;
  source: string | null;
  updated_at: string | null;
  favorite_count?: number;
  wear_more_count?: number;
  retired_count: number;
};

type OdaraCollectionFilter =
  | 'all'
  | 'rated'
  | 'unrated'
  | 'retired'
  | 'anchor'
  | 'layer_tool'
  | 'brightener'
  | 'softener'
  | 'bridge'
  | 'accent'
  | 'soloist';
type OdaraCollectionSort = 'role' | 'rating' | 'family' | 'name' | 'brand';

type OdaraWardrobeSurface = 'wardrobe' | 'search' | 'detail' | 'confirmation';
type OdaraWardrobeDetailReturnSurface = 'wardrobe' | 'search';
type OdaraWardrobeRailSource = 'live_database' | 'safe_local_list';
type OdaraWardrobePrimaryStatus = 'owned' | 'wishlist' | 'liked' | 'loved' | 'not_for_me' | 'disliked';
type OdaraCollectionEntryPreset = 'all' | 'saved' | 'liked' | 'favorites' | 'retired' | 'wishlist';
type OdaraWardrobeSortKey = 'az' | 'newest' | 'last_worn';
type OdaraWardrobeSortDirection = 'asc' | 'desc';
type OdaraWardrobeSeasonKey = 'spring' | 'summer' | 'fall' | 'winter' | 'all_year';
type OdaraWardrobeSeasonFilterKey = Exclude<OdaraWardrobeSeasonKey, 'all_year'>;
type OdaraNegativeState = 0 | 1 | 2;
type OdaraPersistedWardrobePreference = {
  fragrance_id: string;
  preference_state: OdaraCollectionPreferenceState;
  heart_state: HeartState;
  negative_state: OdaraNegativeState;
  created_at: number;
  updated_at: number;
};

type OdaraPersistedWardrobeWishlistSignal = {
  fragrance_id: string;
  status: 'would_buy';
  created_at: number;
  updated_at: number;
};

type OdaraWardrobeCatalogItem = {
  fragrance_id: string;
  name: string;
  brand: string | null;
  family_key: string | null;
  family_label: string | null;
  release_year: number | null;
  concentration: string | null;
  notes: string[];
  accords: string[];
  top_notes: string[];
  heart_notes: string[];
  base_notes: string[];
  source_url: string | null;
  source_confidence: string | null;
  primary_season: OdaraWardrobeSeasonKey | null;
  image_url: string | null;
  thumbnail_url: string | null;
};

type OdaraWardrobeSessionSignal = {
  fragrance_id: string;
  name: string;
  brand: string | null;
  family_key: string | null;
  family_label: string | null;
  release_year: number | null;
  concentration: string | null;
  notes: string[];
  accords: string[];
  top_notes: string[];
  heart_notes: string[];
  base_notes: string[];
  source_url: string | null;
  source_confidence: string | null;
  primary_season: OdaraWardrobeSeasonKey | null;
  image_url: string | null;
  thumbnail_url: string | null;
  owned: boolean;
  own_persisted: boolean;
  wishlist: boolean;
  wishlist_persisted: boolean;
  heart_state: HeartState;
  heart_persisted: boolean;
  negative_state: OdaraNegativeState;
  negative_persisted: boolean;
  updated_at: number;
};

type OdaraWardrobeCard = {
  fragrance_id: string;
  name: string;
  brand: string | null;
  family_key: string | null;
  family_label: string | null;
  primary_season: OdaraWardrobeSeasonKey | null;
  image_url: string | null;
  thumbnail_url: string | null;
  item: OdaraWardrobeCatalogItem;
  primary_status: OdaraWardrobePrimaryStatus;
  favorite: boolean;
  retired: boolean;
  collection_created_at: number;
  collection_updated_at: number;
  sort_newest_at: number;
  last_worn_at: number | null;
  last_worn_date_key: string | null;
  wear_count: number;
  is_unworn: boolean;
  local_only: boolean;
};

type OdaraWardrobeWearSnapshot = {
  last_worn_at: number;
  last_worn_date_key: string;
  wear_count: number;
};

type OdaraWardrobeConfirmationState = {
  kind: 'owned' | 'wishlist' | 'heart' | 'negative';
  fragrance_id: string;
  durability: 'persisted' | 'session';
  status_label: string;
};

const ODARA_WARDROBE_ACTION_LABEL_COUNT_STORAGE_KEY = 'odara-wardrobe-action-label-count-v1';
const ODARA_WARDROBE_ONBOARDING_SEEN_STORAGE_KEY = 'odara-wardrobe-onboarding-seen-v1';
const ODARA_WARDROBE_SESSION_SIGNAL_STORAGE_KEY = 'odara-wardrobe-session-signals-v1';

const ODARA_WARDROBE_FALLBACK_BRANDS = [
  'Alexandria Fragrances',
  'Maison Alhambra',
  'Prada',
  'Gucci',
  'Chanel',
  'Dior',
  'Tom Ford',
  'Le Labo',
  'Xerjoff',
] as const;

const ODARA_BRAND_LABEL_OVERRIDES: Record<string, string> = {
  'Alexandria Fragrances': 'Alexandria',
};

const ODARA_WARDROBE_SEASON_FILTER_OPTIONS: Array<{
  value: OdaraWardrobeSeasonFilterKey | null;
  label: string;
}> = [
  { value: null, label: 'All Seasons' },
  { value: 'spring', label: 'Spring' },
  { value: 'summer', label: 'Summer' },
  { value: 'fall', label: 'Fall' },
  { value: 'winter', label: 'Winter' },
];

const ODARA_WARDROBE_SORT_OPTIONS: Array<{
  value: OdaraWardrobeSortKey;
  defaultDirection: OdaraWardrobeSortDirection;
}> = [
  { value: 'az', defaultDirection: 'asc' },
  { value: 'newest', defaultDirection: 'desc' },
  { value: 'last_worn', defaultDirection: 'desc' },
];

function normalizeNegativeState(value: unknown): OdaraNegativeState {
  return value === 2 ? 2 : value === 1 ? 1 : 0;
}

function normalizeStoredHeartState(value: unknown): HeartState {
  return value === 2 ? 2 : value === 1 ? 1 : 0;
}

function normalizeWardrobeSeasonKey(value: unknown): OdaraWardrobeSeasonKey | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'spring') return 'spring';
  if (normalized === 'summer') return 'summer';
  if (normalized === 'fall' || normalized === 'autumn') return 'fall';
  if (normalized === 'winter') return 'winter';
  if (normalized === 'all_year' || normalized === 'all year' || normalized === 'all-season' || normalized === 'all season') {
    return 'all_year';
  }
  return null;
}

function parseOdaraTimestampMs(value: unknown) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseOdaraDateKeyMs(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return 0;
  const parsed = Date.parse(`${normalized}T12:00:00Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function matchesWardrobeSeason(
  primarySeason: OdaraWardrobeSeasonKey | null | undefined,
  selectedSeason: OdaraWardrobeSeasonFilterKey | null,
) {
  if (!selectedSeason) return true;
  if (!primarySeason) return false;
  if (primarySeason === 'all_year') return true;
  return primarySeason === selectedSeason;
}

function getWardrobeSortLabel(
  sortKey: OdaraWardrobeSortKey | null,
  direction: OdaraWardrobeSortDirection,
) {
  if (sortKey === 'az') return direction === 'asc' ? 'A–Z' : 'Z–A';
  if (sortKey === 'newest') return direction === 'desc' ? 'Newest to Oldest' : 'Oldest to Newest';
  if (sortKey === 'last_worn') return direction === 'desc' ? 'Last Worn' : 'Least Recently Worn';
  return null;
}

function formatWardrobeLastWornLabel(lastWornAt: number | null | undefined) {
  if (typeof lastWornAt !== 'number' || lastWornAt <= 0) return null;
  const diffDays = Math.max(0, Math.floor((Date.now() - lastWornAt) / 86400000));
  if (diffDays <= 0) return 'Worn today';
  if (diffDays === 1) return 'Worn 1d ago';
  if (diffDays < 30) return `Worn ${diffDays}d ago`;
  if (diffDays < 90) return `Worn ${Math.max(1, Math.floor(diffDays / 7))}w ago`;
  if (diffDays < 365) return `Worn ${Math.max(1, Math.floor(diffDays / 30))}mo ago`;
  return `Worn ${Math.max(1, Math.floor(diffDays / 365))}y ago`;
}

function formatWardrobeSourceConfidenceLabel(sourceConfidence: string | null | undefined) {
  const normalized = readTrimmedLayerText(sourceConfidence).toLowerCase();
  if (!normalized) return null;
  if (normalized === 'high') return 'High confidence';
  if (normalized === 'medium') return 'Medium confidence';
  if (normalized === 'low') return 'Low confidence';
  return null;
}

function toggleWardrobeSortDirection(direction: OdaraWardrobeSortDirection): OdaraWardrobeSortDirection {
  return direction === 'asc' ? 'desc' : 'asc';
}

function compareOptionalWardrobeTimestamps(
  left: number | null | undefined,
  right: number | null | undefined,
  direction: OdaraWardrobeSortDirection,
) {
  const a = typeof left === 'number' && left > 0 ? left : null;
  const b = typeof right === 'number' && right > 0 ? right : null;
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === 'desc' ? b - a : a - b;
}

function buildFamilyLabel(familyKey: string | null | undefined) {
  return familyKey ? getFamilyLabelText(familyKey) : null;
}

function getWardrobeBrandLabel(brand: string | null | undefined) {
  const normalized = typeof brand === 'string' ? brand.trim() : '';
  if (!normalized) return 'Brand unavailable';
  return ODARA_BRAND_LABEL_OVERRIDES[normalized] ?? normalized;
}

function compareWardrobeBrands(a: string, b: string) {
  return getWardrobeBrandLabel(a).localeCompare(getWardrobeBrandLabel(b), undefined, { sensitivity: 'base' });
}

function scorePreferredBottleImageUrl(url: string | null | undefined) {
  const normalized = typeof url === 'string' ? url.trim().toLowerCase() : '';
  if (!normalized) return Number.NEGATIVE_INFINITY;
  let score = 0;
  if (normalized.endsWith('.webp')) score += 4;
  if (normalized.endsWith('.png')) score += 3;
  if (isLikelyTransparentBottleImageUrl(normalized)) score += 100;
  if (normalized.includes('thumb')) score -= 1;
  if (normalized.includes('placeholder')) score -= 2;
  return score;
}

function isLikelyTransparentBottleImageUrl(url: string | null | undefined) {
  const normalized = typeof url === 'string' ? url.trim().toLowerCase() : '';
  if (!normalized) return false;
  return normalized.includes('transparent')
    || normalized.includes('cutout')
    || normalized.includes('isolated')
    || normalized.includes('no-bg')
    || normalized.includes('nobg')
    || normalized.includes('background-removed')
    || normalized.includes('removed-background')
    || normalized.includes('alpha')
    || (/^https:\/\/cdn\.fragella\.com\/images\//i.test(normalized) && /\.webp(?:$|[?#])/i.test(normalized));
}

function deriveFragellaTransparentBottleImageUrl(url: string | null | undefined) {
  const trimmed = readTrimmedImageUrl(url);
  if (!trimmed) return null;
  if (!/^https:\/\/cdn\.fragella\.com\/images\//i.test(trimmed)) return null;
  if (!/\.jpe?g(?:$|[?#])/i.test(trimmed)) return null;
  return trimmed.replace(/\.jpe?g(?=$|[?#])/i, '.webp');
}

function pushUniqueImageUrl(target: string[], url: string | null | undefined) {
  const resolved = readTrimmedImageUrl(url);
  if (!resolved) return;
  if (target.some((candidate) => candidate.toLowerCase() === resolved.toLowerCase())) return;
  target.push(resolved);
}

function collectWardrobeBottleImageUrls(...sources: unknown[]) {
  const transparentCandidates: string[] = [];
  const regularCandidates: string[] = [];
  const visited = new Set<unknown>();
  const queue = [...sources];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    if (typeof current === 'string') {
      const resolved = readTrimmedImageUrl(current);
      if (isLikelyTransparentBottleImageUrl(resolved)) {
        pushUniqueImageUrl(transparentCandidates, resolved);
      } else {
        pushUniqueImageUrl(regularCandidates, resolved);
      }
      continue;
    }

    if (typeof current !== 'object') continue;

    const transparent = readTransparentBottleImageUrlFromObject(current);
    const regular = readRegularBottleImageUrlFromObject(current);
    pushUniqueImageUrl(transparentCandidates, transparent);
    pushUniqueImageUrl(regularCandidates, regular);

    const value = current as any;
    queue.push(
      value.preview,
      value.fragrance,
      value.image,
      value.photo,
      value.thumbnail,
      value.provider_payload,
    );
  }

  return {
    transparentCandidates: [...transparentCandidates].sort((a, b) => scorePreferredBottleImageUrl(b) - scorePreferredBottleImageUrl(a)),
    regularCandidates: [...regularCandidates].sort((a, b) => scorePreferredBottleImageUrl(b) - scorePreferredBottleImageUrl(a)),
  };
}

function buildPreferredBottleImageCandidates(...sources: unknown[]) {
  const { transparentCandidates, regularCandidates } = collectWardrobeBottleImageUrls(...sources);
  const candidates: string[] = [];
  transparentCandidates.forEach((url) => pushUniqueImageUrl(candidates, url));
  regularCandidates.forEach((url) => pushUniqueImageUrl(candidates, deriveFragellaTransparentBottleImageUrl(url)));
  regularCandidates.forEach((url) => pushUniqueImageUrl(candidates, url));
  return candidates;
}

function resolvePreferredWardrobeBottleImage(...sources: unknown[]) {
  const { transparentCandidates, regularCandidates } = collectWardrobeBottleImageUrls(...sources);
  return transparentCandidates[0] ?? regularCandidates[0] ?? null;
}

const OdaraBottleImage: React.FC<{
  candidates: string[];
  alt: string;
  className: string;
  style?: React.CSSProperties;
  loading?: 'eager' | 'lazy';
  draggable?: boolean;
  fallback: React.ReactNode;
}> = ({ candidates, alt, className, style, loading = 'lazy', draggable = false, fallback }) => {
  const candidateKey = candidates.join('|');
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidateKey]);

  const imageUrl = candidates[candidateIndex] ?? null;
  if (!imageUrl) return <>{fallback}</>;

  return (
    <img
      src={imageUrl}
      alt={alt}
      className={className}
      loading={loading}
      draggable={draggable}
      style={style}
      onError={() => setCandidateIndex((index) => index + 1)}
    />
  );
}

const OdaraBottleSilhouetteFallback: React.FC<{
  tint: { wash: string; inner: string; frame: string; glowStrong: string };
  monogram: string;
  compact?: boolean;
}> = ({ tint, monogram, compact = false }) => (
  <div
    className="relative flex h-full w-full items-center justify-center overflow-hidden"
    style={{
      background: `radial-gradient(circle at 50% 22%, ${tint.wash} 0%, rgba(255,255,255,0.05) 26%, rgba(10,11,15,0.92) 100%)`,
    }}
  >
    <div
      className="pointer-events-none absolute inset-x-[18%] top-[10%] h-[14%] rounded-t-[10px]"
      style={{
        border: `1px solid ${tint.frame}`,
        borderBottom: 'none',
        background: 'rgba(255,255,255,0.03)',
        boxShadow: `0 0 12px ${tint.glowStrong}`,
      }}
    />
    <div
      className={`relative ${compact ? 'h-[72%] w-[54%]' : 'h-[74%] w-[56%]'} rounded-[28px]`}
      style={{
        border: `1px solid ${tint.frame}`,
        background: `linear-gradient(180deg, rgba(255,255,255,0.10) 0%, ${tint.inner} 22%, rgba(12,13,17,0.78) 100%)`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.10), 0 18px 30px ${tint.glowStrong}`,
      }}
    >
      <div
        className="absolute left-[18%] right-[18%] top-[12%] h-[18%] rounded-full"
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.02) 100%)' }}
      />
      <div
        className="absolute inset-x-[16%] bottom-[16%] flex items-center justify-center rounded-[18px] px-2 py-2 text-center text-[10px] uppercase tracking-[0.18em] text-foreground/70"
        style={{
          border: `1px solid ${tint.frame}`,
          background: 'rgba(255,255,255,0.035)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
        }}
      >
        {monogram}
      </div>
    </div>
  </div>
);

function normalizeWardrobeCatalogItem(row: any, imageAsset?: FragranceImageAsset | null): OdaraWardrobeCatalogItem | null {
  const fragranceId = typeof row?.id === 'string' ? row.id.trim() : '';
  const name = typeof row?.name === 'string' ? row.name.trim() : '';
  if (!fragranceId || !name) return null;
  const familyKey = normalizeSearchFamilyKey(readTrimmedLayerText(row?.family_key, row?.family));
  const resolvedImageUrl = resolvePreferredWardrobeBottleImage(
    imageAsset,
    row,
    imageAsset?.image_url ?? row?.image_url ?? readBottleImageUrlFromObject(row),
    imageAsset?.thumbnail_url ?? row?.thumbnail_url ?? null,
  );
  return {
    fragrance_id: fragranceId,
    name,
    brand: readTrimmedLayerText(row?.brand),
    family_key: familyKey,
    family_label: buildFamilyLabel(familyKey),
    release_year: typeof row?.release_year === 'number' ? row.release_year : null,
    concentration: typeof row?.concentration === 'string' ? row.concentration : null,
    notes: sanitizeTokenSource(row?.notes),
    accords: sanitizeTokenSource(row?.accords),
    top_notes: sanitizeTokenSource(row?.top_notes),
    heart_notes: sanitizeTokenSource(row?.heart_notes),
    base_notes: sanitizeTokenSource(row?.base_notes),
    source_url: readTrimmedLayerText(row?.source_url),
    source_confidence: readTrimmedLayerText(row?.source_confidence),
    primary_season: normalizeWardrobeSeasonKey(row?.primary_season),
    image_url: resolvedImageUrl,
    thumbnail_url: readTrimmedImageUrl(imageAsset?.thumbnail_url ?? row?.thumbnail_url),
  };
}

async function fetchWardrobeImageAssetMap(fragranceIds?: string[]) {
  try {
    let query = odaraSupabase
      .from('fragrance_image_assets' as any)
      .select('fragrance_id, image_url, thumbnail_url, image_source, source_url, provider_payload, updated_at, created_at')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false, nullsFirst: false });

    if (Array.isArray(fragranceIds) && fragranceIds.length > 0) {
      query = query.in('fragrance_id', fragranceIds);
    } else {
      query = query.range(0, 1999);
    }

    const { data: imageRows, error: imageError } = await query;
    if (imageError) throw imageError;

    const imageAssetMap = new Map<string, FragranceImageAsset>();
    for (const row of Array.isArray(imageRows) ? imageRows : []) {
      if (!row?.fragrance_id || imageAssetMap.has(row.fragrance_id)) continue;
      imageAssetMap.set(row.fragrance_id, {
        fragrance_id: row.fragrance_id,
        image_url_transparent: readTransparentBottleImageUrlFromObject(row),
        image_url: readRegularBottleImageUrlFromObject(row),
        thumbnail_url: readTrimmedImageUrl(row.thumbnail_url),
        image_source: readTrimmedLayerText(row.image_source),
        source_url: readTrimmedLayerText(row.source_url),
        updated_at: readTrimmedLayerText(row.updated_at),
        provider_payload: row.provider_payload ?? null,
      });
    }

    return imageAssetMap;
  } catch {
    return new Map<string, FragranceImageAsset>();
  }
}

async function fetchOdaraWardrobeCatalogByIds(fragranceIds: string[]) {
  const ids = Array.from(new Set(
    fragranceIds
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean),
  ));
  if (ids.length === 0) return [] as OdaraWardrobeCatalogItem[];

  const { data: fragranceRows, error: fragranceError } = await odaraSupabase
    .from('fragrances' as any)
    .select('id, name, brand, family_key, primary_season, notes, accords, top_notes, heart_notes, base_notes, release_year, concentration, source_url, source_confidence')
    .in('id', ids)
    .order('brand', { ascending: true })
    .order('name', { ascending: true });

  if (fragranceError) throw fragranceError;

  const imageAssetMap = await fetchWardrobeImageAssetMap(ids);

  return (Array.isArray(fragranceRows) ? fragranceRows : [])
    .map((row) => normalizeWardrobeCatalogItem(row, imageAssetMap.get(row.id) ?? null))
    .filter((row): row is OdaraWardrobeCatalogItem => !!row);
}

async function fetchOdaraWardrobeCatalog() {
  const { data: fragranceRows, error: fragranceError } = await odaraSupabase
    .from('fragrances' as any)
    .select('id, name, brand, family_key, primary_season, notes, accords, top_notes, heart_notes, base_notes, release_year, concentration, source_url, source_confidence')
    .order('brand', { ascending: true })
    .order('name', { ascending: true })
    .range(0, 999);

  if (fragranceError) throw fragranceError;

  const imageAssetMap = await fetchWardrobeImageAssetMap();

  const items = (Array.isArray(fragranceRows) ? fragranceRows : [])
    .map((row) => normalizeWardrobeCatalogItem(row, imageAssetMap.get(row.id) ?? null))
    .filter((row): row is OdaraWardrobeCatalogItem => !!row);

  return items;
}

function createWardrobeSessionSignalFromItem(
  item: OdaraWardrobeCatalogItem,
  patch?: Partial<OdaraWardrobeSessionSignal>,
): OdaraWardrobeSessionSignal {
  return {
    fragrance_id: item.fragrance_id,
    name: item.name,
    brand: item.brand,
    family_key: item.family_key,
    family_label: item.family_label,
    release_year: item.release_year,
    concentration: item.concentration,
    notes: sanitizeTokenSource(item.notes),
    accords: sanitizeTokenSource(item.accords),
    top_notes: sanitizeTokenSource(item.top_notes),
    heart_notes: sanitizeTokenSource(item.heart_notes),
    base_notes: sanitizeTokenSource(item.base_notes),
    source_url: item.source_url,
    source_confidence: item.source_confidence,
    primary_season: item.primary_season,
    image_url: item.image_url,
    thumbnail_url: item.thumbnail_url,
    owned: false,
    own_persisted: false,
    wishlist: false,
    wishlist_persisted: false,
    heart_state: 0,
    heart_persisted: false,
    negative_state: 0,
    negative_persisted: false,
    updated_at: Date.now(),
    ...patch,
  };
}

function normalizeStoredWardrobeSessionSignal(raw: any): OdaraWardrobeSessionSignal | null {
  const fragranceId = typeof raw?.fragrance_id === 'string' ? raw.fragrance_id.trim() : '';
  const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
  if (!fragranceId || !name) return null;
  return {
    fragrance_id: fragranceId,
    name,
    brand: readTrimmedLayerText(raw?.brand),
    family_key: normalizeSearchFamilyKey(readTrimmedLayerText(raw?.family_key)),
    family_label: readTrimmedLayerText(raw?.family_label) ?? buildFamilyLabel(normalizeSearchFamilyKey(readTrimmedLayerText(raw?.family_key))),
    release_year: typeof raw?.release_year === 'number' ? raw.release_year : null,
    concentration: typeof raw?.concentration === 'string' ? raw.concentration : null,
    notes: sanitizeTokenSource(raw?.notes),
    accords: sanitizeTokenSource(raw?.accords),
    top_notes: sanitizeTokenSource(raw?.top_notes),
    heart_notes: sanitizeTokenSource(raw?.heart_notes),
    base_notes: sanitizeTokenSource(raw?.base_notes),
    source_url: readTrimmedLayerText(raw?.source_url),
    source_confidence: readTrimmedLayerText(raw?.source_confidence),
    primary_season: normalizeWardrobeSeasonKey(raw?.primary_season),
    image_url: readTrimmedImageUrl(raw?.image_url),
    thumbnail_url: readTrimmedImageUrl(raw?.thumbnail_url),
    owned: Boolean(raw?.owned),
    own_persisted: Boolean(raw?.own_persisted),
    wishlist: Boolean(raw?.wishlist),
    wishlist_persisted: Boolean(raw?.wishlist_persisted),
    heart_state: normalizeStoredHeartState(raw?.heart_state),
    heart_persisted: Boolean(raw?.heart_persisted),
    negative_state: normalizeNegativeState(raw?.negative_state),
    negative_persisted: Boolean(raw?.negative_persisted),
    updated_at: typeof raw?.updated_at === 'number' ? raw.updated_at : Date.now(),
  };
}

function getScopedWardrobeOnboardingStorageKey(baseKey: string, userId?: string | null) {
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
  return normalizedUserId ? `${baseKey}:${normalizedUserId}` : baseKey;
}

function readStoredWardrobeSessionSignals(userId?: string | null) {
  if (typeof window === 'undefined') return {} as Record<string, OdaraWardrobeSessionSignal>;
  try {
    const raw = window.sessionStorage.getItem(getScopedWardrobeOnboardingStorageKey(ODARA_WARDROBE_SESSION_SIGNAL_STORAGE_KEY, userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const next: Record<string, OdaraWardrobeSessionSignal> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const normalized = normalizeStoredWardrobeSessionSignal(value);
      if (!normalized) continue;
      next[key] = normalized;
    }
    return next;
  } catch {
    return {};
  }
}

function writeStoredWardrobeSessionSignals(userId: string | null | undefined, signals: Record<string, OdaraWardrobeSessionSignal>) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      getScopedWardrobeOnboardingStorageKey(ODARA_WARDROBE_SESSION_SIGNAL_STORAGE_KEY, userId),
      JSON.stringify(signals),
    );
  } catch {
    // Session storage is best-effort only for beta onboarding state.
  }
}

function readStoredWardrobeActionLabelCount() {
  if (typeof window === 'undefined') return 0;
  try {
    const parsed = Number(window.localStorage.getItem(ODARA_WARDROBE_ACTION_LABEL_COUNT_STORAGE_KEY) ?? '0');
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.round(parsed), 99) : 0;
  } catch {
    return 0;
  }
}

function writeStoredWardrobeActionLabelCount(count: number) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ODARA_WARDROBE_ACTION_LABEL_COUNT_STORAGE_KEY, String(Math.max(0, count)));
  } catch {
    // Local UI memory only; ignore persistence failures.
  }
}

function readStoredWardrobeOnboardingSeen(userId?: string | null) {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(getScopedWardrobeOnboardingStorageKey(ODARA_WARDROBE_ONBOARDING_SEEN_STORAGE_KEY, userId)) === '1';
  } catch {
    return false;
  }
}

function writeStoredWardrobeOnboardingSeen(userId: string | null | undefined, seen: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      getScopedWardrobeOnboardingStorageKey(ODARA_WARDROBE_ONBOARDING_SEEN_STORAGE_KEY, userId),
      seen ? '1' : '0',
    );
  } catch {
    // Session storage is best-effort only for first-run state.
  }
}

function normalizeWardrobePreferenceState(value: unknown): OdaraCollectionPreferenceState {
  if (value === 'loved') return 'loved';
  if (value === 'liked') return 'liked';
  if (value === 'disliked') return 'disliked';
  if (value === 'not_for_me') return 'not_for_me';
  return 'neutral';
}

function getWardrobePrimaryStatusLabel(status: OdaraWardrobePrimaryStatus) {
  switch (status) {
    case 'owned':
      return 'Owned';
    case 'wishlist':
      return 'Wishlist';
    case 'liked':
      return 'Liked';
    case 'loved':
      return 'Loved';
    case 'not_for_me':
      return 'Not for me';
    case 'disliked':
      return 'Disliked';
    default:
      return 'Owned';
  }
}

function getWardrobePrimaryStatusTone(status: OdaraWardrobePrimaryStatus) {
  switch (status) {
    case 'owned':
      return {
        border: 'rgba(218,188,124,0.32)',
        background: 'rgba(218,188,124,0.12)',
        color: 'rgba(248,229,185,0.94)',
      };
    case 'wishlist':
      return {
        border: 'rgba(125,161,255,0.28)',
        background: 'rgba(125,161,255,0.12)',
        color: 'rgba(208,221,255,0.92)',
      };
    case 'liked':
      return {
        border: 'rgba(236,72,153,0.28)',
        background: 'rgba(236,72,153,0.12)',
        color: 'rgba(251,207,232,0.94)',
      };
    case 'loved':
      return {
        border: 'rgba(239,68,68,0.3)',
        background: 'rgba(239,68,68,0.12)',
        color: 'rgba(254,202,202,0.96)',
      };
    case 'not_for_me':
      return {
        border: 'rgba(245,158,11,0.28)',
        background: 'rgba(245,158,11,0.12)',
        color: 'rgba(254,240,200,0.94)',
      };
    case 'disliked':
      return {
        border: 'rgba(251,113,133,0.28)',
        background: 'rgba(251,113,133,0.12)',
        color: 'rgba(255,228,230,0.96)',
      };
    default:
      return {
        border: 'rgba(255,255,255,0.12)',
        background: 'rgba(255,255,255,0.05)',
        color: 'rgba(255,255,255,0.9)',
      };
  }
}

function getWardrobeStatusRank(status: OdaraWardrobePrimaryStatus) {
  switch (status) {
    case 'owned':
      return 0;
    case 'wishlist':
      return 1;
    case 'loved':
      return 2;
    case 'liked':
      return 3;
    case 'disliked':
      return 4;
    case 'not_for_me':
      return 5;
    default:
      return 9;
  }
}

function deriveWardrobePrimaryStatus(signal: {
  owned: boolean;
  wishlist: boolean;
  heart_state: HeartState;
  negative_state: OdaraNegativeState;
}): OdaraWardrobePrimaryStatus | null {
  if (signal.owned) return 'owned';
  if (signal.wishlist) return 'wishlist';
  if (signal.heart_state === 2) return 'loved';
  if (signal.heart_state === 1) return 'liked';
  if (signal.negative_state === 2) return 'disliked';
  if (signal.negative_state === 1) return 'not_for_me';
  return null;
}

function hasMeaningfulWardrobeSignal(signal: OdaraWardrobeSessionSignal | null | undefined) {
  return Boolean(
    signal
    && (
      signal.owned
      || signal.wishlist
      || signal.heart_state > 0
      || signal.negative_state > 0
    )
  );
}

function buildWardrobeCatalogItemFromCollectionItem(item: OdaraCollectionItem): OdaraWardrobeCatalogItem | null {
  const fragranceId = typeof item.fragrance_id === 'string' ? item.fragrance_id.trim() : '';
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  if (!fragranceId || !name) return null;
  const familyKey = normalizeSearchFamilyKey(readTrimmedLayerText(item.family_key));
  return {
    fragrance_id: fragranceId,
    name,
    brand: readTrimmedLayerText(item.brand),
    family_key: familyKey,
    family_label: readTrimmedLayerText(item.family_label) || buildFamilyLabel(familyKey),
    release_year: null,
    concentration: null,
    notes: [],
    accords: [],
    top_notes: [],
    heart_notes: [],
    base_notes: [],
    source_url: null,
    source_confidence: null,
    primary_season: normalizeWardrobeSeasonKey(item.primary_season),
    image_url: resolvePreferredWardrobeBottleImage(item, item.image_url, item.thumbnail_url),
    thumbnail_url: readTrimmedImageUrl(item.thumbnail_url),
  };
}

function buildWardrobeCatalogItemFromSignal(signal: OdaraWardrobeSessionSignal): OdaraWardrobeCatalogItem {
  return {
    fragrance_id: signal.fragrance_id,
    name: signal.name,
    brand: signal.brand,
    family_key: signal.family_key,
    family_label: signal.family_label || buildFamilyLabel(signal.family_key),
    release_year: signal.release_year,
    concentration: signal.concentration,
    notes: sanitizeTokenSource(signal.notes),
    accords: sanitizeTokenSource(signal.accords),
    top_notes: sanitizeTokenSource(signal.top_notes),
    heart_notes: sanitizeTokenSource(signal.heart_notes),
    base_notes: sanitizeTokenSource(signal.base_notes),
    source_url: signal.source_url,
    source_confidence: signal.source_confidence,
    primary_season: signal.primary_season,
    image_url: resolvePreferredWardrobeBottleImage(signal, signal.image_url, signal.thumbnail_url),
    thumbnail_url: readTrimmedImageUrl(signal.thumbnail_url),
  };
}

function isWardrobeStatusPersisted(
  signal: Pick<OdaraWardrobeSessionSignal, 'own_persisted' | 'wishlist_persisted' | 'heart_persisted' | 'negative_persisted'>,
  status: OdaraWardrobePrimaryStatus,
) {
  if (status === 'owned') return signal.own_persisted;
  if (status === 'wishlist') return signal.wishlist_persisted;
  if (status === 'liked' || status === 'loved') return signal.heart_persisted;
  if (status === 'not_for_me' || status === 'disliked') return signal.negative_persisted;
  return false;
}

function getWardrobeHeartActionLabel(state: HeartState) {
  if (state === 2) return 'Loved';
  if (state === 1) return 'Liked';
  return 'Like / Love';
}

function getWardrobeHeartActionAriaLabel(state: HeartState) {
  if (state === 2) return 'Remove preference';
  if (state === 1) return 'Mark as loved';
  return 'Like this fragrance';
}

function getWardrobeNegativeActionLabel(state: OdaraNegativeState) {
  if (state === 2) return 'Disliked';
  if (state === 1) return 'Not for me';
  return 'Not for me / Dislike';
}

function getWardrobeNegativeActionAriaLabel(state: OdaraNegativeState) {
  if (state === 2) return 'Remove negative preference';
  if (state === 1) return 'Dislike this fragrance';
  return 'Not for me';
}

function getWardrobeConfirmationTitle(kind: OdaraWardrobeConfirmationState['kind']) {
  switch (kind) {
    case 'owned':
      return 'Added to your wardrobe.';
    case 'wishlist':
      return 'Added to wishlist.';
    case 'heart':
      return 'Vesper noted your taste.';
    case 'negative':
      return 'Vesper will avoid this.';
    default:
      return 'Saved.';
  }
}

type OdaraFragranceDetailSurfaceState = {
  fragrance_id: string | null;
  name: string | null;
  brand: string | null;
  family_key: string | null;
  family_label: string | null;
  family_color_token?: string | null;
  wardrobe_role_key?: string | null;
  wardrobe_role_label?: string | null;
  role_confidence?: string | null;
  role_source?: string | null;
  release_year?: number | null;
  concentration?: string | null;
  perfumer?: string | null;
  short_description?: string | null;
  description_source?: string | null;
  description_generated_at?: string | null;
  timeline_source?: FragranceTimelineSource | null;
  image_url: string | null;
  thumbnail_url: string | null;
  image_source?: string | null;
  source_page_url?: string | null;
  image_license_status?: string | null;
  image_last_checked_at?: string | null;
  notes: string[];
  accords: string[];
  top_notes?: string[];
  middle_notes?: string[];
  base_notes?: string[];
  longevity_score?: number | null;
  longevity_source?: FragrancePerformanceSource | null;
  projection_score?: number | null;
  projection_source?: FragrancePerformanceSource | null;
  odor_impact_score?: number | null;
  density_score?: number | null;
  transparency_score?: number | null;
  beast_mode_score?: number | null;
  trail_source?: FragrancePerformanceSource | null;
  why_it_fits_wardrobe?: string | null;
  source_confidence?: string | null;
  retired?: boolean;
  collection_status?: string | null;
  rating?: number | null;
  source_label?: string | null;
  detail_loading?: boolean;
  detail_error?: string | null;
};

function normalizeDetailText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDetailReleaseYear(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  if (rounded < 1900 || rounded > 2100) return null;
  return rounded;
}

function normalizeUnitIntervalDetailScore(value: unknown): number | null {
  const numeric = normalizeDetailScore(value);
  if (numeric == null) return null;
  const normalized = numeric > 10
    ? numeric / 100
    : numeric > 1
      ? numeric / 10
      : numeric;
  return Math.max(0, Math.min(1, normalized));
}

function joinFragrancePhrases(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts[0]}, ${parts[1]}, and ${parts[2]}`;
}

function toSentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

const THIN_EXPLANATION_PATTERNS = [
  /\bstrong fit for (the )?current context\b/i,
  /\bgood fit for (the )?current context\b/i,
  /\bsolid fit for (the )?current context\b/i,
  /\bworks (well )?for (the )?current context\b/i,
  /\bfits (the )?current context\b/i,
  /\bselected layer for this card\b/i,
  /\badded from search for this card\b/i,
];

const EXPLANATION_DETAIL_SIGNAL_PATTERN = /\b(amber|bergamot|cardamom|cedar|citrus|coffee|floral|iris|jasmine|lavender|leather|marine|musk|neroli|oud|patchouli|pepper|powder|resin|rose|saffron|sandalwood|smoke|spice|spicy|tonka|vanilla|vetiver|violet|woody)\b/i;

function isThinExplanation(value: string | null | undefined) {
  const normalized = normalizeDetailText(value)
    ?.toLowerCase()
    .replace(/\s+/g, ' ')
    .trim() ?? '';

  if (!normalized) return true;
  if (THIN_EXPLANATION_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  if (/\b(layer|hero|main scent|recipe)\b/.test(normalized) && !EXPLANATION_DETAIL_SIGNAL_PATTERN.test(normalized)) {
    return true;
  }

  return normalized.length < 52
    && !/[,:;]/.test(normalized)
    && !EXPLANATION_DETAIL_SIGNAL_PATTERN.test(normalized);
}

function buildExplanationFinishDescriptor(source: {
  family_key?: string | null | undefined;
  notes?: string[] | null | undefined;
  accords?: string[] | null | undefined;
  base_notes?: string[] | null | undefined;
}) {
  const joined = [
    ...sanitizeTokenSource(source.base_notes),
    ...sanitizeTokenSource(source.notes),
    ...sanitizeTokenSource(source.accords),
    readTrimmedLayerText(source.family_key),
  ].join(' ').toLowerCase();

  if (/(vanilla|tonka|amber|benzoin|sweet|kulfi|praline|caramel)/.test(joined)) {
    return 'warm and polished';
  }
  if (/(oud|sandalwood|cedar|vetiver|patchouli|wood|guaiac)/.test(joined)) {
    return 'dark, dry, and grounded';
  }
  if (/(musk|powder|iris|violet|lavender|orris)/.test(joined)) {
    return 'soft and composed';
  }
  if (/(leather|smoke|incense|resin|labdanum|birch)/.test(joined)) {
    return 'dark and textured';
  }
  if (/(bergamot|citrus|marine|aquatic|ozonic|sage|mint|fresh)/.test(joined)) {
    return 'clean and lifted';
  }
  return 'smooth and composed';
}

function buildHydratedHeroExplanation(source: {
  family_key?: string | null | undefined;
  notes?: string[] | null | undefined;
  accords?: string[] | null | undefined;
  top_notes?: string[] | null | undefined;
  middle_notes?: string[] | null | undefined;
  base_notes?: string[] | null | undefined;
}) {
  const top = normalizeNotes(sanitizeTokenSource(source.top_notes), 2);
  const middle = normalizeNotes(sanitizeTokenSource(source.middle_notes), 2);
  const base = normalizeNotes(sanitizeTokenSource(source.base_notes), 2);
  const finish = buildExplanationFinishDescriptor(source);

  if (top.length > 0 || middle.length > 0 || base.length > 0) {
    const structuredPhrases = [
      top.length > 0 ? `${joinFragrancePhrases(top)} up top` : null,
      middle.length > 0 ? `${joinFragrancePhrases(middle)} through the middle` : null,
      base.length > 0 ? `${joinFragrancePhrases(base)} in the base` : null,
    ].filter(Boolean) as string[];

    if (structuredPhrases.length > 0) {
      return `${toSentenceCase(`Built around ${joinFragrancePhrases(structuredPhrases)}, it keeps the profile ${finish}`)}.`;
    }
  }

  const flatNotes = normalizeNotes(sanitizeTokenSource(source.notes), 4);
  if (flatNotes.length >= 4) {
    return `${toSentenceCase(`${joinFragrancePhrases(flatNotes.slice(0, 2))} pair with ${joinFragrancePhrases(flatNotes.slice(2, 4))}, keeping it ${finish}`)}.`;
  }
  if (flatNotes.length >= 2) {
    return `${toSentenceCase(`${joinFragrancePhrases(flatNotes.slice(0, 2))} keep it ${finish}`)}.`;
  }

  const highlights = buildFragranceDescriptionHighlights(source);
  if (highlights.length >= 2) {
    return `${toSentenceCase(`${joinFragrancePhrases(highlights.slice(0, 2))} keep it ${finish}`)}.`;
  }

  return null;
}

function resolveHydratedHeroReason(
  card: DisplayCard,
  detail: FragranceDetail | null | undefined,
) {
  const currentReason = readTrimmedLayerText(card.reason);
  if (!isThinExplanation(currentReason)) return currentReason;

  const fallback = buildHydratedHeroExplanation({
    family_key: detail?.family_key ?? card.family,
    notes: (detail?.notes?.length ?? 0) > 0 ? detail?.notes : card.notes,
    accords: (detail?.accords?.length ?? 0) > 0 ? detail?.accords : card.accords,
    top_notes: detail?.top_notes,
    middle_notes: detail?.middle_notes,
    base_notes: detail?.base_notes,
  });

  return fallback ?? currentReason;
}

function buildFragranceDescriptionHighlights(source: {
  notes?: string[] | null | undefined;
  accords?: string[] | null | undefined;
}) {
  const values = [
    ...sanitizeTokenSource(source.accords),
    ...sanitizeTokenSource(source.notes),
  ].map((value) => value.trim().toLowerCase());
  const joined = values.join(' | ');
  const highlightSpecs: Array<{ match: RegExp; label: string }> = [
    { match: /warm spicy|cinnamon|cardamom|nutmeg|clove|ginger|saffron|pepper|allspice|chai/, label: 'warm spice' },
    { match: /tobacco|tobac/, label: 'tobacco' },
    { match: /vanilla|tonka/, label: 'vanilla' },
    { match: /amber|labdanum|benzoin|resin|resinous|myrrh|olibanum|incense/, label: 'amber resin' },
    { match: /oud|agarwood/, label: 'oud' },
    { match: /leather|suede/, label: 'leather' },
    { match: /bergamot|lemon|lime|grapefruit|orange|mandarin|citrus|neroli/, label: 'bright citrus' },
    { match: /lavender|sage|rosemary|basil|mint|herbal|aromatic|tea/, label: 'aromatic herbs' },
    { match: /rose|jasmine|orange blossom|violet|iris|tuberose|floral/, label: 'florals' },
    { match: /cedar|sandalwood|patchouli|vetiver|cashmeran|guaiac|woody|wood/, label: 'woods' },
    { match: /musk|powdery|orris/, label: 'soft musk' },
    { match: /gourmand|caramel|honey|cacao|chocolate|coffee|sweet/, label: 'gourmand sweetness' },
    { match: /smoky|smoke|birch tar|tar/, label: 'smoke' },
    { match: /marine|aquatic|ozonic|sea|fresh/, label: 'fresh air' },
  ];

  const highlights: string[] = [];
  for (const spec of highlightSpecs) {
    if (!spec.match.test(joined)) continue;
    highlights.push(spec.label);
    if (highlights.length >= 3) break;
  }

  return highlights;
}

function buildFragranceTexturePhrase(source: {
  family_key?: string | null | undefined;
  family_label?: string | null | undefined;
  notes?: string[] | null | undefined;
  accords?: string[] | null | undefined;
  projection_score?: number | null | undefined;
  longevity_score?: number | null | undefined;
  density_score?: number | null | undefined;
}) {
  const familyKey = normalizeSearchFamilyKey(readTrimmedLayerText(source.family_key, source.family_label));
  const joined = [
    ...sanitizeTokenSource(source.accords),
    ...sanitizeTokenSource(source.notes),
  ].join(' ').toLowerCase();
  const projection = normalizeUnitIntervalDetailScore(source.projection_score) ?? 0.5;
  const longevity = normalizeUnitIntervalDetailScore(source.longevity_score) ?? 0.5;
  const density = normalizeUnitIntervalDetailScore(source.density_score) ?? 0.5;

  if (/warm spicy|tobacco|vanilla|amber|resin|boozy/.test(joined) || ['amber-oriental', 'tobacco-boozy', 'dark-leather', 'sweet-gourmand'].includes(familyKey)) {
    if (projection >= 0.66 || density >= 0.62) return 'a dense cold-air trail';
    if (longevity >= 0.62) return 'a warm, slow texture';
    return 'a cozy amber glow';
  }
  if (/citrus|bergamot|lemon|grapefruit|marine|aquatic|fresh/.test(joined) || ['fresh-aquatic', 'citrus-cologne', 'fresh-blue'].includes(familyKey)) {
    if (projection >= 0.6) return 'an easy bright lift';
    return 'a clean, open profile';
  }
  if (/tea|herbal|green|lavender|sage|basil|mint/.test(joined) || ['green-aromatic'].includes(familyKey)) {
    return 'a crisp aromatic edge';
  }
  if (/leather|smoke|oud|incense/.test(joined) || ['dark-leather', 'oud-amber'].includes(familyKey)) {
    return 'darker textured edges';
  }
  if (/musk|powdery|iris|violet/.test(joined)) {
    return 'a softer skin-close profile';
  }
  if (/woody|cedar|sandalwood|vetiver|patchouli/.test(joined) || ['woody', 'woody-clean'].includes(familyKey)) {
    return 'a dry woody texture';
  }
  return projection >= 0.64 ? 'a noticeable presence' : 'an easy-wearing profile';
}

const DERIVED_DESCRIPTION_SOURCES = new Set(['derived_client', 'fallback_generated']);
const NOTE_TIMELINE_ALIASES: Record<string, string> = {
  olibanum: 'frankincense',
  musc: 'musk',
};

function isDerivedDescriptionSource(value: string | null | undefined) {
  const normalized = normalizeDetailText(value);
  return normalized ? DERIVED_DESCRIPTION_SOURCES.has(normalized) : false;
}

function formatTimelineNoteLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return '';
  return NOTE_TIMELINE_ALIASES[normalized] ?? normalized;
}

function selectTimelinePhraseNotes(values: string[], section: 'opening' | 'heart' | 'drydown') {
  const formatted: string[] = [];
  const seen = new Set<string>();

  for (const rawValue of values) {
    const label = formatTimelineNoteLabel(rawValue);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    formatted.push(label);
  }

  if (formatted.length === 0) return formatted;
  if (section === 'heart' && /(leather|suede|rose|jasmine|iris|oud)$/.test(formatted[0]!)) {
    return formatted.slice(0, 1);
  }
  if (section === 'drydown' && /(frankincense|labdanum|styrax|benzoin|amber|incense|musk|patchouli|cedar|sandalwood|vetiver|birch|leather|suede)$/.test(formatted[0]!)) {
    return formatted.slice(0, 1);
  }
  return formatted.slice(0, 2);
}

function buildTimelineOpeningPhrase(opening: string[], accords?: string[] | null | undefined) {
  const joined = `${opening.join(' ')} ${sanitizeTokenSource(accords).join(' ')}`.toLowerCase();
  if (/(raspberry|berry|peach|pear|apple|plum|fig|fruit)/.test(joined) && /(saffron|pepper|clove|cardamom|cumin|ginger|spice)/.test(joined)) {
    return 'open sweet and sharp';
  }
  if (/(bergamot|lemon|lime|grapefruit|orange|mandarin|neroli|citrus|juniper)/.test(joined)) {
    return 'open bright and crisp';
  }
  if (/(basil|mint|sage|lavender|coriander|artemisia|green|herbal|aromatic)/.test(joined)) {
    return 'open crisp and aromatic';
  }
  if (/(saffron|pepper|clove|cardamom|cumin|ginger|spice)/.test(joined)) {
    return 'open warm and spiced';
  }
  if (/(rose|jasmine|lily|iris|violet|floral)/.test(joined)) {
    return 'open soft and floral';
  }
  return 'open first';
}

function buildTimelineDrydownPhrase(drydown: string[], accords?: string[] | null | undefined) {
  const joined = `${drydown.join(' ')} ${sanitizeTokenSource(accords).join(' ')}`.toLowerCase();
  if (/(frankincense|olibanum|labdanum|styrax|benzoin|amber|resin|incense)/.test(joined) && /(smoky|smoke|birch)/.test(joined)) {
    return 'leaves a smoky resin drydown';
  }
  if (/(frankincense|olibanum|labdanum|styrax|benzoin|amber|resin|incense)/.test(joined)) {
    return 'leaves a resinous drydown';
  }
  if (/(cedar|sandalwood|vetiver|patchouli|guaiac|wood)/.test(joined)) {
    return 'settles into a dry woody finish';
  }
  if (/(musk|powder|orris|skin)/.test(joined)) {
    return 'settles into a soft skin-close finish';
  }
  return 'lingers through the drydown';
}

function buildTimelineDescriptionFromSections(
  sections: { opening: string[]; heart: string[]; drydown: string[] },
  accords?: string[] | null | undefined,
) {
  const opening = selectTimelinePhraseNotes(sections.opening, 'opening');
  const heart = selectTimelinePhraseNotes(sections.heart, 'heart');
  const drydown = selectTimelinePhraseNotes(sections.drydown, 'drydown');
  const phrases: string[] = [];

  if (opening.length > 0) {
    phrases.push(`${toSentenceCase(joinFragrancePhrases(opening))} ${buildTimelineOpeningPhrase(opening, accords)}`);
  }

  if (heart.length > 0) {
    phrases.push(`${joinFragrancePhrases(heart)} settles into the heart`);
  }

  if (drydown.length > 0) {
    const lead = phrases.length > 0 ? 'and ' : '';
    phrases.push(`${lead}${joinFragrancePhrases(drydown)} ${buildTimelineDrydownPhrase(drydown, accords)}`);
  }

  if (phrases.length === 0) return null;
  const sentence = toSentenceCase(phrases.join(', ').replace(/,\s+and\s+/i, ', and ').trim());
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function buildTimelineDescriptionFromStructuredNotes(source: {
  top_notes?: string[] | null | undefined;
  middle_notes?: string[] | null | undefined;
  base_notes?: string[] | null | undefined;
  accords?: string[] | null | undefined;
}) {
  const top = normalizeNotes(sanitizeTokenSource(source.top_notes), 4);
  const heart = normalizeNotes(sanitizeTokenSource(source.middle_notes), 4);
  const base = normalizeNotes(sanitizeTokenSource(source.base_notes), 4);
  if (top.length === 0 && heart.length === 0 && base.length === 0) return null;

  return buildTimelineDescriptionFromSections({
    opening: top.length > 0 ? top : heart,
    heart: heart.length > 0 ? heart : top,
    drydown: base.length > 0 ? base : heart,
  }, source.accords);
}

function pickTimelineNotesByPatterns(
  notes: string[],
  patterns: RegExp[],
  used: Set<string>,
  max: number,
) {
  const selected: string[] = [];

  for (const pattern of patterns) {
    const match = notes.find((note) => !used.has(note) && pattern.test(note));
    if (!match) continue;
    used.add(match);
    selected.push(match);
    if (selected.length >= max) return selected;
  }

  for (const note of notes) {
    if (used.has(note)) continue;
    used.add(note);
    selected.push(note);
    if (selected.length >= max) break;
  }

  return selected;
}

function inferTimelineSectionsFromFlatNotes(source: {
  notes?: string[] | null | undefined;
  accords?: string[] | null | undefined;
}) {
  const notes = normalizeNotes(sanitizeTokenSource(source.notes), 14);
  if (notes.length === 0) return null;

  const accordJoined = sanitizeTokenSource(source.accords).join(' ').toLowerCase();
  const used = new Set<string>();
  const openingPatterns = [
    /bergamot|lemon|lime|grapefruit|orange|mandarin|neroli|citrus|juniper|aldehyd/,
    /raspberry|berry|peach|pear|apple|plum|fig|fruit/,
    /saffron|pink pepper|black pepper|pepper|cardamom|clove/,
    /ginger|coriander|mint|basil|sage|lavender|artemisia|juniper/,
    /cumin|nutmeg|allspice/,
  ];
  const heartPatterns = [
    ...(accordJoined.includes('leather') ? [/leather|suede/] : []),
    /rose|jasmine|lily|iris|violet|orange blossom|floral/,
    /coffee|tea|cacao|licorice|honey/,
    /leather|suede|orris|powder/,
  ];
  const drydownPatterns = [
    /olibanum|frankincense|labdanum|styrax|benzoin|balsam|amber|resin|incense|myrrh/,
    /birch|cedar|sandalwood|patchouli|vetiver|guaiac|oud|wood/,
    /musk|suede|leather|tonka|vanilla|licorice/,
  ];

  const opening = pickTimelineNotesByPatterns(notes, openingPatterns, used, 2);
  const heart = pickTimelineNotesByPatterns(notes, heartPatterns, used, 2);
  const drydown = pickTimelineNotesByPatterns(notes, drydownPatterns, used, 2);

  return { opening, heart, drydown };
}

function rewriteSourceBackedDescription(sourceDescription: string) {
  let rewritten = sourceDescription.replace(/\s+/g, ' ').trim();
  rewritten = rewritten
    .replace(/^official [^.]*?\b(describes|highlights)\b\s*/i, '')
    .replace(/\bthis fragrance\b/i, 'It')
    .replace(/\bthis scent\b/i, 'It')
    .replace(/\bopens with\b/i, 'opens on')
    .replace(/\bdries down\b/i, 'settles into')
    .replace(/\bdrying down\b/i, 'settling into')
    .replace(/\bblended with\b/i, 'layered with')
    .replace(/\bcentered around\b/i, 'built around')
    .replace(/\bbalanced by\b/i, 'cut by');

  const sentences = rewritten
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  let candidate = sentences.slice(0, 2).join(' ').trim();
  if (candidate.length > 160) {
    candidate = candidate
      .split(/,\s+/)
      .slice(0, 3)
      .join(', ')
      .trim();
  }
  if (!candidate) return null;
  candidate = toSentenceCase(candidate);
  return /[.!?]$/.test(candidate) ? candidate : `${candidate}.`;
}

function buildGeneratedFragranceDescription(source: {
  family_key?: string | null | undefined;
  family_label?: string | null | undefined;
  notes?: string[] | null | undefined;
  accords?: string[] | null | undefined;
  projection_score?: number | null | undefined;
  longevity_score?: number | null | undefined;
  density_score?: number | null | undefined;
}) {
  const highlights = buildFragranceDescriptionHighlights(source);
  const texture = buildFragranceTexturePhrase(source);
  const lead = highlights.length > 0
    ? joinFragrancePhrases(highlights)
    : (source.family_label ?? (source.family_key ? getFamilyLabelText(source.family_key) : 'the scent profile')).toLowerCase();

  const longTexture = texture ? ` with ${texture}` : '';
  let sentence = `${toSentenceCase(lead)}${longTexture}.`;
  if (sentence.length <= 140) return sentence;

  const shorterLead = highlights.slice(0, 2);
  if (shorterLead.length > 0) {
    sentence = `${toSentenceCase(joinFragrancePhrases(shorterLead))}${longTexture}.`;
    if (sentence.length <= 140) return sentence;
  }

  const fallback = `${toSentenceCase(joinFragrancePhrases(shorterLead.length > 0 ? shorterLead : ['fragrance character']))}.`;
  return fallback.length <= 140 ? fallback : `${fallback.slice(0, 137).trimEnd()}...`;
}

function buildCompactFragranceSummary(source: {
  family_key?: string | null | undefined;
  family_label?: string | null | undefined;
  notes?: string[] | null | undefined;
  accords?: string[] | null | undefined;
  projection_score?: number | null | undefined;
  longevity_score?: number | null | undefined;
  density_score?: number | null | undefined;
}) {
  const highlights = buildFragranceDescriptionHighlights(source);
  const familyLabel = source.family_label ?? (source.family_key ? getFamilyLabelText(source.family_key) : null);
  const leadParts = highlights.length > 0
    ? highlights
    : (familyLabel ? [familyLabel.toLowerCase()] : []);
  if (leadParts.length === 0) return null;

  const texture = buildFragranceTexturePhrase(source);
  const summary = `${toSentenceCase(joinFragrancePhrases(leadParts.slice(0, 3)))} with ${texture}.`;
  return summary.length <= 112 ? summary : `${toSentenceCase(joinFragrancePhrases(leadParts.slice(0, 2)))}.`;
}

function buildVesperizedDetailDescription(source: {
  short_description?: string | null | undefined;
  description_source?: string | null | undefined;
  family_key?: string | null | undefined;
  family_label?: string | null | undefined;
  notes?: string[] | null | undefined;
  accords?: string[] | null | undefined;
  top_notes?: string[] | null | undefined;
  middle_notes?: string[] | null | undefined;
  base_notes?: string[] | null | undefined;
  projection_score?: number | null | undefined;
  longevity_score?: number | null | undefined;
  density_score?: number | null | undefined;
}) {
  const sourceDescription = normalizeDetailText(source.short_description);
  const sourceType = normalizeDetailText(source.description_source);
  const sourceBackedTimeline = buildTimelineDescriptionFromStructuredNotes(source);
  if (sourceDescription && sourceType && !isDerivedDescriptionSource(sourceType)) {
    return sourceBackedTimeline
      ?? rewriteSourceBackedDescription(sourceDescription)
      ?? buildCompactFragranceSummary(source)
      ?? buildGeneratedFragranceDescription(source);
  }

  if (sourceBackedTimeline) return sourceBackedTimeline;
  return buildCompactFragranceSummary(source) ?? buildGeneratedFragranceDescription(source);
}

function formatPlainFamilyStyleLabel(value: string | null | undefined) {
  const normalized = normalizeDetailText(value);
  if (!normalized) return null;
  if (normalized.includes(' ') && /[A-Z]/.test(normalized)) return normalized;
  return normalized
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function resolveTimelineSource(detail: Pick<FragranceDetail, 'description_source' | 'top_notes' | 'middle_notes' | 'base_notes' | 'notes'>): FragranceTimelineSource {
  if (normalizeDetailText(detail.description_source) && !isDerivedDescriptionSource(detail.description_source)) {
    return 'source_description';
  }
  if (sanitizeTokenSource(detail.top_notes).length > 0 || sanitizeTokenSource(detail.middle_notes).length > 0 || sanitizeTokenSource(detail.base_notes).length > 0) {
    return 'official_note_pyramid';
  }
  if (sanitizeTokenSource(detail.notes).length > 0) {
    return 'inferred_from_notes';
  }
  return 'none';
}

function resolveTrailMetric(detail: {
  projection_score?: number | null | undefined;
  longevity_score?: number | null | undefined;
  odor_impact_score?: number | null | undefined;
  density_score?: number | null | undefined;
  beast_mode_score?: number | null | undefined;
}): { score: number | null; source: FragrancePerformanceSource } {
  const projection = normalizeUnitIntervalDetailScore(detail.projection_score);
  const longevity = normalizeUnitIntervalDetailScore(detail.longevity_score);
  const odorImpact = normalizeUnitIntervalDetailScore(detail.odor_impact_score);
  const density = normalizeUnitIntervalDetailScore(detail.density_score);
  const beastMode = normalizeUnitIntervalDetailScore(detail.beast_mode_score);

  if (odorImpact != null) {
    return { score: odorImpact, source: 'direct' };
  }

  const contributors = [
    beastMode != null ? { score: beastMode, weight: 0.35 } : null,
    density != null ? { score: density, weight: 0.2 } : null,
    longevity != null ? { score: longevity, weight: 0.2 } : null,
    projection != null ? { score: projection, weight: 0.25 } : null,
  ].filter((value): value is { score: number; weight: number } => !!value);

  if (contributors.length >= 2 && projection != null) {
    const weighted = contributors.reduce((sum, contributor) => sum + (contributor.score * contributor.weight), 0);
    const totalWeight = contributors.reduce((sum, contributor) => sum + contributor.weight, 0);
    const conservative = Math.max(0, Math.min(1, (weighted / totalWeight) - 0.06));
    return { score: conservative, source: 'derived' };
  }

  if (contributors.length >= 2) {
    const weighted = contributors.reduce((sum, contributor) => sum + (contributor.score * contributor.weight), 0);
    const totalWeight = contributors.reduce((sum, contributor) => sum + contributor.weight, 0);
    return { score: Math.max(0, Math.min(1, (weighted / totalWeight) - 0.04)), source: 'estimated' };
  }

  if (projection != null) {
    return { score: null, source: 'projection_fallback' };
  }

  return { score: null, source: 'unknown' };
}

function finalizeFragranceDetail(detail: FragranceDetail): FragranceDetail {
  const normalized: FragranceDetail = {
    ...detail,
    release_year: normalizeDetailReleaseYear(detail.release_year),
    concentration: normalizeDetailText(detail.concentration),
    perfumer: normalizeDetailText(detail.perfumer),
    short_description: normalizeDetailText(detail.short_description),
    description_source: normalizeDetailText(detail.description_source),
    description_generated_at: normalizeDetailText(detail.description_generated_at),
    timeline_source: detail.timeline_source ?? null,
    odor_impact_score: normalizeUnitIntervalDetailScore(detail.odor_impact_score),
    density_score: normalizeUnitIntervalDetailScore(detail.density_score),
    transparency_score: normalizeUnitIntervalDetailScore(detail.transparency_score),
    beast_mode_score: normalizeUnitIntervalDetailScore(detail.beast_mode_score),
    longevity_source: normalizeDetailText(detail.longevity_source) as FragrancePerformanceSource | null,
    projection_source: normalizeDetailText(detail.projection_source) as FragrancePerformanceSource | null,
    trail_source: normalizeDetailText(detail.trail_source) as FragrancePerformanceSource | null,
    image_source: normalizeDetailText(detail.image_source),
    source_page_url: normalizeDetailText(detail.source_page_url),
    image_license_status: normalizeDetailText(detail.image_license_status),
    image_last_checked_at: normalizeDetailText(detail.image_last_checked_at),
  };
  const trail = resolveTrailMetric(normalized);
  const generated = normalized.short_description ?? buildGeneratedFragranceDescription(normalized);
  return {
    ...normalized,
    short_description: generated,
    description_source: normalized.short_description ? (normalized.description_source ?? 'stored') : (generated ? 'fallback_generated' : null),
    timeline_source: normalized.timeline_source ?? resolveTimelineSource(normalized),
    longevity_source: normalized.longevity_source ?? (normalized.longevity_score != null ? 'direct' : 'unknown'),
    projection_source: normalized.projection_source ?? (normalized.projection_score != null ? 'direct' : 'unknown'),
    trail_source: normalized.trail_source ?? trail.source,
  };
}

type FragrancePerformanceBarDescriptor = {
  key: string;
  label: string;
  score: number;
  valueLabel: string;
  source: FragrancePerformanceSource;
};

const ODARA_DETAIL_PERFORMANCE_ROWS = [
  { key: 'longevity', label: 'Longevity' },
  { key: 'projection', label: 'Projection' },
  { key: 'trail', label: 'Trail' },
] as const;

function formatFragrancePerformanceStrength(score: number) {
  if (score <= 0.3) return 'Soft';
  if (score <= 0.55) return 'Moderate';
  if (score <= 0.75) return 'Strong';
  return 'Very strong';
}

function formatFragrancePerformanceScale(score: number) {
  return `${Math.max(1, Math.min(10, Math.round(score * 10)))}/10`;
}

function buildFragrancePerformanceBars(detail: {
  projection_score?: number | null | undefined;
  longevity_score?: number | null | undefined;
  odor_impact_score?: number | null | undefined;
  density_score?: number | null | undefined;
  beast_mode_score?: number | null | undefined;
  longevity_source?: FragrancePerformanceSource | null | undefined;
  projection_source?: FragrancePerformanceSource | null | undefined;
  trail_source?: FragrancePerformanceSource | null | undefined;
}) {
  const metrics: FragrancePerformanceBarDescriptor[] = [];
  const projection = normalizeUnitIntervalDetailScore(detail.projection_score);
  const longevity = normalizeUnitIntervalDetailScore(detail.longevity_score);
  const density = normalizeUnitIntervalDetailScore(detail.density_score);
  const trail = resolveTrailMetric(detail);

  if (longevity != null) {
    metrics.push({
      key: 'longevity',
      label: 'Longevity',
      score: longevity,
      valueLabel: formatFragrancePerformanceScale(longevity),
      source: detail.longevity_source ?? 'direct',
    });
  }

  if (projection != null) {
    metrics.push({
      key: 'projection',
      label: 'Projection',
      score: projection,
      valueLabel: formatFragrancePerformanceScale(projection),
      source: detail.projection_source ?? 'direct',
    });
  }

  if (trail.score != null) {
    metrics.push({
      key: 'trail',
      label: 'Trail',
      score: trail.score,
      valueLabel: formatFragrancePerformanceStrength(trail.score),
      source: detail.trail_source ?? trail.source,
    });
  }

  if (density != null) {
    metrics.push({
      key: 'density',
      label: 'Density',
      score: density,
      valueLabel: formatFragrancePerformanceStrength(density),
      source: 'direct',
    });
  }

  return metrics;
}

const OdaraPerformanceLifeBar: React.FC<{
  metric: FragrancePerformanceBarDescriptor;
  tint: { frame: string; glowStrong: string };
}> = ({ metric, tint }) => {
  const clampedWidth = `${Math.max(8, Math.min(100, Math.round(metric.score * 100)))}%`;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-[12px] text-foreground/78">
        <span>{metric.label}</span>
        <span className="text-foreground/62">{metric.valueLabel}</span>
      </div>
      <div
        className="mt-2 h-[14px] overflow-hidden rounded-full border"
        aria-hidden="true"
        style={{
          borderColor: 'rgba(255,255,255,0.12)',
          background: 'linear-gradient(180deg, rgba(7,10,16,0.92) 0%, rgba(2,6,12,0.96) 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -8px 18px rgba(0,0,0,0.34)',
        }}
      >
        <span
          className="relative block h-full rounded-full"
          style={{
            width: clampedWidth,
            background: `linear-gradient(90deg, rgba(80,248,245,0.96) 0%, ${tint.frame} 72%, rgba(91,168,255,0.98) 100%)`,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.42), 0 0 18px ${tint.glowStrong}`,
          }}
        >
          <span
            className="pointer-events-none absolute inset-x-[8%] top-[2px] h-[3px] rounded-full"
            style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.34) 0%, rgba(255,255,255,0.82) 54%, rgba(255,255,255,0.26) 100%)' }}
          />
        </span>
      </div>
    </div>
  );
};

const OdaraPerformanceEmptyLifeBar: React.FC<{
  label: string;
  tint: { frame: string; glowStrong: string };
}> = ({ label, tint }) => (
  <div>
    <div className="flex items-center justify-between gap-3 text-[12px] text-foreground/70">
      <span>{label}</span>
      <span className="text-foreground/42">—</span>
    </div>
    <div
      className="relative mt-2 h-[14px] overflow-hidden rounded-full border"
      aria-label={`${label} unavailable`}
      role="img"
      style={{
        borderColor: 'rgba(255,255,255,0.08)',
        background: 'linear-gradient(180deg, rgba(7,10,16,0.78) 0%, rgba(2,6,12,0.88) 100%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -8px 18px rgba(0,0,0,0.22)',
      }}
    >
      <span
        className="pointer-events-none absolute inset-x-[8%] top-[2px] h-[3px] rounded-full"
        style={{
          background: `linear-gradient(90deg, rgba(80,248,245,0.08) 0%, ${tint.frame} 54%, rgba(91,168,255,0.08) 100%)`,
          boxShadow: `0 0 8px ${tint.glowStrong}`,
        }}
      />
    </div>
  </div>
);

function deriveProfileMonogram(value: string | null | undefined): string {
  const label = String(value ?? '').trim();
  if (!label) return '—';
  const parts = label.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase() || '—';
  }
  return label.slice(0, 2).toUpperCase() || '—';
}

type OdaraAuthProfileIdentity = {
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
};

function readAuthProfileIdentity(sessionUser: any): OdaraAuthProfileIdentity {
  const metadata = sessionUser?.user_metadata ?? {};
  const primaryIdentity = Array.isArray(sessionUser?.identities) ? sessionUser.identities[0]?.identity_data ?? {} : {};
  const email = readTrimmedLayerText(sessionUser?.email) || null;
  const emailLocalPart = email?.split('@')[0]?.trim() || '';

  return {
    displayName:
      readTrimmedLayerText(
        metadata.full_name,
        metadata.name,
        metadata.display_name,
        metadata.user_name,
        primaryIdentity.full_name,
        primaryIdentity.name,
        primaryIdentity.display_name,
        emailLocalPart,
      ) || null,
    email,
    avatarUrl: readTrimmedImageUrl(
      metadata.avatar_url,
      metadata.picture,
      metadata.photo_url,
      primaryIdentity.avatar_url,
      primaryIdentity.picture,
      primaryIdentity.photo_url,
    ),
  };
}

function formatProfileCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function normalizeProfileSavedRatio(value: any): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeProfileSavedItemPayload(raw: any): OdaraProfileSavedItemPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const itemId = readTrimmedLayerText(raw.item_id, raw.id);
  const itemKind = readTrimmedLayerText(raw.item_kind);
  if (!itemId || !itemKind) return null;
  if (!['saved_recipe', 'saved_layer_combo', 'saved_layer'].includes(itemKind)) return null;
  return {
    item_kind: itemKind as OdaraProfileSavedItemKind,
    item_id: itemId,
    title: readTrimmedLayerText(raw.title) || null,
    subtitle: readTrimmedLayerText(raw.subtitle) || null,
    created_at: readTrimmedLayerText(raw.created_at) || null,
    updated_at: readTrimmedLayerText(raw.updated_at) || null,
    wear_date: readTrimmedLayerText(raw.wear_date) || null,
    context_key: readTrimmedLayerText(raw.context_key) || null,
    ratio_a: normalizeProfileSavedRatio(raw.ratio_a),
    ratio_b: normalizeProfileSavedRatio(raw.ratio_b),
    application_style: readTrimmedLayerText(raw.application_style) || null,
    notes: readTrimmedLayerText(raw.notes) || null,
    liked: typeof raw.liked === 'boolean' ? raw.liked : null,
    main_fragrance_id: readTrimmedLayerText(raw.main_fragrance_id) || null,
    layer_fragrance_id: readTrimmedLayerText(raw.layer_fragrance_id) || null,
    main_name: readTrimmedLayerText(raw.main_name) || null,
    layer_name: readTrimmedLayerText(raw.layer_name) || null,
    main_brand: readTrimmedLayerText(raw.main_brand) || null,
    layer_brand: readTrimmedLayerText(raw.layer_brand) || null,
    mode: readTrimmedLayerText(raw.mode) || null,
    source_table: readTrimmedLayerText(raw.source_table) || null,
  };
}

function normalizeProfileSavedItemsPayload(raw: any): OdaraProfileSavedItemsPayload {
  const items = Array.isArray(raw?.items)
    ? raw.items
        .map((item: any) => normalizeProfileSavedItemPayload(item))
        .filter((item: OdaraProfileSavedItemPayload | null): item is OdaraProfileSavedItemPayload => !!item)
    : [];
  return {
    saved_item_contract_version: readTrimmedLayerText(raw?.saved_item_contract_version) || 'profile_saved_items_v1',
    items,
  };
}

function formatProfileContextLabel(value: string | null | undefined) {
  const normalized = readTrimmedLayerText(value);
  if (!normalized) return null;
  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatProfileShortDate(value: string | null | undefined) {
  const normalized = readTrimmedLayerText(value);
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return normalized;
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
    }).format(new Date(parsed));
  } catch {
    return normalized;
  }
}

function getCollectionDefaultRank(item: OdaraCollectionItem, index: number) {
  return typeof item.default_rank === 'number' && Number.isFinite(item.default_rank)
    ? item.default_rank
    : index + 1;
}

function getCollectionFamilySortLabel(item: OdaraCollectionItem) {
  if (item.family_label) return item.family_label;
  if (item.family_key) return getFamilyLabelText(item.family_key);
  return 'Unclassified';
}

function getCollectionTileTint(item: Pick<OdaraCollectionItem, 'family_key' | 'family_label'>) {
  const normalized = normalizeSearchFamilyKey(item.family_key ?? item.family_label ?? '');
  return FAMILY_TINTS[normalized] ?? DEFAULT_TINT;
}

type OdaraGlassCardVariant = 'hero' | 'collection';

function getOdaraGlassCardVisualRecipe(
  tint: { bg: string; glow: string; border: string },
  variant: OdaraGlassCardVariant,
) {
  if (variant === 'hero') {
    return {
      surfaceStyle: {
        background: `linear-gradient(165deg, ${tint.bg} 0%, rgba(15,12,8,0.97) 70%)`,
        border: `1px solid ${tint.border}`,
        boxShadow: `0 24px 60px rgba(0,0,0,0.6), inset 0 1px 1px rgba(255,255,255,0.06)`,
      },
      atmosphereClassName: 'absolute -top-16 -right-16 w-52 h-52 rounded-full blur-3xl pointer-events-none',
      atmosphereStyle: {
        background: tint.glow,
        opacity: 0.35,
      },
    } as const;
  }

  return {
    surfaceStyle: {
      background: `linear-gradient(165deg, ${tint.bg} 0%, rgba(15,12,8,0.97) 70%)`,
      border: `1px solid ${tint.border}`,
      boxShadow: `0 18px 36px rgba(0,0,0,0.44), inset 0 1px 1px rgba(255,255,255,0.06)`,
    },
    atmosphereClassName: 'pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full blur-2xl',
    atmosphereStyle: {
      background: tint.glow,
      opacity: 0.28,
    },
  } as const;
}

function getOdaraHeroLiquidGlassMaterialStyle(
  tint: { bg: string; glow: string; border: string },
  heroVisual: ReturnType<typeof getOdaraGlassCardVisualRecipe>,
): React.CSSProperties {
  return {
    ...heroVisual.surfaceStyle,
    background: `linear-gradient(165deg, ${tint.bg.replace('0.08', '0.16').replace('0.07', '0.15').replace('0.06', '0.14')} 0%, rgba(13,14,18,0.72) 56%, rgba(8,9,12,0.90) 100%)`,
    border: typeof heroVisual.surfaceStyle.border === 'string'
      ? heroVisual.surfaceStyle.border
          .replace('0.32', '0.18')
          .replace('0.3', '0.18')
          .replace('0.28', '0.18')
      : heroVisual.surfaceStyle.border,
    boxShadow: '0 28px 64px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.10), inset 0 16px 30px rgba(255,255,255,0.03)',
    backdropFilter: 'blur(22px) saturate(138%)',
    WebkitBackdropFilter: 'blur(22px) saturate(138%)',
  };
}

function getCollectionRoleRank(value: string | null | undefined) {
  switch (value) {
    case 'anchor':
      return 0;
    case 'layer_tool':
      return 1;
    case 'brightener':
      return 2;
    case 'softener':
      return 3;
    case 'bridge':
      return 4;
    case 'accent':
      return 5;
    case 'soloist':
      return 6;
    default:
      return 99;
  }
}

function getCollectionRoleLabel(item: Pick<OdaraCollectionItem, 'wardrobe_role_label'>) {
  return item.wardrobe_role_label?.trim() || null;
}

function getEnhancedCollectionTint(item: Pick<OdaraCollectionItem, 'family_key' | 'family_label'>) {
  const base = getCollectionTileTint(item);
  return {
    ...base,
    wash: base.bg.replace('0.08', '0.09').replace('0.07', '0.09').replace('0.06', '0.085').replace('0.05', '0.08'),
    inner: base.bg.replace('0.08', '0.055').replace('0.07', '0.055').replace('0.06', '0.05').replace('0.05', '0.045'),
    frame: base.border.replace('0.32', '0.22').replace('0.3', '0.22').replace('0.28', '0.2').replace('0.26', '0.18'),
    glowStrong: base.glow.replace('0.22', '0.11').replace('0.2', '0.1').replace('0.18', '0.09').replace('0.16', '0.08'),
  };
}

type OdaraChipTone = {
  border: string;
  background: string;
  color: string;
  glow: string;
};

function odaraHexToRgba(hex: string | null | undefined, alpha: number) {
  const normalized = (hex ?? '').replace('#', '').trim();
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return `rgba(242,242,242,${alpha})`;
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}

function getOdaraMappedChipTone(colorHex: string | null | undefined): OdaraChipTone {
  const color = colorHex ?? SEMANTIC_TOKEN_COLORS.default;
  return {
    border: odaraHexToRgba(color, 0.42),
    background: odaraHexToRgba(color, 0.12),
    color: odaraHexToRgba(color, 0.96),
    glow: odaraHexToRgba(color, 0.18),
  };
}

function getOdaraFamilyMappedChipTone(familyKey: string): OdaraChipTone {
  return getOdaraMappedChipTone(FAMILY_COLORS[familyKey] ?? SEMANTIC_TOKEN_COLORS.default);
}

function normalizeOdaraTermSlug(value: string | null | undefined) {
  return normalizeScentIntelChipSlug(value);
}

function getCanonicalOdaraTermSlug(value: string | null | undefined) {
  return resolveCanonicalScentIntelSlug(value);
}

function getCanonicalOdaraTermFamilyKey(
  value: string | null | undefined,
  fallbackFamilyKey?: string | null,
) {
  const canonical = getCanonicalOdaraTermSlug(value);
  switch (canonical) {
    case 'woody':
      return 'earthy-patchouli';
    case 'amber':
    case 'resins':
    case 'balsamic':
    case 'incense':
    case 'frankincense':
    case 'myrrh':
    case 'olibanum':
    case 'oud':
      return 'oud-amber';
    case 'smoke':
      return 'dark-leather';
    case 'leather':
      return 'dark-leather';
    case 'aquatic':
      return 'fresh-aquatic';
    case 'powdery':
    case 'musk':
    case 'white-musk':
    case 'aldehydic':
    case 'iris':
    case 'orris':
      return 'floral-musk';
    case 'bergamot':
    case 'orange':
    case 'mandarin':
    case 'lemon':
    case 'lime':
    case 'grapefruit':
    case 'citrus':
      return 'citrus-cologne';
    case 'petitgrain':
    case 'neroli':
      return 'citrus-aromatic';
    case 'basil':
    case 'artemisia':
    case 'wormwood':
    case 'sage':
    case 'lavender':
    case 'rosemary':
    case 'mint':
    case 'herbal':
    case 'aromatic':
      return 'aromatic-fougere';
    case 'green':
    case 'leaf':
    case 'leafy':
    case 'galbanum':
    case 'stem':
      return 'green-earthy';
    case 'sweet':
    case 'gourmand':
    case 'vanilla':
    case 'praline':
    case 'tonka':
    case 'coffee':
    case 'cacao':
    case 'cocoa':
    case 'chocolate':
      return 'sweet-gourmand';
    case 'spicy':
    case 'cinnamon':
    case 'cardamom':
    case 'pepper':
    case 'saffron':
    case 'clove':
    case 'ginger':
      return 'spicy-warm';
    case 'patchouli':
    case 'vetiver':
    case 'oakmoss':
    case 'moss':
      return 'earthy-patchouli';
    case 'fruity':
    case 'raspberry':
    case 'plum':
    case 'berry':
    case 'pear':
    case 'peach':
    case 'apple':
      return 'floral-rich';
    default:
      return fallbackFamilyKey ?? null;
  }
}

function getKnownOdaraAccordChipTone(normalized: string): OdaraChipTone | null {
  const canonical = getCanonicalOdaraTermSlug(normalized);
  const term = canonical.replace(/[^a-z0-9]+/g, ' ').trim();
  if (!term) return null;
  if (/\b(bergamot|orange|mandarin|lemon|lime|grapefruit|citrus)\b/.test(term)) return getOdaraFamilyMappedChipTone('citrus-cologne');
  if (/\b(petitgrain|neroli)\b/.test(term)) return getOdaraFamilyMappedChipTone('citrus-aromatic');
  if (/\b(basil|artemisia|wormwood|sage|lavender|rosemary|mint|herbal|aromatic)\b/.test(term)) return getOdaraFamilyMappedChipTone('aromatic-fougere');
  if (/\b(green notes?|green accord|green|leaf|leafy|galbanum|stem)\b/.test(term)) return getOdaraFamilyMappedChipTone('green-earthy');
  if (/\b(woody accord|woody|woods?|cedar|sandalwood|vetiver|oakmoss|moss)\b/.test(term)) return getOdaraFamilyMappedChipTone('earthy-patchouli');
  if (/\b(fresh spicy|spicy fresh|spicy|spice|cinnamon|cardamom|pepper|saffron|clove|ginger)\b/.test(term)) return getOdaraFamilyMappedChipTone('spicy-warm');
  if (/\b(sweet|vanilla|gourmand|honey|caramel|tonka|praline|cocoa|chocolate)\b/.test(term)) return getOdaraFamilyMappedChipTone('sweet-gourmand');
  if (/\b(fruity|fruit|apple|pear|peach|plum|berry|berries|cassis|blackcurrant|cherry|fig)\b/.test(term)) return getOdaraMappedChipTone(SEMANTIC_TOKEN_COLORS.fruity);
  if (/\b(tea|black tea|mate)\b/.test(term)) return getOdaraFamilyMappedChipTone('aromatic-fougere');
  if (/\b(amber|resin|resinous|labdanum|benzoin|myrrh|olibanum|frankincense|incense)\b/.test(term)) return getOdaraFamilyMappedChipTone('oud-amber');
  if (/\b(smoke|smoky|smokey|charred|burnt)\b/.test(term)) return getOdaraFamilyMappedChipTone('dark-leather');
  if (/\b(leather|suede)\b/.test(term)) return getOdaraFamilyMappedChipTone('dark-leather');
  if (/\b(musk|white musk|powdery|iris|orris)\b/.test(term)) return getOdaraFamilyMappedChipTone('floral-musk');
  return null;
}

function getAccordChipTone(label: string, familyKey?: string | null) {
  const normalized = label.trim().toLowerCase();
  const canonical = getCanonicalOdaraTermSlug(normalized);
  const canonicalFamilyKey = getCanonicalOdaraTermFamilyKey(canonical, familyKey);
  const familyTint = FAMILY_TINTS[canonicalFamilyKey ?? familyKey ?? ''] ?? DEFAULT_TINT;
  const knownTone = getKnownOdaraAccordChipTone(canonical || normalized);
  if (knownTone) return knownTone;

  const tones = [
    {
      match: ['oud', 'amber', 'balsamic', 'resin', 'resinous', 'incense', 'olibanum', 'frankincense', 'labdanum', 'benzoin', 'myrrh', 'elemi'],
      border: 'rgba(230,178,96,0.42)',
      background: 'rgba(230,178,96,0.12)',
      color: 'rgba(247,221,165,0.96)',
      glow: 'rgba(230,178,96,0.2)',
    },
    {
      match: ['citrus', 'bergamot', 'lemon', 'orange', 'grapefruit', 'neroli'],
      border: 'rgba(198,212,112,0.42)',
      background: 'rgba(198,212,112,0.12)',
      color: 'rgba(236,246,181,0.96)',
      glow: 'rgba(198,212,112,0.18)',
    },
    {
      match: ['spice', 'spicy', 'cinnamon', 'cardamom', 'pepper', 'saffron', 'clove', 'nutmeg', 'ginger', 'allspice', 'chai'],
      border: 'rgba(223,143,97,0.42)',
      background: 'rgba(223,143,97,0.12)',
      color: 'rgba(248,214,188,0.96)',
      glow: 'rgba(223,143,97,0.18)',
    },
    {
      match: ['woody', 'wood', 'cedar', 'sandalwood', 'patchouli', 'vetiver', 'oakmoss', 'guaiac'],
      border: 'rgba(140,196,154,0.42)',
      background: 'rgba(140,196,154,0.12)',
      color: 'rgba(214,239,219,0.96)',
      glow: 'rgba(140,196,154,0.18)',
    },
    {
      match: ['floral', 'rose', 'jasmine', 'orange blossom', 'violet'],
      border: 'rgba(214,153,174,0.4)',
      background: 'rgba(214,153,174,0.12)',
      color: 'rgba(246,214,225,0.95)',
      glow: 'rgba(214,153,174,0.18)',
    },
    {
      match: ['powdery', 'musk', 'iris', 'aldehydic'],
      border: 'rgba(177,173,214,0.38)',
      background: 'rgba(177,173,214,0.1)',
      color: 'rgba(231,229,247,0.94)',
      glow: 'rgba(177,173,214,0.16)',
    },
    {
      match: ['gourmand', 'vanilla', 'sweet', 'cacao', 'caramel', 'tonka'],
      border: 'rgba(204,152,118,0.42)',
      background: 'rgba(204,152,118,0.12)',
      color: 'rgba(245,220,196,0.95)',
      glow: 'rgba(204,152,118,0.18)',
    },
    {
      match: ['tobacco', 'boozy', 'rum', 'whiskey', 'cognac', 'brandy'],
      border: 'rgba(170,138,121,0.42)',
      background: 'rgba(170,138,121,0.12)',
      color: 'rgba(233,215,204,0.95)',
      glow: 'rgba(170,138,121,0.18)',
    },
    {
      match: ['leather', 'suede'],
      border: 'rgba(186,145,112,0.42)',
      background: 'rgba(186,145,112,0.12)',
      color: 'rgba(239,220,205,0.95)',
      glow: 'rgba(186,145,112,0.18)',
    },
    {
      match: ['tea', 'mate', 'black tea'],
      border: 'rgba(126,185,157,0.42)',
      background: 'rgba(126,185,157,0.12)',
      color: 'rgba(212,241,228,0.95)',
      glow: 'rgba(126,185,157,0.18)',
    },
    {
      match: ['green', 'aromatic', 'herbal', 'basil', 'sage', 'lavender', 'mint', 'rosemary'],
      border: 'rgba(118,184,198,0.42)',
      background: 'rgba(118,184,198,0.12)',
      color: 'rgba(208,240,246,0.95)',
      glow: 'rgba(118,184,198,0.18)',
    },
    {
      match: ['fresh', 'marine', 'aquatic', 'ozonic', 'sea', 'water'],
      border: 'rgba(120,170,214,0.42)',
      background: 'rgba(120,170,214,0.12)',
      color: 'rgba(214,231,249,0.95)',
      glow: 'rgba(120,170,214,0.18)',
    },
    {
      match: ['smoke', 'smoky', 'charred', 'burnt'],
      border: 'rgba(155,145,139,0.42)',
      background: 'rgba(155,145,139,0.12)',
      color: 'rgba(228,221,217,0.94)',
      glow: 'rgba(155,145,139,0.18)',
    },
    {
      match: ['family', 'style', 'accord'],
      border: familyTint.border.replace('0.32', '0.42').replace('0.3', '0.42').replace('0.28', '0.4'),
      background: familyTint.bg.replace('0.08', '0.12').replace('0.07', '0.12').replace('0.06', '0.12'),
      color: 'rgba(244,244,244,0.94)',
      glow: familyTint.glow.replace('0.22', '0.18').replace('0.2', '0.18'),
    },
    {
      match: ['powder', 'musk', 'iris', 'aldehydic', 'orris'],
      border: 'rgba(177,173,214,0.38)',
      background: 'rgba(177,173,214,0.1)',
      color: 'rgba(231,229,247,0.94)',
      glow: 'rgba(177,173,214,0.16)',
    },
    {
      match: ['clean', 'soap', 'soapy', 'linen'],
      border: 'rgba(171,196,214,0.38)',
      background: 'rgba(171,196,214,0.10)',
      color: 'rgba(232,241,248,0.94)',
      glow: 'rgba(171,196,214,0.16)',
    },
    {
      match: ['green', 'aromatic', 'herbal', 'tea', 'fresh', 'marine', 'aquatic', 'ozonic'],
      border: 'rgba(118,184,198,0.42)',
      background: 'rgba(118,184,198,0.12)',
      color: 'rgba(208,240,246,0.95)',
      glow: 'rgba(118,184,198,0.18)',
    },
  ];

  const matched = tones.find((tone) => tone.match.some((token) => normalized.includes(token)));
  if (matched) return matched;

  return {
    border: familyTint.border.replace('0.32', '0.4').replace('0.3', '0.4').replace('0.28', '0.38'),
    background: familyTint.bg.replace('0.08', '0.11').replace('0.07', '0.11').replace('0.06', '0.11'),
    color: 'rgba(242,242,242,0.92)',
    glow: familyTint.glow.replace('0.22', '0.18').replace('0.2', '0.18'),
  };
}

function normalizeCollectionRating(value: unknown) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim().length === 0) return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  const normalized = Math.max(1, Math.min(5, Math.round(numeric)));
  return normalized;
}

function normalizeDetailScore(value: unknown) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim().length === 0) return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getCollectionRatingLabel(rating: number | null | undefined) {
  const normalized = normalizeCollectionRating(rating);
  if (!normalized) return null;
  return `${normalized} star${normalized === 1 ? '' : 's'}`;
}

function getCollectionRatingRank(value: number | null | undefined) {
  const normalized = normalizeCollectionRating(value);
  return normalized ? 6 - normalized : 999;
}

function formatCollectionRatingChip(rating: number | null | undefined) {
  const normalized = normalizeCollectionRating(rating);
  if (!normalized) return null;
  return `Rated ${normalized}`;
}

function formatCompactCollectionRatingValue(rating: number | null | undefined) {
  const numeric = normalizeDetailScore(rating);
  if (numeric == null) return null;
  return Number.isInteger(numeric)
    ? String(numeric)
    : numeric.toFixed(1).replace(/\.0$/, '');
}

function normalizeCollectionPayload(payload: OdaraCollectionPayload | null): OdaraCollectionPayload | null {
  if (!payload) return null;
  return {
    ...payload,
    summary: {
      ...payload.summary,
      rated_count: Number(payload.summary?.rated_count ?? 0),
      wear_more_count: Number(payload.summary?.wear_more_count ?? payload.summary?.favorite_count ?? 0),
      favorite_count: Number(payload.summary?.favorite_count ?? payload.summary?.wear_more_count ?? 0),
      retired_count: Number(payload.summary?.retired_count ?? 0),
    },
    items: (payload.items ?? []).map((item, index) => ({
      ...item,
      family_color_token: typeof item.family_color_token === 'string' ? item.family_color_token : null,
      wardrobe_role_key: typeof item.wardrobe_role_key === 'string' ? item.wardrobe_role_key : null,
      wardrobe_role_label: typeof item.wardrobe_role_label === 'string' ? item.wardrobe_role_label : null,
      role_confidence: typeof item.role_confidence === 'string' ? item.role_confidence : null,
      role_source: typeof item.role_source === 'string' ? item.role_source : null,
      primary_season: normalizeWardrobeSeasonKey(item.primary_season),
      image_url: resolvePreferredWardrobeBottleImage(item, item.image_url, item.thumbnail_url),
      collection_created_at: readTrimmedLayerText(item.collection_created_at),
      collection_updated_at: readTrimmedLayerText(item.collection_updated_at),
      rating: normalizeCollectionRating(item.rating),
      wear_more: Boolean(item.wear_more ?? item.favorite),
      favorite: Boolean(item.favorite ?? item.wear_more),
      retired: Boolean(item.retired),
      is_rated: Boolean(item.is_rated ?? normalizeCollectionRating(item.rating)),
      default_rank: getCollectionDefaultRank(item, index),
    })),
  };
}

function sortCollectionItemsForView(items: OdaraCollectionItem[], sort: OdaraCollectionSort) {
  return [...items].sort((a, b) => {
    const defaultOrder = (a.default_rank ?? Number.MAX_SAFE_INTEGER) - (b.default_rank ?? Number.MAX_SAFE_INTEGER);
    if (sort === 'name') {
      return (
        (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' })
        || (a.brand ?? '').localeCompare(b.brand ?? '', undefined, { sensitivity: 'base' })
        || defaultOrder
      );
    }
    if (sort === 'brand') {
      return (
        (a.brand ?? '').localeCompare(b.brand ?? '', undefined, { sensitivity: 'base' })
        || (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' })
        || defaultOrder
      );
    }
    if (sort === 'family') {
      return (
        getCollectionFamilySortLabel(a).localeCompare(getCollectionFamilySortLabel(b), undefined, { sensitivity: 'base' })
        || (a.brand ?? '').localeCompare(b.brand ?? '', undefined, { sensitivity: 'base' })
        || (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' })
        || defaultOrder
      );
    }
    if (sort === 'rating') {
      return (
        getCollectionRatingRank(a.rating) - getCollectionRatingRank(b.rating)
        || getCollectionRoleRank(a.wardrobe_role_key) - getCollectionRoleRank(b.wardrobe_role_key)
        || (a.brand ?? '').localeCompare(b.brand ?? '', undefined, { sensitivity: 'base' })
        || (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' })
        || defaultOrder
      );
    }
    return (
      getCollectionRoleRank(a.wardrobe_role_key) - getCollectionRoleRank(b.wardrobe_role_key)
      || getCollectionFamilySortLabel(a).localeCompare(getCollectionFamilySortLabel(b), undefined, { sensitivity: 'base' })
      || (a.brand ?? '').localeCompare(b.brand ?? '', undefined, { sensitivity: 'base' })
      || (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' })
      || Number(Boolean(a.retired)) - Number(Boolean(b.retired))
      || (a.brand ?? '').localeCompare(b.brand ?? '', undefined, { sensitivity: 'base' })
      || (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' })
      || defaultOrder
    );
  });
}

const COLLECTION_LOW_RATING_REASONS = [
  { key: 'too_sharp', label: 'Too sharp' },
  { key: 'too_sweet', label: 'Too sweet' },
  { key: 'too_green', label: 'Too green' },
  { key: 'too_smoky', label: 'Too smoky' },
  { key: 'too_floral', label: 'Too floral' },
  { key: 'too_powdery', label: 'Too powdery' },
  { key: 'too_synthetic', label: 'Too synthetic' },
  { key: 'too_boring', label: 'Too boring' },
  { key: 'bad_drydown', label: 'Bad drydown' },
  { key: 'bad_in_heat', label: 'Bad in heat' },
  { key: 'good_layer_only', label: 'Good layer only' },
  { key: 'not_for_me', label: 'Not for me' },
] as const;

const COLLECTION_LONG_PRESS_MS = 420;
const COLLECTION_SCROLL_CANCEL_Y_PX = 14;
const COLLECTION_TAP_MAX_MOVE_PX = 10;

function resolveCollectionRatingFromClientX(clientX: number, rect: DOMRect) {
  const padding = Math.min(18, rect.width * 0.14);
  const startX = rect.left + padding;
  const usableWidth = Math.max(rect.width - padding * 2, 1);
  const ratio = Math.max(0, Math.min(0.999, (clientX - startX) / usableWidth));
  return Math.min(5, Math.max(1, Math.floor(ratio * 5) + 1));
}

function buildFragranceDetailSurfaceStateFromCollectionItem(item: OdaraCollectionItem): OdaraFragranceDetailSurfaceState {
  return {
    fragrance_id: item.fragrance_id ?? null,
    name: item.name ?? '',
    brand: item.brand ?? null,
    family_key: item.family_key ?? null,
    family_label: item.family_label ?? (item.family_key ? getFamilyLabelText(item.family_key) : null),
    family_color_token: item.family_color_token ?? item.family_key ?? null,
    wardrobe_role_key: item.wardrobe_role_key ?? null,
    wardrobe_role_label: item.wardrobe_role_label ?? null,
    role_confidence: item.role_confidence ?? null,
    role_source: item.role_source ?? null,
    release_year: null,
    concentration: null,
    perfumer: null,
    short_description: null,
    description_source: null,
    description_generated_at: null,
    image_url: item.image_url ?? null,
    thumbnail_url: item.thumbnail_url ?? null,
    image_source: null,
    source_page_url: null,
    image_license_status: null,
    image_last_checked_at: null,
    notes: [],
    accords: [],
    top_notes: [],
    middle_notes: [],
    base_notes: [],
    why_it_fits_wardrobe: null,
    source_confidence: null,
    longevity_score: null,
    projection_score: null,
    odor_impact_score: null,
    density_score: null,
    transparency_score: null,
    beast_mode_score: null,
    retired: Boolean(item.retired),
    collection_status: item.collection_status ?? null,
    rating: normalizeCollectionRating(item.rating),
    source_label: item.collection_status === 'guest_demo' ? 'Guest preview' : 'Collection profile',
    detail_loading: false,
    detail_error: null,
  };
}

function buildFragranceDetailSurfaceStateFromWardrobeCatalogItem(item: OdaraWardrobeCatalogItem): OdaraFragranceDetailSurfaceState {
  return {
    fragrance_id: item.fragrance_id,
    name: item.name,
    brand: item.brand ?? null,
    family_key: item.family_key ?? null,
    family_label: item.family_label ?? (item.family_key ? getFamilyLabelText(item.family_key) : null),
    family_color_token: item.family_key ?? null,
    wardrobe_role_key: null,
    wardrobe_role_label: null,
    role_confidence: null,
    role_source: null,
    release_year: item.release_year ?? null,
    concentration: item.concentration ?? null,
    perfumer: null,
    short_description: null,
    description_source: null,
    description_generated_at: null,
    image_url: item.image_url ?? null,
    thumbnail_url: item.thumbnail_url ?? null,
    image_source: null,
    source_page_url: item.source_url ?? null,
    image_license_status: null,
    image_last_checked_at: null,
    notes: sanitizeTokenSource(item.notes),
    accords: sanitizeTokenSource(item.accords),
    top_notes: sanitizeTokenSource(item.top_notes),
    middle_notes: sanitizeTokenSource(item.heart_notes),
    base_notes: sanitizeTokenSource(item.base_notes),
    why_it_fits_wardrobe: null,
    source_confidence: item.source_confidence ?? null,
    longevity_score: null,
    projection_score: null,
    odor_impact_score: null,
    density_score: null,
    transparency_score: null,
    beast_mode_score: null,
    retired: false,
    collection_status: null,
    rating: null,
    source_label: 'Profile detail',
    detail_loading: false,
    detail_error: null,
  };
}

function buildFragranceDetailSurfaceStateFromDisplayCard(card: DisplayCard): OdaraFragranceDetailSurfaceState {
  return {
    fragrance_id: card.fragrance_id ?? null,
    name: card.name ?? '',
    brand: card.brand ?? null,
    family_key: card.family ?? null,
    family_label: card.family ? getFamilyLabelText(card.family) : null,
    family_color_token: card.family ?? null,
    wardrobe_role_key: null,
    wardrobe_role_label: null,
    role_confidence: null,
    role_source: null,
    release_year: null,
    concentration: null,
    perfumer: null,
    short_description: null,
    description_source: null,
    description_generated_at: null,
    image_url: card.image_url ?? null,
    thumbnail_url: null,
    image_source: null,
    source_page_url: null,
    image_license_status: null,
    image_last_checked_at: null,
    notes: sanitizeTokenSource(card.notes),
    accords: sanitizeTokenSource(card.accords),
    top_notes: [],
    middle_notes: [],
    base_notes: [],
    why_it_fits_wardrobe: null,
    source_confidence: null,
    longevity_score: null,
    projection_score: null,
    odor_impact_score: null,
    density_score: null,
    transparency_score: null,
    beast_mode_score: null,
    retired: false,
    collection_status: card.isHero ? 'today_pick' : 'queue',
    rating: null,
    source_label: card.isHero ? 'Today pick' : 'Card detail',
  };
}

function buildFragranceDetailSurfaceStateFromSearchResult(result: OdaraSearchFragranceResult): OdaraFragranceDetailSurfaceState {
  return {
    fragrance_id: result.fragrance_id ?? null,
    name: result.title ?? '',
    brand: result.brand ?? null,
    family_key: result.family_key ?? null,
    family_label: result.family_key ? getFamilyLabelText(result.family_key) : null,
    family_color_token: result.family_key ?? null,
    wardrobe_role_key: null,
    wardrobe_role_label: null,
    role_confidence: null,
    role_source: null,
    release_year: null,
    concentration: null,
    perfumer: null,
    short_description: null,
    description_source: null,
    description_generated_at: null,
    image_url: result.image_url ?? null,
    thumbnail_url: null,
    image_source: null,
    source_page_url: null,
    image_license_status: null,
    image_last_checked_at: null,
    notes: sanitizeTokenSource(result.notes),
    accords: sanitizeTokenSource(result.accords),
    top_notes: [],
    middle_notes: [],
    base_notes: [],
    why_it_fits_wardrobe: null,
    source_confidence: null,
    longevity_score: null,
    projection_score: null,
    odor_impact_score: null,
    density_score: null,
    transparency_score: null,
    beast_mode_score: null,
    retired: false,
    collection_status: null,
    rating: null,
    source_label: 'Search result',
    detail_loading: false,
    detail_error: null,
  };
}

function buildFragranceDetailSurfaceStateFromLayerEntry(
  entry: NonNullable<LayerModes[LayerMood]>,
  imageUrl?: string | null,
): OdaraFragranceDetailSurfaceState {
  return {
    fragrance_id: entry.id ?? null,
    name: entry.name ?? '',
    brand: entry.brand ?? null,
    family_key: entry.family_key ?? null,
    family_label: entry.family_key ? getFamilyLabelText(entry.family_key) : null,
    family_color_token: entry.family_key ?? null,
    wardrobe_role_key: null,
    wardrobe_role_label: null,
    role_confidence: null,
    role_source: null,
    release_year: null,
    concentration: null,
    perfumer: null,
    short_description: null,
    description_source: null,
    description_generated_at: null,
    image_url: imageUrl ?? entry.image_url ?? null,
    thumbnail_url: null,
    image_source: null,
    source_page_url: null,
    image_license_status: null,
    image_last_checked_at: null,
    notes: sanitizeTokenSource(entry.notes),
    accords: sanitizeTokenSource(entry.accords),
    top_notes: [],
    middle_notes: [],
    base_notes: [],
    why_it_fits_wardrobe: null,
    source_confidence: null,
    longevity_score: null,
    projection_score: null,
    odor_impact_score: null,
    density_score: null,
    transparency_score: null,
    beast_mode_score: null,
    retired: false,
    collection_status: 'layer',
    rating: null,
    source_label: 'Layer detail',
    detail_loading: false,
    detail_error: null,
  };
}

function mergeFragranceDetailSurfaceState(
  current: OdaraFragranceDetailSurfaceState,
  detail: FragranceDetail | null | undefined,
): OdaraFragranceDetailSurfaceState {
  if (!detail) return current;
  return {
    ...current,
    fragrance_id: current.fragrance_id ?? detail.id,
    name: current.name || detail.name || '',
    brand: current.brand || detail.brand || null,
    family_key: current.family_key || detail.family_key || null,
    family_label:
      current.family_label
      || (current.family_key ? getFamilyLabelText(current.family_key) : null)
      || (detail.family_key ? getFamilyLabelText(detail.family_key) : null),
    family_color_token: current.family_color_token ?? detail.family_color_token ?? detail.family_key ?? null,
    wardrobe_role_key: current.wardrobe_role_key ?? detail.wardrobe_role_key ?? null,
    wardrobe_role_label: current.wardrobe_role_label ?? detail.wardrobe_role_label ?? null,
    role_confidence: current.role_confidence ?? detail.role_confidence ?? null,
    role_source: current.role_source ?? detail.role_source ?? null,
    release_year: current.release_year ?? detail.release_year ?? null,
    concentration: current.concentration ?? detail.concentration ?? null,
    perfumer: current.perfumer ?? detail.perfumer ?? null,
    short_description: current.short_description ?? detail.short_description ?? null,
    description_source: current.description_source ?? detail.description_source ?? null,
    description_generated_at: current.description_generated_at ?? detail.description_generated_at ?? null,
    timeline_source: current.timeline_source ?? detail.timeline_source ?? null,
    image_url: current.image_url ?? detail.image_url ?? null,
    thumbnail_url: current.thumbnail_url ?? detail.thumbnail_url ?? null,
    image_source: current.image_source ?? detail.image_source ?? null,
    source_page_url: current.source_page_url ?? detail.source_page_url ?? null,
    image_license_status: current.image_license_status ?? detail.image_license_status ?? null,
    image_last_checked_at: current.image_last_checked_at ?? detail.image_last_checked_at ?? null,
    notes: current.notes.length > 0 ? current.notes : sanitizeTokenSource(detail.notes),
    accords: current.accords.length > 0 ? current.accords : sanitizeTokenSource(detail.accords),
    top_notes: (current.top_notes?.length ?? 0) > 0 ? current.top_notes : sanitizeTokenSource(detail.top_notes),
    middle_notes: (current.middle_notes?.length ?? 0) > 0 ? current.middle_notes : sanitizeTokenSource(detail.middle_notes),
    base_notes: (current.base_notes?.length ?? 0) > 0 ? current.base_notes : sanitizeTokenSource(detail.base_notes),
    longevity_score: current.longevity_score ?? detail.longevity_score ?? null,
    longevity_source: current.longevity_source ?? detail.longevity_source ?? null,
    projection_score: current.projection_score ?? detail.projection_score ?? null,
    projection_source: current.projection_source ?? detail.projection_source ?? null,
    odor_impact_score: current.odor_impact_score ?? detail.odor_impact_score ?? null,
    density_score: current.density_score ?? detail.density_score ?? null,
    transparency_score: current.transparency_score ?? detail.transparency_score ?? null,
    beast_mode_score: current.beast_mode_score ?? detail.beast_mode_score ?? null,
    trail_source: current.trail_source ?? detail.trail_source ?? null,
    why_it_fits_wardrobe: current.why_it_fits_wardrobe ?? detail.why_it_fits_wardrobe ?? null,
    source_confidence: current.source_confidence ?? detail.source_confidence ?? null,
    retired: current.retired ?? detail.retired ?? false,
    rating: current.rating ?? normalizeCollectionRating(detail.rating),
    detail_loading: false,
    detail_error: null,
  };
}

async function fetchOdaraFragranceDetailForSurface(
  fragranceId: string,
  userId: string | null,
  isGuestMode: boolean,
): Promise<FragranceDetail | null> {
  if (!fragranceId) return null;

  try {
    const [
      { data: profileData, error: profileError },
      { data, error },
      imageAssetMap,
    ] = await Promise.all([
      odaraSupabase.rpc('get_fragrance_profile_v1' as any, {
        p_user: isGuestMode ? null : userId,
        p_fragrance_id: fragranceId,
      } as any),
      odaraSupabase
        .from('fragrances' as any)
        .select('id, name, brand, family_key, notes, accords, top_notes, heart_notes, base_notes, release_year, concentration, perfumer, longevity_score, projection_score, source_confidence, source_url')
        .eq('id', fragranceId)
        .maybeSingle(),
      fetchWardrobeImageAssetMap([fragranceId]),
    ]);

    const payload = (!profileError && profileData && (profileData as any)?.found)
      ? (profileData as any)
      : null;

    if (!payload && (error || !(data as any)?.id)) {
      return null;
    }

    const imageAsset = imageAssetMap.get(fragranceId) ?? null;
    return finalizeFragranceDetail({
      id: payload?.fragrance_id ?? (data as any)?.id ?? fragranceId,
      name: payload?.name ?? (data as any)?.name ?? '',
      brand: payload?.brand ?? (data as any)?.brand ?? null,
      family_key: payload?.family_key ?? (data as any)?.family_key ?? null,
      family_color_token: payload?.family_color_token ?? payload?.family_key ?? (data as any)?.family_key ?? null,
      wardrobe_role_key: payload?.wardrobe_role_key ?? null,
      wardrobe_role_label: payload?.wardrobe_role_label ?? null,
      role_confidence: payload?.role_confidence ?? null,
      role_source: payload?.role_source ?? null,
      release_year: payload?.release_year ?? (typeof (data as any)?.release_year === 'number' ? (data as any).release_year : null),
      concentration: payload?.concentration ?? (typeof (data as any)?.concentration === 'string' ? (data as any).concentration : null),
      perfumer: payload?.perfumer ?? (typeof (data as any)?.perfumer === 'string' ? (data as any).perfumer : null),
      short_description: payload?.short_description ?? null,
      description_source: payload?.description_source ?? null,
      description_generated_at: payload?.description_generated_at ?? null,
      timeline_source: null,
      notes: Array.isArray(payload?.notes) ? payload.notes : (Array.isArray((data as any)?.notes) ? (data as any).notes : []),
      accords: Array.isArray(payload?.accords) ? payload.accords : (Array.isArray((data as any)?.accords) ? (data as any).accords : []),
      top_notes: Array.isArray(payload?.top_notes) ? payload.top_notes : (Array.isArray((data as any)?.top_notes) ? (data as any).top_notes : []),
      middle_notes: Array.isArray(payload?.middle_notes) ? payload.middle_notes : (Array.isArray((data as any)?.heart_notes) ? (data as any).heart_notes : []),
      base_notes: Array.isArray(payload?.base_notes) ? payload.base_notes : (Array.isArray((data as any)?.base_notes) ? (data as any).base_notes : []),
      longevity_score: normalizeDetailScore(payload?.longevity_score ?? (data as any)?.longevity_score),
      longevity_source: null,
      projection_score: normalizeDetailScore(payload?.projection_score ?? (data as any)?.projection_score),
      projection_source: null,
      odor_impact_score: normalizeDetailScore(payload?.odor_impact_score ?? payload?.odor_impact_confidence),
      density_score: normalizeDetailScore(payload?.density_score),
      transparency_score: normalizeDetailScore(payload?.transparency_score),
      beast_mode_score: normalizeDetailScore(payload?.beast_mode_score),
      trail_source: null,
      why_it_fits_wardrobe: typeof payload?.why_it_fits_wardrobe === 'string' ? payload.why_it_fits_wardrobe : null,
      source_confidence: typeof payload?.source_confidence === 'string'
        ? payload.source_confidence
        : (typeof (data as any)?.source_confidence === 'string' ? (data as any).source_confidence : null),
      retired: Boolean(payload?.retired),
      rating: normalizeCollectionRating(payload?.rating),
      profile_loaded: true,
      image_url: resolvePreferredWardrobeBottleImage(payload, imageAsset, data, payload?.image_url, payload?.thumbnail_url),
      thumbnail_url: payload?.thumbnail_url ?? imageAsset?.thumbnail_url ?? null,
      image_source: payload?.image_source ?? imageAsset?.image_source ?? null,
      source_page_url: payload?.source_page_url ?? payload?.source_url ?? imageAsset?.source_url ?? (typeof (data as any)?.source_url === 'string' ? (data as any).source_url : null),
      image_license_status: payload?.image_license_status ?? null,
      image_last_checked_at: imageAsset?.updated_at ?? null,
    });
  } catch {
    return null;
  }
}

const OdaraProfilePage: React.FC<{
  onClose: () => void;
  onOpenCollection: (preset?: OdaraCollectionEntryPreset) => void;
  onOpenFragranceDetail: (detail: OdaraFragranceDetailSurfaceState) => void;
  onSearch?: () => void;
  userId: string | null;
  isGuestMode: boolean;
}> = ({
  onClose,
  onOpenCollection,
  onOpenFragranceDetail,
  onSearch,
  userId,
  isGuestMode,
}) => {
  const {
    activeSessionUser,
    activeSessionUserId,
    sessionResolved,
  } = useOdaraActiveSessionUser({
    userId,
    isGuestMode,
    scope: 'profile',
  });
  const [profilePayload, setProfilePayload] = useState<OdaraProfileDossierPayload | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [authIdentity, setAuthIdentity] = useState<OdaraAuthProfileIdentity | null>(null);
  const [activeSection, setActiveSection] = useState<'dashboard' | 'saved' | 'liked'>('dashboard');
  const [wishlistCount, setWishlistCount] = useState(0);
  const [savedLibraryPayload, setSavedLibraryPayload] = useState<OdaraProfileSavedItemsPayload | null>(null);
  const [savedLibraryLoading, setSavedLibraryLoading] = useState(false);
  const [savedLibraryError, setSavedLibraryError] = useState<string | null>(null);
  const [likedPreferenceRows, setLikedPreferenceRows] = useState<Array<{
    fragrance_id: string;
    preference_state: PersistedPreferenceMomentState;
    updated_at: string | null;
    created_at: string | null;
    last_event_at: string | null;
  }>>([]);
  const [likedMomentRows, setLikedMomentRows] = useState<PersistedPreferenceMoment[]>([]);
  const [likedLibraryLoading, setLikedLibraryLoading] = useState(false);
  const [likedLibraryError, setLikedLibraryError] = useState<string | null>(null);
  const [profileCatalogById, setProfileCatalogById] = useState<Record<string, OdaraWardrobeCatalogItem>>({});

  useEffect(() => {
    let active = true;

    if (!isGuestMode && !sessionResolved) {
      setProfileLoading(true);
      setProfileError(null);
      return () => {
        active = false;
      };
    }

    if (!isGuestMode && !activeSessionUserId) {
      setProfilePayload(null);
      setProfileLoading(false);
      setProfileError('No signed-in profile is available yet.');
      return () => {
        active = false;
      };
    }

    setProfileLoading(true);
    setProfileError(null);
    setProfilePayload(null);

    (async () => {
      const { data, error } = await odaraSupabase.rpc('get_odara_profile_dossier_v1' as any, {
        p_user_id: isGuestMode ? null : activeSessionUserId,
        p_surface: isGuestMode ? 'guest' : 'signed_in',
      } as any);

      if (!active) return;

      if (error) {
        setProfilePayload(null);
        setProfileError(error.message || 'Could not load the live dossier.');
        setProfileLoading(false);
        return;
      }

      setProfilePayload((data ?? null) as OdaraProfileDossierPayload | null);
      setProfileLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [activeSessionUserId, isGuestMode, sessionResolved]);

  useEffect(() => {
    setActiveSection('dashboard');
  }, [activeSessionUserId, isGuestMode]);

  useEffect(() => {
    setSavedLibraryPayload(null);
    setSavedLibraryLoading(false);
    setSavedLibraryError(null);
    setLikedPreferenceRows([]);
    setLikedMomentRows([]);
    setLikedLibraryLoading(false);
    setLikedLibraryError(null);
    setProfileCatalogById({});
  }, [activeSessionUserId, isGuestMode]);

  useEffect(() => {
    setAuthIdentity(isGuestMode ? null : readAuthProfileIdentity(activeSessionUser));
  }, [activeSessionUser, isGuestMode]);

  const mergeProfileCatalogItems = useCallback((items: OdaraWardrobeCatalogItem[]) => {
    setProfileCatalogById((current) => {
      const next = { ...current };
      let changed = false;
      for (const item of items) {
        if (!item?.fragrance_id) continue;
        if (next[item.fragrance_id] === item) continue;
        next[item.fragrance_id] = item;
        changed = true;
      }
      return changed ? next : current;
    });
  }, []);

  useEffect(() => {
    let active = true;

    if (!isGuestMode && !sessionResolved) {
      return () => {
        active = false;
      };
    }

    if (isGuestMode || !activeSessionUserId) {
      setWishlistCount(0);
      return () => {
        active = false;
      };
    }

    (async () => {
      const { data, error } = await odaraSupabase.rpc('get_user_collection_wishlist_signals_v1' as any, {
        p_user_id: activeSessionUserId,
      } as any);

      if (!active) return;
      if (error) {
        setWishlistCount(0);
        return;
      }

      const items = Array.isArray((data as any)?.items)
        ? (data as any).items
        : Array.isArray(data)
          ? data
          : [];
      setWishlistCount(items.length);
    })();

    return () => {
      active = false;
    };
  }, [activeSessionUserId, isGuestMode, sessionResolved]);

  useEffect(() => {
    let active = true;

    if (!isGuestMode && !sessionResolved) {
      return () => {
        active = false;
      };
    }

    if (activeSection !== 'saved' || isGuestMode || !activeSessionUserId) {
      return () => {
        active = false;
      };
    }

    setSavedLibraryLoading(true);
    setSavedLibraryError(null);
    setSavedLibraryPayload(null);

    (async () => {
      const { data, error } = await odaraSupabase.rpc('get_odara_profile_saved_items_v1' as any, {
        p_user_id: activeSessionUserId,
      } as any);

      if (!active) return;
      if (error) {
        setSavedLibraryPayload(null);
        setSavedLibraryError(error.message || 'Could not load saved scent moments yet.');
        setSavedLibraryLoading(false);
        return;
      }

      const normalized = normalizeProfileSavedItemsPayload(data ?? null);
      setSavedLibraryPayload(normalized);

      const ids = Array.from(new Set(
        normalized.items
          .flatMap((item) => [item.main_fragrance_id, item.layer_fragrance_id])
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter(Boolean),
      ));

      if (ids.length > 0) {
        try {
          const items = await fetchOdaraWardrobeCatalogByIds(ids);
          if (active) mergeProfileCatalogItems(items);
        } catch {
          // Saved cards can still render honest text without catalog enrichment.
        }
      }

      if (active) {
        setSavedLibraryLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [activeSection, activeSessionUserId, isGuestMode, mergeProfileCatalogItems, sessionResolved]);

  useEffect(() => {
    let active = true;

    if (!isGuestMode && !sessionResolved) {
      return () => {
        active = false;
      };
    }

    if (activeSection !== 'liked' || isGuestMode || !activeSessionUserId) {
      return () => {
        active = false;
      };
    }

    setLikedLibraryLoading(true);
    setLikedLibraryError(null);
    setLikedPreferenceRows([]);
    setLikedMomentRows([]);

    (async () => {
      try {
        const [{ data: preferenceData, error: preferenceError }, { data: dayMemoryRows, error: dayMemoryError }] = await Promise.all([
          odaraSupabase.rpc('get_user_fragrance_preference_signals_v1' as any, {
            p_user_id: activeSessionUserId,
          } as any),
          odaraSupabase
            .from(ODARA_SIGNED_IN_DAY_MEMORY_TABLE as any)
            .select('date_key, context_key, state_json, updated_at')
            .eq('user_id', activeSessionUserId),
        ]);

        if (!active) return;
        if (preferenceError) throw preferenceError;
        if (dayMemoryError) throw dayMemoryError;

        const preferenceItems = Array.isArray((preferenceData as any)?.items)
          ? (preferenceData as any).items
          : Array.isArray(preferenceData)
            ? preferenceData
            : [];

        const positivePreferences = preferenceItems
          .map((row: any) => {
            const fragranceId = readTrimmedLayerText(row?.fragrance_id);
            const preferenceState = normalizePersistedPreferenceMomentState(row?.preference_state);
            if (!fragranceId || !preferenceState) return null;
            return {
              fragrance_id: fragranceId,
              preference_state: preferenceState,
              updated_at: readTrimmedLayerText(row?.updated_at) || null,
              created_at: readTrimmedLayerText(row?.created_at) || null,
              last_event_at: readTrimmedLayerText(row?.last_event_at) || null,
            };
          })
          .filter((row: any): row is {
            fragrance_id: string;
            preference_state: PersistedPreferenceMomentState;
            updated_at: string | null;
            created_at: string | null;
            last_event_at: string | null;
          } => !!row);

        const capturedMoments: PersistedPreferenceMoment[] = [];
        for (const row of Array.isArray(dayMemoryRows) ? dayMemoryRows : []) {
          const dateKey = readTrimmedLayerText(row?.date_key) || null;
          const contextKey = readTrimmedLayerText(row?.context_key) || null;
          const updatedAt = readTrimmedLayerText(row?.updated_at) || null;
          const state = deserializeSignedInDayStateFromStorage(row?.state_json);
          for (const moment of Array.isArray(state.preferenceMoments) ? state.preferenceMoments : []) {
            const normalized = toPersistedPreferenceMoment({
              ...moment,
              date_key: moment.date_key ?? dateKey,
              context_key: moment.context_key ?? contextKey,
              created_at: moment.created_at ?? updatedAt,
            });
            if (normalized) capturedMoments.push(normalized);
          }
        }

        setLikedPreferenceRows(positivePreferences);
        setLikedMomentRows(capturedMoments);

        const ids = Array.from(new Set(
          [
            ...positivePreferences.map((item) => item.fragrance_id),
            ...capturedMoments.flatMap((item) => [
              item.main?.fragrance_id,
              item.layer?.fragrance_id,
            ]),
          ]
            .map((value) => (typeof value === 'string' ? value.trim() : ''))
            .filter(Boolean),
        ));

        if (ids.length > 0) {
          try {
            const items = await fetchOdaraWardrobeCatalogByIds(ids);
            if (active) mergeProfileCatalogItems(items);
          } catch {
            // Liked moments fall back to captured names when catalog enrichment misses.
          }
        }
      } catch (error: any) {
        if (!active) return;
        setLikedPreferenceRows([]);
        setLikedMomentRows([]);
        setLikedLibraryError(error?.message || 'Could not load liked scent moments yet.');
      } finally {
        if (active) {
          setLikedLibraryLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [activeSection, activeSessionUserId, isGuestMode, mergeProfileCatalogItems, sessionResolved]);

  const displayName =
    profilePayload?.profile_identity?.display_name
    ?? authIdentity?.displayName
    ?? (isGuestMode ? 'Guest Preview' : authIdentity?.email ?? '');
  const monogram =
    profilePayload?.profile_identity?.initials
    ?? deriveProfileMonogram(displayName || authIdentity?.email);
  const bottleCount = profilePayload?.collection_summary?.bottle_count ?? null;
  const familySegments = useMemo(
    () =>
      (profilePayload?.family_balance?.family_counts ?? []).slice(0, 6).map((segment) => ({
        key: segment.family_key,
        label: segment.label,
        count: Number(segment.count ?? 0),
        pct: Number(segment.pct ?? 0),
        color: FAMILY_COLORS[segment.family_color_token ?? segment.family_key] ?? '#888',
      })),
    [profilePayload]
  );
  const savedCount = profilePayload?.library?.saved_count ?? 0;
  const likedCount = (
    profilePayload?.preference_summary?.liked_count
    ?? profilePayload?.library?.liked_count
    ?? 0
  ) + (
    profilePayload?.preference_summary?.loved_count
    ?? profilePayload?.library?.loved_count
    ?? 0
  );
  const favoriteCount =
    profilePayload?.preference_summary?.favorite_count
    ?? profilePayload?.library?.favorite_count
    ?? 0;
  const wishlistMetric = profileLoading ? '…' : (wishlistCount > 0 ? String(wishlistCount) : '—');
  const wishlistSub = profileLoading ? 'Loading' : (wishlistCount > 0 ? 'Would buy' : 'None yet');
  const dominantFamilyKey = profilePayload?.family_balance?.dominant_family_key ?? null;
  const dossierTint = FAMILY_TINTS[dominantFamilyKey ?? ''] ?? DEFAULT_TINT;
  const dossierHeroVisual = getOdaraGlassCardVisualRecipe(dossierTint, 'hero');
  const dossierModuleVisual = getOdaraGlassCardVisualRecipe(dossierTint, 'collection');

  // Each tile shows one clean metric only — never invented.
  const savedMetric = profileLoading ? '…' : (savedCount > 0 ? String(savedCount) : '—');
  const savedSub = profileLoading ? 'Loading' : (savedCount > 0 ? 'Moments / combos' : 'None yet');
  const likedMetric = profileLoading ? '…' : (likedCount > 0 ? String(likedCount) : '—');
  const likedSub = profileLoading ? 'Loading' : (likedCount > 0 ? 'Liked / loved' : 'None yet');
  const favoritesMetric = profileLoading ? '…' : (favoriteCount > 0 ? String(favoriteCount) : '—');
  const favoritesSub = profileLoading ? 'Loading' : (favoriteCount > 0 ? 'Favorite bottles' : 'None yet');
  const profileChipLabel = readTrimmedLayerText(displayName, authIdentity?.email) || null;
  const shouldShowProfileChip = !isGuestMode && Boolean(profileChipLabel || authIdentity?.avatarUrl || monogram !== '—');

  const openProfileFragranceDetail = useCallback((value: {
    fragrance_id?: string | null;
    id?: string | null;
    name?: string | null;
    brand?: string | null;
    family_key?: string | null;
    family?: string | null;
    image_url?: string | null;
  } | null | undefined) => {
    const snapshot = buildPreferenceMomentFragranceSnapshot(value);
    if (!snapshot) return;
    const catalogItem = profileCatalogById[snapshot.fragrance_id];
    if (catalogItem) {
      onOpenFragranceDetail(buildFragranceDetailSurfaceStateFromWardrobeCatalogItem(catalogItem));
      return;
    }
    onOpenFragranceDetail(buildFragranceDetailSurfaceStateFromDisplayCard({
      fragrance_id: snapshot.fragrance_id,
      name: snapshot.name,
      brand: snapshot.brand ?? '',
      family: snapshot.family_key ?? '',
      reason: '',
      image_url: snapshot.image_url ?? null,
      notes: [],
      accords: [],
      reason_chip_label: null,
      reason_chip_explanation: null,
      isHero: false,
    }));
  }, [onOpenFragranceDetail, profileCatalogById]);

  const likedMomentByFragranceId = useMemo(() => {
    const next = new Map<string, PersistedPreferenceMoment>();
    for (const moment of likedMomentRows) {
      const current = next.get(moment.fragrance_id);
      const nextTs = Date.parse(moment.created_at ?? '') || 0;
      const currentTs = current ? (Date.parse(current.created_at ?? '') || 0) : 0;
      if (!current || nextTs >= currentTs) {
        next.set(moment.fragrance_id, moment);
      }
    }
    return next;
  }, [likedMomentRows]);

  const likedCards = useMemo(() => {
    return likedPreferenceRows
      .map((preference) => {
        const moment = likedMomentByFragranceId.get(preference.fragrance_id) ?? null;
        const mainSnapshot = moment?.main ?? buildPreferenceMomentFragranceSnapshot({
          fragrance_id: preference.fragrance_id,
          ...(profileCatalogById[preference.fragrance_id] ?? {}),
        });
        if (!mainSnapshot) return null;
        const layerSnapshot = moment?.layer ?? null;
        const mainCatalog = profileCatalogById[mainSnapshot.fragrance_id] ?? null;
        const layerCatalog = layerSnapshot?.fragrance_id ? (profileCatalogById[layerSnapshot.fragrance_id] ?? null) : null;
        const primaryTs = Date.parse(moment?.created_at ?? preference.last_event_at ?? preference.updated_at ?? preference.created_at ?? '') || 0;
        return {
          id: `${preference.fragrance_id}:${moment?.layer?.fragrance_id ?? 'single'}`,
          preference_state: preference.preference_state,
          main: mainCatalog
            ? buildPreferenceMomentFragranceSnapshot(mainCatalog)
            : mainSnapshot,
          layer: layerCatalog
            ? buildPreferenceMomentFragranceSnapshot(layerCatalog)
            : layerSnapshot,
          context_key: moment?.context_key ?? null,
          date_key: moment?.date_key ?? null,
          mode: moment?.mode ?? null,
          created_at: primaryTs,
          has_pair_context: Boolean(layerSnapshot?.fragrance_id),
          source_kind: moment ? 'captured_moment' : 'single_preference_fallback',
        };
      })
      .filter((item): item is NonNullable<typeof item> => !!item)
      .sort((a, b) => b.created_at - a.created_at);
  }, [likedMomentByFragranceId, likedPreferenceRows, profileCatalogById]);

  const savedCards = useMemo(() => {
    const items = savedLibraryPayload?.items ?? [];
    return items.map((item) => {
      const mainCatalog = item.main_fragrance_id ? (profileCatalogById[item.main_fragrance_id] ?? null) : null;
      const layerCatalog = item.layer_fragrance_id ? (profileCatalogById[item.layer_fragrance_id] ?? null) : null;
      const main = buildPreferenceMomentFragranceSnapshot(mainCatalog ?? {
        fragrance_id: item.main_fragrance_id,
        name: item.main_name,
        brand: item.main_brand,
      });
      const layer = buildPreferenceMomentFragranceSnapshot(layerCatalog ?? {
        fragrance_id: item.layer_fragrance_id,
        name: item.layer_name,
        brand: item.layer_brand,
      });
      return {
        ...item,
        main,
        layer,
      };
    });
  }, [profileCatalogById, savedLibraryPayload]);

  const favoriteLane = readTrimmedLayerText(
    profilePayload?.preference_summary?.favorite_lane,
    profilePayload?.family_balance?.dominant_family,
    profilePayload?.insights?.dominant_family?.value,
  );
  const houseGravity = readTrimmedLayerText(profilePayload?.preference_summary?.house_gravity);
  const leanValue = readTrimmedLayerText(profilePayload?.insights?.lean?.value);
  const textureValue = readTrimmedLayerText(profilePayload?.insights?.texture?.value);
  const dayNightValue = readTrimmedLayerText(profilePayload?.insights?.day_night?.value);
  const signatureGravity = readTrimmedLayerText(profilePayload?.insights?.signature_gravity?.value);
  const leanTags = [
    favoriteLane,
    leanValue && leanValue !== 'Balanced' ? leanValue : null,
    textureValue && textureValue !== 'Balanced' ? textureValue : null,
    dayNightValue && dayNightValue !== 'Balanced' ? dayNightValue : null,
  ].filter((value, index, array): value is string => !!value && array.indexOf(value) === index).slice(0, 3);
  const currentLeanHeadline = leanTags.length > 0
    ? `You’re leaning ${leanTags.join(', ')} lately.`
    : null;
  const currentLeanSupport = houseGravity
    ? `Keep an eye on ${houseGravity} and adjacent releases that stay in this lane.`
    : favoriteLane
      ? `Look for more ${favoriteLane.toLowerCase()} bottles that reinforce this direction.`
      : signatureGravity
        ? `Your taste is starting to ${signatureGravity.toLowerCase()} — keep following what feels easy to wear.`
        : null;

  const tiles: Array<{
    key: string;
    label: string;
    metric: string;
    sub: string;
    ariaLabel: string;
    onClick?: () => void;
  }> = [
    {
      key: 'saved',
      label: 'Saved',
      metric: savedMetric,
      sub: savedSub,
      ariaLabel: 'Open saved scent moments and combinations',
      onClick: !isGuestMode ? (() => setActiveSection('saved')) : undefined,
    },
    {
      key: 'liked',
      label: 'Liked',
      metric: likedMetric,
      sub: likedSub,
      ariaLabel: 'Open liked and loved scent moments',
      onClick: !isGuestMode ? (() => setActiveSection('liked')) : undefined,
    },
    {
      key: 'favorites',
      label: 'Favorites',
      metric: favoritesMetric,
      sub: favoritesSub,
      ariaLabel: 'Open favorite fragrances',
      onClick: !isGuestMode ? (() => onOpenCollection('favorites')) : undefined,
    },
    {
      key: 'wishlist',
      label: 'Wishlist',
      metric: wishlistMetric,
      sub: wishlistSub,
      ariaLabel: 'Open wishlist fragrances',
      onClick: !isGuestMode ? (() => onOpenCollection('wishlist')) : undefined,
    },
  ];

  // Build conic-gradient string for ring rendering — synced with familySegments.
  const ringGradient = useMemo(() => {
    if (familySegments.length === 0) return 'conic-gradient(rgba(255,255,255,0.05) 0deg 360deg)';
    let acc = 0;
    const stops: string[] = [];
    familySegments.forEach((seg) => {
      const start = acc;
      acc += (seg.pct / 100) * 360;
      stops.push(`${seg.color} ${start}deg ${acc}deg`);
    });
    if (acc < 359.9) {
      stops.push(`rgba(255,255,255,0.05) ${acc}deg 360deg`);
    }
    return `conic-gradient(${stops.join(', ')})`;
  }, [familySegments]);

  const renderProfileSectionIntro = (eyebrow: string, title: string, body: string) => (
    <div className="px-1">
      <div className="text-[10px] font-medium uppercase tracking-[0.32em] text-foreground/40">
        {eyebrow}
      </div>
      <div
        className="mt-2 text-[24px] leading-[1.02] text-foreground/94"
        style={{ fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: '-0.012em' }}
      >
        {title}
      </div>
      <div className="mt-2 max-w-[30rem] text-[12px] leading-[1.6] text-foreground/56">
        {body}
      </div>
    </div>
  );

  const renderProfileMomentCard = ({
    key,
    eyebrow,
    title,
    subtitle,
    main,
    layer,
    onClick,
  }: {
    key: string;
    eyebrow: string;
    title: string;
    subtitle: string | null;
    main: PersistedPreferenceMomentFragrance | null;
    layer?: PersistedPreferenceMomentFragrance | null;
    onClick?: () => void;
  }) => {
    const Tag: any = onClick ? 'button' : 'div';
    return (
      <Tag
        key={key}
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        className={`relative overflow-hidden rounded-[24px] p-4 text-left transition duration-200 ${onClick ? 'active:scale-[0.988]' : ''}`}
        style={dossierModuleVisual.surfaceStyle}
      >
        <div className={dossierModuleVisual.atmosphereClassName} style={dossierModuleVisual.atmosphereStyle} />
        <div className="relative z-[1] flex items-center gap-4">
          <div className="relative h-[118px] w-[100px] shrink-0">
            {main ? (
              <OdaraWardrobeBottleArt
                name={main.name}
                brand={main.brand}
                family_key={main.family_key}
                image_url={main.image_url}
                compact
                frameless
                className="h-[112px] w-[84px]"
              />
            ) : null}
            {layer ? (
              <OdaraWardrobeBottleArt
                name={layer.name}
                brand={layer.brand}
                family_key={layer.family_key}
                image_url={layer.image_url}
                compact
                frameless
                className="absolute bottom-0 right-[-4px] h-[72px] w-[56px]"
              />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[0.28em] text-foreground/40">
              {eyebrow}
            </div>
            <div
              className="mt-2 line-clamp-2 text-[22px] leading-[1.02] text-foreground/94"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: '-0.012em' }}
            >
              {title}
            </div>
            {layer ? (
              <div
                className="mt-1 line-clamp-2 text-[15px] leading-[1.2] text-foreground/72"
                style={{ fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: '-0.008em' }}
              >
                + {layer.name}
              </div>
            ) : null}
            {subtitle ? (
              <div className="mt-3 text-[11px] leading-[1.55] text-foreground/54">
                {subtitle}
              </div>
            ) : null}
          </div>
        </div>
      </Tag>
    );
  };

  const renderSavedContent = () => {
    if (savedLibraryLoading) {
      return (
        <div className="flex flex-col gap-4">
          {renderProfileSectionIntro('Saved', 'Saved scent moments', 'Reading the real saved recipes, combos, and layer ideas now.')}
          <OdaraInsetGroup emphasis>
            <div className="px-5 py-10 text-center text-[12px] leading-[1.6] text-foreground/52">
              Loading saved scent moments…
            </div>
          </OdaraInsetGroup>
        </div>
      );
    }

    if (savedLibraryError) {
      return (
        <div className="flex flex-col gap-4">
          {renderProfileSectionIntro('Saved', 'Saved scent moments', 'Saved recipes, combos, and layer ideas stay here when they exist.')}
          <OdaraInsetGroup emphasis>
            <div className="px-5 py-10 text-center text-[12px] leading-[1.6] text-foreground/52">
              {savedLibraryError}
            </div>
          </OdaraInsetGroup>
        </div>
      );
    }

    if (savedCards.length === 0) {
      return (
        <div className="flex flex-col gap-4">
          {renderProfileSectionIntro('Saved', 'Saved scent moments', 'Saved recipes, combos, and layer ideas stay here when they exist.')}
          <OdaraInsetGroup emphasis>
            <div className="px-5 py-10 text-center">
              <div className="text-[16px] text-foreground/86">No saved scent moments yet.</div>
              <div className="mx-auto mt-3 max-w-[250px] text-[12px] leading-[1.6] text-foreground/52">
                Save a pick or layer combo to find it here.
              </div>
            </div>
          </OdaraInsetGroup>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        {renderProfileSectionIntro('Saved', 'Saved scent moments', 'Saved recipes, combos, and layer ideas stay here when they exist.')}
        <div className="grid gap-3">
          {savedCards.map((item) => {
            const metaBits = [
              item.context_key ? formatProfileContextLabel(item.context_key) : null,
              item.wear_date ? formatProfileShortDate(item.wear_date) : null,
              item.mode ? formatProfileContextLabel(item.mode) : null,
              item.ratio_a && item.ratio_b ? `${item.ratio_a}:${item.ratio_b}` : null,
            ].filter(Boolean);
            const subtitle = [
              metaBits.join(' · ') || null,
              item.application_style || item.notes || null,
            ].filter(Boolean).join(' — ') || null;
            const title = item.main?.name ?? item.main_name ?? item.title ?? 'Saved item';
            return renderProfileMomentCard({
              key: item.item_id,
              eyebrow: item.item_kind === 'saved_recipe'
                ? 'Saved recipe'
                : item.item_kind === 'saved_layer_combo'
                  ? 'Saved combo'
                  : 'Saved layer',
              title,
              subtitle,
              main: item.main,
              layer: item.layer,
              onClick: item.main ? (() => openProfileFragranceDetail(item.main)) : undefined,
            });
          })}
        </div>
      </div>
    );
  };

  const renderLikedContent = () => {
    if (likedLibraryLoading) {
      return (
        <div className="flex flex-col gap-4">
          {renderProfileSectionIntro('Liked', 'Liked scent moments', 'Liked and loved cards keep their scent context when we have it.')}
          <OdaraInsetGroup emphasis>
            <div className="px-5 py-10 text-center text-[12px] leading-[1.6] text-foreground/52">
              Loading liked scent moments…
            </div>
          </OdaraInsetGroup>
        </div>
      );
    }

    if (likedLibraryError) {
      return (
        <div className="flex flex-col gap-4">
          {renderProfileSectionIntro('Liked', 'Liked scent moments', 'Liked and loved cards keep their scent context when we have it.')}
          <OdaraInsetGroup emphasis>
            <div className="px-5 py-10 text-center text-[12px] leading-[1.6] text-foreground/52">
              {likedLibraryError}
            </div>
          </OdaraInsetGroup>
        </div>
      );
    }

    if (likedCards.length === 0) {
      return (
        <div className="flex flex-col gap-4">
          {renderProfileSectionIntro('Liked', 'Liked scent moments', 'Liked and loved cards keep their scent context when we have it.')}
          <OdaraInsetGroup emphasis>
            <div className="px-5 py-10 text-center">
              <div className="text-[16px] text-foreground/86">No liked scent moments yet.</div>
              <div className="mx-auto mt-3 max-w-[250px] text-[12px] leading-[1.6] text-foreground/52">
                Like or love a pick to build your taste map.
              </div>
            </div>
          </OdaraInsetGroup>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        {renderProfileSectionIntro('Liked', 'Liked scent moments', 'Liked and loved cards stay here. Pair cards keep the layer when that context exists.')}
        <div className="grid gap-3">
          {likedCards.map((item) => {
            const metaBits = [
              item.preference_state === 'loved' ? 'Loved' : 'Liked',
              item.context_key ? formatProfileContextLabel(item.context_key) : null,
              item.date_key ? formatProfileShortDate(item.date_key) : null,
            ].filter(Boolean);
            const subtitle = item.source_kind === 'single_preference_fallback'
              ? `${metaBits.join(' · ')} — Historical like context wasn’t stored, so this stays a single bottle.`
              : metaBits.join(' · ');
            return renderProfileMomentCard({
              key: item.id,
              eyebrow: item.preference_state === 'loved' ? 'Loved moment' : 'Liked moment',
              title: item.main?.name ?? 'Liked fragrance',
              subtitle,
              main: item.main,
              layer: item.layer,
              onClick: item.main ? (() => openProfileFragranceDetail(item.main)) : undefined,
            });
          })}
        </div>
      </div>
    );
  };

  return (
    <OdaraDestinationChrome eyebrow="Dossier" onClose={activeSection === 'dashboard' ? onClose : () => setActiveSection('dashboard')} onSearch={onSearch} centerHeader>
      <div className="flex flex-col gap-5">
        {shouldShowProfileChip ? (
          <div className="flex justify-center">
            <div
              className="inline-flex max-w-full items-center gap-2 rounded-full px-2.5 py-1.5"
              style={{
                background: 'linear-gradient(180deg, rgba(20,22,28,0.7) 0%, rgba(10,12,16,0.58) 100%)',
                border: dossierModuleVisual.surfaceStyle.border,
                boxShadow: '0 10px 24px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.05)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
              }}
            >
              {authIdentity?.avatarUrl ? (
                <img
                  src={authIdentity.avatarUrl}
                  alt={profileChipLabel ? `${profileChipLabel} profile` : 'Profile'}
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-medium uppercase tracking-[0.14em] text-foreground/78"
                  style={{
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'radial-gradient(80% 80% at 30% 20%, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.018) 62%, rgba(0,0,0,0) 100%)',
                  }}
                >
                  {monogram || '—'}
                </div>
              )}
              {profileChipLabel ? (
                <div className="min-w-0">
                  <div className="truncate text-[11px] uppercase tracking-[0.18em] text-foreground/72">
                    {profileChipLabel}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeSection === 'dashboard' ? (
          <>
            <button
              type="button"
              onClick={() => onOpenCollection('all')}
              aria-label="Open Collection Coverage in wardrobe"
              className="relative overflow-hidden rounded-[26px] px-5 py-6 text-left transition-transform duration-200 hover:translate-y-[-1px] active:translate-y-0"
              style={dossierHeroVisual.surfaceStyle}
            >
              <div className={dossierHeroVisual.atmosphereClassName} style={dossierHeroVisual.atmosphereStyle} />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.08] to-transparent opacity-40" />
              <div className="relative z-[1] flex flex-col items-center gap-6">
                <div className="text-[10px] font-medium uppercase tracking-[0.32em] text-foreground/48">
                  Collection Coverage
                </div>
                <div className="relative">
                  <div
                    className="relative h-[176px] w-[176px] rounded-full"
                    style={{
                      background: ringGradient,
                      boxShadow: '0 0 0 1px rgba(255,255,255,0.04)',
                    }}
                  >
                    <div
                      className="absolute inset-[14px] flex flex-col items-center justify-center rounded-full"
                      style={{
                        background:
                          'radial-gradient(80% 80% at 50% 35%, rgba(28,29,34,0.96) 0%, rgba(12,13,17,0.98) 100%)',
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
                      }}
                    >
                      <div
                        className="text-[40px] leading-none text-foreground/92"
                        style={{ fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: '-0.015em' }}
                      >
                        {profileLoading ? '…' : (bottleCount ?? '—')}
                      </div>
                      <div className="mt-2 text-[9px] uppercase tracking-[0.36em] text-foreground/42">
                        BOTTLES
                      </div>
                    </div>
                  </div>
                </div>

                {familySegments.length > 0 ? (
                  <div className="grid w-full grid-cols-2 gap-x-5 gap-y-3">
                    {familySegments.map((segment) => (
                      <div key={segment.key} className="flex items-center gap-2.5">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            background: segment.color,
                            boxShadow: `0 0 10px ${segment.color}55`,
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] text-foreground/82">{segment.label}</div>
                          <div className="text-[10px] uppercase tracking-[0.18em] text-foreground/42">
                            {segment.count}
                            {segment.pct > 0 ? ` · ${Math.round(segment.pct)}%` : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11.5px] text-foreground/50">
                    {profileError
                      ? 'Could not load live collection coverage yet.'
                      : profileLoading
                        ? 'Building coverage from the real wardrobe…'
                        : 'No real bottles yet.'}
                  </div>
                )}
              </div>
            </button>

            <div className="grid grid-cols-2 gap-2.5">
              {tiles.map((tile) => {
                const Tag: any = tile.onClick ? 'button' : 'div';
                return (
                  <Tag
                    key={tile.key}
                    type={tile.onClick ? 'button' : undefined}
                    onClick={tile.onClick}
                    aria-label={tile.onClick ? tile.ariaLabel : undefined}
                    className={`relative overflow-hidden rounded-[20px] px-4 py-4 text-left transition-transform duration-200 ${tile.onClick ? 'hover:translate-y-[-1px] active:translate-y-0' : ''}`}
                    style={dossierModuleVisual.surfaceStyle}
                  >
                    <div className={dossierModuleVisual.atmosphereClassName} style={dossierModuleVisual.atmosphereStyle} />
                    <div className="relative z-[1]">
                      <div className="text-[9.5px] uppercase tracking-[0.32em] text-foreground/42">
                        {tile.label}
                      </div>
                      <div
                        className="mt-3 text-[24px] leading-none text-foreground/92"
                        style={{ fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: '-0.01em' }}
                      >
                        {tile.metric}
                      </div>
                      <div className="mt-1.5 text-[10px] uppercase tracking-[0.22em] text-foreground/45">
                        {tile.sub}
                      </div>
                    </div>
                  </Tag>
                );
              })}
            </div>

            <div
              className="relative overflow-hidden rounded-[24px] px-5 py-5"
              style={dossierModuleVisual.surfaceStyle}
            >
              <div className={dossierModuleVisual.atmosphereClassName} style={{ ...dossierModuleVisual.atmosphereStyle, opacity: 0.24 }} />
              <div className="relative z-[1]">
                <div className="text-[10px] uppercase tracking-[0.3em] text-foreground/42">
                  Current Lean
                </div>
                <div
                  className="mt-3 text-[23px] leading-[1.06] text-foreground/94"
                  style={{ fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: '-0.012em' }}
                >
                  {currentLeanHeadline ?? 'Add or wear more fragrances to reveal your current lean.'}
                </div>
                <div className="mt-3 max-w-[30rem] text-[12px] leading-[1.65] text-foreground/56">
                  {currentLeanSupport ?? 'We only sharpen this from real wear, owned bottles, and real likes.'}
                </div>
                {leanTags.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {leanTags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-foreground/76"
                        style={{
                          border: '1px solid rgba(255,255,255,0.08)',
                          background: 'rgba(255,255,255,0.035)',
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </>
        ) : activeSection === 'saved' ? renderSavedContent() : renderLikedContent()}
      </div>
    </OdaraDestinationChrome>
  );
};

const COLLECTION_FILTER_OPTIONS: Array<{ value: OdaraCollectionFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'rated', label: 'Rated' },
  { value: 'unrated', label: 'Unrated' },
  { value: 'retired', label: 'Retired' },
  { value: 'anchor', label: 'Anchors' },
  { value: 'layer_tool', label: 'Layer Tools' },
  { value: 'brightener', label: 'Brighteners' },
  { value: 'bridge', label: 'Bridges' },
  { value: 'accent', label: 'Accents' },
];

const COLLECTION_SORT_OPTIONS: Array<{ value: OdaraCollectionSort; label: string }> = [
  { value: 'role', label: 'Role' },
  { value: 'rating', label: 'Rating' },
  { value: 'family', label: 'Family' },
  { value: 'name', label: 'Name' },
  { value: 'brand', label: 'Brand' },
];

const COLLECTION_RATING_ACTIVE_COLOR = '#e7b55f';
const COLLECTION_RETIRED_ACTIVE_COLOR = '#e25757';
const COLLECTION_ACTION_BUTTON_STYLE = {
  ...CARD_ACTION_BUTTON_BASE_STYLE,
  width: 30,
  height: 30,
  minWidth: 30,
  minHeight: 30,
} as const;

const CollectionRatingStars: React.FC<{
  rating: number | null | undefined;
  size?: number;
  active?: boolean;
}> = ({ rating, size = 12, active = false }) => {
  const resolved = normalizeCollectionRating(rating) ?? 0;
  return (
    <div className="flex items-center justify-center gap-[2px]" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => {
        const filled = index + 1 <= resolved;
        return (
          <svg
            key={index}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill={filled ? COLLECTION_RATING_ACTIVE_COLOR : 'none'}
            stroke={filled ? COLLECTION_RATING_ACTIVE_COLOR : active ? 'rgba(255,255,255,0.54)' : 'rgba(255,255,255,0.24)'}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              filter: filled ? `drop-shadow(0 0 5px ${COLLECTION_RATING_ACTIVE_COLOR}55)` : undefined,
              transform: active && filled ? 'translateY(-1px)' : 'none',
              transition: 'transform 160ms ease, filter 160ms ease, stroke 160ms ease, fill 160ms ease',
            }}
          >
            <path d="M12 3.4l2.67 5.4 5.96.87-4.32 4.2 1.02 5.93L12 17.02 6.67 19.8l1.02-5.93-4.32-4.2 5.96-.87L12 3.4z" />
          </svg>
        );
      })}
    </div>
  );
};

const CollectionRetireButton: React.FC<{
  active: boolean;
  disabled?: boolean;
  onToggle: () => void;
}> = ({ active, disabled, onToggle }) => {
  return (
    <button
      type="button"
      data-collection-control
      aria-label={active ? 'Unretire bottle' : 'Retire bottle'}
      aria-pressed={active}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={`${CARD_ACTION_BUTTON_BASE_CLASS} relative inline-flex h-[30px] w-[30px] items-center justify-center rounded-full`}
      style={{
        ...COLLECTION_ACTION_BUTTON_STYLE,
        ...(active
          ? {
              color: COLLECTION_RETIRED_ACTIVE_COLOR,
              background: 'rgba(226,87,87,0.14)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 10px 22px rgba(226,87,87,0.16)',
            }
          : CARD_ACTION_BUTTON_INACTIVE_STYLE),
      }}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke={active ? COLLECTION_RETIRED_ACTIVE_COLOR : 'currentColor'}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          filter: active ? `drop-shadow(0 0 5px ${COLLECTION_RETIRED_ACTIVE_COLOR}55)` : undefined,
        }}
        >
          <circle cx="12" cy="12" r="8" />
          <path d="M8.2 15.8l7.6-7.6" />
      </svg>
    </button>
  );
};

const OdaraBottomSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  surfaceStyle?: React.CSSProperties;
  atmosphereClassName?: string;
  atmosphereStyle?: React.CSSProperties;
}> = ({ open, onClose, children, surfaceStyle, atmosphereClassName, atmosphereStyle }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[72]">
      <button
        type="button"
        aria-label="Close sheet"
        className="absolute inset-0 bg-black/58 backdrop-blur-[3px]"
        onClick={onClose}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)]">
        <div
          className="pointer-events-auto w-full max-w-md overflow-hidden rounded-[28px] border"
          style={{
            borderColor: 'rgba(255,255,255,0.08)',
            background: 'linear-gradient(180deg, rgba(18,19,24,0.96) 0%, rgba(10,11,14,0.98) 100%)',
            ...surfaceStyle,
            backdropFilter: surfaceStyle?.backdropFilter ?? 'blur(24px)',
            WebkitBackdropFilter: surfaceStyle?.WebkitBackdropFilter ?? 'blur(24px)',
            boxShadow: surfaceStyle?.boxShadow ?? '0 28px 72px rgba(0,0,0,0.56), inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
          role="dialog"
          aria-modal="true"
        >
          {atmosphereClassName ? (
            <div className={atmosphereClassName} style={atmosphereStyle} />
          ) : null}
          <div className="relative z-[1] mx-auto mt-3 h-1.5 w-12 rounded-full bg-white/14" />
          <div className="relative z-[1]">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

type ResolvedTaxonomyFacet = { key?: string | null; display_label?: string | null; label?: string | null };
type ResolvedTaxonomyRole = { key?: string | null; display_label?: string | null; label?: string | null; role_priority?: number | null; priority?: number | null };
type ResolvedTaxonomyPayload = {
  family_display_label?: string | null;
  universal_family_label?: string | null;
  universal_family_key?: string | null;
  legacy_family_key?: string | null;
  facets?: ResolvedTaxonomyFacet[] | null;
  wardrobe_roles?: ResolvedTaxonomyRole[] | null;
  roles?: ResolvedTaxonomyRole[] | null;
  review_status?: string | null;
  source_confidence?: number | string | null;
};

const fragranceTaxonomyCache = new Map<string, ResolvedTaxonomyPayload | null>();
const fragranceTaxonomyInFlight = new Map<string, Promise<ResolvedTaxonomyPayload | null>>();

type ScentIntelInput = {
  label: string;
  slug?: string | null;
  fragranceId?: string | null;
  fragranceName?: string | null;
  fragranceBrand?: string | null;
  position?: string | null;
  sourceFamilyKey?: string | null;
  sourceFamilyLabel?: string | null;
};

type ScentIntelTerm = {
  slug?: string | null;
  label?: string | null;
  term_type?: string | null;
  scent_category?: string | null;
  family_key?: string | null;
  short_label?: string | null;
  what_it_is?: string | null;
  smells_like?: unknown;
  used_for?: string | null;
  what_it_does?: string | null;
  pairs_well_with?: unknown;
  odara_read?: string | null;
};

type ScentIntelWardrobeMatch = {
  fragrance_id?: string | null;
  name?: string | null;
  brand?: string | null;
  status?: string | null;
  positions?: unknown;
};

type ScentIntelPayload = {
  found?: boolean;
  term_slug?: string | null;
  label?: string | null;
  message?: string | null;
  term?: ScentIntelTerm | null;
  context_position?: string | null;
  wardrobe_matches?: ScentIntelWardrobeMatch[] | null;
};

type ScentIntelSheetState = {
  input: ScentIntelInput;
  status: 'loading' | 'ready' | 'error';
  payload?: ScentIntelPayload | null;
  error?: string | null;
  requestKey?: string | null;
};

const SCENT_INTEL_UNMAPPED_MESSAGE = 'Odara has not mapped this note yet.';
const SCENT_INTEL_COMING_SOON_MESSAGE = 'Intel coming soon';

function isScentIntelAccessDeniedError(error: unknown) {
  const message = typeof error === 'object' && error && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : String(error ?? '');
  return /p_user must match auth\.uid\(\)/i.test(message) || /access denied/i.test(message);
}

function buildScentIntelSafeFallbackPayload(
  input: ScentIntelInput,
  message: string = SCENT_INTEL_COMING_SOON_MESSAGE,
): ScentIntelPayload {
  return {
    found: false,
    term_slug: input.slug ?? scentIntelSlugify(input.label ?? ''),
    label: input.label ?? null,
    message,
    wardrobe_matches: [],
  };
}

const SCENT_INTEL_LOCAL_SEEDS: Record<string, ScentIntelPayload> = {
  mango: {
    found: true,
    term_slug: 'mango',
    label: 'Mango',
    message: null,
    context_position: null,
    wardrobe_matches: [],
    term: {
      slug: 'mango',
      label: 'Mango',
      term_type: 'note',
      scent_category: 'Fruit Note',
      family_key: 'fresh-citrus',
      short_label: 'Reconstructed fruit',
      what_it_is: 'Mango is the smell of ripe or green mango recreated for perfume. Most of the time, perfumers build it rather than relying on one common mango extract.',
      smells_like: ['Juicy tropical flesh', 'peachy sweetness', 'soft green peel', 'tart resinous snap'],
      used_for: 'Brightening fruity florals and adding a tropical pop to openings and hearts.',
      what_it_does: 'Makes a fragrance feel juicier, sunnier, and more vivid, or greener in fresher mango styles.',
      pairs_well_with: ['Bergamot', 'Green', 'Jasmine', 'Vanilla', 'Leather', 'Oud', 'Amber', 'Woody'],
    },
  },
  praline: {
    found: true,
    term_slug: 'praline',
    label: 'Praline',
    message: null,
    context_position: null,
    wardrobe_matches: [],
    term: {
      slug: 'praline',
      label: 'Praline',
      term_type: 'note',
      scent_category: 'Gourmand Note',
      family_key: 'sweet-gourmand',
      short_label: 'Gourmand effect',
      what_it_is: 'Praline is the smell of caramelized nuts and sugar translated into perfume. It usually names a built gourmand effect, not one ingredient.',
      smells_like: ['Toasted nuts', 'warm sugar', 'vanilla cream', 'soft candy-like richness'],
      used_for: 'Building dessert-like bases and adding nutty caramel warmth.',
      what_it_does: 'Makes a fragrance feel sweeter, softer, richer, and more comforting.',
      pairs_well_with: ['Vanilla', 'Tonka Bean', 'Amber', 'Sandalwood', 'Coffee', 'Woody', 'Benzoin'],
    },
  },
};

function getLocalScentIntelSeed(input: Pick<ScentIntelInput, 'label' | 'slug'>): ScentIntelPayload | null {
  const candidates = getScentIntelLookupSlugCandidates(input);
  for (const candidate of candidates) {
    const seed = SCENT_INTEL_LOCAL_SEEDS[candidate];
    if (seed) return seed;
  }
  return null;
}

async function fetchResolvedTaxonomy(fragranceId: string): Promise<ResolvedTaxonomyPayload | null> {
  if (fragranceTaxonomyCache.has(fragranceId)) return fragranceTaxonomyCache.get(fragranceId) ?? null;
  const existing = fragranceTaxonomyInFlight.get(fragranceId);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const { data, error } = await odaraSupabase.rpc('get_fragrance_taxonomy_profile_v1' as any, { p_fragrance_id: fragranceId } as any);
      if (error) throw error;
      const payload = (Array.isArray(data) ? data[0] : data) as ResolvedTaxonomyPayload | null;
      fragranceTaxonomyCache.set(fragranceId, payload ?? null);
      return payload ?? null;
    } catch {
      fragranceTaxonomyCache.set(fragranceId, null);
      return null;
    } finally {
      fragranceTaxonomyInFlight.delete(fragranceId);
    }
  })();
  fragranceTaxonomyInFlight.set(fragranceId, promise);
  return promise;
}

function formatTaxonomyReviewStatus(status: string | null | undefined): string | null {
  if (!status) return null;
  const s = String(status).toLowerCase();
  if (s.includes('source') || s.includes('confirm')) return 'Source-backed';
  if (s.includes('wear') || s.includes('gap') || s.includes('needs')) return 'Needs wear test';
  return null;
}

function scentIntelSlugify(value: unknown): string {
  return normalizeScentIntelChipSlug(String(value ?? ''));
}

function getScentIntelAliasSlug(value: string | null | undefined): string {
  const normalized = normalizeScentIntelChipSlug(value);
  if (!normalized) return '';

  switch (normalized) {
    case 'spice':
    case 'spices':
    case 'spicy':
      return 'spice';
    case 'warm-spicy':
      return 'spicy-warm';
    case 'olibanum':
    case 'frank-incense':
    case 'boswellia':
    case 'olibanum-resin':
    case 'frankincense-resin':
      return 'frankincense';
    case 'myrrhe':
      return 'myrrh';
    case 'smoky':
    case 'smokey':
    case 'smoke-accord':
    case 'smoky-woods':
      return 'smoke';
    case 'resin':
    case 'resins':
    case 'resinous':
    case 'resin-material':
    case 'resin-materials':
    case 'resinous-material':
    case 'resinous-materials':
    case 'resin-note':
    case 'resin-notes':
    case 'resinous-note':
    case 'resinous-notes':
      return 'resins';
    case 'amber-resin-and-incense':
      return 'amber-resin-incense';
    case 'roasted-coffee':
    case 'coffee-roasted':
      return 'coffee';
    case 'woods':
    case 'wood':
    case 'woody-accord':
      return 'woody';
    case 'leathery':
    case 'suede':
    case 'leather-accord':
      return 'leather';
    case 'aldehydes':
    case 'aldehyde':
    case 'aldehydic-notes':
    case 'aldehydic-note':
      return 'aldehydic';
    case 'oudh':
      return 'oud';
    default:
      return resolveCanonicalScentIntelSlug(normalized);
  }
}

function getScentIntelLookupSlugCandidates(input: Pick<ScentIntelInput, 'label' | 'slug'>): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];

  const push = (value: string | null | undefined) => {
    const normalized = scentIntelSlugify(value ?? '');
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      candidates.push(normalized);
    }
    const alias = getScentIntelAliasSlug(value ?? '');
    if (alias && !seen.has(alias)) {
      seen.add(alias);
      candidates.push(alias);
    }
  };

  push(input.slug ?? '');
  push(input.label ?? '');

  const canonicalLabel = getCanonicalOdaraTermSlug(input.label ?? '');
  if (canonicalLabel && !seen.has(canonicalLabel)) {
    seen.add(canonicalLabel);
    candidates.push(canonicalLabel);
  }

  return candidates;
}

function normalizeScentIntelStringList(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const values: string[] = [];
  value.forEach((item) => {
    if (typeof item !== 'string') return;
    const label = item.trim();
    if (!label) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    values.push(label);
  });
  return values.slice(0, max);
}

function formatScentIntelFallbackTitle(value: string | null | undefined) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const normalized = raw
    .replace(/[-_]+/g, ' ')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized
    .split(' ')
    .map((part) => {
      if (part === '/') return part;
      if (/^m#$/i.test(part)) return part.toUpperCase();
      return part
        .split("'")
        .map((segment) => (
          segment
            ? `${segment.charAt(0).toUpperCase()}${segment.slice(1).toLowerCase()}`
            : segment
        ))
        .join("'");
    })
    .join(' ');
}

function formatScentIntelListPhrase(values: string[]): string {
  const text = values.join(', ').trim();
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function formatScentIntelInlineList(values: string[]) {
  if (values.length === 0) return '';
  return values
    .map((value, index) => {
      const trimmed = value.trim();
      if (!trimmed) return trimmed;
      return index === 0
        ? `${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`
        : trimmed;
    })
    .join(', ');
}

function formatScentIntelPosition(position: string | null | undefined): string | null {
  const normalized = String(position ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'top':
      return 'Top Note';
    case 'heart':
    case 'middle':
      return 'Heart Note';
    case 'base':
      return 'Base Note';
    case 'accord':
      return 'Accord';
    case 'material':
      return 'Material';
    case 'family':
      return 'Family / Style';
    default:
      return null;
  }
}

function getScentIntelDisplayPosition(position: string | null | undefined) {
  const formatted = formatScentIntelPosition(position);
  if (!formatted) return null;
  return ['Top Note', 'Heart Note', 'Base Note'].includes(formatted) ? formatted : null;
}

function formatScentIntelTermType(type: string | null | undefined): string {
  const normalized = String(type ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'note':
      return 'Note';
    case 'accord':
      return 'Accord';
    case 'material':
      return 'Material';
    case 'family':
      return 'Family / Style';
    case 'chord':
      return 'Chord';
    default:
      return 'Scent Intel';
  }
}

function normalizeScentIntelHeaderCategory(
  termLabel: string | null | undefined,
  category: string | null | undefined,
  termType: string | null | undefined,
) {
  const cleanLabel = String(termLabel ?? '').trim();
  const cleanCategory = String(category ?? '').trim();
  if (!cleanCategory) return formatScentIntelTermType(termType);
  if (!cleanLabel) return cleanCategory;

  const escapedLabel = cleanLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const trimmedCategory = cleanCategory
    .replace(new RegExp(`^${escapedLabel}[\\s:/-]*`, 'i'), '')
    .trim();

  if (trimmedCategory) return trimmedCategory;
  return formatScentIntelTermType(termType);
}

function getScentIntelHeaderCategory(term: ScentIntelTerm | null | undefined): string {
  const storedCategory = typeof term?.scent_category === 'string' ? term.scent_category.trim() : '';
  return normalizeScentIntelHeaderCategory(term?.label, storedCategory, term?.term_type);
}

type ScentIntelCopyOverride = {
  whatItIs?: string;
  smellsLike?: string[];
  usedFor?: string;
  whatItDoes?: string;
  tintKey?: string;
};

const SCENT_INTEL_COPY_OVERRIDES: Record<string, ScentIntelCopyOverride> = {
  amber: {
    whatItIs: 'An accord built from resins, balsams, soft vanilla warmth, and spice to create an amber effect.',
    tintKey: 'oud-amber',
  },
  oud: {
    whatItIs: 'A dark woody material profile built to suggest agarwood, resin, smoke, and warm animalic depth.',
    tintKey: 'oud-amber',
  },
  leather: {
    whatItIs: 'A fragrance accord built to suggest tanned hide, suede, smoke, dry woods, resins, or saffron warmth.',
    smellsLike: ['Polished leather', 'suede', 'smoke', 'dark woods', 'warm spice', 'dry resin'],
    usedFor: 'Adds depth, texture, darkness, and a dressed-up edge to woods, ambers, florals, tobacco, and spice.',
    whatItDoes: 'Makes a fragrance feel richer, darker, smoother, more mature, and more tactile.',
    tintKey: 'dark-leather',
  },
  incense: {
    whatItIs: 'An accord built to suggest dry burning resin, smoke, mineral ash, and incense warmth.',
    smellsLike: ['Dry resin', 'church incense', 'ash', 'cool spice', 'smoky wood'],
    whatItDoes: 'Makes a fragrance feel smokier, drier, darker, and more textured.',
    tintKey: 'oud-amber',
  },
  saffron: {
    whatItIs: 'A spice note from saffron crocus stigmas, used for dry warmth, radiance, and a leathery metallic edge.',
    tintKey: 'spicy-warm',
  },
  woody: {
    whatItIs: 'A broad scent family built from wood notes like cedar, sandalwood, vetiver, patchouli, guaiac wood, or woody aroma molecules.',
    smellsLike: ['Dry timber', 'cedar pencils', 'sandalwood', 'vetiver root', 'bark', 'forest floor'],
    usedFor: 'Gives a fragrance structure, dryness, warmth, polish, and a stronger base.',
    whatItDoes: 'Makes a scent feel grounded, cleaner, more mature, less sugary, and more durable.',
    tintKey: 'woody-clean',
  },
  'dark-leather': {
    whatItIs: 'A dark blended effect made from smoky, resinous, tar-like, and dry-wood facets.',
    smellsLike: ['Smoked suede', 'birch tar', 'dry resin', 'charred wood', 'and tobacco leaf'],
    usedFor: 'Adds smoky dryness and texture to oud, amber, saffron, rose, tobacco, and woods.',
    whatItDoes: 'Makes a fragrance feel drier, darker, and more formal.',
    tintKey: 'dark-leather',
  },
  'woody-clean': {
    whatItIs: 'A clean woody chord that blends polished woods, soft musk, and airy freshness into a restrained everyday profile.',
    tintKey: 'woody-clean',
  },
};

function getScentIntelCopyKey(term: ScentIntelTerm | null | undefined) {
  return scentIntelSlugify(term?.slug ?? term?.label ?? '');
}

function getScentIntelCopyOverride(term: ScentIntelTerm | null | undefined): ScentIntelCopyOverride | null {
  const key = getScentIntelCopyKey(term);
  return key ? (SCENT_INTEL_COPY_OVERRIDES[key] ?? null) : null;
}

function getScentIntelTintKeyOverride(value: string | null | undefined): string | null {
  const canonical = getCanonicalOdaraTermSlug(value);
  if (!canonical) return null;
  const override = SCENT_INTEL_COPY_OVERRIDES[canonical];
  if (override?.tintKey) return override.tintKey;

  switch (canonical) {
    case 'cinnamon':
    case 'cardamom':
    case 'pepper':
    case 'saffron':
    case 'clove':
    case 'ginger':
    case 'spicy':
    case 'fresh-spicy':
    case 'spicy-fresh':
      return 'spicy-warm';
    case 'amber':
    case 'resins':
    case 'balsamic':
    case 'incense':
    case 'frankincense':
    case 'myrrh':
    case 'olibanum':
    case 'oud':
      return 'oud-amber';
    case 'smoke':
    case 'smoky':
    case 'smokey':
      return 'dark-leather';
    case 'coffee':
    case 'roasted-coffee':
    case 'espresso':
    case 'cappuccino':
    case 'latte':
      return 'sweet-gourmand';
    case 'marine':
    case 'aquatic':
    case 'fresh-aquatic':
    case 'fresh-marine':
      return 'fresh-aquatic';
    case 'musk':
    case 'powdery':
    case 'white-musk':
    case 'clean-musk':
    case 'musk-clean':
      return 'floral-musk';
    case 'patchouli':
    case 'vetiver':
    case 'oakmoss':
      return 'earthy-patchouli';
    case 'woody':
      return 'woody-clean';
    default:
      return null;
  }
}

function isScentIntelCategoryRedundant(term: ScentIntelTerm | null | undefined, category: string) {
  const normalizedCategory = normalizeSearchFamilyKey(category).replace(/-(note|accord|material|style|family|chord)$/g, '');
  const normalizedLabel = normalizeSearchFamilyKey(term?.label ?? '');
  const normalizedShort = normalizeSearchFamilyKey(term?.short_label ?? '');
  if (!normalizedCategory) return false;
  return normalizedCategory === normalizedLabel || normalizedCategory === normalizedShort;
}

function getDefaultScentIntelWhatItIs(term: ScentIntelTerm | null | undefined): string | null {
  if (!term) return null;
  switch (String(term.term_type ?? '').trim().toLowerCase()) {
    case 'note':
      return 'A perfumery note used to shape part of a fragrance opening, heart, or drydown.';
    case 'accord':
      return 'A blended fragrance accord built from multiple materials to suggest one recognizable scent effect.';
    case 'material':
      return 'A perfumery material used to add structure, texture, or a specific smell character.';
    case 'family':
      return 'A broad scent family used to describe the main character of a fragrance.';
    case 'chord':
      return 'A recurring scent chord built from multiple notes and materials into one style effect.';
    default:
      return 'A scent term used to describe a fragrance character.';
  }
}

function getScentIntelCategory(term: ScentIntelTerm | null | undefined, position: string | null | undefined): string {
  return formatScentIntelPosition(position)
    ?? (typeof term?.scent_category === 'string' && term.scent_category.trim() ? term.scent_category.trim() : null)
    ?? formatScentIntelTermType(term?.term_type);
}

function getScentIntelWhatItIs(term: ScentIntelTerm | null | undefined): string | null {
  if (!term) return null;
  const override = getScentIntelCopyOverride(term);
  if (override?.whatItIs) return override.whatItIs;
  const storedDefinition = typeof term.what_it_is === 'string' ? term.what_it_is.trim() : '';
  if (storedDefinition) return storedDefinition;

  const storedCategory = typeof term.scent_category === 'string' ? term.scent_category.trim() : '';
  const subject = readTrimmedLayerText(term.label, term.short_label, 'This term');
  const smellsLike = normalizeScentIntelStringList(term.smells_like, 4);
  if (storedCategory && smellsLike.length > 0) {
    return `${subject} is a ${storedCategory.toLowerCase()} with a profile of ${formatScentIntelInlineList(smellsLike)}.`;
  }

  if (storedCategory && !isScentIntelCategoryRedundant(term, storedCategory)) {
    return `${subject} is a ${storedCategory.toLowerCase()}.`;
  }

  const shortLabel = typeof term.short_label === 'string' ? term.short_label.trim() : '';
  const typeLabel = formatScentIntelTermType(term.term_type).toLowerCase();
  if (shortLabel) {
    const lowered = shortLabel.toLowerCase();
    return `${subject} is a ${lowered} ${typeLabel}.`;
  }

  return getDefaultScentIntelWhatItIs(term);
}

function getScentIntelSmellsLike(term: ScentIntelTerm | null | undefined) {
  const override = getScentIntelCopyOverride(term);
  return override?.smellsLike ?? normalizeScentIntelStringList(term?.smells_like, 6);
}

function getScentIntelUsedFor(term: ScentIntelTerm | null | undefined) {
  const override = getScentIntelCopyOverride(term);
  return override?.usedFor ?? (typeof term?.used_for === 'string' ? term.used_for.trim() : '');
}

function getScentIntelWhatItDoes(term: ScentIntelTerm | null | undefined) {
  const override = getScentIntelCopyOverride(term);
  return override?.whatItDoes ?? (typeof term?.what_it_does === 'string' ? term.what_it_does.trim() : '');
}

function resolveScentIntelFamilyKey(
  input: Pick<ScentIntelInput, 'label' | 'slug' | 'sourceFamilyKey' | 'sourceFamilyLabel'>,
  term: ScentIntelTerm | null | undefined,
  payload?: ScentIntelPayload | null,
) {
  const override = getScentIntelCopyOverride(term);
  const preferredKeys = [
    override?.tintKey ?? null,
    getScentIntelTintKeyOverride(term?.slug ?? null),
    getScentIntelTintKeyOverride(term?.label ?? null),
    getScentIntelTintKeyOverride(term?.short_label ?? null),
    term?.family_key ?? null,
    getCanonicalOdaraTermFamilyKey(term?.slug ?? null, term?.family_key ?? null),
    getCanonicalOdaraTermFamilyKey(term?.label ?? null, term?.family_key ?? null),
    getCanonicalOdaraTermFamilyKey(term?.short_label ?? null, term?.family_key ?? null),
    getScentIntelTintKeyOverride(payload?.term_slug ?? null),
    getScentIntelTintKeyOverride(payload?.label ?? null),
    getScentIntelTintKeyOverride(input.slug ?? null),
    getScentIntelTintKeyOverride(input.label ?? null),
    getScentIntelTintKeyOverride(getScentIntelAliasSlug(input.label ?? null)),
    getCanonicalOdaraTermFamilyKey(payload?.term_slug ?? null, null),
    getCanonicalOdaraTermFamilyKey(payload?.label ?? null, null),
    getCanonicalOdaraTermFamilyKey(input.slug ?? null, null),
    getCanonicalOdaraTermFamilyKey(input.label ?? null, null),
    getCanonicalOdaraTermFamilyKey(getScentIntelAliasSlug(input.label ?? null), null),
    input.sourceFamilyKey ?? null,
    input.sourceFamilyLabel ?? null,
  ]
    .map((value) => normalizeSearchFamilyKey(value))
    .filter(Boolean);
  return preferredKeys.find((key) => Boolean(FAMILY_TINTS[key])) ?? null;
}

function getScentIntelGlassTint(
  input: Pick<ScentIntelInput, 'label' | 'slug' | 'sourceFamilyKey' | 'sourceFamilyLabel'>,
  term: ScentIntelTerm | null | undefined,
  payload?: ScentIntelPayload | null,
) {
  const familyKey = resolveScentIntelFamilyKey(input, term, payload);
  if (familyKey) {
    return getCollectionTileTint({ family_key: familyKey, family_label: null });
  }
  if (input.sourceFamilyKey || input.sourceFamilyLabel) {
    return getCollectionTileTint({
      family_key: input.sourceFamilyKey ?? null,
      family_label: input.sourceFamilyLabel ?? null,
    });
  }
  return DEFAULT_TINT;
}

function softenScentIntelGlow(glow: string) {
  return glow
    .replace('0.22', '0.11')
    .replace('0.2', '0.1')
    .replace('0.18', '0.09')
    .replace('0.16', '0.08')
    .replace('0.14', '0.07')
    .replace('0.12', '0.06');
}

function getScentIntelChipClass(extra = '') {
  return `rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.14em] transition-colors hover:text-foreground/92 ${extra}`.trim();
}

const ScentIntelChipButton: React.FC<{
  label: string;
  slug?: string | null;
  onOpen?: (input: ScentIntelInput) => void;
  fragranceId?: string | null;
  fragranceName?: string | null;
  fragranceBrand?: string | null;
  position?: string | null;
  className?: string;
  style?: React.CSSProperties;
  ariaPrefix?: string;
}> = ({ label, slug, onOpen, fragranceId, fragranceName, fragranceBrand, position, className, style, ariaPrefix = 'Open scent intel for' }) => {
  const cleanLabel = String(label ?? '').trim();
  if (!cleanLabel) return null;
  return (
    <button
      type="button"
      data-no-card-swipe
      aria-label={`${ariaPrefix} ${cleanLabel}`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen?.({
          label: cleanLabel,
          slug: slug ?? scentIntelSlugify(cleanLabel),
          fragranceId: fragranceId ?? null,
          fragranceName: fragranceName ?? null,
          fragranceBrand: fragranceBrand ?? null,
          position: position ?? null,
        });
      }}
      className={className}
      style={{
        WebkitTapHighlightColor: 'transparent',
        ...style,
      }}
    >
      {cleanLabel}
    </button>
  );
};

const OdaraCollectionCardSurface: React.FC<{
  ariaLabel: string;
  onOpen: () => void;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children' | 'className' | 'style' | 'onClick' | 'onKeyDown' | 'role' | 'tabIndex' | 'aria-label'>> = ({
  ariaLabel,
  onOpen,
  children,
  className,
  style,
  ...rest
}) => (
  // Deliberately not a native <button>: collection cards contain nested interactive
  // chip/button controls, and nested buttons cause invalid DOM plus layout regressions.
  <div
    role="button"
    tabIndex={0}
    aria-label={ariaLabel}
    onClick={onOpen}
    onKeyDown={(event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onOpen();
    }}
    className={className}
    style={style}
    {...rest}
  >
    {children}
  </div>
);

const ScentIntelSection: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => (
  <div className="pt-1">
    <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-foreground/62">{title}</div>
    <div className="text-[12px] leading-[1.55] text-foreground/78">{children}</div>
  </div>
);

const OdaraScentIntelSheet: React.FC<{
  state: ScentIntelSheetState | null;
  onClose: () => void;
  onOpenTerm: (input: ScentIntelInput) => void;
}> = ({ state, onClose, onOpenTerm }) => {
  if (!state) return null;
  const payload = state.payload ?? null;
  const found = Boolean(payload?.found);
  const term = found ? payload?.term ?? null : null;
  const rawLabel = (found ? term?.label : payload?.label) || state.input.label || 'Scent Intel';
  const label = found ? rawLabel : (formatScentIntelFallbackTitle(rawLabel) || rawLabel);
  const isUnmappedPayload = !found && (payload?.message ?? '').trim() === SCENT_INTEL_UNMAPPED_MESSAGE;
  const category = found
    ? getScentIntelHeaderCategory(term)
    : (isUnmappedPayload ? 'Unmapped Term' : null);
  const positionLabel = found
    ? getScentIntelDisplayPosition(payload?.context_position ?? state.input.position)
    : null;
  const whatItIs = getScentIntelWhatItIs(term);
  const smellsLike = getScentIntelSmellsLike(term);
  const usedFor = getScentIntelUsedFor(term);
  const whatItDoes = getScentIntelWhatItDoes(term);
  const inPerfumeCopy = [usedFor, whatItDoes].map((value) => value.trim()).filter(Boolean).join(' ');
  const pairsWith = normalizeScentIntelStringList(term?.pairs_well_with, 8);
  const pairChips = expandAndDeduplicateScentIntelDisplayTerms(
    pairsWith.map((label) => ({ label, position: 'material' })),
  );
  const intelTint = getScentIntelGlassTint(state.input, term, payload);
  const intelGlassVisual = getOdaraGlassCardVisualRecipe(intelTint, 'hero');
  const intelLiquidGlassStyle = getOdaraHeroLiquidGlassMaterialStyle(intelTint, intelGlassVisual);
  const foundInMatches = (() => {
    const entries: Array<{
      fragrance_id: string | null;
      name: string;
      brand?: string | null;
      positions: string[];
    }> = [];
    const seen = new Set<string>();
    const push = (entry: {
      fragrance_id: string | null;
      name: string | null | undefined;
      brand?: string | null | undefined;
      positions?: string[] | null | undefined;
    }) => {
      const cleanName = String(entry.name ?? '').trim();
      if (!cleanName) return;
      const key = entry.fragrance_id ?? cleanName.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({
        fragrance_id: entry.fragrance_id ?? null,
        name: cleanName,
        brand: entry.brand ?? null,
        positions: Array.isArray(entry.positions) ? entry.positions : [],
      });
    };

    if (Array.isArray(payload?.wardrobe_matches)) {
      payload.wardrobe_matches
        .filter((match) => String(match?.name ?? '').trim())
        .slice(0, 8)
        .forEach((match) => {
          push({
            fragrance_id: match?.fragrance_id ?? null,
            name: match?.name ?? null,
            brand: match?.brand ?? null,
            positions: normalizeScentIntelStringList(match?.positions, 3),
          });
        });
    }

    return entries.slice(0, 8);
  })();

  return (
    <OdaraBottomSheet
      open={!!state}
      onClose={onClose}
      surfaceStyle={intelLiquidGlassStyle}
      atmosphereClassName={intelGlassVisual.atmosphereClassName}
      atmosphereStyle={intelGlassVisual.atmosphereStyle}
    >
      <div
        className="relative px-5 pt-4"
        style={{
          maxHeight: 'calc(100dvh - 132px)',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 30px)',
        }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className="text-[28px] leading-[1.02] text-foreground/92"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: '-0.01em' }}
            >
              {label}
            </div>
            {category ? (
              <div className="mt-1.5 text-[13px] text-foreground/62">{category}</div>
            ) : null}
            {positionLabel ? (
              <div className="mt-1 text-[12px] text-foreground/48">{positionLabel}</div>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Close scent intel"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground/62 transition-colors hover:text-foreground/88"
            style={{
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.02)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.035), 0 0 4px rgba(255,255,255,0.022)',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        {state.status === 'loading' ? (
          <div className="space-y-3">
            <div className="h-10 animate-pulse rounded-[14px] bg-white/[0.035]" />
            <div className="h-10 animate-pulse rounded-[14px] bg-white/[0.03]" />
            <div className="h-16 animate-pulse rounded-[14px] bg-white/[0.025]" />
          </div>
        ) : state.status === 'error' ? (
          <div className="rounded-[18px] border px-4 py-4 text-[12px] leading-[1.5] text-rose-200/82" style={{ borderColor: 'rgba(244,114,182,0.18)', background: 'rgba(244,114,182,0.06)' }}>
            {state.error || 'Scent Intel is unavailable right now.'}
          </div>
        ) : !found ? (
          <div className="rounded-[18px] border px-4 py-4 text-[12px] leading-[1.5] text-foreground/70" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.025)' }}>
            {payload?.message || SCENT_INTEL_UNMAPPED_MESSAGE}
          </div>
        ) : (
          <div className="space-y-5">
            {whatItIs ? (
              <ScentIntelSection title="What it is">
                {whatItIs}
              </ScentIntelSection>
            ) : null}
            {smellsLike.length > 0 ? (
              <ScentIntelSection title="Smells like">
                {formatScentIntelListPhrase(smellsLike)}
              </ScentIntelSection>
            ) : null}
            {inPerfumeCopy ? (
              <ScentIntelSection title="In Perfume">
                {inPerfumeCopy}
              </ScentIntelSection>
            ) : null}
            {pairsWith.length > 0 ? (
              <ScentIntelSection title="Pairs With">
                <div className="flex flex-wrap gap-2">
                  {pairChips.map((pairChip) => {
                    const tone = getAccordChipTone(pairChip.label, term?.family_key ?? null);
                    return (
                      <ScentIntelChipButton
                        key={`pair-${pairChip.position ?? 'material'}-${pairChip.slug ?? pairChip.label}`}
                        label={pairChip.label}
                        slug={pairChip.slug ?? null}
                        onOpen={onOpenTerm}
                        fragranceId={state.input.fragranceId ?? null}
                        fragranceName={state.input.fragranceName ?? null}
                        fragranceBrand={state.input.fragranceBrand ?? null}
                        position={pairChip.position ?? null}
                        className={getScentIntelChipClass()}
                        style={{
                          color: tone.color,
                          border: `1px solid ${tone.border}`,
                          background: tone.background,
                          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05), 0 0 7px ${softenScentIntelGlow(tone.glow)}`,
                        }}
                      />
                    );
                  })}
                </div>
              </ScentIntelSection>
            ) : null}
            {foundInMatches.length > 0 ? (
              <ScentIntelSection title="Found In">
                <div className="flex flex-wrap gap-2">
                  {foundInMatches.map((match) => {
                    const pillLabel = match.brand
                      ? `${match.name} · ${match.brand}`
                      : match.name;
                    return (
                      <span
                        key={`wardrobe-${match.fragrance_id ?? match.name}`}
                        className="max-w-full rounded-full px-3 py-[6px] text-[11px] leading-[1.35] text-foreground/78"
                        style={{
                          border: '1px solid rgba(255,255,255,0.075)',
                          background: 'rgba(255,255,255,0.03)',
                          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
                        }}
                      >
                        {pillLabel}
                      </span>
                    );
                  })}
                </div>
              </ScentIntelSection>
            ) : null}
          </div>
        )}
      </div>
    </OdaraBottomSheet>
  );
};

const OdaraFragranceDetailSheet: React.FC<{
  detail: OdaraFragranceDetailSurfaceState | null;
  open: boolean;
  onClose: () => void;
  onOpenScentIntel?: (input: ScentIntelInput) => void;
  footerActions?: React.ReactNode;
}> = ({ detail, open, onClose, onOpenScentIntel, footerActions }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !scrollRef.current) return undefined;
    const scrollNode = scrollRef.current;
    const resetScroll = () => {
      scrollNode.scrollTop = 0;
      if (typeof scrollNode.scrollTo === 'function') {
        scrollNode.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      }
    };
    resetScroll();
    const frameId = window.requestAnimationFrame(resetScroll);
    return () => window.cancelAnimationFrame(frameId);
  }, [open, detail?.fragrance_id]);

  if (!open || !detail) return null;

  const resolvedDetail = detail;
  const tint = getEnhancedCollectionTint({
    family_key: resolvedDetail.family_key,
    family_label: resolvedDetail.family_label,
  });
  const detailBaseTint = getCollectionTileTint({
    family_key: resolvedDetail.family_key,
    family_label: resolvedDetail.family_label,
  });
  const detailGlassVisual = getOdaraGlassCardVisualRecipe(
    detailBaseTint,
    'hero',
  );
  const detailLiquidGlassStyle = getOdaraHeroLiquidGlassMaterialStyle(detailBaseTint, detailGlassVisual);
  const familyLabel = formatPlainFamilyStyleLabel(
    resolvedDetail.family_label ?? (resolvedDetail.family_key ? getFamilyLabelText(resolvedDetail.family_key) : null),
  );
  const accordLabels = normalizeNotes(resolvedDetail.accords, 8);
  const topLabels = normalizeNotes(resolvedDetail.top_notes ?? [], 6);
  const middleLabels = normalizeNotes(resolvedDetail.middle_notes ?? [], 6);
  const baseLabels = normalizeNotes(resolvedDetail.base_notes ?? [], 6);
  const flatNoteLabels = normalizeNotes(resolvedDetail.notes, 8);
  const roleLabel = resolvedDetail.wardrobe_role_label?.trim() || null;
  const detailDescription = buildVesperizedDetailDescription(resolvedDetail);
  const detailPerformanceBars = buildFragrancePerformanceBars(resolvedDetail)
    .filter((metric) => ['longevity', 'projection', 'trail'].includes(metric.key));
  const detailPerformanceByKey = new Map(detailPerformanceBars.map((metric) => [metric.key, metric]));
  const detailPerformanceRows = ODARA_DETAIL_PERFORMANCE_ROWS.map((row) => ({
    ...row,
    metric: detailPerformanceByKey.get(row.key) ?? null,
  }));
  const topIdentityChips = (() => {
    const chips: Array<{ label: string; position: string }> = [];
    const seen = new Set<string>();
    const pushChip = (label: string | null | undefined, position: string) => {
      const trimmed = typeof label === 'string' ? label.trim() : '';
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      chips.push({ label: trimmed, position });
    };

    pushChip(familyLabel, 'family');
    const availableAccords = accordLabels.filter((accord) => accord.trim().toLowerCase() !== familyLabel?.trim().toLowerCase());
    const priorityPatterns = [
      /\bleather|leathery\b/i,
      /\boud|amber|resin|resinous|incense\b/i,
      /\bcitrus|bergamot|neroli|orange|grapefruit|lemon\b/i,
      /\bgreen|aromatic|herbal\b/i,
      /\bwoody|wood\b/i,
      /\bspicy|spice\b/i,
      /\bfloral\b/i,
      /\bgourmand|sweet\b/i,
      /\bfruity|fruit\b/i,
    ];
    const preferredAccord = priorityPatterns
      .map((pattern) => availableAccords.find((accord) => pattern.test(accord)))
      .find(Boolean)
      ?? availableAccords[0]
      ?? null;
    pushChip(preferredAccord, 'accord');
    return expandAndDeduplicateScentIntelDisplayTerms(chips).slice(0, 4);
  })();
  const orderedNoteChips = (() => {
    const notes: Array<{ label: string; position: string }> = [];
    const seen = new Set<string>();
    const pushNote = (label: string | null | undefined, position: string) => {
      const trimmed = typeof label === 'string' ? label.trim() : '';
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      notes.push({ label: trimmed, position });
    };

    const structuredSections = [
      { position: 'top', values: topLabels },
      { position: 'heart', values: middleLabels },
      { position: 'base', values: baseLabels },
    ];
    const hasStructuredNotes = structuredSections.some((section) => section.values.length > 0);
    if (hasStructuredNotes) {
      for (const section of structuredSections) {
        for (const label of section.values) {
          pushNote(label, section.position);
          if (notes.length >= 6) return expandAndDeduplicateScentIntelDisplayTerms(notes);
        }
      }
    } else {
      for (const label of flatNoteLabels) {
        pushNote(label, 'material');
        if (notes.length >= 6) return expandAndDeduplicateScentIntelDisplayTerms(notes);
      }
    }
    return expandAndDeduplicateScentIntelDisplayTerms(notes);
  })();
  const detailFactLine = `Released: ${resolvedDetail.release_year ? String(resolvedDetail.release_year) : 'Unknown'} • Perfumer: ${resolvedDetail.perfumer ?? 'Unknown'}`;

  return (
    <OdaraBottomSheet
      open={open}
      onClose={onClose}
      surfaceStyle={detailLiquidGlassStyle}
      atmosphereClassName={detailGlassVisual.atmosphereClassName}
      atmosphereStyle={{ ...detailGlassVisual.atmosphereStyle, opacity: 0.22 }}
    >
      <div
        ref={scrollRef}
        className="px-5 pt-4"
        style={{
          maxHeight: 'calc(100dvh - 120px)',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 32px)',
        }}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div
              className="text-[30px] leading-[1.02] text-foreground/94"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: '-0.01em' }}
            >
              {getDisplayName(resolvedDetail.name ?? '', resolvedDetail.brand ?? null)}
            </div>
            {resolvedDetail.brand ? (
              <div className="mt-1.5 text-[13px] text-foreground/58">{resolvedDetail.brand}</div>
            ) : null}
            {detailDescription ? (
              <div className="mt-3 max-w-[34ch] text-[15px] leading-[1.48] text-foreground/84">
                {detailDescription}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Close fragrance detail"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground/62 transition-colors hover:text-foreground/88 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d9b56c]/50 focus-visible:ring-offset-0"
            style={{
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.03)',
              outline: 'none',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-5">
          {topIdentityChips.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {topIdentityChips.map((chip, index) => {
                const tone = getAccordChipTone(chip.label, resolvedDetail.family_key);
                return (
                  <ScentIntelChipButton
                    key={`detail-top-identity-${chip.position}-${chip.label}-${index}`}
                    label={chip.label}
                    slug={chip.slug ?? null}
                    onOpen={onOpenScentIntel}
                    fragranceId={resolvedDetail.fragrance_id}
                    fragranceName={resolvedDetail.name}
                    fragranceBrand={resolvedDetail.brand}
                    position={chip.position}
                    className="inline-flex rounded-full px-3 py-[6px] text-[10px] uppercase tracking-[0.24em]"
                    style={{
                      color: tone.color,
                      border: `1px solid ${tone.border}`,
                      background: tone.background,
                      boxShadow: `0 0 12px ${tone.glow}`,
                    }}
                  />
                );
              })}
            </div>
          ) : null}

          {roleLabel ? (
            <div className="text-[14px] leading-[1.4] text-foreground/72">
              <span className="text-foreground/54">Best worn:</span>{' '}
              <span className="text-foreground/88">{roleLabel}</span>
            </div>
          ) : null}

          <section>
            <div className="mb-3 text-[9px] uppercase tracking-[0.28em] text-foreground/42">Performance</div>
            <div className="space-y-4">
              {detailPerformanceRows.map((row) => (
                row.metric ? (
                  <OdaraPerformanceLifeBar key={row.key} metric={row.metric} tint={tint} />
                ) : (
                  <OdaraPerformanceEmptyLifeBar key={row.key} label={row.label} tint={tint} />
                )
              ))}
            </div>
          </section>

          {accordLabels.length > 0 ? (
            <section>
              <div className="mb-3 text-[9px] uppercase tracking-[0.28em] text-foreground/42">Accords</div>
              <div className="flex flex-wrap gap-2">
                {expandAndDeduplicateScentIntelDisplayTerms(
                  accordLabels.slice(0, 6).map((label) => ({ label, position: 'accord' })),
                ).map((chip, index) => {
                  const tone = getAccordChipTone(chip.label, resolvedDetail.family_key);
                  return (
                    <ScentIntelChipButton
                      key={`detail-accord-${chip.position}-${chip.slug ?? chip.label}-${index}`}
                      label={chip.label}
                      slug={chip.slug ?? null}
                      onOpen={onOpenScentIntel}
                      fragranceId={resolvedDetail.fragrance_id}
                      fragranceName={resolvedDetail.name}
                      fragranceBrand={resolvedDetail.brand}
                      position={chip.position ?? 'accord'}
                      className={getScentIntelChipClass()}
                      style={{
                        color: tone.color,
                        border: `1px solid ${tone.border}`,
                        background: tone.background,
                        boxShadow: `0 0 14px ${tone.glow}`,
                      }}
                    />
                  );
                })}
              </div>
            </section>
          ) : null}

          {orderedNoteChips.length > 0 ? (
            <section>
              <div className="mb-3 text-[9px] uppercase tracking-[0.28em] text-foreground/42">Notes</div>
              <div className="flex flex-wrap gap-2">
                {orderedNoteChips.map((note, index) => {
                  const tone = getAccordChipTone(note.label, resolvedDetail.family_key);
                  return (
                    <ScentIntelChipButton
                      key={`detail-note-${note.position}-${note.label}-${index}`}
                      label={note.label}
                      slug={note.slug ?? null}
                      onOpen={onOpenScentIntel}
                      fragranceId={resolvedDetail.fragrance_id}
                      fragranceName={resolvedDetail.name}
                      fragranceBrand={resolvedDetail.brand}
                      position={note.position}
                      className={getScentIntelChipClass()}
                      style={{
                        color: tone.color,
                        border: `1px solid ${tone.border}`,
                        background: tone.background,
                        boxShadow: `0 0 14px ${tone.glow}`,
                      }}
                    />
                  );
                })}
              </div>
            </section>
          ) : null}

          <div
            className="pt-1 text-[13px] leading-[1.5] text-foreground/66"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
          >
            {detailFactLine}
          </div>

          {footerActions ? (
            <div
              className="mt-1 pb-1 pt-5"
              style={{
                borderTop: '1px solid rgba(217,181,108,0.1)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.035)',
              }}
            >
              {footerActions}
            </div>
          ) : null}
        </div>
      </div>
    </OdaraBottomSheet>
  );
};

const OdaraLegacyCollectionPage: React.FC<{
  onClose: () => void;
  onOpenFragranceDetail: (detail: OdaraFragranceDetailSurfaceState) => void;
  userId: string | null;
  isGuestMode: boolean;
}> = ({ onClose, onOpenFragranceDetail, userId, isGuestMode }) => {
  const {
    activeSessionUserId,
    sessionResolved,
  } = useOdaraActiveSessionUser({
    userId,
    isGuestMode,
    scope: 'legacy_collection',
  });
  const [payload, setPayload] = useState<OdaraCollectionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingRatingById, setPendingRatingById] = useState<Record<string, boolean>>({});
  const [pendingRetiredById, setPendingRetiredById] = useState<Record<string, boolean>>({});
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const [activeRatingTile, setActiveRatingTile] = useState<{ itemKey: string; previewRating: number } | null>(null);
  const [reasonSheetState, setReasonSheetState] = useState<{
    fragranceId: string;
    itemName: string;
    rating: 1 | 2;
  } | null>(null);
  const [reasonSheetError, setReasonSheetError] = useState<string | null>(null);
  const [reasonSavePending, setReasonSavePending] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<OdaraCollectionFilter>('all');
  const [selectedSort, setSelectedSort] = useState<OdaraCollectionSort>('role');
  const ratingPressRef = useRef<{
    itemKey: string;
    fragranceId: string;
    itemName: string;
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    rect: DOMRect;
    target: HTMLDivElement | null;
    timerId: number | null;
    active: boolean;
    cancelled: boolean;
  } | null>(null);
  const ratingWriteInFlightRef = useRef<Set<string>>(new Set());
  const suppressTileClickRef = useRef<Record<string, number>>({});

  const clearActiveRatingGesture = useCallback(() => {
    const current = ratingPressRef.current;
    if (current?.timerId) {
      window.clearTimeout(current.timerId);
    }
    if (current?.active && current.target?.releasePointerCapture && current.target.hasPointerCapture?.(current.pointerId)) {
      try {
        current.target.releasePointerCapture(current.pointerId);
      } catch {
        // Pointer capture can fail in synthetic or interrupted pointer flows; clearing state is still safe.
      }
    }
    ratingPressRef.current = null;
    setActiveRatingTile(null);
  }, []);

  useEffect(() => {
    let active = true;

    if (!isGuestMode && !sessionResolved) {
      setLoading(true);
      setError(null);
      return () => {
        active = false;
      };
    }

    if (!isGuestMode && !activeSessionUserId) {
      setPayload(null);
      setLoading(false);
      setError('No signed-in collection is available yet.');
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setError(null);

    (async () => {
      const rpcName = isGuestMode ? 'get_guest_collection_preview_v1' : 'get_collection_wardrobe_v1';
      const rpcArgs = isGuestMode ? {} : { p_user: activeSessionUserId, p_filter: 'all', p_sort: 'role' };
      const { data, error: rpcError } = await odaraSupabase.rpc(rpcName as any, rpcArgs as any);

      if (!active) return;

      if (rpcError) {
        setPayload(null);
        setError(rpcError.message || 'Could not load the live collection yet.');
        setLoading(false);
        return;
      }

      setPayload(normalizeCollectionPayload((data ?? null) as OdaraCollectionPayload | null));
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [activeSessionUserId, isGuestMode, sessionResolved]);

  useEffect(() => () => {
    clearActiveRatingGesture();
  }, [clearActiveRatingGesture]);

  const visibleItems = useMemo(() => {
    const baseItems = payload?.items ?? [];
    const filteredItems = baseItems.filter((item) => {
      if (selectedFilter === 'all') return true;
      if (selectedFilter === 'rated') return normalizeCollectionRating(item.rating) !== null;
      if (selectedFilter === 'unrated') return normalizeCollectionRating(item.rating) === null;
      if (selectedFilter === 'retired') return Boolean(item.retired);
      return item.wardrobe_role_key === selectedFilter;
    });
    return sortCollectionItemsForView(filteredItems, selectedSort);
  }, [payload, selectedFilter, selectedSort]);

  const handleRatingSave = useCallback(async (
    item: OdaraCollectionItem,
    nextRating: number,
  ) => {
    if (isGuestMode || !item.fragrance_id) return;
    const fragranceId = item.fragrance_id;
    const itemKey = fragranceId;
    const normalizedRating = normalizeCollectionRating(nextRating);
    if (!normalizedRating || ratingWriteInFlightRef.current.has(itemKey)) return;

    ratingWriteInFlightRef.current.add(itemKey);
    setPendingRatingById((prev) => ({ ...prev, [itemKey]: true }));
    setErrorById((prev) => {
      const next = { ...prev };
      delete next[itemKey];
      return next;
    });

    const { data, error: rpcError } = await odaraSupabase.rpc('log_fragrance_rating_v1' as any, {
      p_fragrance_id: fragranceId,
      p_rating: normalizedRating,
      p_rating_source: 'collection',
      p_rating_context: 'solo',
    } as any);

    if (rpcError || !data) {
      ratingWriteInFlightRef.current.delete(itemKey);
      setPendingRatingById((prev) => ({ ...prev, [itemKey]: false }));
      setErrorById((prev) => ({
        ...prev,
        [itemKey]: rpcError?.message || 'Could not save rating.',
      }));
      return;
    }

    const result = data as OdaraCollectionRatingWriteResult;
    setPayload((prev) => {
      if (!prev) return prev;
      return normalizeCollectionPayload({
        ...prev,
        items: (prev.items ?? []).map((entry) => (
          entry.fragrance_id === result.fragrance_id
            ? {
                ...entry,
                rating: result.rating,
              }
            : entry
        )),
        summary: {
          ...prev.summary,
          rated_count: result.rated_count,
        },
      });
    });
    setPendingRatingById((prev) => ({ ...prev, [itemKey]: false }));
    ratingWriteInFlightRef.current.delete(itemKey);

    if (normalizedRating <= 2) {
      setReasonSheetError(null);
      setReasonSheetState({
        fragranceId,
        itemName: item.name ?? 'This bottle',
        rating: normalizedRating as 1 | 2,
      });
    }
  }, [isGuestMode]);

  const handleRatingReasonSelect = useCallback(async (reasonKey: string | null) => {
    if (!reasonSheetState) return;
    if (!reasonKey) {
      setReasonSavePending(false);
      setReasonSheetError(null);
      setReasonSheetState(null);
      return;
    }

    setReasonSavePending(true);
    setReasonSheetError(null);

    const { data, error: rpcError } = await odaraSupabase.rpc('log_fragrance_rating_reason_v1' as any, {
      p_fragrance_id: reasonSheetState.fragranceId,
      p_rating: reasonSheetState.rating,
      p_reason_key: reasonKey,
      p_rating_source: 'collection',
      p_rating_context: 'solo',
    } as any);

    if (rpcError || !data) {
      setReasonSavePending(false);
      setReasonSheetError(rpcError?.message || 'Could not save that reason.');
      return;
    }

    setReasonSavePending(false);
    setReasonSheetState(null);
    setReasonSheetError(null);
  }, [reasonSheetState]);

  const handleRetiredToggle = useCallback(async (item: OdaraCollectionItem) => {
    if (isGuestMode || !item.fragrance_id) return;

    setPendingRetiredById((prev) => ({ ...prev, [item.fragrance_id as string]: true }));
    setErrorById((prev) => {
      const next = { ...prev };
      delete next[item.fragrance_id as string];
      return next;
    });

    const { data, error: rpcError } = await odaraSupabase.rpc('set_user_fragrance_retired_v1' as any, {
      p_fragrance_id: item.fragrance_id,
      p_retired: !item.retired,
      p_source: 'collection',
    } as any);

    if (rpcError || !data) {
      setPendingRetiredById((prev) => ({ ...prev, [item.fragrance_id as string]: false }));
      setErrorById((prev) => ({
        ...prev,
        [item.fragrance_id as string]: rpcError?.message || 'Could not save retired state.',
      }));
      return;
    }

    const result = data as OdaraCollectionRetiredWriteResult;
    setPayload((prev) => {
      if (!prev) return prev;
      return normalizeCollectionPayload({
        ...prev,
        items: (prev.items ?? []).map((entry) => (
          entry.fragrance_id === result.fragrance_id
            ? {
                ...entry,
                retired: result.retired,
                favorite: result.favorite ?? result.wear_more ?? false,
                wear_more: result.wear_more ?? result.favorite ?? false,
              }
            : entry
        )),
        summary: {
          ...prev.summary,
          wear_more_count: result.wear_more_count ?? result.favorite_count ?? prev.summary.wear_more_count,
          favorite_count: result.favorite_count ?? result.wear_more_count ?? prev.summary.favorite_count,
          retired_count: result.retired_count,
        },
      });
    });
    setPendingRetiredById((prev) => ({ ...prev, [item.fragrance_id as string]: false }));
  }, [isGuestMode]);

  const beginCollectionTilePress = useCallback((
    item: OdaraCollectionItem,
    itemKey: string,
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (isGuestMode || !item.fragrance_id) return;
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-collection-control]')) return;

    clearActiveRatingGesture();

    const nextRef = {
      itemKey,
      fragranceId: item.fragrance_id,
      itemName: item.name ?? 'This bottle',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      rect: event.currentTarget.getBoundingClientRect(),
      target: event.currentTarget,
      timerId: null as number | null,
      active: false,
      cancelled: false,
    };

    nextRef.timerId = window.setTimeout(() => {
      const live = ratingPressRef.current;
      if (!live || live.itemKey !== itemKey || live.cancelled) return;
      live.active = true;
      const previewRating = resolveCollectionRatingFromClientX(live.lastX, live.rect);
      setActiveRatingTile({ itemKey, previewRating });
      if (live.target?.setPointerCapture) {
        try {
          live.target.setPointerCapture(live.pointerId);
        } catch {
          // Pointer capture is best-effort only; rating mode still works without it.
        }
      }
      haptic('selection');
    }, COLLECTION_LONG_PRESS_MS);

    ratingPressRef.current = nextRef;
  }, [clearActiveRatingGesture, isGuestMode]);

  const updateCollectionTilePress = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const current = ratingPressRef.current;
    if (!current || current.pointerId !== event.pointerId) return;

    current.lastX = event.clientX;

    if (!current.active) {
      const deltaX = Math.abs(event.clientX - current.startX);
      const deltaY = Math.abs(event.clientY - current.startY);
      if (deltaY > COLLECTION_SCROLL_CANCEL_Y_PX && deltaY > deltaX) {
        current.cancelled = true;
        clearActiveRatingGesture();
      }
      return;
    }

    event.preventDefault();
    setActiveRatingTile({
      itemKey: current.itemKey,
      previewRating: resolveCollectionRatingFromClientX(event.clientX, current.rect),
    });
  }, [clearActiveRatingGesture]);

  const endCollectionTilePress = useCallback((
    item: OdaraCollectionItem,
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const current = ratingPressRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const wasActive = current.active;
    const previewRating = activeRatingTile?.itemKey === current.itemKey
      ? activeRatingTile.previewRating
      : resolveCollectionRatingFromClientX(current.lastX, current.rect);
    const deltaX = Math.abs(event.clientX - current.startX);
    const deltaY = Math.abs(event.clientY - current.startY);

    clearActiveRatingGesture();

    if (!wasActive) {
      if (deltaX > COLLECTION_TAP_MAX_MOVE_PX || deltaY > COLLECTION_TAP_MAX_MOVE_PX) {
        suppressTileClickRef.current[current.itemKey] = Date.now() + 120;
      }
      return;
    }

    suppressTileClickRef.current[current.itemKey] = Date.now() + 600;
    void handleRatingSave(item, previewRating);
  }, [activeRatingTile, clearActiveRatingGesture, handleRatingSave]);

  const cancelCollectionTilePress = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const current = ratingPressRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    clearActiveRatingGesture();
  }, [clearActiveRatingGesture]);

  const headline = 'Collection';
  const subtitle = loading
    ? 'Reading the real wardrobe…'
    : error
      ? error
      : isGuestMode
        ? 'Guest preview uses the real demo wardrobe and stays read-only.'
        : [
            formatProfileCount(payload?.summary?.owned_count ?? 0, 'bottle'),
            `${payload?.summary?.rated_count ?? 0} rated`,
            `${payload?.summary?.retired_count ?? 0} retired`,
          ].join(' · ');

  return (
    <OdaraDestinationChrome title={headline} onClose={onClose}>
      <div className="mb-5 px-1 text-[11px] leading-[1.55] text-foreground/42">
        {subtitle}
      </div>

      <div className="flex flex-col gap-4">
          {(payload?.items?.length ?? 0) > 0 && (
            <div className="px-1 pb-1 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1.5 px-1 text-[9px] font-medium uppercase tracking-[0.28em] text-foreground/36">
                    Filter
                  </div>
                  <select
                    value={selectedFilter}
                    onChange={(event) => setSelectedFilter(event.target.value as OdaraCollectionFilter)}
                    aria-label="Filter collection"
                    className="w-full rounded-[14px] border bg-transparent px-3 py-2 text-[11px] text-foreground/78 outline-none"
                    style={{
                      borderColor: 'rgba(255,255,255,0.08)',
                      background: 'rgba(255,255,255,0.025)',
                    }}
                  >
                    {COLLECTION_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="mb-1.5 px-1 text-[9px] font-medium uppercase tracking-[0.28em] text-foreground/36">
                    Sort
                  </div>
                  <select
                    value={selectedSort}
                    onChange={(event) => setSelectedSort(event.target.value as OdaraCollectionSort)}
                    aria-label="Sort collection"
                    className="w-full rounded-[14px] border bg-transparent px-3 py-2 text-[11px] text-foreground/78 outline-none"
                    style={{
                      borderColor: 'rgba(255,255,255,0.08)',
                      background: 'rgba(255,255,255,0.025)',
                    }}
                  >
                    {COLLECTION_SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {(payload?.items?.length ?? 0) === 0 ? (
            <div className="px-4 pb-4 text-[12px] leading-[1.55] text-foreground/46">
              {error ?? payload?.empty_reason ?? 'No real bottles are available yet.'}
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="px-4 pb-4 text-[12px] leading-[1.55] text-foreground/46">
              No bottles match that filter yet.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-x-3 gap-y-6 px-1 pb-4 pt-2">
              {visibleItems.map((item, index) => {
                const itemKey = item.fragrance_id ?? `${item.brand ?? 'brand'}|${item.name ?? 'name'}|${index}`;
                const tint = getEnhancedCollectionTint(item);
                const resolvedImageUrl = resolvePreferredWardrobeBottleImage(item, item.image_url, item.thumbnail_url);
                const imageCandidates = buildPreferredBottleImageCandidates(item, item.image_url, item.thumbnail_url);
                const likelyTransparentImage = isLikelyTransparentBottleImageUrl(imageCandidates[0] ?? resolvedImageUrl);
                const familyLabel = item.family_label ?? (item.family_key ? getFamilyLabelText(item.family_key) : 'Unclassified');
                const roleLabel = getCollectionRoleLabel(item);
                const itemError = errorById[itemKey];
                const isRetired = Boolean(item.retired);
                const ratingPreview = activeRatingTile?.itemKey === itemKey ? activeRatingTile.previewRating : null;
                const ratingMarker = normalizeCollectionRating(item.rating);
                return (
                  <OdaraCollectionCardSurface
                    key={itemKey}
                    data-collection-tile
                    data-collection-fragrance-id={item.fragrance_id ?? itemKey}
                    data-collection-fragrance-name={item.name ?? ''}
                    ariaLabel={`Open details for ${item.name ?? 'this bottle'}`}
                    onOpen={() => {
                      const suppressedUntil = suppressTileClickRef.current[itemKey] ?? 0;
                      if (suppressedUntil > Date.now()) return;
                      onOpenFragranceDetail(buildFragranceDetailSurfaceStateFromCollectionItem(item));
                    }}
                    className="relative flex min-h-[286px] flex-col rounded-[28px] p-2.5 transition-transform duration-200 active:scale-[0.985]"
                    onContextMenu={(event) => event.preventDefault()}
                    onPointerDown={(event) => beginCollectionTilePress(item, itemKey, event)}
                    onPointerMove={updateCollectionTilePress}
                    onPointerUp={(event) => endCollectionTilePress(item, event)}
                    onPointerCancel={cancelCollectionTilePress}
                    style={{
                      background: isRetired
                        ? 'radial-gradient(circle at 50% 16%, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.012) 48%, rgba(255,255,255,0) 100%)'
                        : `radial-gradient(circle at 50% 18%, ${tint.wash} 0%, rgba(255,255,255,0.018) 42%, rgba(255,255,255,0) 100%)`,
                      boxShadow: isRetired
                        ? '0 18px 42px rgba(0,0,0,0.26)'
                        : `0 26px 58px ${tint.glowStrong}`,
                      touchAction: 'pan-y',
                      WebkitTouchCallout: 'none',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    {!isRetired ? (
                      <div
                        className="pointer-events-none absolute inset-x-3 top-3 h-16 rounded-[18px]"
                        style={{
                          background: `radial-gradient(circle at 50% 0%, ${tint.inner} 0%, rgba(255,255,255,0) 78%)`,
                          filter: 'blur(18px)',
                        }}
                      />
                    ) : null}
                    {ratingPreview ? (
                      <div
                        className="pointer-events-none absolute inset-x-2 bottom-2 z-[2] rounded-[18px] border px-3 py-3"
                        style={{
                          borderColor: 'rgba(231,181,95,0.22)',
                          background: 'linear-gradient(180deg, rgba(15,16,20,0.95) 0%, rgba(9,10,14,0.98) 100%)',
                          boxShadow: '0 18px 42px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.06)',
                        }}
                      >
                        <div className="text-center text-[8px] uppercase tracking-[0.24em] text-white/42">
                          Release to rate
                        </div>
                        <div className="mt-2 flex justify-center">
                          <CollectionRatingStars rating={ratingPreview} size={18} active />
                        </div>
                        <div className="mt-2 text-center text-[10px] uppercase tracking-[0.16em] text-[#e7b55f]">
                          {getCollectionRatingLabel(ratingPreview)}
                        </div>
                      </div>
                    ) : null}
                    {itemError ? (
                      <div className="pointer-events-none absolute inset-x-2 bottom-12 z-[2] flex justify-center">
                        <div
                          className="max-w-full truncate rounded-full px-3 py-[7px] text-[9px] text-rose-200/88"
                          style={{
                            border: '1px solid rgba(226,87,87,0.26)',
                            background: 'rgba(43,14,18,0.84)',
                            boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
                          }}
                        >
                          {itemError}
                        </div>
                      </div>
                    ) : null}
                    <div
                      className="relative flex flex-1 flex-col"
                      style={isRetired ? { filter: 'grayscale(1) saturate(0.18)', opacity: 0.82 } : undefined}
                    >
                      <div
                        className="relative"
                        style={{
                          aspectRatio: '4 / 5',
                          background: `radial-gradient(circle at 50% 44%, ${tint.inner} 0%, rgba(255,255,255,0) 72%)`,
                        }}
                      >
                        <OdaraBottleImage
                          candidates={imageCandidates}
                          alt={item.name ?? 'Fragrance bottle'}
                          className="h-full w-full object-contain p-1.5"
                          style={{
                            borderRadius: likelyTransparentImage ? undefined : 20,
                            filter: likelyTransparentImage
                              ? `drop-shadow(0 22px 30px rgba(0,0,0,0.42)) drop-shadow(0 0 22px ${tint.glowStrong})`
                              : `contrast(1.03) saturate(0.96) drop-shadow(0 22px 30px rgba(0,0,0,0.42)) drop-shadow(0 0 18px ${tint.glowStrong})`,
                            mixBlendMode: likelyTransparentImage ? undefined : 'darken',
                          }}
                          fallback={(
                          <div
                            className="flex h-full w-full items-center justify-center text-[20px] uppercase tracking-[0.1em] text-foreground/56"
                            style={{
                              background: `radial-gradient(circle at 50% 46%, ${tint.wash} 0%, rgba(255,255,255,0) 72%)`,
                            }}
                          >
                            <div className="px-4 py-2 drop-shadow-[0_18px_28px_rgba(0,0,0,0.36)]">
                              {deriveProfileMonogram(item.name ?? item.brand ?? 'Bottle')}
                            </div>
                          </div>
                          )}
                        />
                        {ratingMarker ? (
                          <div className="pointer-events-none absolute left-2.5 top-2.5 z-[1]">
                            <div
                              className="rounded-full px-2 py-[4px] text-[8px] font-medium tracking-[0.08em]"
                              style={{
                                color: 'rgba(247,220,159,0.96)',
                                border: '1px solid rgba(231,181,95,0.26)',
                                background: 'rgba(19,16,11,0.78)',
                                boxShadow: '0 10px 24px rgba(0,0,0,0.2)',
                              }}
                            >
                              {`${ratingMarker}★`}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="mt-3 flex min-h-[98px] flex-col">
                        <div
                          className="line-clamp-2 text-left text-[15.5px] leading-[1.14] text-foreground/96"
                          style={{ fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: '-0.012em' }}
                        >
                          {item.name ?? 'Unnamed fragrance'}
                        </div>
                        <div className="mt-2 text-[11.5px] leading-[1.46] text-foreground/60">
                          {item.brand ?? 'Brand unavailable'}
                        </div>
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          <span
                            className="max-w-full truncate rounded-full px-2.5 py-[5px] text-[8.5px] font-medium tracking-[0.08em]"
                            style={{
                              color: 'rgba(255,255,255,0.84)',
                              border: `1px solid ${tint.frame}`,
                              background: `linear-gradient(180deg, ${tint.inner} 0%, rgba(255,255,255,0.018) 100%)`,
                              boxShadow: `0 0 18px ${tint.glowStrong}`,
                            }}
                          >
                            {familyLabel}
                          </span>
                          {roleLabel ? (
                            <span
                              className="max-w-full truncate rounded-full px-2.5 py-[5px] text-[7.5px] uppercase tracking-[0.18em] text-foreground/64"
                              style={{
                                border: '1px solid rgba(255,255,255,0.09)',
                                background: 'rgba(255,255,255,0.028)',
                              }}
                            >
                              {roleLabel}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="mt-auto flex min-h-[34px] items-end justify-end pt-3">
                      {!isGuestMode ? (
                        <div className="flex min-h-[30px] flex-1 items-end justify-end">
                          <CollectionRetireButton
                            active={isRetired}
                            disabled={
                              !!pendingRetiredById[itemKey]
                              || !!pendingRatingById[itemKey]
                              || !item.fragrance_id
                            }
                            onToggle={() => {
                              haptic(isRetired ? 'selection' : 'success');
                              void handleRetiredToggle(item);
                            }}
                          />
                        </div>
                      ) : null}
                    </div>
                  </OdaraCollectionCardSurface>
                );
              })}
            </div>
          )}
      </div>
      <OdaraBottomSheet
        open={!!reasonSheetState}
        onClose={() => {
          setReasonSheetError(null);
          setReasonSavePending(false);
          setReasonSheetState(null);
        }}
      >
        <div className="px-5 pb-5 pt-4">
          <div className="text-center text-[10px] uppercase tracking-[0.28em] text-foreground/38">
            Low rating follow-up
          </div>
          <div
            className="mt-2 text-center text-[26px] leading-[1.04] text-foreground/92"
            style={{ fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: '-0.01em' }}
          >
            What went wrong?
          </div>
          <div className="mt-1 text-center text-[12px] leading-[1.55] text-foreground/48">
            {reasonSheetState ? `${reasonSheetState.itemName} stays at ${reasonSheetState.rating} star${reasonSheetState.rating === 1 ? '' : 's'}.` : ''}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {COLLECTION_LOW_RATING_REASONS.map((reason) => (
              <button
                key={reason.key}
                type="button"
                disabled={reasonSavePending}
                onClick={() => {
                  void handleRatingReasonSelect(reason.key);
                }}
                className="rounded-[16px] px-3 py-3 text-left text-[12px] text-foreground/84 transition-colors hover:bg-white/[0.04]"
                style={{
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(255,255,255,0.025)',
                }}
              >
                {reason.label}
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              type="button"
              disabled={reasonSavePending}
              onClick={() => {
                void handleRatingReasonSelect(null);
              }}
              className="text-[11px] uppercase tracking-[0.24em] text-foreground/48 transition-colors hover:text-foreground/78"
            >
              Skip
            </button>
            {reasonSavePending ? (
              <div className="text-[11px] uppercase tracking-[0.22em] text-foreground/42">
                Saving…
              </div>
            ) : null}
          </div>

          <div className="mt-2 min-h-[16px] text-center text-[10px] leading-[1.4] text-rose-300/82">
            {reasonSheetError ?? ''}
          </div>
        </div>
      </OdaraBottomSheet>
    </OdaraDestinationChrome>
  );
};

const OdaraWardrobeStatusPill: React.FC<{
  status: OdaraWardrobePrimaryStatus;
  localOnly?: boolean;
  compact?: boolean;
}> = ({ status, localOnly = false, compact = false }) => {
  const tone = getWardrobePrimaryStatusTone(status);
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full ${compact ? 'px-2.5 py-[5px] text-[8px]' : 'px-3 py-[6px] text-[9px]'} uppercase tracking-[0.22em]`}
      style={{
        border: `1px solid ${tone.border}`,
        background: tone.background,
        color: tone.color,
      }}
    >
      <span className="truncate">{getWardrobePrimaryStatusLabel(status)}</span>
      {localOnly ? (
        <span className="rounded-full bg-black/16 px-1.5 py-[1px] text-[7px] tracking-[0.18em] text-white/68">
          Session
        </span>
      ) : null}
    </span>
  );
};

const OdaraWardrobeBottleArt: React.FC<{
  name: string;
  brand?: string | null;
  family_key?: string | null;
  family_label?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  alt?: string;
  compact?: boolean;
  frameless?: boolean;
  presentation?: 'default' | 'wardrobe_grid';
  className?: string;
}> = ({
  name,
  brand,
  family_key,
  family_label,
  image_url,
  thumbnail_url,
  alt,
  compact = false,
  frameless = false,
  presentation = 'default',
  className = '',
}) => {
  const tint = getEnhancedCollectionTint({
    family_key: family_key ?? family_label ?? null,
    family_label: family_label ?? (family_key ? getFamilyLabelText(family_key) : null),
  });
  const resolvedImageUrl = resolvePreferredWardrobeBottleImage(image_url, thumbnail_url);
  const imageCandidates = buildPreferredBottleImageCandidates(image_url, thumbnail_url);
  const likelyTransparentImage = isLikelyTransparentBottleImageUrl(imageCandidates[0] ?? resolvedImageUrl);
  const useWardrobeGridPresentation = presentation === 'wardrobe_grid';
  const monogram = deriveProfileMonogram(name || brand || 'Bottle');

  return (
    <div
      className={`relative ${(frameless || useWardrobeGridPresentation) ? 'overflow-visible rounded-[28px]' : 'overflow-hidden rounded-[24px] border'} ${className}`}
      style={{
        borderColor: (frameless || useWardrobeGridPresentation) ? 'transparent' : tint.frame,
        background: useWardrobeGridPresentation
          ? 'transparent'
          : frameless
          ? 'transparent'
          : `radial-gradient(circle at 50% 12%, ${tint.wash} 0%, rgba(255,255,255,0.022) 36%, rgba(9,10,14,0.96) 100%)`,
        boxShadow: useWardrobeGridPresentation
          ? 'none'
          : frameless
          ? 'none'
          : `inset 0 1px 0 rgba(255,255,255,0.06), 0 18px 40px ${tint.glowStrong}`,
      }}
    >
      {!useWardrobeGridPresentation ? (
        <div
          className={`pointer-events-none absolute rounded-full ${frameless ? 'inset-x-8 top-11 h-12 opacity-45' : 'inset-x-4 top-3 h-16'}`}
          style={{
            background: `radial-gradient(circle at 50% 0%, ${tint.inner} 0%, rgba(255,255,255,0) 78%)`,
            filter: frameless ? 'blur(10px)' : 'blur(18px)',
          }}
        />
      ) : null}
      <OdaraBottleImage
        candidates={imageCandidates}
        alt={alt ?? `${name} bottle`}
        className={`relative h-full w-full object-contain ${frameless ? (compact ? 'p-1' : 'p-2') : compact ? 'p-2.5' : 'p-4'}`}
        style={useWardrobeGridPresentation
          ? {
              borderRadius: likelyTransparentImage ? undefined : 18,
              filter: likelyTransparentImage
                ? 'drop-shadow(0 12px 18px rgba(0,0,0,0.26))'
                : 'contrast(1.03) saturate(0.96) drop-shadow(0 12px 18px rgba(0,0,0,0.28))',
              mixBlendMode: likelyTransparentImage ? undefined : 'darken',
            }
          : frameless
            ? {
                borderRadius: likelyTransparentImage ? undefined : 18,
                filter: likelyTransparentImage
                  ? `drop-shadow(0 16px 24px rgba(0,0,0,0.42)) drop-shadow(0 0 8px ${tint.glowStrong})`
                  : 'contrast(1.03) saturate(0.95) drop-shadow(0 14px 22px rgba(0,0,0,0.4))',
                mixBlendMode: likelyTransparentImage ? undefined : 'darken',
              }
            : {
                borderRadius: likelyTransparentImage ? undefined : 18,
                filter: likelyTransparentImage
                  ? undefined
                  : 'contrast(1.03) saturate(0.95)',
                mixBlendMode: likelyTransparentImage ? undefined : 'darken',
              }}
        fallback={(
        <div className="flex h-full w-full items-center justify-center">
          <div className="relative">
            <svg
              width={compact ? 58 : 112}
              height={compact ? 76 : 148}
              viewBox="0 0 112 148"
              aria-hidden="true"
              className={useWardrobeGridPresentation ? 'drop-shadow-[0_8px_18px_rgba(0,0,0,0.22)]' : 'drop-shadow-[0_10px_30px_rgba(0,0,0,0.32)]'}
            >
              <defs>
                <linearGradient id={useWardrobeGridPresentation ? 'wardrobeBottleSilhouetteGrid' : 'wardrobeBottleSilhouette'} x1="50%" y1="0%" x2="50%" y2="100%">
                  <stop offset="0%" stopColor={useWardrobeGridPresentation ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.22)'} />
                  <stop offset="100%" stopColor={useWardrobeGridPresentation ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.08)'} />
                </linearGradient>
              </defs>
              <rect x="40" y="10" width="32" height="22" rx="8" fill={useWardrobeGridPresentation ? 'url(#wardrobeBottleSilhouetteGrid)' : 'url(#wardrobeBottleSilhouette)'} />
              <rect x="30" y="28" width="52" height="98" rx="18" fill={useWardrobeGridPresentation ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.08)'} stroke={useWardrobeGridPresentation ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.18)'} />
              <rect x="35" y="38" width="42" height="74" rx="14" fill={useWardrobeGridPresentation ? 'rgba(255,255,255,0.028)' : 'rgba(255,255,255,0.05)'} />
            </svg>
            <div
              className={`pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center uppercase tracking-[0.32em] ${useWardrobeGridPresentation ? 'text-[9px] text-foreground/48' : 'text-[10px] text-foreground/56'}`}
              style={{ fontFamily: "'Geist Sans', system-ui, sans-serif" }}
            >
              {monogram}
            </div>
          </div>
        </div>
        )}
      />
    </div>
  );
};

const OdaraSignedInWardrobeOnboardingPage: React.FC<{
  onClose: () => void;
  onOpenScentIntel?: (input: ScentIntelInput) => void;
  userId: string | null;
  selectedContext: string;
  entryPreset?: OdaraCollectionEntryPreset;
  onCapturePreferenceMoment?: (payload: {
    preference_state: PersistedPreferenceMomentState;
    source: string;
    main: {
      fragrance_id?: string | null;
      name?: string | null;
      brand?: string | null;
      family_key?: string | null;
      image_url?: string | null;
    };
    layer?: {
      fragrance_id?: string | null;
      name?: string | null;
      brand?: string | null;
      family_key?: string | null;
      image_url?: string | null;
    } | null;
  }) => void;
}> = ({ onClose, onOpenScentIntel, userId, selectedContext, entryPreset = 'all', onCapturePreferenceMoment }) => {
  const {
    activeSessionUserId,
    sessionResolved,
  } = useOdaraActiveSessionUser({
    userId,
    isGuestMode: false,
    scope: 'collection',
  });
  const [payload, setPayload] = useState<OdaraCollectionPayload | null>(null);
  const [persistedPreferencesById, setPersistedPreferencesById] = useState<Record<string, OdaraPersistedWardrobePreference>>({});
  const [persistedWishlistsById, setPersistedWishlistsById] = useState<Record<string, OdaraPersistedWardrobeWishlistSignal>>({});
  const [persistedWearById, setPersistedWearById] = useState<Record<string, OdaraWardrobeWearSnapshot>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<OdaraWardrobeCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [wearHistoryLoading, setWearHistoryLoading] = useState(true);
  const [brandRailSource, setBrandRailSource] = useState<OdaraWardrobeRailSource>('safe_local_list');
  const [surface, setSurface] = useState<OdaraWardrobeSurface>('wardrobe');
  const [detailReturnSurface, setDetailReturnSurface] = useState<OdaraWardrobeDetailReturnSurface>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(debouncedSearchQuery);
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [wardrobeBrandFilter, setWardrobeBrandFilter] = useState<string | null>(null);
  const [wardrobeSeasonFilter, setWardrobeSeasonFilter] = useState<OdaraWardrobeSeasonFilterKey | null>(null);
  const [wardrobeFamilyFilter, setWardrobeFamilyFilter] = useState<string | null>(null);
  const [wardrobeWishlistOnly, setWardrobeWishlistOnly] = useState(false);
  const [wardrobeLikedOnly, setWardrobeLikedOnly] = useState(false);
  const [wardrobeRetiredOnly, setWardrobeRetiredOnly] = useState(false);
  const [wardrobeFavoriteOnly, setWardrobeFavoriteOnly] = useState(false);
  const [wardrobeUnwornOnly, setWardrobeUnwornOnly] = useState(false);
  const [wardrobeSortKey, setWardrobeSortKey] = useState<OdaraWardrobeSortKey | null>('az');
  const [wardrobeSortDirection, setWardrobeSortDirection] = useState<OdaraWardrobeSortDirection>('asc');
  const [wardrobeMenu, setWardrobeMenu] = useState<'filter' | 'sort' | null>(null);
  const [wardrobeSearchOpen, setWardrobeSearchOpen] = useState(false);
  const [wardrobeSearchQuery, setWardrobeSearchQuery] = useState('');
  const [selectedFragranceId, setSelectedFragranceId] = useState<string | null>(null);
  const [confirmationState, setConfirmationState] = useState<OdaraWardrobeConfirmationState | null>(null);
  const [sessionSignals, setSessionSignals] = useState<Record<string, OdaraWardrobeSessionSignal>>(() => readStoredWardrobeSessionSignals(activeSessionUserId));
  const [actionLabelCount, setActionLabelCount] = useState(() => readStoredWardrobeActionLabelCount());
  const [onboardingSeen, setOnboardingSeen] = useState(() => readStoredWardrobeOnboardingSeen(activeSessionUserId));
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const [pendingRetiredById, setPendingRetiredById] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [detailHydrationById, setDetailHydrationById] = useState<Record<string, {
    detail: FragranceDetail | null;
    loading: boolean;
    error: string | null;
  }>>({});

  useEffect(() => {
    setWardrobeBrandFilter(null);
    setWardrobeSeasonFilter(null);
    setWardrobeFamilyFilter(null);
    setWardrobeFavoriteOnly(entryPreset === 'favorites');
    setWardrobeUnwornOnly(false);
    setWardrobeWishlistOnly(entryPreset === 'saved' || entryPreset === 'wishlist');
    setWardrobeLikedOnly(entryPreset === 'liked');
    setWardrobeRetiredOnly(entryPreset === 'retired');
  }, [entryPreset]);

  const loadCollection = useCallback(async () => {
    if (!sessionResolved) {
      setLoading(true);
      setError(null);
      return;
    }

    if (!activeSessionUserId) {
      setPayload(null);
      setLoading(false);
      setError('No signed-in wardrobe is available yet.');
      return;
    }

    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await odaraSupabase.rpc('get_collection_wardrobe_v1' as any, {
      p_user: activeSessionUserId,
      p_filter: 'all',
      p_sort: 'role',
    } as any);

    if (rpcError) {
      setPayload(null);
      setError(rpcError.message || 'Could not load the live wardrobe yet.');
      setLoading(false);
      return;
    }

    setPayload(normalizeCollectionPayload((data ?? null) as OdaraCollectionPayload | null));
    setLoading(false);
  }, [activeSessionUserId, sessionResolved]);

  const loadPersistedPreferences = useCallback(async () => {
    if (!sessionResolved) {
      return;
    }

    if (!activeSessionUserId) {
      setPersistedPreferencesById({});
      return;
    }

    const { data, error: preferenceError } = await odaraSupabase.rpc('get_user_fragrance_preference_signals_v1' as any, {
      p_user_id: activeSessionUserId,
    } as any);

    if (preferenceError) {
      throw preferenceError;
    }

    const preferenceItems = Array.isArray((data as any)?.items)
      ? (data as any).items
      : Array.isArray(data)
        ? data
        : [];

    const nextPreferences: Record<string, OdaraPersistedWardrobePreference> = {};
    for (const row of preferenceItems) {
      const fragranceId = typeof row?.fragrance_id === 'string' ? row.fragrance_id.trim() : '';
      if (!fragranceId) continue;
      const preferenceState = normalizeWardrobePreferenceState(row?.preference_state);
      if (preferenceState === 'neutral') continue;
      nextPreferences[fragranceId] = {
        fragrance_id: fragranceId,
        preference_state: preferenceState,
        heart_state: preferenceStateToHeartState(preferenceState),
        negative_state: preferenceStateToNegativeState(preferenceState),
        created_at: parseOdaraTimestampMs(row?.created_at ?? row?.updated_at),
        updated_at: Number.isFinite(Date.parse(String(row?.updated_at ?? '')))
          ? Date.parse(String(row?.updated_at ?? ''))
          : Date.now(),
      };
    }

    setPersistedPreferencesById(nextPreferences);
    setSessionSignals((current) => {
      const next = { ...current };
      for (const [fragranceId, signal] of Object.entries(current)) {
        if (!signal.heart_persisted && !signal.negative_persisted) continue;
        const persisted = nextPreferences[fragranceId];
        if (persisted) {
          next[fragranceId] = {
            ...signal,
            heart_state: persisted.heart_state,
            heart_persisted: persisted.heart_state > 0,
            negative_state: persisted.negative_state,
            negative_persisted: persisted.negative_state > 0,
            updated_at: Math.max(signal.updated_at, persisted.updated_at),
          };
          continue;
        }
        next[fragranceId] = {
          ...signal,
          heart_state: 0,
          heart_persisted: false,
          negative_state: 0,
          negative_persisted: false,
          updated_at: Date.now(),
        };
      }
      return next;
    });
  }, [activeSessionUserId, sessionResolved]);

  const loadPersistedWishlists = useCallback(async () => {
    if (!sessionResolved) {
      return;
    }

    if (!activeSessionUserId) {
      setPersistedWishlistsById({});
      return;
    }

    const { data, error: wishlistError } = await odaraSupabase.rpc('get_user_collection_wishlist_signals_v1' as any, {
      p_user_id: activeSessionUserId,
    } as any);

    if (wishlistError) {
      throw wishlistError;
    }

    const wishlistItems = Array.isArray((data as any)?.items)
      ? (data as any).items
      : Array.isArray(data)
        ? data
        : [];

    const nextWishlists: Record<string, OdaraPersistedWardrobeWishlistSignal> = {};
    for (const row of wishlistItems) {
      const fragranceId = typeof row?.fragrance_id === 'string' ? row.fragrance_id.trim() : '';
      const status = typeof row?.status === 'string' ? row.status.trim().toLowerCase() : '';
      if (!fragranceId || status !== 'would_buy') continue;
      nextWishlists[fragranceId] = {
        fragrance_id: fragranceId,
        status: 'would_buy',
        created_at: parseOdaraTimestampMs(row?.created_at ?? row?.updated_at),
        updated_at: Number.isFinite(Date.parse(String(row?.updated_at ?? '')))
          ? Date.parse(String(row?.updated_at ?? ''))
          : Date.now(),
      };
    }

    setPersistedWishlistsById(nextWishlists);
    setSessionSignals((current) => {
      const next = { ...current };
      for (const [fragranceId, signal] of Object.entries(current)) {
        const persisted = nextWishlists[fragranceId];
        if (persisted) {
          next[fragranceId] = {
            ...signal,
            wishlist: true,
            wishlist_persisted: true,
            updated_at: Math.max(signal.updated_at, persisted.updated_at),
          };
          continue;
        }

        if (signal.wishlist || signal.wishlist_persisted) {
          next[fragranceId] = {
            ...signal,
            wishlist: false,
            wishlist_persisted: false,
            updated_at: Date.now(),
          };
        }
      }
      return next;
    });
  }, [activeSessionUserId, sessionResolved]);

  const loadPersistedWearHistory = useCallback(async () => {
    if (!sessionResolved) {
      setWearHistoryLoading(true);
      return;
    }

    if (!activeSessionUserId) {
      setPersistedWearById({});
      setWearHistoryLoading(false);
      return;
    }

    setWearHistoryLoading(true);
    try {
      const { data, error: historyError } = await odaraSupabase
        .from(ODARA_SIGNED_IN_DAY_MEMORY_TABLE as any)
        .select('date_key, context_key, state_json')
        .eq('user_id', activeSessionUserId)
        .eq('context_key', normalizePersistedContextKey(selectedContext));

      if (historyError) throw historyError;

      const nextHistory: Record<string, OdaraWardrobeWearSnapshot> = {};
      for (const row of Array.isArray(data) ? data : []) {
        const dateKey = typeof row?.date_key === 'string' ? row.date_key.trim() : '';
        const wornAt = parseOdaraDateKeyMs(dateKey);
        if (!dateKey || wornAt <= 0) continue;

        const state = deserializeSignedInDayStateFromStorage(row?.state_json);
        const lockTruth = resolveSignedInLockedTruth(state);
        if (!lockTruth) continue;

        const seenFragranceIds = new Set(
          [
            lockTruth.lockedCard?.fragrance_id,
            lockTruth.lockedLayerCard?.fragrance_id,
          ]
            .map((value) => (typeof value === 'string' ? value.trim() : ''))
            .filter(Boolean),
        );

        for (const fragranceId of seenFragranceIds) {
          const existing = nextHistory[fragranceId];
          nextHistory[fragranceId] = {
            last_worn_at: Math.max(existing?.last_worn_at ?? 0, wornAt),
            last_worn_date_key:
              !existing || wornAt >= existing.last_worn_at
                ? dateKey
                : existing.last_worn_date_key,
            wear_count: (existing?.wear_count ?? 0) + 1,
          };
        }
      }

      setPersistedWearById(nextHistory);
    } catch (wearHistoryError) {
      console.error('[Odara] wardrobe wear-history hydrate failed', wearHistoryError);
      setPersistedWearById({});
    } finally {
      setWearHistoryLoading(false);
    }
  }, [activeSessionUserId, selectedContext, sessionResolved]);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const nextCatalog = await fetchOdaraWardrobeCatalog();
      setCatalog(nextCatalog);
      setCatalogLoading(false);
    } catch (catalogLoadError: any) {
      setCatalog([]);
      setCatalogError(catalogLoadError?.message || 'Could not read the fragrance catalog yet.');
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCollection();
  }, [loadCollection]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadPersistedPreferences();
      } catch (preferenceHydrateError) {
        if (!cancelled) {
          console.error('[Odara] wardrobe preference hydrate failed', preferenceHydrateError);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadPersistedPreferences]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadPersistedWishlists();
      } catch (wishlistHydrateError) {
        if (!cancelled) {
          console.error('[Odara] wardrobe wishlist hydrate failed', wishlistHydrateError);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadPersistedWishlists]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    void loadPersistedWearHistory();
  }, [loadPersistedWearHistory]);

  useEffect(() => {
    setSessionSignals(readStoredWardrobeSessionSignals(activeSessionUserId));
    setOnboardingSeen(readStoredWardrobeOnboardingSeen(activeSessionUserId));
    setSurface('wardrobe');
    setSelectedFragranceId(null);
    setConfirmationState(null);
    setPendingActionKey(null);
    setActionError(null);
    setWardrobeSeasonFilter(null);
    setWardrobeFamilyFilter(null);
    setWardrobeWishlistOnly(false);
    setWardrobeFavoriteOnly(false);
    setWardrobeUnwornOnly(false);
    setWardrobeSortKey('az');
    setWardrobeSortDirection('asc');
  }, [activeSessionUserId]);

  useEffect(() => {
    if (surface !== 'detail' || !selectedFragranceId || !activeSessionUserId) return;
    const existing = detailHydrationById[selectedFragranceId];
    if (existing?.detail || existing?.loading || existing?.error) return;

    let cancelled = false;
    setDetailHydrationById((current) => ({
      ...current,
      [selectedFragranceId]: {
        detail: current[selectedFragranceId]?.detail ?? null,
        loading: true,
        error: null,
      },
    }));

    (async () => {
      const detail = await fetchOdaraFragranceDetailForSurface(
        selectedFragranceId,
        activeSessionUserId,
        false,
      );
      if (cancelled) return;
      setDetailHydrationById((current) => ({
        ...current,
        [selectedFragranceId]: {
          detail,
          loading: false,
          error: detail ? null : 'Could not refresh the live fragrance profile.',
        },
      }));
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSessionUserId, detailHydrationById, selectedFragranceId, surface]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 180);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchQuery]);

  useEffect(() => {
    writeStoredWardrobeSessionSignals(activeSessionUserId, sessionSignals);
  }, [activeSessionUserId, sessionSignals]);

  useEffect(() => {
    writeStoredWardrobeActionLabelCount(actionLabelCount);
  }, [actionLabelCount]);

  useEffect(() => {
    writeStoredWardrobeOnboardingSeen(activeSessionUserId, onboardingSeen);
  }, [activeSessionUserId, onboardingSeen]);

  const collectionItems = payload?.items ?? [];

  const collectionItemById = useMemo(() => {
    const next = new Map<string, OdaraCollectionItem>();
    for (const item of collectionItems) {
      if (!item.fragrance_id) continue;
      next.set(item.fragrance_id, item);
    }
    return next;
  }, [collectionItems]);

  const handleRetiredToggle = useCallback(async (item: OdaraCollectionItem) => {
    if (!item.fragrance_id) return;
    setPendingRetiredById((prev) => ({ ...prev, [item.fragrance_id as string]: true }));
    const { data, error: rpcError } = await odaraSupabase.rpc('set_user_fragrance_retired_v1' as any, {
      p_fragrance_id: item.fragrance_id,
      p_retired: !item.retired,
      p_source: 'collection',
    } as any);
    if (rpcError || !data) {
      setPendingRetiredById((prev) => ({ ...prev, [item.fragrance_id as string]: false }));
      return;
    }
    const result = data as OdaraCollectionRetiredWriteResult;
    setPayload((prev) => {
      if (!prev) return prev;
      return normalizeCollectionPayload({
        ...prev,
        items: (prev.items ?? []).map((entry) => (
          entry.fragrance_id === result.fragrance_id
            ? {
                ...entry,
                retired: result.retired,
                favorite: result.favorite ?? result.wear_more ?? false,
                wear_more: result.wear_more ?? result.favorite ?? false,
              }
            : entry
        )),
        summary: {
          ...prev.summary,
          wear_more_count: result.wear_more_count ?? result.favorite_count ?? prev.summary.wear_more_count,
          favorite_count: result.favorite_count ?? result.wear_more_count ?? prev.summary.favorite_count,
          retired_count: result.retired_count,
        },
      });
    });
    setPendingRetiredById((prev) => ({ ...prev, [item.fragrance_id as string]: false }));
  }, []);

  const catalogById = useMemo(() => {
    const next = new Map<string, OdaraWardrobeCatalogItem>();
    for (const item of catalog) {
      next.set(item.fragrance_id, item);
    }
    return next;
  }, [catalog]);

  const liveBrands = useMemo(() => {
    const brands = Array.from(new Set(
      catalog
        .map((item) => readTrimmedLayerText(item.brand))
        .filter(Boolean),
    ));
    brands.sort(compareWardrobeBrands);
    return brands;
  }, [catalog]);

  useEffect(() => {
    setBrandRailSource(liveBrands.length > 0 ? 'live_database' : 'safe_local_list');
  }, [liveBrands.length]);

  const brandOptions = useMemo(() => {
    if (liveBrands.length > 0) return liveBrands;
    return [...ODARA_WARDROBE_FALLBACK_BRANDS].sort(compareWardrobeBrands);
  }, [liveBrands]);

  const effectiveSignalMap = useMemo(() => {
    const next: Record<string, OdaraWardrobeSessionSignal> = {};

    for (const item of collectionItems) {
      if (!item.fragrance_id) continue;
      const resolvedItem = catalogById.get(item.fragrance_id) ?? buildWardrobeCatalogItemFromCollectionItem(item);
      if (!resolvedItem) continue;
      const collectionHeartState = preferenceStateToHeartState(item.preference_state);
      next[item.fragrance_id] = createWardrobeSessionSignalFromItem(resolvedItem, {
        owned: true,
        own_persisted: true,
        heart_state: collectionHeartState,
        heart_persisted: collectionHeartState > 0,
        updated_at: Math.max(
          parseOdaraTimestampMs(item.collection_created_at),
          parseOdaraTimestampMs(item.collection_updated_at),
        ),
      });
    }

    for (const persistedWishlist of Object.values(persistedWishlistsById)) {
      const resolvedItem = catalogById.get(persistedWishlist.fragrance_id)
        ?? (collectionItemById.get(persistedWishlist.fragrance_id) ? buildWardrobeCatalogItemFromCollectionItem(collectionItemById.get(persistedWishlist.fragrance_id)!) : null);
      if (!resolvedItem) continue;
      const baseSignal = next[persistedWishlist.fragrance_id] ?? createWardrobeSessionSignalFromItem(resolvedItem);
      next[persistedWishlist.fragrance_id] = {
        ...baseSignal,
        wishlist: !baseSignal.owned,
        wishlist_persisted: !baseSignal.owned,
        updated_at: persistedWishlist.updated_at,
      };
    }

    for (const persisted of Object.values(persistedPreferencesById)) {
      const resolvedItem = catalogById.get(persisted.fragrance_id)
        ?? (collectionItemById.get(persisted.fragrance_id) ? buildWardrobeCatalogItemFromCollectionItem(collectionItemById.get(persisted.fragrance_id)!) : null);
      if (!resolvedItem) continue;
      const baseSignal = next[persisted.fragrance_id] ?? createWardrobeSessionSignalFromItem(resolvedItem);
      next[persisted.fragrance_id] = {
        ...baseSignal,
        heart_state: persisted.heart_state,
        heart_persisted: persisted.heart_state > 0,
        negative_state: persisted.negative_state,
        negative_persisted: persisted.negative_state > 0,
        updated_at: persisted.updated_at,
      };
    }

    for (const [fragranceId, signal] of Object.entries(sessionSignals)) {
      const resolvedItem = catalogById.get(fragranceId)
        ?? buildWardrobeCatalogItemFromSignal(signal)
        ?? null;
      if (!resolvedItem) continue;
      const baseSignal = next[fragranceId] ?? createWardrobeSessionSignalFromItem(resolvedItem);
      const persistedSignal = persistedPreferencesById[fragranceId] ?? null;
      const allowSessionHeartState = !persistedSignal || signal.heart_persisted;
      const allowSessionNegativeState = !persistedSignal || signal.negative_persisted;
      const resolvedHeartState = allowSessionHeartState ? signal.heart_state : baseSignal.heart_state;
      const resolvedHeartPersisted = allowSessionHeartState ? signal.heart_persisted : baseSignal.heart_persisted;
      const resolvedNegativeState = allowSessionNegativeState ? signal.negative_state : baseSignal.negative_state;
      const resolvedNegativePersisted = allowSessionNegativeState ? signal.negative_persisted : baseSignal.negative_persisted;
      next[fragranceId] = {
        ...baseSignal,
        ...signal,
        brand: signal.brand ?? baseSignal.brand,
        family_key: signal.family_key || baseSignal.family_key,
        family_label: signal.family_label || baseSignal.family_label,
        release_year: signal.release_year ?? baseSignal.release_year,
        concentration: signal.concentration ?? baseSignal.concentration,
        notes: signal.notes.length > 0 ? signal.notes : baseSignal.notes,
        accords: signal.accords.length > 0 ? signal.accords : baseSignal.accords,
        top_notes: signal.top_notes.length > 0 ? signal.top_notes : baseSignal.top_notes,
        heart_notes: signal.heart_notes.length > 0 ? signal.heart_notes : baseSignal.heart_notes,
        base_notes: signal.base_notes.length > 0 ? signal.base_notes : baseSignal.base_notes,
        source_url: signal.source_url ?? baseSignal.source_url,
        source_confidence: signal.source_confidence ?? baseSignal.source_confidence,
        primary_season: signal.primary_season ?? baseSignal.primary_season,
        image_url: signal.image_url ?? baseSignal.image_url,
        thumbnail_url: signal.thumbnail_url ?? baseSignal.thumbnail_url,
        wishlist: baseSignal.owned ? false : (resolvedNegativeState > 0 ? false : signal.wishlist),
        wishlist_persisted: baseSignal.owned ? false : (resolvedNegativeState > 0 ? false : signal.wishlist_persisted),
        heart_state: resolvedHeartState,
        heart_persisted: resolvedHeartPersisted,
        negative_state: resolvedNegativeState,
        negative_persisted: resolvedNegativePersisted,
      };
    }

    return next;
  }, [catalogById, collectionItemById, collectionItems, persistedPreferencesById, persistedWishlistsById, sessionSignals]);

  const compareWardrobeCardsDefault = useCallback((a: OdaraWardrobeCard, b: OdaraWardrobeCard) => {
    const rankDelta = getWardrobeStatusRank(a.primary_status) - getWardrobeStatusRank(b.primary_status);
    if (rankDelta !== 0) return rankDelta;
    const newestDelta = compareOptionalWardrobeTimestamps(a.sort_newest_at, b.sort_newest_at, 'desc');
    if (newestDelta !== 0) return newestDelta;
    return (
      getWardrobeBrandLabel(a.brand).localeCompare(getWardrobeBrandLabel(b.brand), undefined, { sensitivity: 'base' })
      || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
  }, []);

  const wardrobeCards = useMemo(() => {
    const cards = Object.values(effectiveSignalMap)
      .filter((signal) => hasMeaningfulWardrobeSignal(signal))
      .map((signal) => {
        const primaryStatus = deriveWardrobePrimaryStatus(signal);
        if (!primaryStatus) return null;
        const resolvedItem = catalogById.get(signal.fragrance_id) ?? buildWardrobeCatalogItemFromSignal(signal);
        const collectionItem = collectionItemById.get(signal.fragrance_id) ?? null;
        const persistedWishlist = persistedWishlistsById[signal.fragrance_id] ?? null;
        const persistedPreference = persistedPreferencesById[signal.fragrance_id] ?? null;
        const wearSnapshot = persistedWearById[signal.fragrance_id] ?? null;
        const collectionCreatedAt = parseOdaraTimestampMs(collectionItem?.collection_created_at);
        const collectionUpdatedAt = parseOdaraTimestampMs(collectionItem?.collection_updated_at);
        const sortNewestAt = signal.owned
          ? (collectionCreatedAt || collectionUpdatedAt || signal.updated_at)
          : signal.wishlist
            ? (persistedWishlist?.created_at ?? persistedWishlist?.updated_at ?? signal.updated_at)
            : (persistedPreference?.created_at ?? persistedPreference?.updated_at ?? signal.updated_at);
        return {
          fragrance_id: signal.fragrance_id,
          name: signal.name,
          brand: signal.brand,
          family_key: signal.family_key,
          family_label: signal.family_label || buildFamilyLabel(signal.family_key),
          primary_season: resolvedItem.primary_season,
          image_url: signal.image_url ?? resolvedItem.image_url,
          thumbnail_url: signal.thumbnail_url ?? resolvedItem.thumbnail_url,
          item: resolvedItem,
          primary_status: primaryStatus,
          favorite: Boolean(collectionItem?.favorite ?? collectionItem?.wear_more),
          retired: Boolean(collectionItem?.retired),
          collection_created_at: collectionCreatedAt,
          collection_updated_at: collectionUpdatedAt,
          sort_newest_at: sortNewestAt,
          last_worn_at: wearSnapshot?.last_worn_at ?? null,
          last_worn_date_key: wearSnapshot?.last_worn_date_key ?? null,
          wear_count: wearSnapshot?.wear_count ?? 0,
          is_unworn: !wearSnapshot,
          local_only: !isWardrobeStatusPersisted(signal, primaryStatus),
        } satisfies OdaraWardrobeCard;
      })
      .filter((card): card is OdaraWardrobeCard => !!card);

    return cards.sort(compareWardrobeCardsDefault);
  }, [
    catalogById,
    collectionItemById,
    compareWardrobeCardsDefault,
    effectiveSignalMap,
    persistedPreferencesById,
    persistedWearById,
    persistedWishlistsById,
  ]);

  // Dynamic brand bar — built only from the current user's visible collection.
  // Null-safe: trims labels, ignores empty brands, dedupes case-insensitively,
  // sorts alphabetically (All is rendered first separately).
  const wardrobeBrandOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    wardrobeCards.forEach((card) => {
      const label = readTrimmedLayerText(card.brand);
      if (!label) return;
      const key = label.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, label);
    });
    return Array.from(byKey.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
  }, [wardrobeCards]);

  // Keep an active brand filter valid as the collection changes.
  useEffect(() => {
    if (
      wardrobeBrandFilter &&
      !wardrobeBrandOptions.some(
        (brand) => brand.toLowerCase() === wardrobeBrandFilter.toLowerCase(),
      )
    ) {
      setWardrobeBrandFilter(null);
    }
  }, [wardrobeBrandFilter, wardrobeBrandOptions]);

  const brandFilteredWardrobeCards = useMemo(() => {
    if (!wardrobeBrandFilter) return wardrobeCards;
    const target = wardrobeBrandFilter.toLowerCase();
    return wardrobeCards.filter(
      (card) => readTrimmedLayerText(card.brand).toLowerCase() === target,
    );
  }, [wardrobeBrandFilter, wardrobeCards]);

  const wardrobeFamilyOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    brandFilteredWardrobeCards.forEach((card) => {
      const familyKey = readTrimmedLayerText(card.family_key);
      if (!familyKey) return;
      if (!byKey.has(familyKey.toLowerCase())) {
        byKey.set(familyKey.toLowerCase(), readTrimmedLayerText(card.family_label) || buildFamilyLabel(familyKey) || familyKey);
      }
    });
    return Array.from(byKey.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  }, [brandFilteredWardrobeCards]);

  useEffect(() => {
    if (
      wardrobeFamilyFilter &&
      !wardrobeFamilyOptions.some((option) => option.key === wardrobeFamilyFilter)
    ) {
      setWardrobeFamilyFilter(null);
    }
  }, [wardrobeFamilyFilter, wardrobeFamilyOptions]);

  const activeWardrobeSortLabel = getWardrobeSortLabel(wardrobeSortKey, wardrobeSortDirection);
  const hasNonDefaultWardrobeSort = wardrobeSortKey !== 'az' || wardrobeSortDirection !== 'asc';

  const visibleWardrobeCards = useMemo(() => {
    let cards = [...brandFilteredWardrobeCards];

    if (wardrobeSeasonFilter) {
      cards = cards.filter((card) => matchesWardrobeSeason(card.primary_season, wardrobeSeasonFilter));
    }
    if (wardrobeFamilyFilter) {
      cards = cards.filter((card) => readTrimmedLayerText(card.family_key).toLowerCase() === wardrobeFamilyFilter);
    }
    if (wardrobeWishlistOnly) {
      cards = cards.filter((card) => card.primary_status === 'wishlist');
    }
    if (wardrobeLikedOnly) {
      cards = cards.filter((card) => (effectiveSignalMap[card.fragrance_id]?.heart_state ?? 0) > 0);
    }
    if (wardrobeRetiredOnly) {
      cards = cards.filter((card) => card.retired);
    }
    if (wardrobeFavoriteOnly) {
      cards = cards.filter((card) => card.favorite);
    }
    if (wardrobeUnwornOnly) {
      cards = cards.filter((card) => card.is_unworn);
    }

    cards.sort((a, b) => {
      if (wardrobeSortKey === 'az') {
        const nameDelta = wardrobeSortDirection === 'asc'
          ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
          : b.name.localeCompare(a.name, undefined, { sensitivity: 'base' });
        if (nameDelta !== 0) return nameDelta;
      } else if (wardrobeSortKey === 'newest') {
        const newestDelta = compareOptionalWardrobeTimestamps(a.sort_newest_at, b.sort_newest_at, wardrobeSortDirection);
        if (newestDelta !== 0) return newestDelta;
      } else if (wardrobeSortKey === 'last_worn') {
        const aWorn = typeof a.last_worn_at === 'number' && a.last_worn_at > 0;
        const bWorn = typeof b.last_worn_at === 'number' && b.last_worn_at > 0;
        if (aWorn && bWorn) {
          const wornDelta = compareOptionalWardrobeTimestamps(a.last_worn_at, b.last_worn_at, wardrobeSortDirection);
          if (wornDelta !== 0) return wornDelta;
        } else if (aWorn !== bWorn) {
          return aWorn ? -1 : 1;
        }
      }

      return compareWardrobeCardsDefault(a, b);
    });

    return cards;
  }, [
    brandFilteredWardrobeCards,
    compareWardrobeCardsDefault,
    wardrobeFavoriteOnly,
    wardrobeFamilyFilter,
    wardrobeLikedOnly,
    wardrobeRetiredOnly,
    wardrobeSeasonFilter,
    wardrobeSortDirection,
    wardrobeSortKey,
    wardrobeUnwornOnly,
    wardrobeWishlistOnly,
  ]);

  const normalizedWardrobeSearchQuery = useMemo(
    () => normalizeOdaraSearchQuery(wardrobeSearchQuery),
    [wardrobeSearchQuery],
  );

  const filteredWardrobeCards = useMemo(() => {
    const queryTokens = normalizedWardrobeSearchQuery.split(/\s+/).filter(Boolean);
    if (queryTokens.length === 0) return visibleWardrobeCards;

    return visibleWardrobeCards.filter((card) => {
      const searchableValues = [
        card.name,
        getWardrobeBrandLabel(card.brand),
        readTrimmedLayerText(card.family_label, buildFamilyLabel(card.family_key), card.family_key),
        card.primary_status,
        card.favorite ? 'favorite favorites wear more' : '',
        card.retired ? 'retired archive' : '',
        card.is_unworn ? 'unworn never worn' : '',
        sanitizeTokenSource(card.item.notes).join(' '),
        sanitizeTokenSource(card.item.accords).join(' '),
      ]
        .map((value) => normalizeOdaraSearchQuery(value))
        .filter(Boolean);

      return queryTokens.every((token) => searchableValues.some((value) => value.includes(token)));
    });
  }, [normalizedWardrobeSearchQuery, visibleWardrobeCards]);

  const activeWardrobeFilterCount = [
    wardrobeSeasonFilter,
    wardrobeFamilyFilter,
    wardrobeWishlistOnly ? 'wishlist' : null,
    wardrobeLikedOnly ? 'liked' : null,
    wardrobeRetiredOnly ? 'retired' : null,
    wardrobeFavoriteOnly ? 'favorite' : null,
    wardrobeUnwornOnly ? 'unworn' : null,
  ].filter(Boolean).length;

  const presetEmptyState = !wardrobeBrandFilter && !wardrobeSeasonFilter && !wardrobeFamilyFilter && activeWardrobeFilterCount <= 1
    ? entryPreset === 'saved' || entryPreset === 'wishlist'
      ? {
          title: 'No wishlist fragrances yet.',
          body: 'Add fragrances you want to try or buy.',
        }
      : entryPreset === 'liked'
        ? {
            title: 'No liked fragrances yet.',
            body: 'Like or love a fragrance and it will appear here.',
          }
        : entryPreset === 'favorites'
          ? {
              title: 'No favorites yet.',
              body: 'Mark a fragrance as a favorite and it will appear here.',
            }
          : entryPreset === 'retired'
            ? {
                title: 'No retired fragrances yet.',
                body: 'Retired bottles will appear here.',
              }
            : null
    : null;

  const hasWardrobeSearchQuery = normalizedWardrobeSearchQuery.length > 0;

  const hasAnyMeaningfulSignal = useMemo(
    () => Object.values(effectiveSignalMap).some((signal) => hasMeaningfulWardrobeSignal(signal)),
    [effectiveSignalMap],
  );

  const shouldShowFirstRun = surface === 'wardrobe'
    && !loading
    && !error
    && !hasAnyMeaningfulSignal
    && !onboardingSeen;

  const selectedCatalogItem = selectedFragranceId
    ? catalogById.get(selectedFragranceId)
      ?? (effectiveSignalMap[selectedFragranceId] ? buildWardrobeCatalogItemFromSignal(effectiveSignalMap[selectedFragranceId]) : null)
      ?? (collectionItemById.get(selectedFragranceId) ? buildWardrobeCatalogItemFromCollectionItem(collectionItemById.get(selectedFragranceId)!) : null)
    : null;

  const selectedSignal = selectedFragranceId ? effectiveSignalMap[selectedFragranceId] ?? null : null;
  const selectedCollectionItem = selectedFragranceId ? collectionItemById.get(selectedFragranceId) ?? null : null;

  const selectedHeartState = selectedSignal?.heart_state ?? 0;
  const selectedNegativeState = selectedSignal?.negative_state ?? 0;
  const selectedWishlist = Boolean(selectedSignal?.wishlist);
  const selectedOwned = Boolean(selectedSignal?.owned);

  const searchResults = useMemo(() => {
    const normalizedQuery = normalizeOdaraSearchQuery(deferredSearchQuery);
    const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
    const filteredByBrand = selectedBrand
      ? catalog.filter((item) => readTrimmedLayerText(item.brand) === selectedBrand)
      : catalog;

    if (queryTokens.length === 0) {
      return filteredByBrand.slice(0, 36);
    }

    const scored = filteredByBrand
      .map((item) => {
        const haystacks = [
          item.name.toLowerCase(),
          getWardrobeBrandLabel(item.brand).toLowerCase(),
          item.family_label?.toLowerCase() ?? '',
          sanitizeTokenSource(item.notes).join(' ').toLowerCase(),
          sanitizeTokenSource(item.accords).join(' ').toLowerCase(),
        ];

        let score = 0;
        for (const token of queryTokens) {
          if (!token) continue;
          if (item.name.toLowerCase().startsWith(token)) score += 12;
          else if (item.name.toLowerCase().includes(token)) score += 7;
          if ((item.brand ?? '').toLowerCase().startsWith(token)) score += 6;
          else if ((item.brand ?? '').toLowerCase().includes(token)) score += 3;
          if ((item.family_label ?? '').toLowerCase().includes(token)) score += 2;
          if (sanitizeTokenSource(item.notes).some((note) => note.toLowerCase().includes(token))) score += 2;
          if (sanitizeTokenSource(item.accords).some((accord) => accord.toLowerCase().includes(token))) score += 1;
          if (haystacks.some((value) => value.includes(token))) score += 0.5;
        }

        return { item, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => (
        b.score - a.score
        || getWardrobeBrandLabel(a.item.brand).localeCompare(getWardrobeBrandLabel(b.item.brand), undefined, { sensitivity: 'base' })
        || a.item.name.localeCompare(b.item.name, undefined, { sensitivity: 'base' })
      ));

    return scored.slice(0, 48).map((entry) => entry.item);
  }, [catalog, deferredSearchQuery, selectedBrand]);

  const openSearch = useCallback(() => {
    setOnboardingSeen(true);
    setActionError(null);
    setConfirmationState(null);
    setDetailReturnSurface('search');
    setSurface('search');
  }, []);

  const openWardrobe = useCallback(() => {
    setActionError(null);
    setConfirmationState(null);
    setDetailReturnSurface('wardrobe');
    setSurface('wardrobe');
  }, []);

  const openDetail = useCallback((fragranceId: string, returnSurface: OdaraWardrobeDetailReturnSurface = 'search') => {
    setActionError(null);
    setDetailReturnSurface(returnSurface);
    setSelectedFragranceId(fragranceId);
    setSurface('detail');
  }, []);

  const clearWardrobeFilters = useCallback(() => {
    setWardrobeSeasonFilter(null);
    setWardrobeFamilyFilter(null);
    setWardrobeWishlistOnly(false);
    setWardrobeLikedOnly(false);
    setWardrobeRetiredOnly(false);
    setWardrobeFavoriteOnly(false);
    setWardrobeUnwornOnly(false);
  }, []);

  const clearWardrobeSort = useCallback(() => {
    setWardrobeSortKey('az');
    setWardrobeSortDirection('asc');
  }, []);

  const recordActionInteraction = useCallback(() => {
    setActionLabelCount((current) => Math.min(99, current + 1));
  }, []);

  const upsertSessionSignal = useCallback((
    item: OdaraWardrobeCatalogItem,
    updater: (current: OdaraWardrobeSessionSignal) => OdaraWardrobeSessionSignal,
  ) => {
    setSessionSignals((current) => {
      const existing = current[item.fragrance_id]
        ?? effectiveSignalMap[item.fragrance_id]
        ?? createWardrobeSessionSignalFromItem(item);
      return {
        ...current,
        [item.fragrance_id]: updater({
          ...existing,
          name: existing.name || item.name,
          brand: existing.brand ?? item.brand,
          family_key: existing.family_key || item.family_key,
          family_label: existing.family_label || item.family_label,
          release_year: existing.release_year ?? item.release_year,
          concentration: existing.concentration ?? item.concentration,
          notes: existing.notes.length > 0 ? existing.notes : item.notes,
          accords: existing.accords.length > 0 ? existing.accords : item.accords,
          top_notes: existing.top_notes.length > 0 ? existing.top_notes : item.top_notes,
          heart_notes: existing.heart_notes.length > 0 ? existing.heart_notes : item.heart_notes,
          base_notes: existing.base_notes.length > 0 ? existing.base_notes : item.base_notes,
          source_url: existing.source_url ?? item.source_url,
          source_confidence: existing.source_confidence ?? item.source_confidence,
          primary_season: existing.primary_season ?? item.primary_season,
          image_url: existing.image_url ?? item.image_url,
          thumbnail_url: existing.thumbnail_url ?? item.thumbnail_url,
        }),
      };
    });
  }, [effectiveSignalMap]);

  const handleOwn = useCallback(async () => {
    if (!selectedCatalogItem || !activeSessionUserId || selectedOwned) return;
    setPendingActionKey(`own:${selectedCatalogItem.fragrance_id}`);
    setActionError(null);

    try {
      const { data, error: rpcError } = await odaraSupabase.rpc('add_to_collection_v2' as any, {
        p_user_id: activeSessionUserId,
        p_name: selectedCatalogItem.name,
        p_brand: selectedCatalogItem.brand ?? '',
        p_release_year: selectedCatalogItem.release_year,
        p_concentration: selectedCatalogItem.concentration,
        p_status: 'owned',
        p_love_level: null,
        p_negative_level: null,
        p_longevity_feedback: null,
        p_projection_feedback: null,
      } as any);

      if (rpcError) throw rpcError;

      const persistedFragranceId = typeof data === 'string' && data.trim()
        ? data
        : selectedCatalogItem.fragrance_id;

      upsertSessionSignal(selectedCatalogItem, (current) => ({
        ...current,
        fragrance_id: persistedFragranceId,
        owned: true,
        own_persisted: true,
        wishlist: false,
        wishlist_persisted: false,
        negative_state: 0,
        negative_persisted: false,
        updated_at: Date.now(),
      }));
      const refreshResults = await Promise.allSettled([
        loadCollection(),
        loadPersistedWishlists(),
      ]);
      for (const result of refreshResults) {
        if (result.status === 'rejected') {
          console.error('[Odara] post-owned wardrobe refresh failed', result.reason);
        }
      }
      recordActionInteraction();
      setConfirmationState({
        kind: 'owned',
        fragrance_id: selectedCatalogItem.fragrance_id,
        durability: 'persisted',
        status_label: 'Owned',
      });
      setSurface('confirmation');
    } catch {
      setActionError("Couldn't save to wardrobe. Try again.");
    } finally {
      setPendingActionKey(null);
    }
  }, [activeSessionUserId, loadCollection, loadPersistedWishlists, recordActionInteraction, selectedCatalogItem, selectedOwned, upsertSessionSignal]);

  const handleWishlist = useCallback(async () => {
    if (!selectedCatalogItem || !activeSessionUserId || selectedOwned) return;
    const nextWishlist = !selectedWishlist;
    setActionError(null);
    setPendingActionKey(`wishlist:${selectedCatalogItem.fragrance_id}`);

    try {
      const { data, error: rpcError } = await odaraSupabase.rpc('set_user_collection_wishlist_v1' as any, {
        p_fragrance_id: selectedCatalogItem.fragrance_id,
        p_next_active: nextWishlist,
        p_source: 'search',
      } as any);

      if (rpcError) throw rpcError;

      const wishlistActive = Boolean((data as any)?.wishlist_active);
      upsertSessionSignal(selectedCatalogItem, (current) => ({
        ...current,
        wishlist: wishlistActive,
        wishlist_persisted: wishlistActive,
        negative_state: wishlistActive ? 0 : current.negative_state,
        negative_persisted: wishlistActive ? false : current.negative_persisted,
        updated_at: Date.now(),
      }));
      const refreshResults = await Promise.allSettled([
        loadCollection(),
        loadPersistedPreferences(),
        loadPersistedWishlists(),
      ]);
      for (const result of refreshResults) {
        if (result.status === 'rejected') {
          console.error('[Odara] post-wishlist refresh failed', result.reason);
        }
      }
      recordActionInteraction();
      if (wishlistActive) {
        setConfirmationState({
          kind: 'wishlist',
          fragrance_id: selectedCatalogItem.fragrance_id,
          durability: 'persisted',
          status_label: 'Wishlist',
        });
        setSurface('confirmation');
        return;
      }
      setConfirmationState(null);
    } catch {
      setActionError("Couldn't save wishlist. Try again.");
    } finally {
      setPendingActionKey(null);
    }
  }, [
    loadCollection,
    loadPersistedPreferences,
    loadPersistedWishlists,
    recordActionInteraction,
    selectedCatalogItem,
    selectedOwned,
    selectedWishlist,
    upsertSessionSignal,
    activeSessionUserId,
  ]);

  const handleHeart = useCallback(async () => {
    if (!selectedCatalogItem || !activeSessionUserId) return;
    const nextHeartState: HeartState = selectedHeartState === 0 ? 1 : selectedHeartState === 1 ? 2 : 0;
    setPendingActionKey(`heart:${selectedCatalogItem.fragrance_id}`);
    setActionError(null);

    try {
      const { data, error: rpcError } = await odaraSupabase.rpc('set_user_fragrance_preference_v1' as any, {
        p_fragrance_id: selectedCatalogItem.fragrance_id,
        p_next_state: heartStateToPreferenceState(nextHeartState),
        p_source: 'odara_wardrobe_onboarding',
      } as any);

      if (rpcError) throw rpcError;

      const resolvedHeartState = preferenceStateToHeartState((data as any)?.preference_state);
      const resolvedNegativeState = preferenceStateToNegativeState((data as any)?.preference_state);
      upsertSessionSignal(selectedCatalogItem, (current) => ({
        ...current,
        heart_state: resolvedHeartState,
        heart_persisted: resolvedHeartState > 0,
        negative_state: resolvedNegativeState,
        negative_persisted: resolvedNegativeState > 0,
        updated_at: Date.now(),
      }));
      const refreshResults = await Promise.allSettled([
        loadCollection(),
        loadPersistedPreferences(),
      ]);
      for (const result of refreshResults) {
        if (result.status === 'rejected') {
          console.error('[Odara] post-heart preference refresh failed', result.reason);
        }
      }
      recordActionInteraction();
      if (resolvedHeartState > 0) {
        onCapturePreferenceMoment?.({
          preference_state: resolvedHeartState === 2 ? 'loved' : 'liked',
          source: 'odara_wardrobe_onboarding',
          main: {
            fragrance_id: selectedCatalogItem.fragrance_id,
            name: selectedCatalogItem.name,
            brand: selectedCatalogItem.brand,
            family_key: selectedCatalogItem.family_key,
            image_url: selectedCatalogItem.image_url,
          },
        });
        setConfirmationState({
          kind: 'heart',
          fragrance_id: selectedCatalogItem.fragrance_id,
          durability: 'persisted',
          status_label: resolvedHeartState === 2 ? 'Loved' : 'Liked',
        });
        setSurface('confirmation');
      } else {
        setConfirmationState(null);
      }
    } catch (heartError: any) {
      setActionError(heartError?.message || 'Could not save that preference yet.');
    } finally {
      setPendingActionKey(null);
    }
  }, [activeSessionUserId, loadCollection, loadPersistedPreferences, onCapturePreferenceMoment, recordActionInteraction, selectedCatalogItem, selectedHeartState, upsertSessionSignal]);

  const handleNegative = useCallback(async () => {
    if (!selectedCatalogItem || !activeSessionUserId) return;
    const nextNegativeState: OdaraNegativeState = selectedNegativeState === 0 ? 1 : selectedNegativeState === 1 ? 2 : 0;
    setPendingActionKey(`negative:${selectedCatalogItem.fragrance_id}`);
    setActionError(null);

    try {
      if (nextNegativeState > 0 && selectedWishlist) {
        const { error: wishlistError } = await odaraSupabase.rpc('set_user_collection_wishlist_v1' as any, {
          p_fragrance_id: selectedCatalogItem.fragrance_id,
          p_next_active: false,
          p_source: 'search',
        } as any);

        if (wishlistError) throw wishlistError;
      }

      const { data, error: rpcError } = await odaraSupabase.rpc('set_user_fragrance_preference_v1' as any, {
        p_fragrance_id: selectedCatalogItem.fragrance_id,
        p_next_state: negativeStateToPreferenceState(nextNegativeState),
        p_source: 'odara_wardrobe_onboarding',
      } as any);
      if (rpcError) throw rpcError;

      const resolvedHeartState = preferenceStateToHeartState((data as any)?.preference_state);
      const resolvedNegativeState = preferenceStateToNegativeState((data as any)?.preference_state);

      upsertSessionSignal(selectedCatalogItem, (current) => ({
        ...current,
        wishlist: resolvedNegativeState > 0 ? false : current.wishlist,
        wishlist_persisted: resolvedNegativeState > 0 ? false : current.wishlist_persisted,
        heart_state: resolvedHeartState,
        heart_persisted: resolvedHeartState > 0,
        negative_state: resolvedNegativeState,
        negative_persisted: resolvedNegativeState > 0,
        updated_at: Date.now(),
      }));
      const refreshResults = await Promise.allSettled([
        loadCollection(),
        loadPersistedPreferences(),
        loadPersistedWishlists(),
      ]);
      for (const result of refreshResults) {
        if (result.status === 'rejected') {
          console.error('[Odara] post-negative preference refresh failed', result.reason);
        }
      }
      recordActionInteraction();
      if (resolvedNegativeState > 0) {
        setConfirmationState({
          kind: 'negative',
          fragrance_id: selectedCatalogItem.fragrance_id,
          durability: 'persisted',
          status_label: resolvedNegativeState === 2 ? 'Disliked' : 'Not for me',
        });
        setSurface('confirmation');
      } else {
        setConfirmationState(null);
      }
    } catch (negativeError: any) {
      setActionError("Couldn't save preference. Try again.");
    } finally {
      setPendingActionKey(null);
    }
  }, [
    loadCollection,
    loadPersistedPreferences,
    loadPersistedWishlists,
    recordActionInteraction,
    selectedCatalogItem,
    selectedNegativeState,
    selectedWishlist,
    upsertSessionSignal,
    activeSessionUserId,
  ]);

  const renderSearchContent = () => (
    <div className="flex flex-col gap-4">
      <div
        className="sticky top-0 z-[1] -mx-1 space-y-3 rounded-[22px] px-1 pb-1 pt-1"
        style={{
          background: 'linear-gradient(180deg, rgba(9,10,14,0.98) 0%, rgba(9,10,14,0.92) 78%, rgba(9,10,14,0) 100%)',
        }}
      >
        <button
          type="button"
          onClick={openWardrobe}
          className="inline-flex items-center gap-2 px-2 text-[10px] uppercase tracking-[0.28em] text-foreground/42 transition-colors hover:text-foreground/74"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to wardrobe
        </button>

        <div
          className="flex items-center gap-3 rounded-[22px] border px-4 py-3"
          style={{
            borderColor: 'rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.03)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground/46">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by name, brand, or notes."
            aria-label="Search fragrances by name, brand, or notes"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground/92 outline-none placeholder:text-foreground/34"
            autoCapitalize="words"
            autoCorrect="off"
            spellCheck={false}
          />
          {searchQuery ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearchQuery('')}
              className="flex h-8 w-8 items-center justify-center rounded-full text-foreground/54 transition-colors hover:text-foreground/82"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          ) : null}
        </div>

        <div className="flex gap-2 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => setSelectedBrand(null)}
            className="shrink-0 rounded-full px-3.5 py-2 text-[10px] uppercase tracking-[0.22em] transition-colors"
            style={{
              border: `1px solid ${selectedBrand === null ? 'rgba(218,188,124,0.34)' : 'rgba(255,255,255,0.08)'}`,
              background: selectedBrand === null ? 'rgba(218,188,124,0.14)' : 'rgba(255,255,255,0.03)',
              color: selectedBrand === null ? 'rgba(248,229,185,0.94)' : 'rgba(255,255,255,0.68)',
            }}
          >
            All
          </button>
          {brandOptions.map((brand) => {
            const active = selectedBrand === brand;
            return (
              <button
                key={brand}
                type="button"
                onClick={() => setSelectedBrand(brand)}
                className="shrink-0 rounded-full px-3.5 py-2 text-[10px] uppercase tracking-[0.22em] transition-colors"
                style={{
                  border: `1px solid ${active ? 'rgba(218,188,124,0.34)' : 'rgba(255,255,255,0.08)'}`,
                  background: active ? 'rgba(218,188,124,0.14)' : 'rgba(255,255,255,0.03)',
                  color: active ? 'rgba(248,229,185,0.94)' : 'rgba(255,255,255,0.68)',
                }}
              >
                {getWardrobeBrandLabel(brand)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-1 text-[10px] uppercase tracking-[0.24em] text-foreground/36">
        {brandRailSource === 'live_database' ? 'Brands from live wardrobe catalog' : 'Brand shortcuts'}
      </div>

      {catalogLoading ? (
        <OdaraInsetGroup emphasis>
          <div className="space-y-3 px-4 py-4">
            {Array.from({ length: 5 }, (_, index) => (
              <div
                key={index}
                className="flex items-center gap-3 rounded-[18px] border px-3 py-3"
                style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}
              >
                <div className="h-[68px] w-[54px] animate-pulse rounded-[16px] bg-white/[0.05]" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-3/4 animate-pulse rounded-full bg-white/[0.05]" />
                  <div className="h-3 w-1/2 animate-pulse rounded-full bg-white/[0.04]" />
                </div>
                <div className="h-10 w-10 animate-pulse rounded-full bg-white/[0.05]" />
              </div>
            ))}
          </div>
        </OdaraInsetGroup>
      ) : catalogError ? (
        <OdaraInsetGroup emphasis>
          <div className="px-4 py-4 text-[12px] leading-[1.6] text-rose-200/84">
            {catalogError}
          </div>
        </OdaraInsetGroup>
      ) : searchResults.length === 0 ? (
        <OdaraInsetGroup emphasis>
          <div className="px-4 py-6 text-center">
            <div
              className="text-[20px] leading-[1.06] text-foreground/92"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: '-0.01em' }}
            >
              Search the wardrobe catalog
            </div>
            <div className="mt-2 text-[12px] leading-[1.6] text-foreground/48">
              Try a fragrance name, a brand, or one of the notes you already know.
            </div>
          </div>
        </OdaraInsetGroup>
      ) : (
        <OdaraInsetGroup emphasis>
          <div className="divide-y divide-white/[0.04]">
            {searchResults.map((item) => (
              <div
                key={item.fragrance_id}
                role="button"
                tabIndex={0}
                onClick={() => openDetail(item.fragrance_id)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  openDetail(item.fragrance_id);
                }}
                className="flex items-center gap-3 px-4 py-3"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <OdaraWardrobeBottleArt
                  name={item.name}
                  brand={item.brand}
                  family_key={item.family_key}
                  family_label={item.family_label}
                  image_url={item.image_url}
                  thumbnail_url={item.thumbnail_url}
                  compact
                  className="h-[72px] w-[58px] shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div
                    className="line-clamp-2 text-[17px] leading-[1.05] text-foreground/94"
                    style={{ fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: '-0.01em' }}
                  >
                    {item.name}
                  </div>
                  <div className="mt-1 text-[12px] text-foreground/56">
                    {getWardrobeBrandLabel(item.brand)}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Open ${item.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    openDetail(item.fragrance_id);
                  }}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-foreground/72 transition-colors hover:text-foreground/92"
                  style={{
                    borderColor: 'rgba(255,255,255,0.08)',
                    background: 'rgba(255,255,255,0.03)',
                  }}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </OdaraInsetGroup>
      )}
    </div>
  );

  const renderDetailContent = () => {
    if (!selectedCatalogItem) {
      return (
        <OdaraInsetGroup emphasis>
          <div className="px-4 py-6 text-[12px] leading-[1.6] text-foreground/54">
            This fragrance could not be loaded from the current local catalog.
          </div>
        </OdaraInsetGroup>
      );
    }

    const detailHydration = selectedFragranceId ? detailHydrationById[selectedFragranceId] : null;
    const baseDetail = buildFragranceDetailSurfaceStateFromWardrobeCatalogItem(selectedCatalogItem);
    const detailState = {
      ...mergeFragranceDetailSurfaceState(baseDetail, detailHydration?.detail ?? null),
      collection_status: selectedCollectionItem?.collection_status ?? baseDetail.collection_status ?? null,
      retired: selectedCollectionItem?.retired ?? baseDetail.retired ?? false,
      rating: selectedCollectionItem?.rating ?? baseDetail.rating ?? null,
      detail_loading: Boolean(detailHydration?.loading),
      detail_error: detailHydration?.error ?? null,
    };
    const ownPending = pendingActionKey === `own:${selectedCatalogItem.fragrance_id}`;
    const wishlistPending = pendingActionKey === `wishlist:${selectedCatalogItem.fragrance_id}`;
    const heartPending = pendingActionKey === `heart:${selectedCatalogItem.fragrance_id}`;
    const negativePending = pendingActionKey === `negative:${selectedCatalogItem.fragrance_id}`;
    const selectedIsOwnedCollectionItem = Boolean(selectedCollectionItem || selectedOwned);
    const retirePending = selectedFragranceId ? Boolean(pendingRetiredById[selectedFragranceId]) : false;
    const retireActive = Boolean(selectedCollectionItem?.retired);
    const renderDetailActionButton = ({
      ariaLabel,
      active,
      disabled,
      onClick,
      children,
      activeStyle,
    }: {
      ariaLabel: string;
      active?: boolean;
      disabled?: boolean;
      onClick: () => void;
      children: React.ReactNode;
      activeStyle?: React.CSSProperties;
    }) => (
      <button
        type="button"
        aria-label={ariaLabel}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors disabled:opacity-45 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d9b56c]/40"
        style={{
          border: '1px solid rgba(217,181,108,0.13)',
          background: 'rgba(255,255,255,0.032)',
          color: 'rgba(255,255,255,0.78)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 10px 26px rgba(0,0,0,0.12)',
          ...(active ? activeStyle : null),
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {children}
      </button>
    );

    return (
      <OdaraFragranceDetailSheet
        detail={detailState}
        open
        onClose={() => {
          setActionError(null);
          setSurface(detailReturnSurface);
        }}
        onOpenScentIntel={onOpenScentIntel}
        footerActions={(
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-[14px] py-1">
              {selectedIsOwnedCollectionItem ? renderDetailActionButton({
                ariaLabel: retireActive ? 'Unretire bottle' : 'Retire bottle',
                active: retireActive,
                disabled: retirePending || !selectedCollectionItem,
                onClick: () => {
                  if (!selectedCollectionItem) return;
                  void handleRetiredToggle(selectedCollectionItem);
                },
                activeStyle: {
                  borderColor: 'rgba(226,87,87,0.34)',
                  background: 'rgba(226,87,87,0.12)',
                  color: 'rgba(255,218,218,0.96)',
                },
                children: (
                  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9.4 3.4h5.2" />
                    <path d="M10 3.4v3.1" />
                    <path d="M14 3.4v3.1" />
                    <path d="M8.2 7.1h7.6" />
                    <path d="M7.9 8.7c0-.9.7-1.6 1.6-1.6h5c.9 0 1.6.7 1.6 1.6v10c0 1.1-.9 2-2 2H9.9c-1.1 0-2-.9-2-2z" />
                    <path d="M10 12h4" opacity="0.46" />
                    <path d="M10 16.2h4" opacity="0.28" />
                  </svg>
                ),
              }) : renderDetailActionButton({
                ariaLabel: 'Add to owned wardrobe',
                disabled: ownPending,
                onClick: () => {
                  void handleOwn();
                },
                children: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                ),
              })}

              {renderDetailActionButton({
                ariaLabel: selectedWishlist ? 'Remove from wishlist' : 'Add to wishlist',
                active: selectedWishlist,
                disabled: wishlistPending,
                onClick: () => {
                  void handleWishlist();
                },
                activeStyle: {
                  borderColor: 'rgba(125,161,255,0.32)',
                  background: 'rgba(125,161,255,0.12)',
                  color: 'rgba(208,221,255,0.96)',
                },
                children: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill={selectedWishlist ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                  </svg>
                ),
              })}

              {renderDetailActionButton({
                ariaLabel: getWardrobeHeartActionAriaLabel(selectedHeartState),
                active: selectedHeartState > 0,
                disabled: heartPending,
                onClick: () => {
                  void handleHeart();
                },
                activeStyle: {
                  borderColor: selectedHeartState === 2 ? 'rgba(239,68,68,0.32)' : 'rgba(236,72,153,0.32)',
                  background: selectedHeartState === 2 ? 'rgba(239,68,68,0.12)' : 'rgba(236,72,153,0.12)',
                  color: selectedHeartState === 2 ? 'rgba(254,202,202,0.96)' : 'rgba(251,207,232,0.96)',
                },
                children: (
                  <svg width="19" height="19" viewBox="0 0 24 24" fill={selectedHeartState > 0 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m12 21-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09A6 6 0 0 1 16.5 3C19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.18z" />
                  </svg>
                ),
              })}

              {renderDetailActionButton({
                ariaLabel: getWardrobeNegativeActionAriaLabel(selectedNegativeState),
                active: selectedNegativeState > 0,
                disabled: negativePending,
                onClick: () => {
                  void handleNegative();
                },
                activeStyle: {
                  borderColor: selectedNegativeState === 2 ? 'rgba(251,113,133,0.32)' : 'rgba(245,158,11,0.32)',
                  background: selectedNegativeState === 2 ? 'rgba(251,113,133,0.12)' : 'rgba(245,158,11,0.12)',
                  color: selectedNegativeState === 2 ? 'rgba(255,228,230,0.96)' : 'rgba(254,240,200,0.96)',
                },
                children: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                ),
              })}
            </div>

            {actionError ? (
              <div className="text-center text-[11px] leading-[1.5] text-rose-200/88">
                {actionError}
              </div>
            ) : null}
          </div>
        )}
      />
    );
  };

  const renderConfirmationContent = () => {
    const confirmedItem = confirmationState
      ? catalogById.get(confirmationState.fragrance_id)
        ?? (effectiveSignalMap[confirmationState.fragrance_id] ? buildWardrobeCatalogItemFromSignal(effectiveSignalMap[confirmationState.fragrance_id]) : null)
      : null;
    if (!confirmationState || !confirmedItem) return null;

    return (
      <OdaraInsetGroup emphasis>
        <div className="px-4 pb-6 pt-5 text-center">
          <div className="flex justify-center">
            <OdaraWardrobeBottleArt
              name={confirmedItem.name}
              brand={confirmedItem.brand}
              family_key={confirmedItem.family_key}
              family_label={confirmedItem.family_label}
              image_url={confirmedItem.image_url}
              thumbnail_url={confirmedItem.thumbnail_url}
              className="h-[220px] w-[168px]"
            />
          </div>
          <div
            className="mt-5 text-[28px] leading-[1.04] text-foreground/95"
            style={{ fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: '-0.012em' }}
          >
            {getWardrobeConfirmationTitle(confirmationState.kind)}
          </div>
          <div className="mt-3 text-[16px] text-foreground/88">{confirmedItem.name}</div>
          <div className="mt-1 text-[12px] text-foreground/54">{getWardrobeBrandLabel(confirmedItem.brand)}</div>
          <div className="mt-4 flex justify-center">
            <OdaraWardrobeStatusPill
              status={
                confirmationState.status_label === 'Owned'
                  ? 'owned'
                  : confirmationState.status_label === 'Wishlist'
                    ? 'wishlist'
                    : confirmationState.status_label === 'Loved'
                      ? 'loved'
                      : confirmationState.status_label === 'Liked'
                        ? 'liked'
                        : confirmationState.status_label === 'Disliked'
                          ? 'disliked'
                          : 'not_for_me'
              }
              localOnly={confirmationState.durability === 'session'}
            />
          </div>
          {confirmationState.durability === 'session' ? (
            <div className="mt-3 text-[11px] leading-[1.5] text-foreground/44">
              Saved for this session.
            </div>
          ) : null}
          <div className="mt-6 grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={openSearch}
              className="rounded-[18px] px-4 py-3 text-[12px] uppercase tracking-[0.22em] text-[#f8e5b9]"
              style={{
                border: '1px solid rgba(218,188,124,0.32)',
                background: 'rgba(218,188,124,0.12)',
              }}
            >
              Add another fragrance
            </button>
            <button
              type="button"
              onClick={openWardrobe}
              className="rounded-[18px] px-4 py-3 text-[12px] uppercase tracking-[0.22em] text-foreground/78"
              style={{
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.03)',
              }}
            >
              Go to wardrobe
            </button>
          </div>
        </div>
      </OdaraInsetGroup>
    );
  };

  const renderWardrobeContent = () => {
    if (loading || wearHistoryLoading) {
      return (
        <div className="space-y-4 px-1 py-3">
            <div className="h-6 w-1/2 animate-pulse rounded-full bg-white/[0.05]" />
            <div className="h-4 w-3/4 animate-pulse rounded-full bg-white/[0.04]" />
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 pt-2">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="rounded-[28px] p-3" style={{ background: 'radial-gradient(circle at 50% 18%, rgba(255,255,255,0.05), rgba(255,255,255,0.014) 46%, rgba(255,255,255,0) 100%)' }}>
                  <div className="aspect-[4/5] animate-pulse rounded-full bg-white/[0.045]" />
                  <div className="mt-3 h-4 animate-pulse rounded-full bg-white/[0.05]" />
                  <div className="mt-2 h-3 w-2/3 animate-pulse rounded-full bg-white/[0.04]" />
                </div>
              ))}
            </div>
          </div>
      );
    }

    if (error) {
      return (
        <OdaraInsetGroup emphasis>
          <div className="px-4 py-5 text-[12px] leading-[1.6] text-rose-200/84">
            {error}
          </div>
        </OdaraInsetGroup>
      );
    }

    if (shouldShowFirstRun) {
      return (
        <OdaraInsetGroup emphasis>
          <div className="px-5 py-12 text-center">
            <div
              className="text-[34px] leading-[0.98] text-foreground/96"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: '-0.015em' }}
            >
              Build your wardrobe
            </div>
            <div className="mx-auto mt-4 max-w-[272px] text-[13px] leading-[1.68] text-foreground/54">
              Add fragrances you own, want, love, or dislike so Vesper can learn your taste.
            </div>
            <button
              type="button"
              onClick={openSearch}
              className="mt-7 rounded-[20px] px-5 py-3 text-[12px] uppercase tracking-[0.22em] text-[#f8e5b9]"
              style={{
                border: '1px solid rgba(218,188,124,0.32)',
                background: 'rgba(218,188,124,0.12)',
              }}
            >
              + Add fragrance
            </button>
            <div className="mt-4 text-[11px] leading-[1.5] text-foreground/42">
              Start with one. Add more anytime.
            </div>
          </div>
        </OdaraInsetGroup>
      );
    }

    if (wardrobeCards.length === 0) {
      return (
        <OdaraInsetGroup emphasis>
          <div className="px-5 py-12 text-center">
            <div
              className="text-[32px] leading-[1.02] text-foreground/96"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: '-0.012em' }}
            >
              Your wardrobe is empty.
            </div>
            <div className="mx-auto mt-4 max-w-[280px] text-[13px] leading-[1.68] text-foreground/54">
              Add fragrances you own or love so Vesper can learn your taste.
            </div>
            <button
              type="button"
              onClick={openSearch}
              className="mt-7 rounded-[20px] px-5 py-3 text-[12px] uppercase tracking-[0.22em] text-[#f8e5b9]"
              style={{
                border: '1px solid rgba(218,188,124,0.32)',
                background: 'rgba(218,188,124,0.12)',
              }}
            >
              + Add fragrance
            </button>
          </div>
        </OdaraInsetGroup>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        <div className="relative px-1">
          {!wardrobeSearchOpen ? (
            <div>
              <div className="flex items-center gap-2 overflow-x-auto px-0.5 pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">

                {/* Filter pill + anchored dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setWardrobeMenu(wardrobeMenu === 'filter' ? null : 'filter')}
                    aria-haspopup="menu"
                    aria-expanded={wardrobeMenu === 'filter'}
                    className="flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[10px] uppercase tracking-[0.2em] transition-colors"
                    style={{
                      border: `1px solid ${activeWardrobeFilterCount > 0 ? 'rgba(218,188,124,0.34)' : 'rgba(255,255,255,0.1)'}`,
                      background: activeWardrobeFilterCount > 0 ? 'rgba(218,188,124,0.12)' : 'rgba(255,255,255,0.04)',
                      color: activeWardrobeFilterCount > 0 ? 'rgba(248,229,185,0.94)' : 'rgba(255,255,255,0.74)',
                    }}
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="4" y1="6" x2="20" y2="6" />
                      <line x1="7" y1="12" x2="17" y2="12" />
                      <line x1="10" y1="18" x2="14" y2="18" />
                    </svg>
                    Filter{activeWardrobeFilterCount > 0 ? ` · ${activeWardrobeFilterCount}` : ''}
                  </button>
                  {wardrobeMenu === 'filter' ? (
                    <div
                      className="absolute left-0 top-[calc(100%+8px)] z-[80] w-60 rounded-[18px] border p-3"
                      role="menu"
                      style={{
                        borderColor: 'rgba(255,255,255,0.1)',
                        background: 'linear-gradient(180deg, rgba(26,24,30,0.98) 0%, rgba(12,12,15,0.99) 100%)',
                        boxShadow: '0 22px 48px rgba(0,0,0,0.55)',
                        backdropFilter: 'blur(14px)',
                        WebkitBackdropFilter: 'blur(14px)',
                      }}
                    >
                      <div className="space-y-3">
                        <div>
                          <div className="mb-1.5 text-[9px] uppercase tracking-[0.26em] text-foreground/40">Season</div>
                          <div className="flex flex-wrap gap-1.5">
                            {ODARA_WARDROBE_SEASON_FILTER_OPTIONS.map((option) => {
                              const active = wardrobeSeasonFilter === option.value;
                              return (
                                <button
                                  key={option.label}
                                  type="button"
                                  role="menuitemradio"
                                  aria-checked={active}
                                  onClick={() => {
                                    setWardrobeSeasonFilter(option.value);
                                  }}
                                  className="rounded-full px-3 py-2 text-[10px] uppercase tracking-[0.18em] transition-colors"
                                  style={{
                                    border: `1px solid ${active ? 'rgba(218,188,124,0.3)' : 'rgba(255,255,255,0.06)'}`,
                                    background: active ? 'rgba(218,188,124,0.1)' : 'rgba(255,255,255,0.02)',
                                    color: active ? 'rgba(248,229,185,0.96)' : 'rgba(255,255,255,0.78)',
                                  }}
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div>
                          <div className="mb-1.5 text-[9px] uppercase tracking-[0.26em] text-foreground/40">Family</div>
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              role="menuitemradio"
                              aria-checked={wardrobeFamilyFilter === null}
                              onClick={() => {
                                setWardrobeFamilyFilter(null);
                              }}
                              className="rounded-full px-3 py-2 text-[10px] uppercase tracking-[0.18em] transition-colors"
                              style={{
                                border: `1px solid ${wardrobeFamilyFilter === null ? 'rgba(218,188,124,0.3)' : 'rgba(255,255,255,0.06)'}`,
                                background: wardrobeFamilyFilter === null ? 'rgba(218,188,124,0.1)' : 'rgba(255,255,255,0.02)',
                                color: wardrobeFamilyFilter === null ? 'rgba(248,229,185,0.96)' : 'rgba(255,255,255,0.78)',
                              }}
                            >
                              All Families
                            </button>
                            {wardrobeFamilyOptions.map((option) => {
                              const active = wardrobeFamilyFilter === option.key;
                              return (
                                <button
                                  key={option.key}
                                  type="button"
                                  role="menuitemradio"
                                  aria-checked={active}
                                  onClick={() => {
                                    setWardrobeFamilyFilter(active ? null : option.key);
                                  }}
                                  className="rounded-full px-3 py-2 text-[10px] uppercase tracking-[0.18em] transition-colors"
                                  style={{
                                    border: `1px solid ${active ? 'rgba(218,188,124,0.3)' : 'rgba(255,255,255,0.06)'}`,
                                    background: active ? 'rgba(218,188,124,0.1)' : 'rgba(255,255,255,0.02)',
                                    color: active ? 'rgba(248,229,185,0.96)' : 'rgba(255,255,255,0.78)',
                                  }}
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div>
                          <div className="mb-1.5 text-[9px] uppercase tracking-[0.26em] text-foreground/40">Library</div>
                          <div className="flex flex-wrap gap-1.5">
                            {[
                              { key: 'wishlist', label: 'Wishlist', active: wardrobeWishlistOnly, toggle: () => setWardrobeWishlistOnly((current) => !current) },
                              { key: 'liked', label: 'Liked', active: wardrobeLikedOnly, toggle: () => setWardrobeLikedOnly((current) => !current) },
                              { key: 'retired', label: 'Retired', active: wardrobeRetiredOnly, toggle: () => setWardrobeRetiredOnly((current) => !current) },
                              { key: 'favorite', label: 'Favorites', active: wardrobeFavoriteOnly, toggle: () => setWardrobeFavoriteOnly((current) => !current) },
                              { key: 'unworn', label: 'Unworn', active: wardrobeUnwornOnly, toggle: () => setWardrobeUnwornOnly((current) => !current) },
                            ].map((option) => (
                              <button
                                key={option.key}
                                type="button"
                                role="menuitemcheckbox"
                                aria-checked={option.active}
                                onClick={option.toggle}
                                className="rounded-full px-3 py-2 text-[10px] uppercase tracking-[0.18em] transition-colors"
                                style={{
                                  border: `1px solid ${option.active ? 'rgba(218,188,124,0.3)' : 'rgba(255,255,255,0.06)'}`,
                                  background: option.active ? 'rgba(218,188,124,0.1)' : 'rgba(255,255,255,0.02)',
                                  color: option.active ? 'rgba(248,229,185,0.96)' : 'rgba(255,255,255,0.78)',
                                }}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {activeWardrobeFilterCount > 0 ? (
                          <button
                            type="button"
                            onClick={() => {
                              clearWardrobeFilters();
                              setWardrobeMenu(null);
                            }}
                            className="w-full rounded-xl px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-foreground/72 transition-colors hover:text-foreground/92"
                            style={{
                              border: '1px solid rgba(255,255,255,0.08)',
                              background: 'rgba(255,255,255,0.02)',
                            }}
                          >
                            Clear filters
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Sort pill + anchored dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setWardrobeMenu(wardrobeMenu === 'sort' ? null : 'sort')}
                    aria-haspopup="menu"
                    aria-expanded={wardrobeMenu === 'sort'}
                    className="flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[10px] uppercase tracking-[0.2em] transition-colors"
                    style={{
                      border: `1px solid ${activeWardrobeSortLabel ? 'rgba(218,188,124,0.34)' : 'rgba(255,255,255,0.1)'}`,
                      background: activeWardrobeSortLabel ? 'rgba(218,188,124,0.12)' : 'rgba(255,255,255,0.04)',
                      color: activeWardrobeSortLabel ? 'rgba(248,229,185,0.94)' : 'rgba(255,255,255,0.74)',
                    }}
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m3 16 4 4 4-4" />
                      <path d="M7 20V4" />
                      <path d="m21 8-4-4-4 4" />
                      <path d="M17 4v16" />
                    </svg>
                    {activeWardrobeSortLabel ? `Sort · ${activeWardrobeSortLabel}` : 'Sort'}
                  </button>
                  {wardrobeMenu === 'sort' ? (
                    <div
                      className="absolute left-0 top-[calc(100%+8px)] z-[80] w-56 rounded-[18px] border p-2"
                      role="menu"
                      style={{
                        borderColor: 'rgba(255,255,255,0.1)',
                        background: 'linear-gradient(180deg, rgba(26,24,30,0.98) 0%, rgba(12,12,15,0.99) 100%)',
                        boxShadow: '0 22px 48px rgba(0,0,0,0.55)',
                        backdropFilter: 'blur(14px)',
                        WebkitBackdropFilter: 'blur(14px)',
                      }}
                    >
                      {ODARA_WARDROBE_SORT_OPTIONS.map((option) => {
                        const active = wardrobeSortKey === option.value;
                        const optionLabel = getWardrobeSortLabel(
                          option.value,
                          active ? wardrobeSortDirection : option.defaultDirection,
                        );
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="menuitemradio"
                            aria-checked={active}
                            onClick={() => {
                              if (active) {
                                setWardrobeSortDirection((current) => toggleWardrobeSortDirection(current));
                              } else {
                                setWardrobeSortKey(option.value);
                                setWardrobeSortDirection(option.defaultDirection);
                              }
                              setWardrobeMenu(null);
                            }}
                            className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-[12px] transition-colors"
                            style={{
                              border: `1px solid ${active ? 'rgba(218,188,124,0.3)' : 'transparent'}`,
                              background: active ? 'rgba(218,188,124,0.1)' : 'transparent',
                              color: active
                                ? 'rgba(248,229,185,0.96)'
                                : 'rgba(255,255,255,0.82)',
                            }}
                          >
                            <span>{optionLabel}</span>
                            {active ? (
                              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M20 6 9 17l-5-5" />
                              </svg>
                            ) : null}
                          </button>
                        );
                      })}
                      {hasNonDefaultWardrobeSort ? (
                        <button
                          type="button"
                          onClick={() => {
                            clearWardrobeSort();
                            setWardrobeMenu(null);
                          }}
                          className="mt-1 flex w-full items-center justify-center rounded-xl px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-foreground/72 transition-colors hover:text-foreground/92"
                          style={{
                            border: '1px solid rgba(255,255,255,0.08)',
                            background: 'rgba(255,255,255,0.02)',
                          }}
                        >
                          Reset to A–Z
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={openSearch}
                  className="shrink-0 rounded-full px-3.5 py-2 text-[10px] uppercase tracking-[0.16em] text-[#f8e5b9]"
                  style={{
                    border: '1px solid rgba(218,188,124,0.28)',
                    background: 'linear-gradient(180deg, rgba(218,188,124,0.16) 0%, rgba(169,132,57,0.12) 100%)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 10px 20px rgba(0,0,0,0.16)',
                  }}
                >
                  + Add
                </button>
                <button
                  type="button"
                  aria-label="Search your collection"
                  onClick={() => {
                    setWardrobeMenu(null);
                    setWardrobeSearchOpen(true);
                  }}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground/72 transition-colors hover:text-foreground/94"
                  style={{
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.04)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                </button>
              </div>
              <div
                className="mt-3 h-px w-full"
                style={{
                  background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.16) 18%, rgba(255,255,255,0.16) 82%, rgba(255,255,255,0))',
                }}
              />
            </div>
          ) : (
            <div
              className="flex items-center gap-2 rounded-[20px] px-3.5 py-3"
              style={{
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'linear-gradient(180deg, rgba(18,20,26,0.72) 0%, rgba(10,12,16,0.56) 100%)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 18px 34px rgba(0,0,0,0.2)',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground/46" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                autoFocus
                type="search"
                value={wardrobeSearchQuery}
                onChange={(event) => setWardrobeSearchQuery(event.target.value)}
                placeholder="Search your collection"
                aria-label="Search your collection by fragrance, brand, family, or notes"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground/92 outline-none placeholder:text-foreground/34"
                autoCapitalize="words"
                autoCorrect="off"
                spellCheck={false}
              />
              <button
                type="button"
                aria-label="Close collection search"
                onClick={() => {
                  setWardrobeSearchOpen(false);
                  setWardrobeSearchQuery('');
                }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground/54 transition-colors hover:text-foreground/94"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6L6 18" />
                  <path d="M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Outside-click catcher for the dropdowns */}
          {wardrobeMenu ? (
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setWardrobeMenu(null)}
              className="fixed inset-0 z-[75] cursor-default"
              style={{ background: 'transparent' }}
            />
          ) : null}
        </div>


        {wardrobeBrandOptions.length > 0 ? (
          <div className="flex justify-center px-1">
            <div className="flex max-w-full gap-2 overflow-x-auto px-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button
                type="button"
                onClick={() => setWardrobeBrandFilter(null)}
                className="shrink-0 rounded-full px-3.5 py-2 text-[10px] uppercase tracking-[0.22em] transition-colors"
                style={{
                  border: `1px solid ${wardrobeBrandFilter === null ? 'rgba(218,188,124,0.34)' : 'rgba(255,255,255,0.08)'}`,
                  background: wardrobeBrandFilter === null ? 'rgba(218,188,124,0.14)' : 'rgba(255,255,255,0.03)',
                  color: wardrobeBrandFilter === null ? 'rgba(248,229,185,0.94)' : 'rgba(255,255,255,0.68)',
                  boxShadow: wardrobeBrandFilter === null ? '0 8px 18px rgba(0,0,0,0.16)' : 'none',
                }}
              >
                All
              </button>
              {wardrobeBrandOptions.map((brand) => {
                const active = wardrobeBrandFilter === brand;
                return (
                  <button
                    key={brand}
                    type="button"
                    onClick={() => setWardrobeBrandFilter(brand)}
                    className="shrink-0 whitespace-nowrap rounded-full px-3.5 py-2 text-[10px] uppercase tracking-[0.22em] transition-colors"
                    style={{
                      border: `1px solid ${active ? 'rgba(218,188,124,0.34)' : 'rgba(255,255,255,0.08)'}`,
                      background: active ? 'rgba(218,188,124,0.14)' : 'rgba(255,255,255,0.03)',
                      color: active ? 'rgba(248,229,185,0.94)' : 'rgba(255,255,255,0.68)',
                      boxShadow: active ? '0 8px 18px rgba(0,0,0,0.16)' : 'none',
                    }}
                  >
                    {getWardrobeBrandLabel(brand)}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {filteredWardrobeCards.length === 0 ? (
          <OdaraInsetGroup emphasis>
            <div className="px-5 py-10 text-center">
              <div
                className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
                style={{
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/58" aria-hidden="true">
                  <rect x="3.5" y="6" width="17" height="13.5" rx="2.75" />
                  <path d="M7 6V4.75a1.75 1.75 0 0 1 1.75-1.75h6.5A1.75 1.75 0 0 1 17 4.75V6" />
                </svg>
              </div>
              <div
                className="text-[24px] leading-[1.04] text-foreground/94"
                style={{ fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: '-0.012em' }}
              >
                {hasWardrobeSearchQuery ? 'No scents found in your collection' : presetEmptyState?.title ?? 'No fragrances match these filters.'}
              </div>
              <div className="mx-auto mt-3 max-w-[260px] text-[12px] leading-[1.6] text-foreground/52">
                {hasWardrobeSearchQuery
                  ? 'Try another name, brand, family, or clear your search.'
                  : presetEmptyState?.body ?? 'Try a different brand, clear a filter, or add another fragrance.'}
              </div>
              {(hasWardrobeSearchQuery || activeWardrobeFilterCount > 0 || wardrobeBrandFilter) ? (
                <button
                  type="button"
                  onClick={() => {
                    if (hasWardrobeSearchQuery) {
                      setWardrobeSearchOpen(false);
                      setWardrobeSearchQuery('');
                      return;
                    }
                    clearWardrobeFilters();
                    setWardrobeBrandFilter(null);
                  }}
                  className="mt-5 rounded-[18px] px-4 py-3 text-[11px] uppercase tracking-[0.22em] text-foreground/78"
                  style={{
                    border: '1px solid rgba(255,255,255,0.08)',
                    background: 'rgba(255,255,255,0.03)',
                  }}
                >
                  {hasWardrobeSearchQuery ? 'Clear search' : 'Clear view'}
                </button>
              ) : null}
            </div>
          </OdaraInsetGroup>
        ) : (
          <div className="flex flex-col gap-4 px-1 pb-6 pt-1">
            {filteredWardrobeCards.map((card) => {
              const cardVisual = getOdaraGlassCardVisualRecipe(getCollectionTileTint(card), 'collection');
              const tint = getEnhancedCollectionTint(card);
              const familyLabel = readTrimmedLayerText(
                card.family_label,
                buildFamilyLabel(card.family_key),
                card.family_key,
              ) || 'Unclassified';
              const familyChipLabel = card.family_key
                ? (FAMILY_LABELS[card.family_key] ?? familyLabel.replace(/\s+/g, '-').toUpperCase())
                : familyLabel.replace(/\s+/g, '-').toUpperCase();
              const familyChipTone = card.family_key
                ? getOdaraFamilyMappedChipTone(card.family_key)
                : getAccordChipTone(familyChipLabel, card.family_key);
              const ratingDisplay = formatCompactCollectionRatingValue(
                collectionItemById.get(card.fragrance_id)?.rating ?? null,
              );
              const metadataLabels = [
                formatWardrobeLastWornLabel(card.last_worn_at),
                formatWardrobeSourceConfidenceLabel(card.item.source_confidence),
              ].filter((value): value is string => Boolean(value));
              const railChips = (() => {
                const seenLabels = new Set<string>();
                return expandAndDeduplicateScentIntelDisplayTerms([
                  ...sanitizeTokenSource(card.item.accords)
                    .slice(0, 6)
                    .map((label) => ({ label, position: 'accord' })),
                  ...sanitizeTokenSource(card.item.notes)
                    .slice(0, 6)
                    .map((label) => ({ label, position: 'note' })),
                ])
                  .filter((chip) => normalizeOdaraSearchQuery(chip.label) !== normalizeOdaraSearchQuery(familyChipLabel))
                  .filter((chip) => {
                    const normalizedLabel = normalizeOdaraSearchQuery(chip.label);
                    if (!normalizedLabel || seenLabels.has(normalizedLabel)) return false;
                    seenLabels.add(normalizedLabel);
                    return true;
                  })
                  .slice(0, 3);
              })();
              return (
                <OdaraCollectionCardSurface
                  key={card.fragrance_id}
                  data-collection-card
                  ariaLabel={`Open ${card.name} profile`}
                  onOpen={() => openDetail(card.fragrance_id, 'wardrobe')}
                  className="group relative block w-full cursor-pointer overflow-hidden rounded-[30px] p-[1px] text-left transition duration-200 hover:-translate-y-[1px] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/24"
                  style={{
                    ...cardVisual.surfaceStyle,
                    boxShadow: '0 18px 36px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.04)',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <div
                    className={cardVisual.atmosphereClassName}
                    style={cardVisual.atmosphereStyle}
                  />
                  <div
                    className="absolute inset-[1px] rounded-[27px] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                    style={{
                      background: 'linear-gradient(180deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0) 22%, rgba(0,0,0,0.08) 100%)',
                    }}
                  />
                  <div className="relative z-[1] flex items-center gap-4 px-4 py-4 sm:gap-5 sm:px-5 sm:py-5">
                    <div className="relative flex min-h-[162px] w-[132px] shrink-0 items-center justify-center sm:min-h-[174px] sm:w-[146px]">
                      <div
                        className="pointer-events-none absolute inset-x-1 bottom-2 h-14 rounded-full blur-2xl"
                        style={{
                          background: `radial-gradient(circle at 50% 100%, ${tint.inner} 0%, rgba(255,255,255,0) 76%)`,
                          opacity: 0.92,
                        }}
                      />
                      <div className="relative z-[1] h-full w-full max-w-[138px] self-center sm:max-w-[150px]">
                        <OdaraWardrobeBottleArt
                          name={card.name}
                          brand={card.brand}
                          family_key={card.family_key}
                          family_label={card.family_label}
                          image_url={card.image_url ?? card.item.image_url}
                          thumbnail_url={card.thumbnail_url ?? card.item.thumbnail_url}
                          frameless
                          className="h-full w-full"
                        />
                      </div>
                    </div>
                    <div className="relative z-[1] flex min-w-0 flex-1 flex-col justify-center py-1">
                      <div className="flex items-start justify-between gap-3">
                        {onOpenScentIntel ? (
                          <ScentIntelChipButton
                            label={familyChipLabel}
                            slug={card.family_key ?? scentIntelSlugify(familyChipLabel)}
                            onOpen={onOpenScentIntel}
                            fragranceId={card.fragrance_id}
                            fragranceName={card.name}
                            fragranceBrand={card.brand}
                            position="family"
                            className="inline-flex max-w-full min-w-0 shrink truncate rounded-full px-3.5 py-[7px] text-[9px] font-medium uppercase tracking-[0.16em]"
                            style={{
                              color: familyChipTone.color,
                              border: `1px solid ${familyChipTone.border}`,
                              background: familyChipTone.background,
                              boxShadow: `0 0 14px ${familyChipTone.glow}`,
                            }}
                          />
                        ) : (
                          <span
                            className="inline-flex max-w-full min-w-0 shrink truncate rounded-full px-3.5 py-[7px] text-[9px] font-medium uppercase tracking-[0.16em]"
                            style={{
                              color: familyChipTone.color,
                              border: `1px solid ${familyChipTone.border}`,
                              background: familyChipTone.background,
                              boxShadow: `0 0 14px ${familyChipTone.glow}`,
                            }}
                          >
                            {familyChipLabel}
                          </span>
                        )}
                        {ratingDisplay ? (
                          <div
                            className="shrink-0 whitespace-nowrap pl-2 pt-1 text-[12px] font-medium tracking-[0.02em]"
                            style={{
                              color: 'rgba(247,220,159,0.96)',
                            }}
                          >
                            {`★ ${ratingDisplay}`}
                          </div>
                        ) : null}
                      </div>
                      <div
                        className="mt-3 line-clamp-2 text-[28px] leading-[0.94] text-foreground/94 sm:text-[30px]"
                        style={{ fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: '-0.016em' }}
                      >
                        {card.name}
                      </div>
                      <div className="mt-1.5 text-[14px] leading-[1.38] text-foreground/58">
                        {getWardrobeBrandLabel(card.brand)}
                      </div>
                      {metadataLabels.length > 0 ? (
                        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-[0.12em] text-foreground/46">
                          {metadataLabels.map((label) => (
                            <span key={`${card.fragrance_id}-${label}`} className="shrink-0 whitespace-nowrap">
                              {label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {railChips.length > 0 ? (
                        <div className={`${metadataLabels.length > 0 ? 'mt-3.5' : 'mt-3'} min-w-0 pb-1`}>
                          <div
                            data-no-card-swipe
                            className="odara-token-rail-fade hide-horizontal-scrollbar flex w-full flex-nowrap items-center gap-1.5 overflow-x-auto pr-3"
                            style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x' }}
                          >
                            {railChips.map((chip, index) => {
                              const tone = getAccordChipTone(chip.label, card.family_key);
                              return onOpenScentIntel ? (
                                <ScentIntelChipButton
                                  key={`wardrobe-card-chip-${card.fragrance_id}-${chip.position ?? 'accord'}-${chip.slug ?? chip.label}-${index}`}
                                  label={chip.label}
                                  slug={chip.slug ?? null}
                                  onOpen={onOpenScentIntel}
                                  fragranceId={card.fragrance_id}
                                  fragranceName={card.name}
                                  fragranceBrand={card.brand}
                                  position={chip.position ?? 'accord'}
                                  className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-[6px] text-[9px] tracking-[0.02em]"
                                  style={{
                                    color: tone.color,
                                    border: `1px solid ${tone.border}`,
                                    background: tone.background,
                                    boxShadow: `0 0 12px ${tone.glow}`,
                                  }}
                                />
                              ) : (
                                <span
                                  key={`wardrobe-card-chip-${card.fragrance_id}-${chip.position ?? 'accord'}-${chip.slug ?? chip.label}-${index}`}
                                  className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-[6px] text-[9px] tracking-[0.02em]"
                                  style={{
                                    color: tone.color,
                                    border: `1px solid ${tone.border}`,
                                    background: tone.background,
                                    boxShadow: `0 0 12px ${tone.glow}`,
                                  }}
                                >
                                  {chip.label}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  </OdaraCollectionCardSurface>
                );
              })}
          </div>
        )}
      </div>


    );
  };

  const isCollectionProfileDetail = surface === 'detail'
    && detailReturnSurface === 'wardrobe'
    && Boolean(selectedCollectionItem);

  const chromeTitle = surface === 'search'
    ? 'Add fragrance'
    : surface === 'detail'
      ? (isCollectionProfileDetail ? 'Fragrance Profile' : 'Add fragrance')
      : surface === 'confirmation'
        ? ''
        : wardrobeCards.length > 0
          ? '' // top wordmark already reads VESPER — no duplicate serif title
          : shouldShowFirstRun
            ? 'Build your wardrobe'
            : 'Vesper';

  const wardrobeEyebrow =
    entryPreset === 'liked'
      ? 'Liked'
      : entryPreset === 'saved' || entryPreset === 'wishlist'
        ? 'Wishlist'
        : entryPreset === 'favorites'
          ? 'Favorites'
        : entryPreset === 'retired'
          ? 'Retired'
          : 'My Collection';

  const chromeEyebrow = surface === 'search'
    ? 'Search by name, brand, or notes.'
    : surface === 'confirmation'
      ? 'Wardrobe updated'
      : surface === 'wardrobe' && wardrobeCards.length > 0
        ? wardrobeEyebrow
        : undefined;

  return (
    <OdaraDestinationChrome
      title={chromeTitle || undefined}
      eyebrow={chromeEyebrow}
      onClose={onClose}
      onSearch={surface !== 'search' ? openSearch : undefined}
      centerHeader={surface === 'wardrobe'}
    >
      {surface === 'search'
        ? renderSearchContent()
        : surface === 'detail'
          ? renderDetailContent()
          : surface === 'confirmation'
            ? renderConfirmationContent()
            : renderWardrobeContent()}
    </OdaraDestinationChrome>
  );
};

const OdaraCollectionPage: React.FC<{
  onClose: () => void;
  onOpenFragranceDetail: (detail: OdaraFragranceDetailSurfaceState) => void;
  onOpenScentIntel?: (input: ScentIntelInput) => void;
  onCapturePreferenceMoment?: (payload: {
    preference_state: PersistedPreferenceMomentState;
    source: string;
    main: {
      fragrance_id?: string | null;
      name?: string | null;
      brand?: string | null;
      family_key?: string | null;
      image_url?: string | null;
    };
    layer?: {
      fragrance_id?: string | null;
      name?: string | null;
      brand?: string | null;
      family_key?: string | null;
      image_url?: string | null;
    } | null;
  }) => void;
  userId: string | null;
  isGuestMode: boolean;
  selectedContext: string;
  entryPreset?: OdaraCollectionEntryPreset;
}> = ({ onClose, onOpenFragranceDetail, onOpenScentIntel, onCapturePreferenceMoment, userId, isGuestMode, selectedContext, entryPreset = 'all' }) => {
  if (isGuestMode) {
    return (
      <OdaraLegacyCollectionPage
        onClose={onClose}
        onOpenFragranceDetail={onOpenFragranceDetail}
        userId={userId}
        isGuestMode={isGuestMode}
      />
    );
  }

  return (
    <OdaraSignedInWardrobeOnboardingPage
      onClose={onClose}
      onOpenScentIntel={onOpenScentIntel}
      userId={userId}
      selectedContext={selectedContext}
      entryPreset={entryPreset}
      onCapturePreferenceMoment={onCapturePreferenceMoment}
    />
  );
};

/* Planner / Settings — keep the existing simple inset list layout. */
const OdaraMenuDestination: React.FC<{
  page: OdaraMenuPage;
  onClose: () => void;
  onOpenCollection: (preset?: OdaraCollectionEntryPreset) => void;
  onSearch?: () => void;
  onOpenFragranceDetail: (detail: OdaraFragranceDetailSurfaceState) => void;
  onOpenScentIntel?: (input: ScentIntelInput) => void;
  onCapturePreferenceMoment?: (payload: {
    preference_state: PersistedPreferenceMomentState;
    source: string;
    main: {
      fragrance_id?: string | null;
      name?: string | null;
      brand?: string | null;
      family_key?: string | null;
      image_url?: string | null;
    };
    layer?: {
      fragrance_id?: string | null;
      name?: string | null;
      brand?: string | null;
      family_key?: string | null;
      image_url?: string | null;
    } | null;
  }) => void;
  userId: string | null;
  isGuestMode: boolean;
  selectedContext: string;
  collectionPreset?: OdaraCollectionEntryPreset;
}> = ({ page, onClose, onOpenCollection, onSearch, onOpenFragranceDetail, onOpenScentIntel, onCapturePreferenceMoment, userId, isGuestMode, selectedContext, collectionPreset = 'all' }) => {
  if (page === 'profile') {
    return (
      <OdaraProfilePage
        onClose={onClose}
        onOpenCollection={onOpenCollection}
        onOpenFragranceDetail={onOpenFragranceDetail}
        onSearch={onSearch}
        userId={userId}
        isGuestMode={isGuestMode}
      />
    );
  }
  if (page === 'collection') {
    return (
      <OdaraCollectionPage
        onClose={onClose}
        onOpenFragranceDetail={onOpenFragranceDetail}
        onOpenScentIntel={onOpenScentIntel}
        onCapturePreferenceMoment={onCapturePreferenceMoment}
        userId={userId}
        isGuestMode={isGuestMode}
        selectedContext={selectedContext}
        entryPreset={collectionPreset}
      />
    );
  }
  const config = ODARA_MENU_PAGE_CONFIG[page];
  return (
    <OdaraDestinationChrome title={config.title} eyebrow={config.subtitle} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {config.groups.map((group, gi) => (
          <OdaraInsetGroup key={gi} eyebrow={group.eyebrow} emphasis={group.emphasis}>
            {group.rows.map((row, ri) => (
              <OdaraInsetRow
                key={row.label}
                label={row.label}
                emphasis={group.emphasis}
                isFirst={ri === 0}
              />
            ))}
          </OdaraInsetGroup>
        ))}
      </div>
    </OdaraDestinationChrome>
  );
};

const OdaraScreen = ({
  oracle, oracleLoading, oracleError, onSignOut,
  selectedContext, onContextChange,
  selectedDate, onDateChange,
  onAccept, onSkip, userId,
  resolvedTemperature,
  isGuestMode = false,
}: OdaraScreenProps) => {
  const [activeOracle, setActiveOracle] = useState<OracleResult | null>(oracle);
  // heroLayer no longer used — all layer resolution goes through get_layer_for_card_v1
  const todayDateKey = fmtLocalDateStr(new Date());
  const currentWeekDays = buildForecastDays(selectedDate);
  const currentWeekStartDateKey = currentWeekDays[0]?.dateStr ?? fmtLocalDateStr(new Date());
  const [signedInLockedHistoryDateKeys, setSignedInLockedHistoryDateKeys] = useState<string[]>([]);
  const signedInLockedHistoryDays = useMemo(() => {
    return signedInLockedHistoryDateKeys
      .filter((dateKey) => dateKey < currentWeekStartDateKey)
      .sort((a, b) => a.localeCompare(b))
      .map((dateKey) => {
        const d = parseLocalDateKey(dateKey);
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return {
          label: dayNames[d.getDay()],
          day: d.getDate(),
          dateStr: dateKey,
          isToday: dateKey === todayDateKey,
          isSelected: dateKey === selectedDate,
        };
      });
  }, [signedInLockedHistoryDateKeys, currentWeekStartDateKey, selectedDate, todayDateKey]);
  const forwardRailDays = useMemo(
    () => buildForwardRailDays(selectedDate),
    [selectedDate]
  );
  const earlierCurrentWeekDays = useMemo(
    () => currentWeekDays.filter((fd) => fd.dateStr < todayDateKey),
    [currentWeekDays, todayDateKey]
  );
  const navigationDays = useMemo(
    () => [...signedInLockedHistoryDays, ...earlierCurrentWeekDays, ...forwardRailDays],
    [signedInLockedHistoryDays, earlierCurrentWeekDays, forwardRailDays]
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPage, setMenuPage] = useState<OdaraMenuPage | null>(null);
  const [collectionPreset, setCollectionPreset] = useState<OdaraCollectionEntryPreset>('all');
  const [occasionSelectorOpen, setOccasionSelectorOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<OdaraSearchFragranceResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchAddPendingFragranceId, setSearchAddPendingFragranceId] = useState<string | null>(null);
  const [searchAddFeedback, setSearchAddFeedback] = useState<{ fragranceId: string; text: string } | null>(null);
  const [daySwipeOffset, setDaySwipeOffset] = useState(0);
  const [daySwipeDragging, setDaySwipeDragging] = useState(false);
  const shellAuthActionLabel = isGuestMode ? 'Sign in or create account' : 'Sign out';
  const menuPanelVisual = getOdaraGlassCardVisualRecipe(DEFAULT_TINT, 'hero');
  const {
    activeSessionUserId: scentIntelSessionUserId,
    sessionResolved: scentIntelSessionResolved,
  } = useOdaraActiveSessionUser({
    userId,
    isGuestMode,
    scope: 'scent-intel',
  });

  // ── Time-orb tick (forecast strip): aligned to local-clock minute boundary ──
  // Uses Date#getHours/getMinutes/getSeconds which return values in the user's
  // local timezone; this is naturally DST-safe (a "day" is still 0:00 → 24:00
  // wall-clock, even on spring-forward / fall-back days, because we measure
  // progress against the local clock, not against a fixed 86400s window).
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    let timeoutId: number | undefined;
    let intervalId: number | undefined;
    const tick = () => setNowTick(Date.now());
    const scheduleNextMinute = () => {
      const now = new Date();
      const msToNextMinute =
        (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
      timeoutId = window.setTimeout(() => {
        tick();
        // After aligning, fall back to a steady 60s interval.
        intervalId = window.setInterval(tick, 60_000);
      }, Math.max(250, msToNextMinute));
    };
    scheduleNextMinute();
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', tick);
    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      if (intervalId) window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', tick);
    };
  }, []);
  const navigationDayCellRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const navigationDayIndicatorRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const navigationStripRef = useRef<HTMLDivElement | null>(null);
  const navigationContentRef = useRef<HTMLDivElement | null>(null);
  const occasionSelectorRef = useRef<HTMLDivElement | null>(null);
  const searchBarRef = useRef<HTMLDivElement | null>(null);
  const searchResultsRef = useRef<HTMLDivElement | null>(null);
  const searchRpcAvailableRef = useRef<boolean | null>(null);
  const searchFeedbackTimeoutRef = useRef<number | null>(null);
  const railAnchoredToTodayRef = useRef(false);
  const [navigationDayCellWidth, setNavigationDayCellWidth] = useState<number | null>(null);
  useEffect(() => {
    return () => {
      if (searchFeedbackTimeoutRef.current) {
        window.clearTimeout(searchFeedbackTimeoutRef.current);
      }
    };
  }, []);
  const closeSearchSurface = useCallback((clearQuery = true) => {
    setSearchOpen(false);
    if (clearQuery) {
      setSearchQuery('');
    }
  }, []);
  const normalizedSelectedContextKey = useMemo(
    () => normalizePersistedContextKey(selectedContext),
    [selectedContext],
  );
  const selectNavigationDay = useCallback((dateStr: string | null | undefined) => {
    if (!dateStr || dateStr === selectedDate) return false;
    onDateChange(dateStr);
    return true;
  }, [onDateChange, selectedDate]);
  useEffect(() => {
    if (!searchOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (searchBarRef.current?.contains(target)) return;
      if (searchResultsRef.current?.contains(target)) return;
      closeSearchSurface();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeSearchSurface();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeSearchSurface, searchOpen]);
  useEffect(() => {
    if (!occasionSelectorOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (occasionSelectorRef.current?.contains(target)) return;
      setOccasionSelectorOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOccasionSelectorOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [occasionSelectorOpen]);
  useEffect(() => {
    if (!searchOpen && !menuOpen) return;
    setOccasionSelectorOpen(false);
  }, [menuOpen, searchOpen]);
  useEffect(() => {
    const strip = navigationStripRef.current;
    if (!strip || typeof ResizeObserver === 'undefined') return;

    const compute = () => {
      const nextWidth = strip.clientWidth / 7;
      if (!Number.isFinite(nextWidth) || nextWidth <= 0) return;
      setNavigationDayCellWidth((current) => (
        current !== null && Math.abs(current - nextWidth) < 0.25
          ? current
          : nextWidth
      ));
    };

    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(strip);
    return () => observer.disconnect();
  }, []);
  // ── LiveMoonPhaseMarker geometry ──
  // Position is a PURE lerp between the measured centers of today's and
  // tomorrow's dedicated indicator slots, driven by local wall-clock
  // seconds-since-midnight. The slot keeps the marker visually separate from
  // the day number instead of letting it graze the digits.
  const [moonMarker, setMoonMarker] = useState<{
    left: number;          // px, container-relative center of marker
    topY: number;          // px, vertical center aligned with indicator slot
    weekNotches: number[]; // px midpoint positions between adjacent day anchors
    moonLitFrac: number;   // 0..1 illumination
    moonWaxing: boolean;
  } | null>(null);
  // Per-second tick dedicated to the marker (independent of the minute tick).
  const [markerSecondTick, setMarkerSecondTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setMarkerSecondTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    // Dev-only mock time: ?odaraMockTime=2026-05-07T03:56:00 (local).
    const getNow = (): Date => {
      try {
        const params = new URLSearchParams(window.location.search);
        const mock = params.get('odaraMockTime');
        if (mock) {
          const parsed = new Date(mock);
          if (!isNaN(parsed.getTime())) return parsed;
        }
      } catch { /* noop */ }
      return new Date();
    };
    const compute = () => {
      const strip = navigationStripRef.current;
      const content = navigationContentRef.current;
      const todayNavIdx = navigationDays.findIndex((fd) => fd.isToday);
      const todayBtn = todayNavIdx >= 0 ? navigationDayCellRefs.current[todayNavIdx] : null;
      const nextBtn  = todayNavIdx >= 0 ? navigationDayCellRefs.current[todayNavIdx + 1] : null;
      const todayIndicator = todayNavIdx >= 0 ? navigationDayIndicatorRefs.current[todayNavIdx] : null;
      const nextIndicator = todayNavIdx >= 0 ? navigationDayIndicatorRefs.current[todayNavIdx + 1] : null;
      if (!strip || !content || !todayBtn || !nextBtn) {
        setMoonMarker((current) => (current === null ? current : null));
        return;
      }
      const cRect = content.getBoundingClientRect();
      const aRect = todayBtn.getBoundingClientRect();
      const bRect = nextBtn.getBoundingClientRect();
      const todayIndicatorRect = todayIndicator?.getBoundingClientRect() ?? null;
      const nextIndicatorRect = nextIndicator?.getBoundingClientRect() ?? null;
      const todayAnchorX = todayIndicatorRect
        ? (todayIndicatorRect.left + todayIndicatorRect.width / 2 - cRect.left)
        : (aRect.left + aRect.width / 2 - cRect.left);
      const tomorrowAnchorX = nextIndicatorRect
        ? (nextIndicatorRect.left + nextIndicatorRect.width / 2 - cRect.left)
        : (bRect.left + bRect.width / 2 - cRect.left);
      const d = getNow();
      const secondsSinceMidnight =
        d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
      const progress = Math.min(1, Math.max(0, secondsSinceMidnight / 86400));
      // PURE lerp between today's and tomorrow's measured centers, driven by
      // local-time progress through the 24-hour day. At midnight the marker
      // sits on today's center; at noon halfway to tomorrow; at 11:59 PM
      // almost on tomorrow's center. At 12:00 AM the new "today" advances
      // and the marker resets onto the new current day cleanly.
      const markerX = todayAnchorX + (tomorrowAnchorX - todayAnchorX) * progress;
      // Vertical center: align with the reserved indicator slot when present.
      // Fall back to the legacy day-digit row center so the rail keeps working
      // even during first paint before refs settle.
      const indicatorCenterY = todayIndicatorRect
        ? (todayIndicatorRect.top + todayIndicatorRect.height / 2 - cRect.top)
        : (aRect.top + 26 - cRect.top);
      const dayAnchorCenters: number[] = [];
      for (let i = 0; i < navigationDays.length; i++) {
        const indicator = navigationDayIndicatorRefs.current[i];
        if (indicator) {
          const r = indicator.getBoundingClientRect();
          dayAnchorCenters.push(r.left + r.width / 2 - cRect.left);
          continue;
        }
        const btn = navigationDayCellRefs.current[i];
        if (!btn) continue;
        const r = btn.getBoundingClientRect();
        dayAnchorCenters.push(r.left + r.width / 2 - cRect.left);
      }
      const weekNotches: number[] = [];
      for (let i = 0; i < dayAnchorCenters.length - 1; i++) {
        weekNotches.push((dayAnchorCenters[i] + dayAnchorCenters[i + 1]) / 2);
      }
      // Real lunar phase (synodic month). Reference new moon: 2000-01-06 18:14 UTC.
      const SYNODIC = 29.530588853;
      const refMs = Date.UTC(2000, 0, 6, 18, 14, 0);
      const daysSince = (d.getTime() - refMs) / 86400000;
      const phaseFrac = ((daysSince % SYNODIC) + SYNODIC) % SYNODIC / SYNODIC;
      const moonLitFrac = (1 - Math.cos(2 * Math.PI * phaseFrac)) / 2;
      const moonWaxing = phaseFrac < 0.5;
      const nextMarker = {
        left: markerX,
        topY: indicatorCenterY,
        weekNotches,
        moonLitFrac,
        moonWaxing,
      };
      setMoonMarker((current) => (
        areSameMoonMarkerState(current, nextMarker) ? current : nextMarker
      ));
    };
    compute();
    const strip = navigationStripRef.current;
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    strip?.addEventListener('scroll', compute);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
      strip?.removeEventListener('scroll', compute);
    };
  }, [markerSecondTick, nowTick, navigationDays]);
  // Backwards-compat alias used by render block below.
  const orbGeom = moonMarker
    ? {
        left: moonMarker.left,
        topY: moonMarker.topY,
        weekNotches: moonMarker.weekNotches,
        moonLitFrac: moonMarker.moonLitFrac,
        moonWaxing: moonMarker.moonWaxing,
      }
    : null;
  const suppressCardClickRef = useRef(false);
  const selectedNavigationIndex = navigationDays.findIndex((fd) => fd.dateStr === selectedDate);
  const prevForecastDay = selectedNavigationIndex > 0 ? navigationDays[selectedNavigationIndex - 1] : null;
  const nextForecastDay = selectedNavigationIndex >= 0 && selectedNavigationIndex < navigationDays.length - 1
    ? navigationDays[selectedNavigationIndex + 1]
    : null;
  useEffect(() => {
    if (selectedNavigationIndex < 0) return;
    const selectedCell = navigationDayCellRefs.current[selectedNavigationIndex];
    const strip = navigationStripRef.current;
    if (!selectedCell || !strip) return;
    window.requestAnimationFrame(() => {
      if (selectedDate === todayDateKey) {
        const maxScrollLeft = Math.max(0, strip.scrollWidth - strip.clientWidth);
        const left = Math.max(0, Math.min(selectedCell.offsetLeft, maxScrollLeft));
        strip.scrollTo({
          left,
          behavior: railAnchoredToTodayRef.current ? 'smooth' : 'auto',
        });
        railAnchoredToTodayRef.current = true;
        return;
      }
      selectedCell.scrollIntoView({
        inline: 'center',
        block: 'nearest',
        behavior: 'smooth',
      });
    });
  }, [selectedNavigationIndex, navigationDays.length, selectedDate, todayDateKey]);

  // ── Queue from get_home_card_queue_v1 ──
  const [queue, setQueue] = useState<DisplayCard[]>([]);
  const [queuePointer, setQueuePointer] = useState(0);
  const [viewHistory, setViewHistory] = useState<HistoryEntry[]>([]);
  const [skipLoading, setSkipLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);

  const [visibleCard, setVisibleCard] = useState<DisplayCard | null>(null);
  const [promotedAltId, setPromotedAltId] = useState<string | null>(null);

  // ── Slot-scoped layer caches (lazy, from get_layer_for_card_mode_v1) ──
  // Key: `${date}|${context}|${fragranceId}|${mood}` → BackendModeEntry (never null — failures go to modeErrors)
  const moodCacheRef = useRef<Map<string, BackendModeEntry>>(new Map());
  const moodInFlightRef = useRef<Map<string, Promise<BackendModeEntry | null>>>(new Map());
  const moodLaneStackRef = useRef<Map<string, BackendModeEntry[]>>(new Map());
  const moodLaneInFlightRef = useRef<Map<string, Promise<BackendModeEntry[]>>>(new Map());
  const [moodCacheVersion, setMoodCacheVersion] = useState(0); // bump to trigger re-render
  const [modeLoading, setModeLoading] = useState<Record<LayerMood, boolean>>({ balance: false, bold: false, smooth: false, wild: false });
  const [modeErrors, setModeErrors] = useState<Record<LayerMood, string | null>>({ balance: null, bold: null, smooth: null, wild: null });
  const [layerDebugSource, setLayerDebugSource] = useState<string>('none');
  // Key: `${date}|${context}|${fragranceId}` → OracleAlternate[]
  const alternatesCacheRef = useRef<Map<string, OracleAlternate[]>>(new Map());
  const [currentCardAlternates, setCurrentCardAlternates] = useState<OracleAlternate[]>([]);
  const [currentCardAlternatesOwnerId, setCurrentCardAlternatesOwnerId] = useState<string | null>(null);
  const fragranceDetailCacheRef = useRef<Map<string, FragranceDetail>>(new Map());
  const fragranceDetailInFlightRef = useRef<Map<string, Promise<FragranceDetail | null>>>(new Map());
  const queueFetchInFlightRef = useRef<Map<string, Promise<DisplayCard[]>>>(new Map());
  const signedInQueuedHeroRef = useRef<Map<string, DisplayCard>>(new Map());
  const [signedInQueuedHeroVersion, setSignedInQueuedHeroVersion] = useState(0);
  const [fragranceDetailVersion, setFragranceDetailVersion] = useState(0);
  const [fragranceDetailSheet, setFragranceDetailSheet] = useState<OdaraFragranceDetailSurfaceState | null>(null);
  const scentIntelCacheRef = useRef<Map<string, ScentIntelPayload>>(new Map());
  const scentIntelInFlightRef = useRef<Map<string, Promise<ScentIntelPayload>>>(new Map());
  const [scentIntelSheet, setScentIntelSheet] = useState<ScentIntelSheetState | null>(null);

  const hasHistory = viewHistory.length > 0;

  const readMoodLaneStack = useCallback((moodKey: string): BackendModeEntry[] => {
    const seededStack = moodLaneStackRef.current.get(moodKey);
    if (Array.isArray(seededStack) && seededStack.length > 0) {
      return seededStack;
    }

    const cachedEntry = moodCacheRef.current.get(moodKey);
    return cachedEntry ? [cachedEntry] : [];
  }, []);

  const writeMoodLaneStack = useCallback((
    moodKey: string,
    entries: Array<BackendModeEntry | null | undefined>,
    selectedIndex = 0,
  ) => {
    const nextStack = appendUniqueBackendModeEntries([], entries);
    if (nextStack.length === 0) {
      moodLaneStackRef.current.delete(moodKey);
      moodCacheRef.current.delete(moodKey);
      return nextStack;
    }

    moodLaneStackRef.current.set(moodKey, nextStack);
    const safeIndex = Math.min(Math.max(selectedIndex, 0), nextStack.length - 1);
    moodCacheRef.current.set(moodKey, nextStack[safeIndex] ?? nextStack[0]);
    return nextStack;
  }, []);

  const syncMoodLaneSelectedEntry = useCallback((
    moodKey: string,
    selectedIndex: number,
  ) => {
    const stack = readMoodLaneStack(moodKey);
    if (stack.length === 0) return null;
    const safeIndex = Math.min(Math.max(selectedIndex, 0), stack.length - 1);
    const selectedEntry = stack[safeIndex] ?? stack[0] ?? null;
    if (selectedEntry) {
      moodCacheRef.current.set(moodKey, selectedEntry);
    }
    return selectedEntry;
  }, [readMoodLaneStack]);

  // Signed-in mood-lane state: keep the per-mood active layer index in runtime
  // memory so leaving Daily and coming back restores the same lane position
  // for that slot/anchor instead of snapping back to candidate 0.
  const [signedInLayerIdxByMood, setSignedInLayerIdxByMood] = useState<Record<LayerMood, number>>({
    balance: 0, bold: 0, smooth: 0, wild: 0,
  });
  const signedInLayerIdxByMoodRef = useRef(signedInLayerIdxByMood);
  signedInLayerIdxByMoodRef.current = signedInLayerIdxByMood;
  const signedInSearchPreviewSnapshotRef = useRef<Record<string, SignedInSearchPreviewSnapshot | null>>({});
  const signedInMoodCycleScopeRef = useRef<{ slot: string; anchorId: string | null } | null>(null);
  const signedInMoodCycleMemoryRef = useRef<Record<string, {
    selectedMood: LayerMood;
    layerIdxByMood: Record<LayerMood, number>;
  }>>({});

  const getResolvedMoodLaneEntry = useCallback((
    fragranceId: string | null | undefined,
    mood: LayerMood | null | undefined,
    explicitIndex?: number | null,
  ) => {
    if (!fragranceId) return null;
    const resolvedMood = mood ?? 'balance';
    const moodKey = buildMoodLaneKey(`${selectedDate}|${selectedContext}`, fragranceId, resolvedMood);
    const stack = readMoodLaneStack(moodKey);
    if (stack.length === 0) {
      return moodCacheRef.current.get(moodKey) ?? null;
    }
    const laneIndex = explicitIndex ?? (signedInLayerIdxByMood[resolvedMood] ?? 0);
    const safeIndex = Math.min(Math.max(laneIndex, 0), stack.length - 1);
    return stack[safeIndex] ?? stack[0] ?? null;
  }, [readMoodLaneStack, selectedContext, selectedDate, signedInLayerIdxByMood]);

  const commitSignedInQueuedHero = useCallback((card: DisplayCard, detail: FragranceDetail | null | undefined) => {
    if (isGuestMode || card.isHero) {
      return card;
    }

    const previous = signedInQueuedHeroRef.current.get(card.fragrance_id);
    const mergedCard = previous
      ? {
          ...card,
          family: card.family || previous.family,
          image_url: card.image_url ?? previous.image_url ?? null,
          notes: card.notes.length > 0 ? card.notes : previous.notes,
          accords: card.accords.length > 0 ? card.accords : previous.accords,
          reason_chip_label: card.reason_chip_label ?? previous.reason_chip_label ?? null,
          reason_chip_explanation: card.reason_chip_explanation ?? previous.reason_chip_explanation ?? null,
        }
      : card;
    const resolved = resolveQueuedHeroDisplayWithDetails(mergedCard, detail);
    if (!areSameDisplayCards(previous, resolved)) {
      signedInQueuedHeroRef.current.set(card.fragrance_id, resolved);
      setSignedInQueuedHeroVersion((version) => version + 1);
    }
    return resolved;
  }, [isGuestMode]);

  const fetchFragranceImageAssets = useCallback(async (fragranceIds: string[]) => {
    const uniqueIds = Array.from(new Set(fragranceIds.filter(Boolean)));
    if (uniqueIds.length === 0) {
      return new Map<string, FragranceImageAsset>();
    }

    try {
      const { data, error } = await odaraSupabase
        .from('fragrance_image_assets' as any)
        .select('fragrance_id, image_url, thumbnail_url, image_source, source_url, provider_payload, updated_at')
        .in('fragrance_id', uniqueIds);

      if (error) {
        console.warn('[Odara] fragrance image asset fetch skipped', error.message);
        return new Map<string, FragranceImageAsset>();
      }

      return new Map<string, FragranceImageAsset>(
        (Array.isArray(data) ? data : [])
          .filter((row) => !!row?.fragrance_id)
          .map((row) => [row.fragrance_id, {
            fragrance_id: row.fragrance_id,
            image_url_transparent: readTransparentBottleImageUrlFromObject(row),
            image_url: readRegularBottleImageUrlFromObject(row),
            thumbnail_url: readTrimmedImageUrl(row.thumbnail_url),
            image_source: readTrimmedLayerText(row.image_source),
            source_url: readTrimmedLayerText(row.source_url),
            updated_at: readTrimmedLayerText(row.updated_at),
            provider_payload: row.provider_payload ?? null,
          }] as [string, FragranceImageAsset]),
      );
    } catch {
      return new Map<string, FragranceImageAsset>();
    }
  }, []);

  const fetchFragranceDetails = useCallback(async (fragranceIds: string[]) => {
    const uniqueIds = Array.from(new Set(fragranceIds.filter(Boolean)));
    const details = new Map<string, FragranceDetail>();
    const missingIds: string[] = [];

    for (const fragranceId of uniqueIds) {
      const cached = fragranceDetailCacheRef.current.get(fragranceId);
      if (cached) {
        details.set(fragranceId, cached);
      } else {
        missingIds.push(fragranceId);
      }
    }

    if (missingIds.length === 0) {
      return details;
    }

    try {
      const [{ data, error }, imageAssets] = await Promise.all([
        odaraSupabase
          .from('fragrances')
          .select('id, name, brand, family_key, notes, accords, top_notes, heart_notes, base_notes, release_year, concentration, perfumer, longevity_score, projection_score, source_confidence, source_url')
          .in('id', missingIds),
        fetchFragranceImageAssets(missingIds),
      ]);

      if (error) {
        return details;
      }

      let cacheUpdated = false;
      for (const row of Array.isArray(data) ? data : []) {
        if (!row?.id) continue;
        const imageAsset = imageAssets.get(row.id) ?? null;
        const detail = finalizeFragranceDetail({
          id: row.id,
          name: row.name ?? '',
          brand: row.brand ?? null,
          family_key: row.family_key ?? null,
          family_color_token: row.family_key ?? null,
          wardrobe_role_key: null,
          wardrobe_role_label: null,
          role_confidence: null,
          role_source: null,
          release_year: typeof (row as any).release_year === 'number' ? (row as any).release_year : null,
          concentration: typeof (row as any).concentration === 'string' ? (row as any).concentration : null,
          perfumer: typeof (row as any).perfumer === 'string' ? (row as any).perfumer : null,
          short_description: null,
          description_source: null,
          description_generated_at: null,
          timeline_source: null,
          notes: Array.isArray(row.notes) ? row.notes : [],
          accords: Array.isArray(row.accords) ? row.accords : [],
          top_notes: Array.isArray((row as any).top_notes) ? (row as any).top_notes : [],
          middle_notes: Array.isArray((row as any).heart_notes) ? (row as any).heart_notes : [],
          base_notes: Array.isArray((row as any).base_notes) ? (row as any).base_notes : [],
          longevity_score: normalizeDetailScore((row as any).longevity_score),
          longevity_source: null,
          projection_score: normalizeDetailScore((row as any).projection_score),
          projection_source: null,
          odor_impact_score: null,
          density_score: null,
          transparency_score: null,
          beast_mode_score: null,
          trail_source: null,
          why_it_fits_wardrobe: null,
          source_confidence: typeof (row as any).source_confidence === 'string' ? (row as any).source_confidence : null,
          retired: false,
          rating: null,
          profile_loaded: false,
          image_url: resolvePreferredWardrobeBottleImage(imageAsset, row),
          thumbnail_url: imageAsset?.thumbnail_url ?? null,
          image_source: imageAsset?.image_source ?? null,
          source_page_url: imageAsset?.source_url ?? (typeof (row as any).source_url === 'string' ? (row as any).source_url : null),
          image_license_status: null,
          image_last_checked_at: imageAsset?.updated_at ?? null,
        });
        fragranceDetailCacheRef.current.set(row.id, detail);
        details.set(row.id, detail);
        cacheUpdated = true;
      }

      if (cacheUpdated) {
        setFragranceDetailVersion((version) => version + 1);
      }
    } catch {
      return details;
    }

    return details;
  }, []);

  const queueRowsToDisplay = useCallback((rowsInput: any[], excludeId?: string) => {
    const normalizedRows = (Array.isArray(rowsInput) ? rowsInput : [])
      .map(normalizeQueueCardRow)
      .filter((row): row is QueueCard => (
        !!row
        && (!excludeId || row.fragrance_id !== excludeId)
        && !isTemporarilySuppressedRotationFragrance({
          fragrance_id: row.fragrance_id,
          name: row.name,
          brand: row.brand,
        })
      ));

    return normalizedRows.map((row) => commitSignedInQueuedHero(queueCardToDisplay(row), null));
  }, [commitSignedInQueuedHero]);

  const stateKey = `${selectedDate}:${selectedContext}`;

  // Fetch queue from backend — background only, never blocks hero.
  // GUEST MODE: skip — queue is signed-in only.
  const fetchQueue = useCallback(async (excludeId?: string) => {
    if (isGuestMode) {
      odaraDebugLog('[Odara][Guest] queue fetch skipped (read-only)');
      return [];
    }
    const requestKey = `${stateKey}|${excludeId ?? '(none)'}`;
    const inFlight = queueFetchInFlightRef.current.get(requestKey);
    if (inFlight) {
      odaraDebugLog('[Odara] queue fetch reuse', requestKey);
      return inFlight;
    }

    odaraDebugLog('[Odara] queue fetch start', requestKey);
    setQueueError(null);

    const request = (async () => {
      try {
        const { data, error } = await odaraSupabase.rpc('get_home_card_queue_v1' as any, {
          p_user: userId,
          p_context: selectedContext,
          p_temperature: resolvedTemperature,
          p_brand: 'Alexandria Fragrances',
          p_wear_date: selectedDate,
          p_limit: 12,
        });
        if (error) {
          console.error('[Odara] queue fetch fail', error.message);
          setQueueError(error.message);
          return [];
        }
        const seededQueue = queueRowsToDisplay((data as unknown as QueueCard[]) ?? [], excludeId);
        const detailIds = seededQueue
          .filter((row) => displayCardNeedsDetailHydration(row))
          .map((row) => row.fragrance_id);
        const detailMap = detailIds.length > 0
          ? await fetchFragranceDetails(detailIds)
          : new Map<string, FragranceDetail>();
        odaraDebugLog('[Odara] queue fetch success', seededQueue.length, 'cards');
        return seededQueue.map((row) => {
          const resolvedCard = resolveQueuedHeroDisplayWithDetails(
            row,
            detailMap.get(row.fragrance_id) ?? null,
          );
          return commitSignedInQueuedHero(resolvedCard, detailMap.get(row.fragrance_id) ?? null);
        });
      } catch (e: any) {
        console.error('[Odara] queue fetch fail', e?.message);
        setQueueError(e?.message ?? 'Queue fetch failed');
        return [];
      } finally {
        queueFetchInFlightRef.current.delete(requestKey);
      }
    })();

    queueFetchInFlightRef.current.set(requestKey, request);
    return request;
  }, [userId, selectedContext, selectedDate, resolvedTemperature, isGuestMode, stateKey, queueRowsToDisplay, fetchFragranceDetails, commitSignedInQueuedHero]);

  const fetchFragranceDetail = useCallback(async (fragranceId: string) => {
    if (!fragranceId) return null;
    const cached = fragranceDetailCacheRef.current.get(fragranceId);
    if (cached?.profile_loaded) {
      return cached;
    }

    const inFlight = fragranceDetailInFlightRef.current.get(fragranceId);
    if (inFlight) return inFlight;

    const request = (async (): Promise<FragranceDetail | null> => {
      try {
        const [
          { data: profileData, error: profileError },
          { data, error },
          imageAssets,
        ] = await Promise.all([
          odaraSupabase.rpc('get_fragrance_profile_v1' as any, {
            p_user: isGuestMode ? null : userId,
            p_fragrance_id: fragranceId,
          } as any),
          odaraSupabase
            .from('fragrances')
            .select('id, name, brand, family_key, notes, accords, top_notes, heart_notes, base_notes, release_year, concentration, perfumer, longevity_score, projection_score, source_confidence, source_url')
            .eq('id', fragranceId)
            .maybeSingle(),
          fetchFragranceImageAssets([fragranceId]),
        ]);

        const payload = (!profileError && profileData && (profileData as any)?.found)
          ? (profileData as any)
          : null;

        if (!payload && (error || !data?.id)) {
          return null;
        }

        const imageAsset = imageAssets.get(fragranceId) ?? null;
        const detail = finalizeFragranceDetail({
          id: payload?.fragrance_id ?? data?.id ?? fragranceId,
          name: payload?.name ?? data?.name ?? '',
          brand: payload?.brand ?? data?.brand ?? null,
          family_key: payload?.family_key ?? data?.family_key ?? null,
          family_color_token: payload?.family_color_token ?? payload?.family_key ?? data?.family_key ?? null,
          wardrobe_role_key: payload?.wardrobe_role_key ?? null,
          wardrobe_role_label: payload?.wardrobe_role_label ?? null,
          role_confidence: payload?.role_confidence ?? null,
          role_source: payload?.role_source ?? null,
          release_year: payload?.release_year ?? (typeof (data as any)?.release_year === 'number' ? (data as any).release_year : null),
          concentration: payload?.concentration ?? (typeof (data as any)?.concentration === 'string' ? (data as any).concentration : null),
          perfumer: payload?.perfumer ?? (typeof (data as any)?.perfumer === 'string' ? (data as any).perfumer : null),
          short_description: payload?.short_description ?? null,
          description_source: payload?.description_source ?? null,
          description_generated_at: payload?.description_generated_at ?? null,
          timeline_source: null,
          notes: Array.isArray(payload?.notes) ? payload.notes : (Array.isArray(data?.notes) ? data.notes : []),
          accords: Array.isArray(payload?.accords) ? payload.accords : (Array.isArray(data?.accords) ? data.accords : []),
          top_notes: Array.isArray(payload?.top_notes) ? payload.top_notes : (Array.isArray((data as any)?.top_notes) ? (data as any).top_notes : []),
          middle_notes: Array.isArray(payload?.middle_notes) ? payload.middle_notes : (Array.isArray((data as any)?.heart_notes) ? (data as any).heart_notes : []),
          base_notes: Array.isArray(payload?.base_notes) ? payload.base_notes : (Array.isArray((data as any)?.base_notes) ? (data as any).base_notes : []),
          longevity_score: normalizeDetailScore(payload?.longevity_score ?? (data as any)?.longevity_score),
          longevity_source: null,
          projection_score: normalizeDetailScore(payload?.projection_score ?? (data as any)?.projection_score),
          projection_source: null,
          odor_impact_score: normalizeDetailScore(payload?.odor_impact_score ?? payload?.odor_impact_confidence),
          density_score: normalizeDetailScore(payload?.density_score),
          transparency_score: normalizeDetailScore(payload?.transparency_score),
          beast_mode_score: normalizeDetailScore(payload?.beast_mode_score),
          trail_source: null,
          why_it_fits_wardrobe: typeof payload?.why_it_fits_wardrobe === 'string' ? payload.why_it_fits_wardrobe : null,
          source_confidence: typeof payload?.source_confidence === 'string'
            ? payload.source_confidence
            : (typeof (data as any)?.source_confidence === 'string' ? (data as any).source_confidence : null),
          retired: Boolean(payload?.retired),
          rating: normalizeCollectionRating(payload?.rating),
          profile_loaded: true,
          image_url: resolvePreferredWardrobeBottleImage(payload, imageAsset, data, payload?.image_url, payload?.thumbnail_url),
          thumbnail_url: payload?.thumbnail_url ?? imageAsset?.thumbnail_url ?? null,
          image_source: payload?.image_source ?? imageAsset?.image_source ?? null,
          source_page_url: payload?.source_page_url ?? payload?.source_url ?? imageAsset?.source_url ?? (typeof (data as any)?.source_url === 'string' ? (data as any).source_url : null),
          image_license_status: payload?.image_license_status ?? null,
          image_last_checked_at: payload?.image_last_checked_at ?? imageAsset?.updated_at ?? null,
        });

        fragranceDetailCacheRef.current.set(fragranceId, detail);
        setFragranceDetailVersion((version) => version + 1);
        return detail;
      } catch {
        return null;
      } finally {
        fragranceDetailInFlightRef.current.delete(fragranceId);
      }
    })();

    fragranceDetailInFlightRef.current.set(fragranceId, request);
    return request;
  }, [fetchFragranceImageAssets, isGuestMode, userId]);

  const openFragranceDetailSheet = useCallback(async (seed: OdaraFragranceDetailSurfaceState) => {
    if (!seed) return;
    const cachedDetail = seed.fragrance_id
      ? (fragranceDetailCacheRef.current.get(seed.fragrance_id) ?? null)
      : null;
    const initialState = seed.fragrance_id
      ? mergeFragranceDetailSurfaceState(
          seed,
          cachedDetail,
        )
      : seed;
    setFragranceDetailSheet({
      ...initialState,
      detail_loading: Boolean(seed.fragrance_id) && !(cachedDetail?.profile_loaded),
      detail_error: null,
    });

    if (!seed.fragrance_id) return;
    const detail = await fetchFragranceDetail(seed.fragrance_id);
    if (!detail) {
      setFragranceDetailSheet((current) => (
        current?.fragrance_id === seed.fragrance_id
          ? {
              ...current,
              detail_loading: false,
              detail_error: 'Could not refresh the live fragrance profile.',
            }
          : current
      ));
      return;
    }
    setFragranceDetailSheet((current) => (
      current?.fragrance_id === seed.fragrance_id
        ? {
            ...mergeFragranceDetailSurfaceState(current, detail),
            detail_loading: false,
            detail_error: null,
          }
        : current
    ));
  }, [fetchFragranceDetail]);

  const openScentIntelSheet = useCallback((input: ScentIntelInput) => {
    const label = String(input?.label ?? '').trim();
    if (!label) return;
    const lookupSlugCandidates = getScentIntelLookupSlugCandidates(input);
    const resolvedLookupSlug = lookupSlugCandidates[0] ?? scentIntelSlugify(label);

    const detailSheetFragrance = input.fragranceId && fragranceDetailSheet?.fragrance_id === input.fragranceId
      ? {
          id: fragranceDetailSheet.fragrance_id,
          name: fragranceDetailSheet.name,
          brand: fragranceDetailSheet.brand,
          familyKey: fragranceDetailSheet.family_key ?? null,
          familyLabel: fragranceDetailSheet.family_label ?? null,
        }
      : null;
    const cachedDetail = input.fragranceId
      ? (fragranceDetailCacheRef.current.get(input.fragranceId) ?? null)
      : null;
    const cachedFragrance = input.fragranceId
      ? (cachedDetail
        ? {
            id: cachedDetail.id,
            name: cachedDetail.name,
            brand: cachedDetail.brand,
            familyKey: cachedDetail.family_key ?? null,
            familyLabel: cachedDetail.family_key ? getFamilyLabelText(cachedDetail.family_key) : null,
          }
        : detailSheetFragrance
        ?? (visibleCard?.fragrance_id === input.fragranceId
          ? {
              id: visibleCard.fragrance_id,
              name: visibleCard.name,
              brand: visibleCard.brand,
              familyKey: visibleCard.family ?? null,
              familyLabel: visibleCard.family ? getFamilyLabelText(visibleCard.family) : null,
            }
          : null))
      : null;
    const normalizedInput: ScentIntelInput = {
      label,
      slug: resolvedLookupSlug,
      fragranceId: input.fragranceId ?? null,
      fragranceName: input.fragranceName ?? cachedFragrance?.name ?? null,
      fragranceBrand: input.fragranceBrand ?? cachedFragrance?.brand ?? null,
      position: input.position ?? null,
      sourceFamilyKey: input.sourceFamilyKey ?? cachedFragrance?.familyKey ?? null,
      sourceFamilyLabel: input.sourceFamilyLabel ?? cachedFragrance?.familyLabel ?? null,
    };
    const requestUserScopeKey = isGuestMode
      ? 'public'
      : (scentIntelSessionResolved
        ? (scentIntelSessionUserId ?? 'authenticated-no-user')
        : 'auth-pending');
    const requestKey = [
      requestUserScopeKey,
      resolvedLookupSlug,
      normalizedInput.fragranceId ?? 'no-fragrance',
      normalizedInput.position ?? 'no-position',
    ].join('|');

    const cached = scentIntelCacheRef.current.get(requestKey);
    setScentIntelSheet({
      input: normalizedInput,
      status: cached ? 'ready' : 'loading',
      payload: cached ?? null,
      error: null,
      requestKey,
    });
    if (cached) return;

    const existing = scentIntelInFlightRef.current.get(requestKey);
    const request = existing ?? (async (): Promise<ScentIntelPayload> => {
      const resolvePayload = (
        payload: ScentIntelPayload | null,
        fallbackMessage: string = SCENT_INTEL_UNMAPPED_MESSAGE,
      ): ScentIntelPayload => {
        if (payload?.found) return payload;

        const localSeed = getLocalScentIntelSeed(normalizedInput);
        if (localSeed) {
          return {
            ...localSeed,
            context_position: payload?.context_position ?? normalizedInput.position ?? localSeed.context_position ?? null,
          };
        }

        return payload ?? buildScentIntelSafeFallbackPayload(normalizedInput, fallbackMessage);
      };

      const runDossierLookup = async (pUser: string | null) => {
        let lastPayload: ScentIntelPayload | null = null;

        for (const candidateSlug of lookupSlugCandidates) {
          const { data, error } = await odaraSupabase.rpc('get_scent_term_dossier_v1' as any, {
            p_user: pUser,
            p_term_slug: candidateSlug,
            p_term_label: normalizedInput.label,
            p_fragrance_id: normalizedInput.fragranceId,
            p_position: normalizedInput.position,
          } as any);
          if (error) throw error;
          const payload = (data && typeof data === 'object')
            ? (data as ScentIntelPayload)
            : null;
          if (payload?.found) return payload;
          lastPayload = payload ?? lastPayload;
        }

        return lastPayload;
      };

      const getVerifiedScentIntelUserId = async () => {
        if (isGuestMode) return null;
        try {
          const { data, error } = await odaraSupabase.auth.getUser();
          if (error) {
            if (import.meta.env.DEV) {
              console.warn('[Odara] scent intel auth verification failed', error.message);
            }
            return null;
          }
          return normalizeOdaraAuthUserId(data?.user?.id);
        } catch (error) {
          if (import.meta.env.DEV) {
            console.warn('[Odara] scent intel auth verification threw', error);
          }
          return null;
        }
      };

      const verifiedUserId = await getVerifiedScentIntelUserId();

      try {
        const payload = await runDossierLookup(verifiedUserId);
        return resolvePayload(payload);
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn('[Odara] scent intel private lookup failed', error);
        }

        const shouldRetryPublic = verifiedUserId != null || isScentIntelAccessDeniedError(error);
        if (shouldRetryPublic) {
          try {
            const payload = await runDossierLookup(null);
            return resolvePayload(payload);
          } catch (publicError) {
            if (import.meta.env.DEV) {
              console.warn('[Odara] scent intel public fallback failed', publicError);
            }
          }
        }

        return resolvePayload(null, SCENT_INTEL_COMING_SOON_MESSAGE);
      }
    })();

    if (!existing) {
      scentIntelInFlightRef.current.set(requestKey, request);
    }

    request
      .then((payload) => {
        scentIntelCacheRef.current.set(requestKey, payload);
        setScentIntelSheet((current) => (
          current?.requestKey === requestKey
            ? {
                input: normalizedInput,
                status: 'ready',
                payload,
                error: null,
                requestKey,
              }
            : current
        ));
      })
      .catch((error) => {
        if (import.meta.env.DEV) {
          console.error('[Odara] scent intel sheet request failed', error);
        }
        setScentIntelSheet((current) => (
          current?.requestKey === requestKey
            ? {
                input: normalizedInput,
                status: 'error',
                payload: null,
                error: 'Scent Intel is unavailable right now.',
                requestKey,
              }
            : current
        ));
      })
      .finally(() => {
        scentIntelInFlightRef.current.delete(requestKey);
      });
  }, [fragranceDetailSheet, isGuestMode, scentIntelSessionResolved, scentIntelSessionUserId, visibleCard]);

  const runFallbackFragranceSearch = useCallback(async (query: string) => {
    const normalizedQuery = normalizeOdaraSearchQuery(query);
    if (!normalizedQuery) return [] as OdaraSearchFragranceResult[];

    const pattern = `%${normalizedQuery}%`;
    const { data, error } = await odaraSupabase
      .from('fragrances')
      .select('id, name, brand, family_key, notes, accords')
      .or(`name.ilike.${pattern},brand.ilike.${pattern},family_key.ilike.${pattern}`)
      .order('name', { ascending: true })
      .limit(12);

    if (error) throw error;

    return (Array.isArray(data) ? data : [])
      .map((row) => normalizeOdaraSearchFragranceResult(row, 'catalog_fallback'))
      .filter((row): row is OdaraSearchFragranceResult => !!row);
  }, []);

  const runFragranceSearch = useCallback(async (query: string) => {
    const normalizedQuery = normalizeOdaraSearchQuery(query);
    if (!normalizedQuery) return [] as OdaraSearchFragranceResult[];

    if (!isGuestMode && userId && searchRpcAvailableRef.current !== false) {
      try {
        const { data, error } = await odaraSupabase.rpc('search_odara_v3' as any, {
          p_user: userId,
          p_query: normalizedQuery,
          p_in_collection_only: false,
          p_limit_per_section: 8,
        });

        if (error) {
          searchRpcAvailableRef.current = false;
        } else {
          searchRpcAvailableRef.current = true;
          return (Array.isArray(data) ? data : [])
            .filter((row: any) => row?.section_key === 'fragrances' && row?.fragrance_id)
            .map((row: any) => normalizeOdaraSearchFragranceResult(row, 'search_rpc'))
            .filter((row): row is OdaraSearchFragranceResult => !!row);
        }
      } catch {
        searchRpcAvailableRef.current = false;
      }
    }

    return runFallbackFragranceSearch(normalizedQuery);
  }, [isGuestMode, runFallbackFragranceSearch, userId]);

  useEffect(() => {
    if (!searchOpen) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(null);
      return;
    }

    const normalizedQuery = normalizeOdaraSearchQuery(searchQuery);
    if (!normalizedQuery) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(null);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setSearchLoading(true);
      setSearchError(null);
      runFragranceSearch(normalizedQuery)
        .then((results) => {
          if (cancelled) return;
          setSearchResults(results);
        })
        .catch(() => {
          if (cancelled) return;
          setSearchResults([]);
          setSearchError('Search is unavailable right now.');
        })
        .finally(() => {
          if (!cancelled) {
            setSearchLoading(false);
          }
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [searchOpen, searchQuery, runFragranceSearch]);

  // Interactive state
  const [selectedMood, setSelectedMood] = useState<LayerMood>('balance');
  const [selectedRatio, setSelectedRatio] = useState('1:1');
  const [layerExpanded, setLayerExpanded] = useState(false);
  const [signedInModeHistory, setSignedInModeHistory] = useState<LocalModeHistoryEntry<LayerMood>[]>([]);
  const signedInModeHistoryRef = useRef<LocalModeHistoryEntry<LayerMood>[]>([]);
  const getBetaSafeLayerMood = useCallback((mood: LayerMood | null | undefined): LayerMood => {
    const normalized = normalizeLayerMoodKey(mood) ?? 'balance';
    return !isGuestMode && normalized === 'wild' ? 'balance' : normalized;
  }, [isGuestMode]);
  const betaSafeSignedInMood = getBetaSafeLayerMood(selectedMood);
  const persistSignedInMoodCycleMemory = useCallback((
    slotKey: string,
    anchorId: string | null | undefined,
    mood: LayerMood,
    layerIdxByMood: Record<LayerMood, number>,
  ) => {
    if (isGuestMode || !anchorId) return;
    const memoryKey = buildSignedInMoodCycleMemoryKey(slotKey, anchorId);
    signedInMoodCycleMemoryRef.current[memoryKey] = {
      selectedMood: mood,
      layerIdxByMood: { ...layerIdxByMood },
    };
  }, [isGuestMode]);

  useEffect(() => {
    persistSignedInMoodCycleMemory(
      `${selectedDate}|${selectedContext}`,
      visibleCard?.fragrance_id ?? null,
      betaSafeSignedInMood,
      signedInLayerIdxByMood,
    );
  }, [betaSafeSignedInMood, persistSignedInMoodCycleMemory, visibleCard?.fragrance_id, selectedDate, selectedContext, signedInLayerIdxByMood]);

  useEffect(() => {
    if (isGuestMode || selectedMood !== 'wild') return;
    setSelectedMood('balance');
  }, [isGuestMode, selectedMood]);

  // ── Guest-mode v5 state machine (guest_single_bundle_v3_mode_layers) ──
  // Two render states only:
  //   A) selectedAlternateIdx === null → main-mode state
  //      Drives selectedMode + activeLayerIndex against payload.main_bundle.layer_modes[mode].layers[]
  //   B) selectedAlternateIdx !== null → alternate-bundle state
  //      Renders payload.alternate_bundles[idx]; mode row hidden.
  // selectedAlternateIdx must NOT overwrite selectedMode/activeLayerIndex —
  // those are restored verbatim when the alternate is cleared.
  const [guestLayerExpanded, setGuestLayerExpanded] = useState(false);
  const [guestSelectedMood, setGuestSelectedMood] = useState<GuestModeKey>('balance');
  const [guestLayerIdxByMood, setGuestLayerIdxByMood] = useState<Record<GuestModeKey, number>>(DEFAULT_LAYER_INDEX_MAP);
  const guestActiveLayerIdx = guestLayerIdxByMood[guestSelectedMood] ?? 0;
  const [guestModeHistory, setGuestModeHistory] = useState<LocalModeHistoryEntry<GuestModeKey>[]>([]);
  const guestModeHistoryRef = useRef<LocalModeHistoryEntry<GuestModeKey>[]>([]);
  const [selectedAlternateIdx, setSelectedAlternateIdx] = useState<number | null>(null);
  // Snapshot of main-state at time alternate was selected, for clean restore.
  const guestPrevMainStateRef = useRef<{ mood: GuestModeKey; idx: number } | null>(null);
  const guestRenderSourceRef = useRef<GuestRenderSource>('guest_main_bundle');
  // Multi-step guest skip history: each entry is the alternate index that was
  // visible BEFORE the skip (null = main bundle). Pushed on every guest skip,
  // popped by the back button to restore the previous guest card.
  const [guestSkipHistory, setGuestSkipHistory] = useState<Array<number | null>>([]);

  // ── Guest-local action state (session-only, no Supabase writes) ──
  // Card-scoped: keyed by `${date}|${context}|${heroId}|${brand}` so that
  // navigating to a different visible card does NOT inherit the prior
  // card's local star/lock visual state. Returning to the same card during
  // the same session restores the local state.
  const [guestStarredByKey, setGuestStarredByKey] = useState<Record<string, boolean>>({});
  const [guestLocked, setGuestLocked] = useState(false);
  // Frozen copy of activeGuestRender at the moment the guest lock engaged.
  // While guestLocked === true, visible guest JSX renders from this snapshot
  // so the scent decision (hero/layer/mood/tokens) cannot drift.
  const [lockedGuestSnapshot, setLockedGuestSnapshot] = useState<any | null>(null);
  const [guestStarFlash, setGuestStarFlash] = useState(false);
  const [guestLockFlash, setGuestLockFlash] = useState(false);
  const [guestUnlockFlash, setGuestUnlockFlash] = useState(false);

  // Reset guest state whenever the slot (date/context) or backend payload changes.
  useEffect(() => {
    guestRenderSourceRef.current = 'guest_main_bundle';
    setSelectedAlternateIdx(null);
    guestPrevMainStateRef.current = null;
    setGuestSkipHistory([]);
    setGuestLayerExpanded(false);
    setGuestLayerIdxByMood(DEFAULT_LAYER_INDEX_MAP);
    setGuestLocked(false);
    setLockedGuestSnapshot(null);
    const def = (oracle as any)?.main_bundle?.ui_default_mode ?? (oracle as any)?.ui_default_mode;
    const safeDef = (normalizeLayerMoodKey(def) ?? 'balance') as GuestModeKey;
    setGuestSelectedMood(safeDef);
  }, [selectedDate, selectedContext, (oracle as any)?.style_key, (oracle as any)?.main_bundle?.ui_default_mode, (oracle as any)?.ui_default_mode]);

  // ── Guest v5 contract guard + single derivation helper ──
  // activeGuestRender is the live guest resolver.
  // visibleGuestRender is the visible guest render source.
  // When guestLocked is true, visibleGuestRender reads from lockedGuestSnapshot
  // so the visible scent decision cannot drift.
  const activeGuestRender = useMemo(() => {
    if (!isGuestMode) return null;
    // Prefer the freshest payload — `oracle` (latest prop) before
    // `activeOracle` (state mirror) so guest tokens paint on the very first
    // render pass after hydration without needing a manual repaint/scroll.
    const o: any = oracle ?? activeOracle ?? {};
    // Accept v5 either via the explicit contract flag OR by structural
    // signature (main_bundle.hero present). This eliminates the hydration
    // race where the contract field arrives one tick after main_bundle.
    const isV5 = !!(o?.main_bundle?.hero) &&
      (o?.guest_mode_contract === 'guest_single_bundle_v3_mode_layers' || !!o?.main_bundle?.layer_modes);
    if (!isV5) return null;

    // PHASE 2 STALE PAYLOAD GUARD: if the v6 payload's requested_context or
    // wear_date does not match the current selection, treat it as stale and
    // do not render. The fetch-layer requestId guard already discards stale
    // responses; this is defense-in-depth at the render layer.
    const payloadCtx = o?.requested_context ?? o?.main_bundle?.requested_context ?? null;
    const payloadDate = o?.wear_date ?? o?.main_bundle?.wear_date ?? null;
    if (payloadCtx && payloadCtx !== selectedContext) return null;
    if (payloadDate && payloadDate !== selectedDate) return null;


    const resolved = resolveGuestCardVM(o, selectedAlternateIdx, {
      source: guestRenderSourceRef.current,
      selectedMood: guestSelectedMood,
      activeLayerIdx: guestActiveLayerIdx,
    });
    if (!resolved) return null;
    const normalizedActiveLayer = guestLayerToModeEntry(resolved.layer);
    const resolvedLayerTokens = resolveGuestLayerTokens(
      resolved.layer,
      resolved.hero,
      resolved.layerTokens,
    );
    return {
      contract: 'v5' as const,
      source: resolved.source,
      showModeRow: resolved.modeOrder.length > 0,
      modeOrder: resolved.modeOrder,
      selectedMode: resolved.selectedMode,
      activeLayerIndex: resolved.activeLayerIndex,
      selectedAlternateIndex: resolved.selectedAlternateIndex,
      activeHero: resolved.hero,
      activeHeroTokens: resolved.heroTokens,
      activeLayer: normalizedActiveLayer
        ? {
            ...normalizedActiveLayer,
            family: normalizedActiveLayer.family_key,
            tokens: resolvedLayerTokens,
          }
        : null,
      layerModes: resolved.layerModes,
      modeLayerStack: resolved.modeLayerStack,
      alternates: resolved.alternates,
      renderedFromFullBundle: resolved.renderedFromFullBundle,
      reasonChipLabel: resolved.reasonChipLabel,
      reasonChipExplanation: resolved.reasonChipExplanation,
    };
  }, [isGuestMode, oracle, activeOracle, selectedAlternateIdx, guestSelectedMood, guestActiveLayerIdx, selectedContext, selectedDate]);

  // Single authoritative guest lock boolean — used by every guest mutation handler.
  const isGuestLocked = isGuestMode && guestLocked;

  // Visible guest render: while locked, the JSX must render the frozen
  // snapshot. When unlocked (or no snapshot yet), fall back to the live
  // resolver. activeGuestRender remains the live source of truth.
  const visibleGuestRender =
    isGuestMode && guestLocked && lockedGuestSnapshot
      ? lockedGuestSnapshot
      : activeGuestRender;

  useEffect(() => {
    if (!isGuestMode || !visibleGuestRender?.activeHero) return;

    const heroId = visibleGuestRender.activeHero?.fragrance_id ?? visibleGuestRender.activeHero?.id ?? null;
    if (heroId && !fragranceDetailCacheRef.current.has(heroId)) {
      void fetchFragranceDetail(heroId);
    }

    const activeLayer = guestLayerToModeEntry(visibleGuestRender.activeLayer);
    if (activeLayer?.id && !fragranceDetailCacheRef.current.has(activeLayer.id)) {
      void fetchFragranceDetail(activeLayer.id);
    }
  }, [isGuestMode, visibleGuestRender, fetchFragranceDetail, fragranceDetailVersion]);

  useEffect(() => {
    guestModeHistoryRef.current = guestModeHistory;
  }, [guestModeHistory]);

  useEffect(() => {
    signedInModeHistoryRef.current = signedInModeHistory;
  }, [signedInModeHistory]);

  const guestModeHistoryScopeKey = useMemo(() => {
    const guestCardId = visibleGuestRender?.activeHero?.fragrance_id ?? visibleGuestRender?.activeHero?.id ?? 'none';
    return `${selectedDate}|${selectedContext}|guest|${selectedAlternateIdx ?? 'main'}|${guestCardId}`;
  }, [selectedDate, selectedContext, selectedAlternateIdx, visibleGuestRender?.activeHero?.fragrance_id, visibleGuestRender?.activeHero?.id]);

  const signedInModeHistoryScopeKey = useMemo(() => {
    const currentCardId = visibleCard?.fragrance_id ?? 'none';
    return `${selectedDate}|${selectedContext}|signed_in|${currentCardId}|${promotedAltId ?? 'base'}`;
  }, [selectedDate, selectedContext, visibleCard?.fragrance_id, promotedAltId]);

  const guestModeHistoryScopeRef = useRef<string>('');
  const signedInModeHistoryScopeRef = useRef<string>('');

  useEffect(() => {
    if (!isGuestMode) {
      if (guestModeHistoryRef.current.length > 0) {
        guestModeHistoryRef.current = [];
        setGuestModeHistory([]);
      }
      guestModeHistoryScopeRef.current = '';
      return;
    }
    if (guestModeHistoryScopeRef.current === guestModeHistoryScopeKey) return;
    guestModeHistoryScopeRef.current = guestModeHistoryScopeKey;
    guestModeHistoryRef.current = [];
    setGuestModeHistory([]);
  }, [isGuestMode, guestModeHistoryScopeKey]);

  useEffect(() => {
    if (isGuestMode) {
      if (signedInModeHistoryRef.current.length > 0) {
        signedInModeHistoryRef.current = [];
        setSignedInModeHistory([]);
      }
      signedInModeHistoryScopeRef.current = '';
      return;
    }
    if (signedInModeHistoryScopeRef.current === signedInModeHistoryScopeKey) return;
    signedInModeHistoryScopeRef.current = signedInModeHistoryScopeKey;
    signedInModeHistoryRef.current = [];
    setSignedInModeHistory([]);
  }, [isGuestMode, signedInModeHistoryScopeKey]);

  // Guest mode-row tap: different mode → switch + reset idx; same mode → cycle.
  const handleGuestModeTap = useCallback((mode: GuestModeKey) => {
    if (isGuestLocked) return;
    const o: any = oracle ?? activeOracle ?? {};
    const resolved = resolveGuestCardVM(o, selectedAlternateIdx, {
      source: guestRenderSourceRef.current,
      selectedMood: mode,
      activeLayerIdx: guestLayerIdxByMood[mode] ?? 0,
    });
    const modeBlock = getNormalizedLayerModeBlock(resolved?.layerModes ?? null, mode);
    const stack = layerModeBlockToStack(modeBlock);
    if (stack.length === 0) return;
    if (mode !== guestSelectedMood) {
      const nextHistory = [
        ...guestModeHistoryRef.current,
        { mood: guestSelectedMood, layerIndex: guestActiveLayerIdx },
      ];
      guestModeHistoryRef.current = nextHistory;
      setGuestModeHistory(nextHistory);
      setGuestSelectedMood(mode);
      setGuestLayerIdxByMood((prev) => {
        const nextIndex = prev[mode] ?? 0;
        const safeIndex = nextIndex >= 0 && nextIndex < stack.length ? nextIndex : 0;
        if (safeIndex === nextIndex) return prev;
        return { ...prev, [mode]: safeIndex };
      });
    } else {
      // cycle within current mode using backend layers.length (no hard-coded N)
      setGuestLayerIdxByMood((prev) => ({
        ...prev,
        [mode]: ((prev[mode] ?? 0) + 1) % stack.length,
      }));
    }
  }, [oracle, activeOracle, guestSelectedMood, guestActiveLayerIdx, guestLayerIdxByMood, selectedAlternateIdx, isGuestLocked]);

  const handleGuestNextLocal = useCallback(async (): Promise<'advanced' | 'locked' | 'unavailable'> => {
    if (isGuestLocked) return 'locked';

    const o: any = oracle ?? activeOracle ?? {};
    const altBundles: any[] = Array.isArray(o?.alternate_bundles) ? o.alternate_bundles : [];
    if (altBundles.length === 0) {
      return 'unavailable';
    }

    setSkipAnimating(true);
    window.setTimeout(() => setSkipAnimating(false), 350);

    const current = selectedAlternateIdx;
    const nextIdx = current === null ? 0 : (current + 1) % altBundles.length;
    setGuestSkipHistory((history) => [...history, current]);
    guestRenderSourceRef.current = 'guest_skip_target';
    setSelectedAlternateIdx(nextIdx);
    guestPrevMainStateRef.current = null;
    haptic('selection');

    return 'advanced';
  }, [isGuestLocked, oracle, activeOracle, selectedAlternateIdx]);

  // Guest alternate tap: PHASE 2 — promotion model matches signed-in.
  // Tapping an alternate promotes it to hero. Tapping the SAME (already-active)
  // alternate is a no-op (no toggle-off). Use the back arrow to undo.
  const handleGuestAlternateTap = useCallback((idx: number) => {
    if (isGuestLocked) return;
    if (selectedAlternateIdx === idx) {
      // Active alternate tapped again → no-op (matches main Odara behavior).
      return;
    }
    // Snapshot main state once (only if not already in alternate state)
    if (selectedAlternateIdx === null) {
      guestPrevMainStateRef.current = { mood: guestSelectedMood, idx: guestActiveLayerIdx };
    }
    guestRenderSourceRef.current = 'guest_selected_alternate';
    setSelectedAlternateIdx(idx);
    setGuestLayerExpanded(true);
    haptic('selection');
  }, [selectedAlternateIdx, guestSelectedMood, guestActiveLayerIdx, isGuestLocked]);

  // Guest back-button unwind: skip-history → alternate → mode-depth → normal back
  const handleGuestBack = useCallback((): boolean => {
    if (!isGuestMode) return false;
    if (isGuestLocked) return true;
    // 1. Skip-history rewind takes priority — walks back through every skipped guest card.
    if (guestSkipHistory.length > 0) {
      const prevIdx = guestSkipHistory[guestSkipHistory.length - 1];
      const o: any = (oracle ?? activeOracle ?? {});
      const altBundles: any[] = Array.isArray(o?.alternate_bundles) ? o.alternate_bundles : [];
      const beforeName =
        selectedAlternateIdx === null
          ? (o?.main_bundle?.hero?.name ?? null)
          : (altBundles[selectedAlternateIdx]?.hero?.name ?? null);
      const restoredName =
        prevIdx === null
          ? (o?.main_bundle?.hero?.name ?? null)
          : (altBundles[prevIdx]?.hero?.name ?? null);
      const lengthBefore = guestSkipHistory.length;
      setGuestSkipHistory((h) => h.slice(0, -1));
      guestRenderSourceRef.current = 'guest_back_restore';
      setSelectedAlternateIdx(prevIdx);
      // Reset alternate snapshot since we're walking the skip stack, not unwinding a tap.
      guestPrevMainStateRef.current = null;
      console.info('ODARA_GUEST_BACK_PROOF', {
        actionTaken: 'guest_back_skip',
        previousCardName: beforeName,
        restoredCardName: restoredName,
        guestHistoryLengthBefore: lengthBefore,
        guestHistoryLengthAfter: lengthBefore - 1,
      });
      return true;
    }
    if (selectedAlternateIdx !== null) {
      const prev = guestPrevMainStateRef.current;
      if (prev) {
        setGuestSelectedMood(prev.mood);
        setGuestLayerIdxByMood((current) => ({ ...current, [prev.mood]: prev.idx }));
      }
      guestPrevMainStateRef.current = null;
      guestRenderSourceRef.current = 'guest_main_bundle';
      setSelectedAlternateIdx(null);
      return true; // consumed
    }
    if (guestActiveLayerIdx > 0) {
      setGuestLayerIdxByMood((current) => ({
        ...current,
        [guestSelectedMood]: Math.max(0, (current[guestSelectedMood] ?? 0) - 1),
      }));
      return true; // consumed
    }
    return false; // let normal back run
  }, [isGuestMode, selectedAlternateIdx, guestActiveLayerIdx, guestSelectedMood, guestSkipHistory, oracle, activeOracle, isGuestLocked]);

  // Lock + carryover state — persisted per signed-in calendar day
  const [signedInDayStateMap, setSignedInDayStateMap] = useState<SignedInDayStateMap>({});
  const [signedInForcedLayerCarryCard, setSignedInForcedLayerCarryCard] = useState<DisplayCard | null>(null);
  const [signedInResolvedDayDecisionSource, setSignedInResolvedDayDecisionSource] = useState<SignedInResolvedDayDecision['source']>('oracle');
  const currentDateKey = selectedDate;
  const previousDateKey = useMemo(() => getPreviousDateKey(selectedDate), [selectedDate]);
  const currentDayStateKey = useMemo(
    () => buildSignedInDayStateSlotKey(currentDateKey, selectedContext),
    [currentDateKey, selectedContext],
  );
  const previousDayStateKey = useMemo(
    () => buildSignedInDayStateSlotKey(previousDateKey, selectedContext),
    [previousDateKey, selectedContext],
  );
  const currentWeekDateKeys = useMemo(() => currentWeekDays.map((fd) => fd.dateStr), [currentWeekDays]);
  const visibleWeekDateKeys = currentWeekDateKeys;
  const visibleWeekDateKeysKey = useMemo(() => visibleWeekDateKeys.join('|'), [visibleWeekDateKeys]);
  const signedInWeekHydrationDateKeys = useMemo(() => {
    if (visibleWeekDateKeys.length === 0) return [];
    return Array.from(new Set([getPreviousDateKey(visibleWeekDateKeys[0]), ...visibleWeekDateKeys]));
  }, [visibleWeekDateKeys]);
  const signedInWeekHydrationDateKeysKey = useMemo(
    () => signedInWeekHydrationDateKeys.join('|'),
    [signedInWeekHydrationDateKeys]
  );
  const signedInWeekMemoryScopeKey = isGuestMode ? 'guest' : `${userId}|${selectedContext}|${signedInWeekHydrationDateKeysKey}`;
  const hasStoredSignedInDayState = Object.prototype.hasOwnProperty.call(signedInDayStateMap, currentDayStateKey);
  const signedInDayState = signedInDayStateMap[currentDayStateKey] ?? createDefaultSignedInDayState();
  const signedInPreviousDayState = signedInDayStateMap[previousDayStateKey] ?? createDefaultSignedInDayState();
  const signedInVerifiedPredecessorBaton = useMemo(() => {
    if (isGuestMode) return null;
    if (signedInResolvedDayDecisionSource !== 'carryover-main' && signedInResolvedDayDecisionSource !== 'carryover-layer') {
      return null;
    }
    return resolveVerifiedPredecessorBaton(signedInPreviousDayState, currentDateKey, selectedContext);
  }, [currentDateKey, isGuestMode, selectedContext, signedInResolvedDayDecisionSource, signedInPreviousDayState]);
  const signedInResolvedLockTruth = useMemo(
    () => (isGuestMode ? null : resolveSignedInLockedTruth(signedInDayState)),
    [isGuestMode, signedInDayState]
  );
  const signedInManualPreviewActive = !isGuestMode
    && (!!signedInDayState.manualHeroCard || !!signedInDayState.manualLayerCard);
  const signedInSearchPreviewSnapshotActive = !isGuestMode
    && !!signedInSearchPreviewSnapshotRef.current[currentDayStateKey];
  const signedInSelectedDayIsPast = !isGuestMode && currentDateKey < todayDateKey;
  const signedInSearchPreviewLocked = !isGuestMode && (
    signedInDayState.lockState === 'locked'
    || signedInResolvedDayDecisionSource === 'locked'
    || !!signedInResolvedLockTruth
  );
  const signedInIsReadOnlyHistoryCard = signedInSelectedDayIsPast;
  const signedInDisabledMoodReasons = useMemo(() => {
    if (isGuestMode) return undefined;

    const reasons: Partial<Record<LayerMood, string>> = {
      wild: 'Wild is being tuned.',
    };

    const signedInModeReadOnlyReason = signedInSelectedDayIsPast
      ? 'Past days are read-only'
      : null;
    const signedInModeLockedReason = signedInSearchPreviewLocked
      ? 'Unlock to adjust'
      : null;

    if (signedInModeReadOnlyReason) {
      reasons.balance = signedInModeReadOnlyReason;
      reasons.bold = signedInModeReadOnlyReason;
      reasons.smooth = signedInModeReadOnlyReason;
    } else if (signedInModeLockedReason) {
      reasons.balance = signedInModeLockedReason;
      reasons.bold = signedInModeLockedReason;
      reasons.smooth = signedInModeLockedReason;
    }

    return reasons;
  }, [isGuestMode, signedInSearchPreviewLocked, signedInSelectedDayIsPast]);
  const signedInSearchPreviewDisabledReason = useMemo(() => {
    if (isGuestMode) return null;
    if (signedInSelectedDayIsPast) return 'Past days are read-only';
    if (signedInSearchPreviewLocked) {
      return 'Unlock to preview';
    }
    return null;
  }, [
    isGuestMode,
    signedInSearchPreviewLocked,
    signedInSelectedDayIsPast,
  ]);
  const lockState: LockState = signedInDayState.lockState;
  const persistedSignedInDayStateRef = useRef<Record<string, string | null>>({});
  const signedInWeekMemoryRequestIdRef = useRef(0);
  const signedInHistoryMemoryRequestIdRef = useRef(0);
  const signedInWeekMemoryWriteTimeoutRef = useRef<number | null>(null);
  const [signedInWeekMemoryReadyScopeKey, setSignedInWeekMemoryReadyScopeKey] = useState<string>(isGuestMode ? 'guest' : '');
  const signedInWeekMemoryReady = isGuestMode || signedInWeekMemoryReadyScopeKey === signedInWeekMemoryScopeKey;
  const [signedInHistoryMemoryReadyScopeKey, setSignedInHistoryMemoryReadyScopeKey] = useState<string>(isGuestMode ? 'guest' : '');
  const signedInHistoryMemoryScopeKey = isGuestMode ? 'guest' : `${userId}|${selectedContext}|${currentWeekStartDateKey}`;
  const signedInHistoryMemoryReady = isGuestMode || signedInHistoryMemoryReadyScopeKey === signedInHistoryMemoryScopeKey;
  const selectedDateNeedsHistoryMemory = !isGuestMode && currentDateKey < currentWeekStartDateKey;
  const signedInResolvedMemoryReady = isGuestMode
    || (signedInWeekMemoryReady && (!selectedDateNeedsHistoryMemory || signedInHistoryMemoryReady));
  const setLockState = useCallback((ls: LockState) => {
    setSignedInDayStateMap(prev => {
      const current = prev[currentDayStateKey] ?? createDefaultSignedInDayState();
      const next: SignedInDayState = ls === 'locked'
        ? { ...current, lockState: ls }
        : {
            ...current,
            lockState: ls,
            lockedCard: null,
            lockedLayerCard: null,
            lockedLayerMode: null,
            lockedResolvedCurrentCard: null,
            lockedContext: null,
            lockedMood: 'balance',
            lockedPromotedAltId: null,
          };
      if (
        current.lockState === next.lockState &&
        current.lockedCard === next.lockedCard &&
        current.lockedLayerCard === next.lockedLayerCard &&
        current.lockedLayerMode === next.lockedLayerMode &&
        current.lockedResolvedCurrentCard === next.lockedResolvedCurrentCard &&
        current.lockedContext === next.lockedContext &&
        current.lockedMood === next.lockedMood &&
        current.lockedPromotedAltId === next.lockedPromotedAltId
      ) {
        return prev;
      }
      return { ...prev, [currentDayStateKey]: next };
    });
  }, [currentDayStateKey]);

  const [lockPulse, setLockPulse] = useState(false);
  const [lockPulseType, setLockPulseType] = useState<'lock' | 'unlock' | null>(null);
  const lockPulseTimeoutRef = useRef<number | null>(null);
  const [unlockFlash, setUnlockFlash] = useState(false);
  const [lockFlash, setLockFlash] = useState(false);
  const [likeFlash, setLikeFlash] = useState(false);
  const [skipAnimating, setSkipAnimating] = useState(false);

  // Locked selections for weekly lanes
  const [lockedSelections, setLockedSelections] = useState<LockedSelectionsMap>({});

  // Signed-in action-state hydration comes from durable backend preference
  // stores. Guest remains local/session-only and read-only for durable writes.
  const [signedInFavoriteByFragranceId, setSignedInFavoriteByFragranceId] = useState<Record<string, boolean>>({});
  const [signedInHeartStateByFragranceId, setSignedInHeartStateByFragranceId] = useState<Record<string, HeartState>>({});
  const [favoriteWritePendingByFragranceId, setFavoriteWritePendingByFragranceId] = useState<Record<string, boolean>>({});
  const [heartWritePendingByFragranceId, setHeartWritePendingByFragranceId] = useState<Record<string, boolean>>({});
  // Guest heart state remains local/session-only. Per-card key
  // (date|context|heroId).
  // 0 = empty, 1 = liked (single heart), 2 = loved (double heart).
  const [heartStateByKey, setHeartStateByKey] = useState<Record<string, 0 | 1 | 2>>({});
  const [heartFlash, setHeartFlash] = useState(false);
  // Micro-label triggers for the bottom action row (Favorite / Daisy Chain).
  // Heart manages its own label inside HeartReactionButton.
  const [favoriteLabelTick, setFavoriteLabelTick] = useState(0);
  const [favoriteLabelText, setFavoriteLabelText] = useState<string | null>(null);
  const [daisyLabelTick, setDaisyLabelTick] = useState(0);
  const [daisyLabelText, setDaisyLabelText] = useState<string | null>(null);
  const [nextLabelTick, setNextLabelTick] = useState(0);
  const [nextLabelText, setNextLabelText] = useState<string | null>(null);
  const favoriteButtonRef = useRef<HTMLButtonElement | null>(null);
  const daisyButtonRef = useRef<HTMLButtonElement | null>(null);
  const nextButtonRef = useRef<HTMLButtonElement | null>(null);
  const signedInActionFragranceId = visibleCard?.fragrance_id ?? null;
  const signedInFavoriteActive = !isGuestMode
    && !!signedInActionFragranceId
    && !!signedInFavoriteByFragranceId[signedInActionFragranceId];
  const signedInHeartState = !isGuestMode && signedInActionFragranceId
    ? (signedInHeartStateByFragranceId[signedInActionFragranceId] ?? 0)
    : 0;
  const signedInFavoritePending = !isGuestMode
    && !!signedInActionFragranceId
    && !!favoriteWritePendingByFragranceId[signedInActionFragranceId];
  const signedInHeartPending = !isGuestMode
    && !!signedInActionFragranceId
    && !!heartWritePendingByFragranceId[signedInActionFragranceId];
  const signedInCarryoverOrigin = signedInDayState.carryoverOrigin;
  const [signedInCarryoverPulseTarget, setSignedInCarryoverPulseTarget] = useState<Exclude<SignedInCarryoverTarget, 'off'> | null>(null);
  const [signedInCarryoverCloseFlash, setSignedInCarryoverCloseFlash] = useState(false);
  const signedInLockedLaneByDate = useMemo(() => {
    if (isGuestMode) return {} as Record<string, Record<string, { mainColor: string; layerColor: string | null }>>;

    const next: Record<string, Record<string, { mainColor: string; layerColor: string | null }>> = {};

    for (const [slotKey, dayState] of Object.entries(signedInDayStateMap)) {
      const lockTruth = resolveSignedInLockedTruth(dayState);
      if (!lockTruth) continue;

      const { dateKey, contextKey } = parseSignedInDayStateSlotKey(slotKey);
      if (!dateKey) continue;

      const mainColor = lockTruth.lockedCard.family
        ? (FAMILY_COLORS[lockTruth.lockedCard.family] ?? '#888')
        : '#888';
      const layerColor = lockTruth.lockedLayerCard?.family
        ? (FAMILY_COLORS[lockTruth.lockedLayerCard.family] ?? '#888')
        : null;

      if (!next[dateKey]) next[dateKey] = {};
      next[dateKey][contextKey] = { mainColor, layerColor };
    }

    return next;
  }, [isGuestMode, signedInDayStateMap]);
  const updateSignedInDayState = useCallback((
    key: string,
    updater: (current: SignedInDayState) => SignedInDayState,
  ) => {
    setSignedInDayStateMap(prev => {
      const current = prev[key] ?? createDefaultSignedInDayState();
      const next = updater(current);
      if (
        current.lockState === next.lockState &&
        current.daisyChainEnabled === next.daisyChainEnabled &&
        current.carryoverMode === next.carryoverMode &&
        current.carryoverOrigin === next.carryoverOrigin &&
        current.carryoverNextDayRole === next.carryoverNextDayRole &&
        current.carryoverSourceDateKey === next.carryoverSourceDateKey &&
        current.carryoverTargetDateKey === next.carryoverTargetDateKey &&
        current.carryoverContextKey === next.carryoverContextKey &&
        current.lockedContext === next.lockedContext &&
        current.lockedMood === next.lockedMood &&
        current.lockedPromotedAltId === next.lockedPromotedAltId &&
        areSameDisplayCards(current.carryoverSelectedCard, next.carryoverSelectedCard) &&
        areSameDisplayCards(current.resolvedHeroCard, next.resolvedHeroCard) &&
        areSameDisplayCards(current.resolvedLayerCard, next.resolvedLayerCard) &&
        areSameDisplayCards(current.carryoverHeroCard, next.carryoverHeroCard) &&
        areSameDisplayCards(current.carryoverLayerCard, next.carryoverLayerCard) &&
        areSameDisplayCards(current.lockedCard, next.lockedCard) &&
        areSameDisplayCards(current.lockedLayerCard, next.lockedLayerCard) &&
        areSameLayerModeSnapshots(current.lockedLayerMode, next.lockedLayerMode) &&
        areSameResolvedCurrentCardSnapshots(current.lockedResolvedCurrentCard, next.lockedResolvedCurrentCard) &&
        areSameDisplayCards(current.manualHeroCard, next.manualHeroCard) &&
        areSameDisplayCards(current.manualLayerCard, next.manualLayerCard) &&
        areSamePreferenceMoments(current.preferenceMoments, next.preferenceMoments)
      ) {
        return prev;
      }
      return { ...prev, [key]: next };
    });
  }, []);

  const captureSignedInPreferenceMoment = useCallback((payload: {
    preference_state: PersistedPreferenceMomentState;
    source: string;
    main: {
      fragrance_id?: string | null;
      name?: string | null;
      brand?: string | null;
      family_key?: string | null;
      image_url?: string | null;
    };
    layer?: {
      fragrance_id?: string | null;
      name?: string | null;
      brand?: string | null;
      family_key?: string | null;
      image_url?: string | null;
    } | null;
  }) => {
    if (isGuestMode || !userId) return;
    const preferenceState = normalizePersistedPreferenceMomentState(payload.preference_state);
    const main = buildPreferenceMomentFragranceSnapshot(payload.main);
    const layer = buildPreferenceMomentFragranceSnapshot(payload.layer ?? null);
    if (!preferenceState || !main) return;

    const nextMoment: PersistedPreferenceMoment = {
      fragrance_id: main.fragrance_id,
      preference_state: preferenceState,
      source: readTrimmedLayerText(payload.source) || null,
      created_at: new Date().toISOString(),
      context_key: normalizePersistedContextKey(selectedContext),
      date_key: selectedDate,
      mode: null,
      main,
      layer,
    };

    updateSignedInDayState(currentDayStateKey, (current) => ({
      ...current,
      preferenceMoments: upsertPreferenceMoment(current.preferenceMoments, nextMoment),
    }));
  }, [currentDayStateKey, isGuestMode, selectedContext, selectedDate, updateSignedInDayState, userId]);

  const clearLockedSelection = useCallback(() => {
    const key = `${selectedDate}:${selectedContext}`;
    setLockedSelections(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, [selectedDate, selectedContext]);

  const clearSignedInSearchPreviewSnapshot = useCallback((slotKey: string) => {
    delete signedInSearchPreviewSnapshotRef.current[slotKey];
  }, []);

  const captureSignedInSearchPreviewSnapshot = useCallback((slotKey: string) => {
    if (isGuestMode || signedInSearchPreviewSnapshotRef.current[slotKey]) return;
    signedInSearchPreviewSnapshotRef.current[slotKey] = {
      visibleCard,
      forcedLayerCarryCard: signedInForcedLayerCarryCard,
      selectedMood: betaSafeSignedInMood,
      layerIdxByMood: { ...signedInLayerIdxByMoodRef.current },
      promotedAltId,
      resolvedDayDecisionSource: signedInResolvedDayDecisionSource,
      alternates: [...currentCardAlternates],
      alternatesOwnerId: currentCardAlternatesOwnerId,
    };
  }, [
    betaSafeSignedInMood,
    currentCardAlternates,
    currentCardAlternatesOwnerId,
    isGuestMode,
    promotedAltId,
    signedInForcedLayerCarryCard,
    signedInResolvedDayDecisionSource,
    visibleCard,
  ]);

  const restoreSignedInSearchPreviewSnapshot = useCallback((snapshot: SignedInSearchPreviewSnapshot | null) => {
    if (!snapshot) return;
    setVisibleCard(snapshot.visibleCard);
    setSignedInForcedLayerCarryCard(snapshot.forcedLayerCarryCard);
    setSignedInResolvedDayDecisionSource(snapshot.resolvedDayDecisionSource);
    setPromotedAltId(snapshot.promotedAltId);
    setSelectedMood(getBetaSafeLayerMood(snapshot.selectedMood));
    setSignedInLayerIdxByMood({ ...snapshot.layerIdxByMood });
    signedInModeHistoryRef.current = [];
    setSignedInModeHistory([]);
    setLayerExpanded(false);
    setLockState('neutral');
    clearLockedSelection();
    setCurrentCardAlternates([...snapshot.alternates]);
    setCurrentCardAlternatesOwnerId(snapshot.alternatesOwnerId);
  }, [clearLockedSelection, getBetaSafeLayerMood, setLockState]);

  useEffect(() => {
    return () => {
      if (signedInWeekMemoryWriteTimeoutRef.current !== null) {
        window.clearTimeout(signedInWeekMemoryWriteTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (signedInWeekMemoryWriteTimeoutRef.current !== null) {
      window.clearTimeout(signedInWeekMemoryWriteTimeoutRef.current);
      signedInWeekMemoryWriteTimeoutRef.current = null;
    }

    persistedSignedInDayStateRef.current = {};
    signedInSearchPreviewSnapshotRef.current = {};
    setSignedInDayStateMap((current) => (Object.keys(current).length === 0 ? current : {}));
    setSignedInLockedHistoryDateKeys((current) => (current.length === 0 ? current : []));
    setSignedInWeekMemoryReadyScopeKey(isGuestMode ? 'guest' : '');
    setSignedInHistoryMemoryReadyScopeKey(isGuestMode ? 'guest' : '');
  }, [isGuestMode, userId]);

  useEffect(() => {
    if (isGuestMode || !userId) {
      setSignedInFavoriteByFragranceId((current) => (Object.keys(current).length === 0 ? current : {}));
      setSignedInHeartStateByFragranceId((current) => (Object.keys(current).length === 0 ? current : {}));
      setFavoriteWritePendingByFragranceId((current) => (Object.keys(current).length === 0 ? current : {}));
      setHeartWritePendingByFragranceId((current) => (Object.keys(current).length === 0 ? current : {}));
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await odaraSupabase.rpc('get_user_collection_preferences_v1' as any, {
          p_user_id: userId,
        } as any);

        if (cancelled) return;
        if (error) throw error;

        const normalized = normalizeCollectionPayload((data ?? null) as OdaraCollectionPayload | null);
        const nextFavorites: Record<string, boolean> = {};
        const nextHeartStates: Record<string, HeartState> = {};

        for (const item of normalized?.items ?? []) {
          if (!item.fragrance_id) continue;
          nextFavorites[item.fragrance_id] = Boolean(item.favorite ?? item.wear_more);
          nextHeartStates[item.fragrance_id] = preferenceStateToHeartState(item.preference_state);
        }

        setSignedInFavoriteByFragranceId(nextFavorites);
        setSignedInHeartStateByFragranceId(nextHeartStates);
      } catch (error) {
        if (!cancelled) {
          console.error('[Odara] signed-in action-state hydrate failed', error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isGuestMode, userId]);

  useEffect(() => {
    if (isGuestMode) {
      setSignedInWeekMemoryReadyScopeKey('guest');
      return;
    }

    if (!userId || signedInWeekHydrationDateKeys.length === 0) {
      setSignedInWeekMemoryReadyScopeKey('');
      return;
    }

    const requestId = signedInWeekMemoryRequestIdRef.current + 1;
    signedInWeekMemoryRequestIdRef.current = requestId;
    setSignedInWeekMemoryReadyScopeKey('');

    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await odaraSupabase
          .from(ODARA_SIGNED_IN_DAY_MEMORY_TABLE as any)
          .select('date_key, context_key, state_json, updated_at')
          .eq('user_id', userId)
          .eq('context_key', normalizePersistedContextKey(selectedContext))
          .in('date_key', signedInWeekHydrationDateKeys);

        if (cancelled || signedInWeekMemoryRequestIdRef.current !== requestId) return;
        if (error) {
          throw error;
        }

        const loadedStates: SignedInDayStateMap = {};
        const persistedEntries: Record<string, string | null> = {};
        for (const dateKey of signedInWeekHydrationDateKeys) {
          persistedEntries[buildSignedInDayStateSlotKey(dateKey, selectedContext)] = null;
        }

        for (const row of Array.isArray(data) ? data : []) {
          const dateKey = typeof row?.date_key === 'string' ? row.date_key : '';
          const contextKey = normalizePersistedContextKey(row?.context_key);
          const slotKey = buildSignedInDayStateSlotKey(dateKey, contextKey);
          if (!dateKey) continue;
          const state = deserializeSignedInDayStateFromStorage(row?.state_json);
          loadedStates[slotKey] = state;
          persistedEntries[slotKey] = stableSerializeSignedInDayState(state);
        }

        persistedSignedInDayStateRef.current = {
          ...persistedSignedInDayStateRef.current,
          ...persistedEntries,
        };

        setSignedInDayStateMap((prev) => {
          let changed = false;
          const next = { ...prev };

          for (const dateKey of signedInWeekHydrationDateKeys) {
            const slotKey = buildSignedInDayStateSlotKey(dateKey, selectedContext);
            const loaded = loadedStates[slotKey];
            if (!loaded) continue;

            const existing = prev[slotKey];
            if (hasHydratedRuntimeSignedInDayState(existing)) {
              continue;
            }

            const serializedLoaded = stableSerializeSignedInDayState(loaded);
            const serializedExisting = existing ? stableSerializeSignedInDayState(existing) : null;
            if (serializedExisting === serializedLoaded) continue;

            next[slotKey] = loaded;
            changed = true;
          }

          return changed ? next : prev;
        });
      } catch (error) {
        if (cancelled || signedInWeekMemoryRequestIdRef.current !== requestId) return;
        console.error('[Odara] signed-in week memory hydrate failed', error);
        const clearedEntries: Record<string, string | null> = {};
        for (const dateKey of signedInWeekHydrationDateKeys) {
          clearedEntries[buildSignedInDayStateSlotKey(dateKey, selectedContext)] = null;
        }
        persistedSignedInDayStateRef.current = {
          ...persistedSignedInDayStateRef.current,
          ...clearedEntries,
        };
      } finally {
        if (!cancelled && signedInWeekMemoryRequestIdRef.current === requestId) {
          setSignedInWeekMemoryReadyScopeKey(signedInWeekMemoryScopeKey);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isGuestMode,
    userId,
    selectedContext,
    signedInWeekHydrationDateKeysKey,
    signedInWeekMemoryScopeKey,
  ]);

  useEffect(() => {
    if (isGuestMode) {
      setSignedInLockedHistoryDateKeys((current) => (current.length === 0 ? current : []));
      setSignedInHistoryMemoryReadyScopeKey('guest');
      return;
    }

    if (!userId) {
      setSignedInLockedHistoryDateKeys((current) => (current.length === 0 ? current : []));
      setSignedInHistoryMemoryReadyScopeKey('');
      return;
    }

    const requestId = signedInHistoryMemoryRequestIdRef.current + 1;
    signedInHistoryMemoryRequestIdRef.current = requestId;
    setSignedInHistoryMemoryReadyScopeKey('');

    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await odaraSupabase
          .from(ODARA_SIGNED_IN_DAY_MEMORY_TABLE as any)
          .select('date_key, context_key, state_json, updated_at')
          .eq('user_id', userId)
          .eq('context_key', normalizePersistedContextKey(selectedContext))
          .lt('date_key', currentWeekStartDateKey);

        if (cancelled || signedInHistoryMemoryRequestIdRef.current !== requestId) return;
        if (error) throw error;

        const loadedStates: SignedInDayStateMap = {};
        const lockedHistoryKeys: string[] = [];
        const persistedEntries: Record<string, string | null> = {};

        for (const row of Array.isArray(data) ? data : []) {
          const dateKey = typeof row?.date_key === 'string' ? row.date_key : '';
          const contextKey = normalizePersistedContextKey(row?.context_key);
          const slotKey = buildSignedInDayStateSlotKey(dateKey, contextKey);
          if (!dateKey) continue;
          const state = deserializeSignedInDayStateFromStorage(row?.state_json);
          const lockTruth = resolveSignedInLockedTruth(state);
          if (!lockTruth) continue;
          loadedStates[slotKey] = state;
          lockedHistoryKeys.push(dateKey);
          persistedEntries[slotKey] = stableSerializeSignedInDayState(state);
        }

        persistedSignedInDayStateRef.current = {
          ...persistedSignedInDayStateRef.current,
          ...persistedEntries,
        };

        const sortedLockedHistoryKeys = lockedHistoryKeys.sort((a, b) => a.localeCompare(b));
        setSignedInLockedHistoryDateKeys((current) => (
          areSameStringLists(current, sortedLockedHistoryKeys) ? current : sortedLockedHistoryKeys
        ));
        setSignedInDayStateMap((prev) => {
          let changed = false;
          const next = { ...prev };

          for (const [slotKey, loaded] of Object.entries(loadedStates)) {
            const serializedLoaded = stableSerializeSignedInDayState(loaded);
            const existing = prev[slotKey];
            const serializedExisting = existing ? stableSerializeSignedInDayState(existing) : null;
            if (serializedExisting === serializedLoaded) continue;
            next[slotKey] = loaded;
            changed = true;
          }

          return changed ? next : prev;
        });
      } catch (error) {
        if (cancelled || signedInHistoryMemoryRequestIdRef.current !== requestId) return;
        console.error('[Odara] signed-in locked history hydrate failed', error);
        setSignedInLockedHistoryDateKeys([]);
      } finally {
        if (!cancelled && signedInHistoryMemoryRequestIdRef.current === requestId) {
          setSignedInHistoryMemoryReadyScopeKey(signedInHistoryMemoryScopeKey);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isGuestMode,
    userId,
    selectedContext,
    currentWeekStartDateKey,
    signedInHistoryMemoryScopeKey,
  ]);

  useEffect(() => {
    if (isGuestMode || !userId || !signedInWeekMemoryReady || visibleWeekDateKeys.length === 0) {
      return;
    }

    const upsertRows: Array<{ dateKey: string; contextKey: string; slotKey: string; state: SignedInDayState; serialized: string }> = [];
    const deleteKeys: Array<{ dateKey: string; slotKey: string }> = [];
    const storageContextKey = normalizePersistedContextKey(selectedContext);

    for (const dateKey of visibleWeekDateKeys) {
      const slotKey = buildSignedInDayStateSlotKey(dateKey, selectedContext);
      const current = signedInDayStateMap[slotKey];
      const persistedSerialized = persistedSignedInDayStateRef.current[slotKey] ?? null;

      if (current && isPersistableSignedInDayState(current)) {
        const serialized = stableSerializeSignedInDayState(current);
        if (serialized !== persistedSerialized) {
          upsertRows.push({ dateKey, contextKey: storageContextKey, slotKey, state: current, serialized });
        }
      } else if (persistedSerialized !== null) {
        deleteKeys.push({ dateKey, slotKey });
      }
    }

    if (upsertRows.length === 0 && deleteKeys.length === 0) {
      return;
    }

    if (signedInWeekMemoryWriteTimeoutRef.current !== null) {
      window.clearTimeout(signedInWeekMemoryWriteTimeoutRef.current);
    }

    signedInWeekMemoryWriteTimeoutRef.current = window.setTimeout(async () => {
      const nextPersistedEntries: Record<string, string | null> = {};

      try {
        if (upsertRows.length > 0) {
          const { error } = await odaraSupabase
            .from(ODARA_SIGNED_IN_DAY_MEMORY_TABLE as any)
            .upsert(
              upsertRows.map(({ dateKey, state }) => ({
                context_key: storageContextKey,
                user_id: userId,
                date_key: dateKey,
                state_json: serializeSignedInDayStateForStorage(state),
                updated_at: new Date().toISOString(),
              })),
              { onConflict: 'user_id,date_key,context_key' }
            );

          if (error) throw error;

          for (const row of upsertRows) {
            nextPersistedEntries[row.slotKey] = row.serialized;
          }
        }

        if (deleteKeys.length > 0) {
          const { error } = await odaraSupabase
            .from(ODARA_SIGNED_IN_DAY_MEMORY_TABLE as any)
            .delete()
            .eq('user_id', userId)
            .eq('context_key', storageContextKey)
            .in('date_key', deleteKeys.map(({ dateKey }) => dateKey));

          if (error) throw error;

          for (const { slotKey } of deleteKeys) {
            nextPersistedEntries[slotKey] = null;
          }
        }

        persistedSignedInDayStateRef.current = {
          ...persistedSignedInDayStateRef.current,
          ...nextPersistedEntries,
        };
      } catch (error) {
        console.error('[Odara] signed-in week memory persist failed', error);
      } finally {
        signedInWeekMemoryWriteTimeoutRef.current = null;
      }
    }, 250);

    return () => {
      if (signedInWeekMemoryWriteTimeoutRef.current !== null) {
        window.clearTimeout(signedInWeekMemoryWriteTimeoutRef.current);
        signedInWeekMemoryWriteTimeoutRef.current = null;
      }
    };
  }, [
    isGuestMode,
    userId,
    signedInWeekMemoryReady,
    visibleWeekDateKeysKey,
    selectedContext,
    signedInDayStateMap,
  ]);

  // Hoisted above lazy mood fetcher and signed-in resolvers to avoid TDZ on
  // `signedInResolvedOracle` (previously declared later in render but read in
  // useCallback dependency arrays evaluated earlier).
  const signedInResolvedOracle = useMemo(() => {
    if (isGuestMode) return null;
    const candidate: any = activeOracle ?? oracle ?? null;
    if (!candidate) return null;
    return signedInOracleMatchesRequestedSlot(candidate, selectedContext, selectedDate)
      ? candidate
      : null;
  }, [isGuestMode, activeOracle, oracle, selectedContext, selectedDate]);

  // ── Lazy per-mood fetcher via get_layer_for_card_mode_v1 (slot-scoped) ──
  const fetchMoodForCard = useCallback(async (
    fragranceId: string,
    mood: LayerMood,
    isRetry = false,
    extraExcludeIds: string[] = [],
  ) => {
    if (isGuestMode) {
      odaraDebugLog('[Odara][Guest] mood fetch skipped (read-only)', { mood, fragranceId });
      return null;
    }
    const slotPrefix = `${selectedDate}|${selectedContext}`;
    const moodKey = buildMoodLaneKey(slotPrefix, fragranceId, mood);
    const cached = moodCacheRef.current.get(moodKey);
    if (cached !== undefined && !isRetry) {
      odaraDebugLog('[Odara] mood cache hit', moodKey);
      return cached;
    }

    // In-flight dedupe: reuse pending promise for same key
    const inFlight = moodInFlightRef.current.get(moodKey);
    if (inFlight && !isRetry) {
      odaraDebugLog('[Odara] mood in-flight reuse', moodKey);
      return inFlight;
    }

    odaraDebugLog('[Odara] mood cache miss', moodKey, isRetry ? '(retry)' : '');

    // Capture slot at launch for stale guard
    const capturedSlot = stateKey;

    // Keep exclusion scoped to this mood lane. The top-level oracle layer is
    // the seeded balance candidate, so do not exclude it from balance itself.
    const excludeIds: string[] = [];
    for (const existing of readMoodLaneStack(moodKey)) {
      if (existing?.layer_fragrance_id && !excludeIds.includes(existing.layer_fragrance_id)) {
        excludeIds.push(existing.layer_fragrance_id);
      }
    }
    const ol = activeOracle?.layer;
    const oracleLayerMood = normalizeLayerMoodKey(ol?.layer_mode ?? (ol as any)?.mode ?? (ol as any)?.interaction_type) ?? 'balance';
    if (ol?.fragrance_id && oracleLayerMood !== mood && !excludeIds.includes(ol.fragrance_id)) {
      excludeIds.push(ol.fragrance_id);
    }
    for (const extraId of extraExcludeIds) {
      if (extraId && !excludeIds.includes(extraId)) excludeIds.push(extraId);
    }

    const fetchPromise = (async (): Promise<BackendModeEntry | null> => {
      try {
        odaraDebugLog('[Odara] lazy mood fetch start', mood, fragranceId, 'slot', capturedSlot);
        setModeLoading(prev => ({ ...prev, [mood]: true }));
        setModeErrors(prev => ({ ...prev, [mood]: null }));
        setLayerDebugSource(`rpc:${mood}…`);
        const { data, error } = await odaraSupabase.rpc('get_layer_for_card_mode_v1' as any, {
          p_user: userId,
          p_fragrance_id: fragranceId,
          p_context: selectedContext,
          p_temperature: resolvedTemperature,
          p_brand: 'Alexandria Fragrances',
          p_wear_date: selectedDate,
          p_mode: mood,
          p_exclude_fragrance_ids: excludeIds.length > 0 ? excludeIds : undefined,
        });

        if (activeSlotRef.current !== capturedSlot) {
          odaraDebugLog('[Odara] ignoring stale mood result for old slot', capturedSlot, '→ current', activeSlotRef.current);
          return null;
        }

        if (error) {
          console.error('[Odara] lazy mood fetch fail', mood, error.message);
          // Fallback: if the home payload pre-seeded this mood block, hydrate
          // from there instead of surfacing a hard error to the user. This
          // keeps mode buttons functional even when the per-mode RPC is
          // unavailable on the backend.
          const hp: any = signedInResolvedOracle ?? {};
          const heroIdHp = hp?.today_pick?.fragrance_id ?? null;
          const seed: any = heroIdHp === fragranceId
            ? getNormalizedLayerModeBlock(hp?.layer_modes ?? null, mood)
            : null;
          const fbEntry = modeValueToBackendModeEntry(seed, mood);
          if (fbEntry) {
            if (!isRetry) {
              const seededStack = appendUniqueBackendModeEntries(readMoodLaneStack(moodKey), [fbEntry]);
              moodLaneStackRef.current.set(moodKey, seededStack);
            }
            moodCacheRef.current.set(moodKey, fbEntry);
            setModeErrors(prev => ({ ...prev, [mood]: null }));
            setLayerDebugSource(`fallback:${mood}`);
            setModeLoading(prev => ({ ...prev, [mood]: false }));
            setMoodCacheVersion(v => v + 1);
            odaraDebugLog('[Odara] mood RPC failed → seeded from home payload', mood);
            return fbEntry;
          }
          setModeErrors(prev => ({ ...prev, [mood]: error.message }));
          setLayerDebugSource(`err:${error.message}`);
          setModeLoading(prev => ({ ...prev, [mood]: false }));
          setMoodCacheVersion(v => v + 1);
          return null;
        }

        const row = Array.isArray(data) ? data[0] : data;
        if (!row || !row.layer_fragrance_id) {
          // Empty result — no layer available for this mode. Not an error, just empty.
          setLayerDebugSource(`rpc:${mood}(empty)`);
          setModeLoading(prev => ({ ...prev, [mood]: false }));
          setMoodCacheVersion(v => v + 1);
          return null;
        }

        const entry = modeValueToBackendModeEntry(row, mood);
        if (!entry) {
          setLayerDebugSource(`rpc:${mood}(empty)`);
          setModeLoading(prev => ({ ...prev, [mood]: false }));
          setMoodCacheVersion(v => v + 1);
          return null;
        }

        if (entry.layer_fragrance_id && !entry.layer_name) {
          const detail = await fetchFragranceDetail(entry.layer_fragrance_id);
          if (detail?.name) entry.layer_name = detail.name;
        }
        if (
          entry.layer_fragrance_id &&
          (
            !entry.layer_family ||
            !hasRenderableRailTokens(entry.layer_accords, entry.layer_notes)
          )
        ) {
          const detail = await fetchFragranceDetail(entry.layer_fragrance_id);
          if (detail) {
            if (!entry.layer_family) entry.layer_family = detail.family_key ?? '';
            const preferredRail = pickPreferredRailSource(
              entry.layer_accords,
              entry.layer_notes,
              detail.accords,
              detail.notes,
            );
            entry.layer_notes = preferredRail.notes;
            entry.layer_accords = preferredRail.accords;
          }
        }

        if (!isRetry) {
          const nextStack = appendUniqueBackendModeEntries(readMoodLaneStack(moodKey), [entry]);
          moodLaneStackRef.current.set(moodKey, nextStack);
        }
        moodCacheRef.current.set(moodKey, entry);
        odaraDebugLog('[Odara] lazy mood fetch success', mood, entry.layer_name, 'slot', capturedSlot);
        setLayerDebugSource(`rpc:${mood}`);
        setModeLoading(prev => ({ ...prev, [mood]: false }));
        setMoodCacheVersion(v => v + 1);
        return entry;
      } catch (e: any) {
        if (activeSlotRef.current !== capturedSlot) {
          odaraDebugLog('[Odara] ignoring stale mood error for old slot', capturedSlot);
          return null;
        }
        setModeErrors(prev => ({ ...prev, [mood]: e?.message ?? 'Fetch failed' }));
        setLayerDebugSource(`err:${e?.message}`);
        setModeLoading(prev => ({ ...prev, [mood]: false }));
        setMoodCacheVersion(v => v + 1);
        return null;
      } finally {
        moodInFlightRef.current.delete(moodKey);
      }
    })();

    moodInFlightRef.current.set(moodKey, fetchPromise);
    return fetchPromise;
  }, [userId, selectedContext, selectedDate, signedInResolvedOracle, stateKey, isGuestMode, fetchFragranceDetail, readMoodLaneStack]);

  const ensureMoodLaneDepth = useCallback(async (
    fragranceId: string,
    mood: LayerMood,
    targetIndex: number,
    extraExcludeIds: string[] = [],
  ) => {
    if (isGuestMode) return [];

    const slotPrefix = `${selectedDate}|${selectedContext}`;
    const moodKey = buildMoodLaneKey(slotPrefix, fragranceId, mood);
    let currentStack = readMoodLaneStack(moodKey);
    if (currentStack.length > targetIndex) {
      return currentStack;
    }

    const existingInFlight = moodLaneInFlightRef.current.get(moodKey);
    if (existingInFlight) {
      const resolvedStack = await existingInFlight;
      if (resolvedStack.length > targetIndex) {
        return resolvedStack;
      }
      currentStack = resolvedStack;
    }

    const lanePromise = (async () => {
      let nextStack = [...readMoodLaneStack(moodKey)];

      while (nextStack.length <= targetIndex) {
        const excludeIds = Array.from(new Set([
          ...extraExcludeIds,
          ...nextStack.map((entry) => entry.layer_fragrance_id).filter(Boolean),
        ]));
        const nextEntry = await fetchMoodForCard(
          fragranceId,
          mood,
          nextStack.length > 0,
          excludeIds,
        );
        if (!nextEntry) break;

        const appendedStack = appendUniqueBackendModeEntries(nextStack, [nextEntry]);
        if (appendedStack.length === nextStack.length) break;
        nextStack = appendedStack;
        moodLaneStackRef.current.set(moodKey, nextStack);
        const safeIndex = Math.min(targetIndex, nextStack.length - 1);
        moodCacheRef.current.set(moodKey, nextStack[safeIndex] ?? nextStack[0]);
        setMoodCacheVersion((version) => version + 1);
      }

      return nextStack;
    })();

    moodLaneInFlightRef.current.set(moodKey, lanePromise);
    try {
      return await lanePromise;
    } finally {
      moodLaneInFlightRef.current.delete(moodKey);
    }
  }, [isGuestMode, selectedDate, selectedContext, readMoodLaneStack, fetchMoodForCard]);

  const resolveAlternatesForCard = useCallback(async (card: DisplayCard) => {
    // GUEST MODE: source alternates directly from raw payload — no signed-in RPC.
    // Null fragrance_id is valid (pending_catalog) — keep the row visible, only id-dependent actions are gated.
    if (isGuestMode) {
      const raw = (oracle?.alternates ?? []) as any[];
      const guestAlts: OracleAlternate[] = raw.map((row, idx) => ({
        fragrance_id: row?.fragrance_id ?? `__guest_alt_${idx}`,
        name: row?.name ?? '',
        family: row?.family ?? '',
        reason: row?.reason ?? '',
        brand: row?.brand ?? '',
        notes: Array.isArray(row?.notes) ? row.notes : [],
        accords: Array.isArray(row?.accords) ? row.accords : [],
      })).filter(a => a.name);
      odaraDebugLog('[Odara][Guest] alternates from raw payload', { count: guestAlts.length });
      return guestAlts;
    }

    const altKey = `${selectedDate}|${selectedContext}|${card.fragrance_id}`;
    const cached = alternatesCacheRef.current.get(altKey);
    if (cached !== undefined) {
      return cached;
    }

    const capturedSlot = stateKey;

    try {
      const { data, error } = await odaraSupabase.rpc('get_alternates_for_card_v1' as any, {
        p_user: userId,
        p_fragrance_id: card.fragrance_id,
        p_context: selectedContext,
        p_temperature: resolvedTemperature,
        p_brand: 'Alexandria Fragrances',
        p_wear_date: selectedDate,
      });

      if (activeSlotRef.current !== capturedSlot) {
        odaraDebugLog('[Odara] ignoring stale alternates for old slot', capturedSlot);
        return [];
      }

      if (error) {
        alternatesCacheRef.current.set(altKey, []);
        return [];
      }

      const seen = new Set<string>();
      const rows = Array.isArray(data) ? data : [];
      const normalized: OracleAlternate[] = [];

      for (const row of rows) {
        const alt = normalizeAlternateRow(row);
        if (!alt || alt.fragrance_id === card.fragrance_id || seen.has(alt.fragrance_id)) continue;
        seen.add(alt.fragrance_id);
        normalized.push(alt);
      }

      alternatesCacheRef.current.set(altKey, normalized);
      return normalized;
    } catch {
      if (activeSlotRef.current !== capturedSlot) return [];
      alternatesCacheRef.current.set(altKey, []);
      return [];
    }
  }, [userId, selectedContext, selectedDate, stateKey, isGuestMode, oracle]);

  // Stable ref for fetchQueue so effects don't re-fire on reference change
  const fetchQueueRef = useRef(fetchQueue);
  fetchQueueRef.current = fetchQueue;
  const signedInDayStateMapRef = useRef(signedInDayStateMap);
  signedInDayStateMapRef.current = signedInDayStateMap;

  // ── Slot-change request guard ──
  // Tracks the current slot so stale async responses are ignored
  const activeSlotRef = useRef(stateKey);
  activeSlotRef.current = stateKey;
  const committedSignedInSlotRef = useRef(stateKey);
  const slotChangedSinceLastCommit = committedSignedInSlotRef.current !== stateKey;

  // Track previous slot to detect actual slot changes
  const prevSlotRef = useRef(stateKey);
  const activeSearchPreviewTopId = !isGuestMode ? (signedInDayState.manualHeroCard?.fragrance_id ?? null) : null;
  const activeSearchPreviewLayerId = !isGuestMode ? (signedInDayState.manualLayerCard?.fragrance_id ?? null) : null;

  const showSearchFeedback = useCallback((fragranceId: string, text: string) => {
    if (searchFeedbackTimeoutRef.current) {
      window.clearTimeout(searchFeedbackTimeoutRef.current);
    }
    setSearchAddFeedback({ fragranceId, text });
    searchFeedbackTimeoutRef.current = window.setTimeout(() => {
      setSearchAddFeedback((current) => (
        current?.fragranceId === fragranceId ? null : current
      ));
    }, 1500);
  }, []);

  const resolveActiveSignedInDefaultMood = useCallback((): LayerMood => {
    const activeSignedInOracle: any = signedInResolvedOracle ?? null;
    const normalized = activeSignedInOracle ? normalizeOracleHomePayload(activeSignedInOracle) : null;
    const v6 = activeSignedInOracle?.__v6 ?? null;
    return normalizeLayerMoodKey(v6?.ui_default_mode ?? normalized?.defaultMode)
      ?? (normalized?.defaultMode ?? 'balance');
  }, [signedInResolvedOracle]);

  const resolveSearchPreviewDecision = useCallback((
    nextDayState: SignedInDayState,
  ): SignedInResolvedDayDecision | null => {
    const activeSignedInOracle: any = signedInResolvedOracle ?? null;
    const defaultMood = resolveActiveSignedInDefaultMood();
    if (!activeSignedInOracle?.today_pick) {
      if (nextDayState.manualHeroCard) {
        return {
          visibleCard: nextDayState.manualHeroCard,
          forcedLayerCarryCard: nextDayState.manualLayerCard,
          selectedMood: defaultMood,
          promotedAltId: null,
          source: 'manual',
        };
      }
      if (nextDayState.manualLayerCard) {
        return {
          visibleCard: visibleCard ?? null,
          forcedLayerCarryCard: nextDayState.manualLayerCard,
          selectedMood: defaultMood,
          promotedAltId: null,
          source: 'manual',
        };
      }
      return null;
    }
    const previousDayState = signedInDayStateMapRef.current[previousDayStateKey] ?? createDefaultSignedInDayState();
    const resolvedBaseDecision = resolveSignedInDayDecision(
      {
        ...nextDayState,
        manualHeroCard: null,
        manualLayerCard: null,
      },
      true,
      previousDayState,
      activeSignedInOracle.today_pick,
      defaultMood,
      currentDateKey,
      selectedContext,
    );
    if (nextDayState.manualLayerCard) {
      return {
        forcedLayerCarryCard: nextDayState.manualLayerCard,
        visibleCard: resolvedBaseDecision.visibleCard ?? visibleCard ?? null,
        selectedMood: defaultMood,
        promotedAltId: resolvedBaseDecision.promotedAltId ?? null,
        source: 'manual',
      };
    }
    return resolveSignedInDayDecision(
      nextDayState,
      true,
      previousDayState,
      activeSignedInOracle.today_pick,
      defaultMood,
      currentDateKey,
      selectedContext,
    );
  }, [currentDateKey, signedInResolvedOracle, previousDayStateKey, resolveActiveSignedInDefaultMood, selectedContext, visibleCard]);

  const applySignedInSearchPreviewDecision = useCallback((
    decision: SignedInResolvedDayDecision | null,
    options?: {
      prefetchedAlternates?: OracleAlternate[] | null;
    },
  ) => {
    const fallbackMood = resolveActiveSignedInDefaultMood();
    if (decision?.visibleCard) {
      setVisibleCard(decision.visibleCard);
      setSignedInForcedLayerCarryCard(decision.forcedLayerCarryCard);
      setSignedInResolvedDayDecisionSource(decision.source);
      setPromotedAltId(decision.promotedAltId);
      setSelectedMood(getBetaSafeLayerMood(decision.selectedMood ?? fallbackMood));
    } else {
      setVisibleCard(null);
      setSignedInForcedLayerCarryCard(null);
      setSignedInResolvedDayDecisionSource('oracle');
      setPromotedAltId(null);
      setSelectedMood(getBetaSafeLayerMood(fallbackMood));
    }

    setSignedInLayerIdxByMood({ balance: 0, bold: 0, smooth: 0, wild: 0 });
    signedInModeHistoryRef.current = [];
    setSignedInModeHistory([]);
    setLayerExpanded(false);
    setLockState('neutral');
    clearLockedSelection();

    if (decision?.visibleCard && options?.prefetchedAlternates) {
      setCurrentCardAlternates(options.prefetchedAlternates);
      setCurrentCardAlternatesOwnerId(decision.visibleCard.fragrance_id);
    } else {
      setCurrentCardAlternates([]);
      setCurrentCardAlternatesOwnerId(null);
    }
  }, [clearLockedSelection, getBetaSafeLayerMood, resolveActiveSignedInDefaultMood, setLockState]);

  const primeSignedInPreviewTopCard = useCallback(async (heroCard: DisplayCard) => {
    const [prefetchedAlternates] = await Promise.all([
      resolveAlternatesForCard(heroCard),
      fetchMoodForCard(heroCard.fragrance_id, 'balance'),
    ]);
    return prefetchedAlternates;
  }, [resolveAlternatesForCard, fetchMoodForCard]);

  const clearSearchPreviewFromSelectedDay = useCallback(async (
    target: 'top' | 'layer' | 'all' = 'all',
  ) => {
    if (isGuestMode) return false;

    const current = signedInDayStateMapRef.current[currentDayStateKey] ?? createDefaultSignedInDayState();
    const shouldClearTop = target === 'all' || target === 'top';
    const shouldClearLayer = target === 'all' || target === 'layer' || shouldClearTop;
    const restoreSnapshot = shouldClearTop
      ? (signedInSearchPreviewSnapshotRef.current[currentDayStateKey] ?? null)
      : null;
    if (!current.manualHeroCard && !current.manualLayerCard && !restoreSnapshot) return false;
    const nextDayState: SignedInDayState = {
      ...current,
      manualHeroCard: shouldClearTop ? null : current.manualHeroCard,
      manualLayerCard: shouldClearLayer ? null : current.manualLayerCard,
    };

    const capturedSlot = stateKey;
    updateSignedInDayState(currentDayStateKey, () => nextDayState);

    if (restoreSnapshot) {
      clearSignedInSearchPreviewSnapshot(currentDayStateKey);
      restoreSignedInSearchPreviewSnapshot(restoreSnapshot);
      return true;
    }

    const decision = resolveSearchPreviewDecision(nextDayState);
    applySignedInSearchPreviewDecision(decision);

    if (decision?.visibleCard) {
      const prefetchedAlternates = decision.source === 'manual' && decision.forcedLayerCarryCard === null
        ? await primeSignedInPreviewTopCard(decision.visibleCard)
        : await resolveAlternatesForCard(decision.visibleCard);
      if (activeSlotRef.current !== capturedSlot) return true;
      setCurrentCardAlternates(prefetchedAlternates);
      setCurrentCardAlternatesOwnerId(decision.visibleCard.fragrance_id);
    }

    return true;
  }, [
    applySignedInSearchPreviewDecision,
    clearSignedInSearchPreviewSnapshot,
    currentDayStateKey,
    isGuestMode,
    primeSignedInPreviewTopCard,
    resolveAlternatesForCard,
    resolveSearchPreviewDecision,
    restoreSignedInSearchPreviewSnapshot,
    stateKey,
    updateSignedInDayState,
  ]);

  const handleAddSearchResultToSelectedDay = useCallback(async (result: OdaraSearchFragranceResult) => {
    if (!result?.fragrance_id) return;

    if (isGuestMode) {
      showSearchFeedback(result.fragrance_id, 'Sign in to add');
      return;
    }

    if (signedInSearchPreviewDisabledReason) {
      showSearchFeedback(result.fragrance_id, signedInSearchPreviewDisabledReason);
      return;
    }

    const current = signedInDayStateMapRef.current[currentDayStateKey] ?? createDefaultSignedInDayState();
    const isActiveTop = current.manualHeroCard?.fragrance_id === result.fragrance_id;
    const isActiveLayer = current.manualLayerCard?.fragrance_id === result.fragrance_id;
    const hadPreviewTop = !!current.manualHeroCard;
    if (isActiveTop) {
      if (isActiveLayer) {
        await clearSearchPreviewFromSelectedDay('all');
        showSearchFeedback(result.fragrance_id, 'Removed');
        return;
      }
    }
    if (isActiveLayer) {
      await clearSearchPreviewFromSelectedDay('layer');
      showSearchFeedback(result.fragrance_id, 'Removed');
      return;
    }

    const capturedSlot = stateKey;
    setSearchAddPendingFragranceId(result.fragrance_id);

    try {
      const detail = await fetchFragranceDetail(result.fragrance_id);
      const resolvedCard = resolveDisplayCardWithDetails(
        searchResultToDisplayCard(result),
        detail,
      );
      if (activeSlotRef.current !== capturedSlot) return;

      if (!current.manualHeroCard && !current.manualLayerCard) {
        captureSignedInSearchPreviewSnapshot(currentDayStateKey);
      }

      const base: SignedInDayState = {
        ...current,
        lockState: 'neutral',
        lockedCard: null,
        lockedLayerCard: null,
        lockedLayerMode: null,
        lockedResolvedCurrentCard: null,
        lockedContext: null,
        lockedMood: 'balance',
        lockedPromotedAltId: null,
      };

      let nextDayState: SignedInDayState;
      let feedbackText = hadPreviewTop ? 'Added as layer' : 'Added as top';
      let prefetchedAlternates: OracleAlternate[] | null = null;

      if (isActiveTop) {
        nextDayState = {
          ...base,
          manualHeroCard: null,
          manualLayerCard: resolvedCard,
        };
      } else if (!current.manualHeroCard) {
        nextDayState = {
          ...base,
          manualHeroCard: resolvedCard,
          manualLayerCard: null,
        };
        prefetchedAlternates = await primeSignedInPreviewTopCard(resolvedCard);
        feedbackText = 'Added as top';
      } else {
        nextDayState = {
          ...base,
          manualHeroCard: current.manualHeroCard,
          manualLayerCard: resolvedCard,
        };
        feedbackText = 'Added as layer';
      }

      if (activeSlotRef.current !== capturedSlot) return;

      const decision = resolveSearchPreviewDecision(nextDayState);
      if (!prefetchedAlternates && decision?.visibleCard) {
        prefetchedAlternates = await resolveAlternatesForCard(decision.visibleCard);
        if (activeSlotRef.current !== capturedSlot) return;
      }

      updateSignedInDayState(currentDayStateKey, () => nextDayState);
      applySignedInSearchPreviewDecision(decision, { prefetchedAlternates });
      showSearchFeedback(result.fragrance_id, feedbackText);
      haptic('success');
    } finally {
      setSearchAddPendingFragranceId((currentPending) => (
        currentPending === result.fragrance_id ? null : currentPending
      ));
    }
  }, [
    applySignedInSearchPreviewDecision,
    captureSignedInSearchPreviewSnapshot,
    clearSearchPreviewFromSelectedDay,
    currentDayStateKey,
    fetchFragranceDetail,
    isGuestMode,
    primeSignedInPreviewTopCard,
    resolveAlternatesForCard,
    resolveSearchPreviewDecision,
    showSearchFeedback,
    signedInSearchPreviewDisabledReason,
    stateKey,
    updateSignedInDayState,
  ]);

  // Effect 1: CLEAR card state immediately when the slot (date or context) changes
  useEffect(() => {
    if (prevSlotRef.current === stateKey) return; // same slot, no-op
    const oldSlot = prevSlotRef.current;
    persistSignedInMoodCycleMemory(
      oldSlot,
      visibleCard?.fragrance_id ?? null,
      betaSafeSignedInMood,
      signedInLayerIdxByMood,
    );
    prevSlotRef.current = stateKey;

    odaraDebugLog('[Odara] slot change -> clearing ALL state', oldSlot, '→', stateKey);
    signedInSearchPreviewSnapshotRef.current = {};
    setSignedInDayStateMap((prev) => {
      let changed = false;
      const next: SignedInDayStateMap = {};

      for (const [dateKey, state] of Object.entries(prev)) {
        if (state.manualHeroCard || state.manualLayerCard) {
          next[dateKey] = {
            ...state,
            manualHeroCard: null,
            manualLayerCard: null,
          };
          changed = true;
        } else {
          next[dateKey] = state;
        }
      }

      return changed ? next : prev;
    });
    // Immediately wipe the old slot's card data so it can't bleed
    setVisibleCard(null);
    setActiveOracle(null);
    setLayerDebugSource('clearing');
    setCurrentCardAlternates([]);
    setCurrentCardAlternatesOwnerId(null);
    setQueue([]);
    setQueuePointer(0);
    setViewHistory([]);
    setPromotedAltId(null);
    setLayerExpanded(false);
    setSelectedMood('balance');
    setSignedInLayerIdxByMood({ balance: 0, bold: 0, smooth: 0, wild: 0 });
    setSignedInForcedLayerCarryCard(null);
    setSignedInResolvedDayDecisionSource('oracle');
    setModeLoading({ balance: false, bold: false, smooth: false, wild: false });
    setModeErrors({ balance: null, bold: null, smooth: null, wild: null });
    moodCacheRef.current.clear();
    moodInFlightRef.current.clear();
    moodLaneStackRef.current.clear();
    moodLaneInFlightRef.current.clear();
    alternatesCacheRef.current.clear();
    queueFetchInFlightRef.current.clear();
  }, [betaSafeSignedInMood, persistSignedInMoodCycleMemory, signedInLayerIdxByMood, stateKey, visibleCard?.fragrance_id]);

  useEffect(() => {
    committedSignedInSlotRef.current = stateKey;
  }, [stateKey]);

  // Effect 2: Hydrate card when oracle data arrives — hero-first contract
  // Full-screen loader disappears as soon as oracle resolves.
  // Queue is fetched in the BACKGROUND after hero is set.
  useEffect(() => {
    if (!oracle) {
      setActiveOracle((current) => (current === null ? current : null));
      setVisibleCard((current) => (current === null ? current : null));
      setLayerDebugSource('none');
      setQueue((current) => (current.length === 0 ? current : []));
      setQueuePointer((current) => (current === 0 ? current : 0));
      setSignedInForcedLayerCarryCard((current) => (current === null ? current : null));
      setSignedInResolvedDayDecisionSource((current) => (current === 'oracle' ? current : 'oracle'));
      return;
    }

    if (!isGuestMode && !signedInResolvedMemoryReady) {
      return;
    }

    const capturedSlot = stateKey;
    if (!isGuestMode && !signedInOracleMatchesRequestedSlot(oracle, selectedContext, selectedDate)) {
      odaraDebugLog('[Odara] ignoring stale signed-in oracle payload for slot', {
        requestedContext: readSignedInOracleSlotMeta(oracle).contextKey,
        requestedDate: readSignedInOracleSlotMeta(oracle).wearDate,
        selectedContext,
        selectedDate,
        capturedSlot,
      });
      setActiveOracle((current) => (current === null ? current : null));
      setVisibleCard((current) => (current === null ? current : null));
      setLayerDebugSource('none');
      setQueue((current) => (current.length === 0 ? current : []));
      setQueuePointer((current) => (current === 0 ? current : 0));
      setSignedInForcedLayerCarryCard((current) => (current === null ? current : null));
      setSignedInResolvedDayDecisionSource((current) => (current === 'oracle' ? current : 'oracle'));
      return;
    }

    // ── Normalize raw payload ONCE — single source of truth ──
    const normalized = normalizeOracleHomePayload(oracle);

    // 1) Clear ALL stale state first
    // viewHistory is NOT cleared here — slot changes clear it in Effect 1 above
    setPromotedAltId((current) => (current === null ? current : null));
    setLayerExpanded((current) => (current ? false : current));
    setCurrentCardAlternates((current) => (current.length === 0 ? current : []));
    setCurrentCardAlternatesOwnerId((current) => (current === null ? current : null));
    setModeLoading((current) => (
      areSameModeLoadingMap(current, DEFAULT_MODE_LOADING_STATE) ? current : DEFAULT_MODE_LOADING_STATE
    ));
    setModeErrors((current) => (
      areSameModeErrorMap(current, DEFAULT_MODE_ERROR_STATE) ? current : DEFAULT_MODE_ERROR_STATE
    ));

    // 2) Set oracle
    setActiveOracle((current) => (current === oracle ? current : oracle));

    const dayStateMap = signedInDayStateMapRef.current;
    const hasCurrentDayState = Object.prototype.hasOwnProperty.call(dayStateMap, currentDayStateKey);
    const currentDayState = dayStateMap[currentDayStateKey] ?? createDefaultSignedInDayState();
    const previousDayState = dayStateMap[previousDayStateKey] ?? createDefaultSignedInDayState();

    // 3) Initialize from the signed-in home contract payload:
    // ui_default_mode + restored mode indexes for the current slot/anchor.
    const v6 = (oracle as any)?.__v6 ?? null;
    const v6DefaultMood: LayerMood = (() => {
      const def = v6?.ui_default_mode ?? normalized.defaultMode;
      return normalizeLayerMoodKey(def) ?? normalized.defaultMode;
    })();
    const resolvedDayDecision = resolveSignedInDayDecision(
      currentDayState,
      hasCurrentDayState,
      previousDayState,
      oracle.today_pick,
      v6DefaultMood,
      currentDateKey,
      selectedContext,
    );
    const initialVisibleCard = resolvedDayDecision.visibleCard;
    const initialForcedLayerCarryCard = resolvedDayDecision.forcedLayerCarryCard;
    const initialMood: LayerMood = resolvedDayDecision.selectedMood;
    const initialAnchorId = initialVisibleCard?.fragrance_id ?? oracle.today_pick?.fragrance_id ?? null;
    const moodCycleMemoryKey = buildSignedInMoodCycleMemoryKey(capturedSlot, initialAnchorId);
    const storedMoodCycleState = initialAnchorId
      ? (signedInMoodCycleMemoryRef.current[moodCycleMemoryKey] ?? null)
      : null;
    const previousMoodCycleScope = signedInMoodCycleScopeRef.current;
    const shouldResetSignedInMoodCycleState =
      previousMoodCycleScope?.slot !== capturedSlot
      || previousMoodCycleScope?.anchorId !== initialAnchorId;

    if (shouldResetSignedInMoodCycleState) {
      const restoredMood = getBetaSafeLayerMood(storedMoodCycleState?.selectedMood ?? initialMood);
      const restoredLayerIdxByMood = storedMoodCycleState?.layerIdxByMood ?? DEFAULT_LAYER_INDEX_MAP;
      setSelectedMood((current) => (current === restoredMood ? current : restoredMood));
      setSignedInLayerIdxByMood((current) => (
        areSameLayerIndexMap(current, restoredLayerIdxByMood) ? current : restoredLayerIdxByMood
      ));
    }
    signedInMoodCycleScopeRef.current = { slot: capturedSlot, anchorId: initialAnchorId };

    if (oracle.today_pick) {
      setVisibleCard((current) => (
        areSameDisplayCards(current, initialVisibleCard) ? current : initialVisibleCard
      ));
      setSignedInForcedLayerCarryCard((current) => (
        areSameDisplayCards(current, initialForcedLayerCarryCard) ? current : initialForcedLayerCarryCard
      ));
      setSignedInResolvedDayDecisionSource((current) => (
        current === resolvedDayDecision.source ? current : resolvedDayDecision.source
      ));
      setPromotedAltId((current) => (
        current === resolvedDayDecision.promotedAltId ? current : resolvedDayDecision.promotedAltId
      ));

      // 4) Pre-seed mood cache from normalized payload for hero card
      const slotPfx = `${selectedDate}|${selectedContext}`;
      const heroId = oracle.today_pick.fragrance_id;

      // 4a) Seed every mode block only when layer_modes are actually present.
      // Launch first paint may omit them because v7 defers full mode stacks.
      if (normalized.layerModesRaw) {
        for (const mood of LAYER_MODE_ORDER) {
          const modeData = getNormalizedLayerModeBlock(normalized.layerModesRaw as any, mood);
          if (modeData) {
            const seededEntries = appendUniqueBackendModeEntries(
              [],
              Array.isArray(modeData.layers)
                ? modeData.layers.map((layer: any) => modeValueToBackendModeEntry(layer, mood))
                : [modeValueToBackendModeEntry(modeData, mood)],
            );
            if (seededEntries.length > 0) {
              writeMoodLaneStack(
                buildMoodLaneKey(slotPfx, heroId, mood),
                seededEntries,
                shouldResetSignedInMoodCycleState
                  ? (storedMoodCycleState?.layerIdxByMood?.[mood] ?? 0)
                  : (signedInLayerIdxByMoodRef.current[mood] ?? 0),
              );
              odaraDebugLog('[Odara] pre-seeded mood cache from layer_modes', mood, seededEntries.map((entry) => entry.layer_name));
            }
          }
        }
      }

      // 4b) GUARANTEE balance is seeded — fall back to normalized.seededBalanceLayer
      // (which already prefers payload.layer → oracle_layer → seeded_balance_mode → layer_modes.balance)
      const balanceCacheKey = `${slotPfx}|${heroId}|balance`;
      if (!moodCacheRef.current.has(balanceCacheKey) && normalized.seededBalanceLayer?.fragranceId) {
        const sb = normalized.seededBalanceLayer;
        const balanceEntry = modeValueToBackendModeEntry({
          fragrance_id: sb.fragranceId,
          name: sb.name,
          brand: sb.brand,
          family: sb.family,
          notes: sb.notes,
          accords: sb.accords,
          layer_score: sb.layerScore,
          reason: sb.reason,
          why_it_works: sb.whyItWorks,
          ratio_hint: sb.ratioHint,
          application_style: sb.applicationStyle,
          placement_hint: sb.placementHint,
          spray_guidance: sb.sprayGuidance,
          spray_pattern: sb.sprayPattern,
          spray_pattern_key: sb.sprayPatternKey,
          spray_pattern_name: sb.sprayPatternName,
          halo: sb.halo,
          trail: sb.trail,
          anchor_sprays: sb.anchorSprays,
          layer_sprays: sb.layerSprays,
          interaction_type: sb.interactionType ?? 'balance',
        }, 'balance');
        if (balanceEntry) {
          writeMoodLaneStack(
            balanceCacheKey,
            [balanceEntry],
            shouldResetSignedInMoodCycleState
              ? (storedMoodCycleState?.layerIdxByMood?.balance ?? 0)
              : (signedInLayerIdxByMoodRef.current.balance ?? 0),
          );
          odaraDebugLog('[Odara] pre-seeded balance from normalized.seededBalanceLayer', balanceEntry.layer_name);
        }
      }

      odaraDebugLog('[Odara] mode cache after init', {
        heroId,
        keys: Array.from(moodCacheRef.current.keys()).filter(k => k.includes(heroId)),
        balanceLoaded: moodCacheRef.current.has(balanceCacheKey),
      });

      setMoodCacheVersion(v => v + 1);

      // 5) Seed queue immediately from the signed-in v7 contract when present.
      // This prevents an early skip from launching a second identical queue RPC
      // while the background queue load is still racing.
      const seededQueue = queueRowsToDisplay(
        Array.isArray(v6?.queue) ? v6.queue : [],
        initialVisibleCard?.fragrance_id ?? oracle.today_pick.fragrance_id,
      );
      if (seededQueue.length > 0) {
        setQueue((current) => (
          areSameDisplayCardLists(current, seededQueue) ? current : seededQueue
        ));
        if (!initialVisibleCard) {
          const seededHero = seededQueue[0] ?? null;
          const seededPointer = seededQueue.length > 1 ? 1 : 0;
          setVisibleCard((current) => (
            areSameDisplayCards(current, seededHero) ? current : seededHero
          ));
          setQueuePointer((current) => (current === seededPointer ? current : seededPointer));
        } else {
          setQueuePointer((current) => (current === 0 ? current : 0));
        }
      } else {
        fetchQueueRef.current(initialVisibleCard?.fragrance_id ?? oracle.today_pick.fragrance_id).then(q => {
          if (activeSlotRef.current !== capturedSlot) return;
          if (!initialVisibleCard && q.length > 0) {
            const queuedHero = q[0] ?? null;
            const queuedPointer = q.length > 1 ? 1 : 0;
            setVisibleCard((current) => (
              areSameDisplayCards(current, queuedHero) ? current : queuedHero
            ));
            setQueuePointer((current) => (current === queuedPointer ? current : queuedPointer));
            setQueue((current) => (
              areSameDisplayCardLists(current, q) ? current : q
            ));
            return;
          }
          setQueue((current) => (
            areSameDisplayCardLists(current, q) ? current : q
          ));
          setQueuePointer((current) => (current === 0 ? current : 0));
        });
      }
    } else {
      setVisibleCard((current) => (current === null ? current : null));
      setLayerDebugSource('none');
      setQueue((current) => (current.length === 0 ? current : []));
      setQueuePointer((current) => (current === 0 ? current : 0));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oracle, stateKey, currentDayStateKey, previousDayStateKey, queueRowsToDisplay, isGuestMode, signedInResolvedMemoryReady]);

  // No eager mode-stack fetch on first paint. Full mode data is loaded only
  // from deferred payloads or user-driven lazy hydration.

  // `signedInResolvedOracle` hoisted earlier (see fetchMoodForCard region) to
  // avoid TDZ during useCallback dep evaluation.
  const v6Payload: any = (signedInResolvedOracle as any)?.__v6 ?? null;
  const backendCardUnavailable = useMemo(() => {
    if (isGuestMode) return null;

    const raw =
      v6Payload?.card_unavailable ??
      (signedInResolvedOracle as any)?.card_unavailable ??
      null;

    if (!raw || typeof raw !== 'object' || raw.is_unavailable !== true) {
      return null;
    }

    const message = typeof raw.message === 'string' && raw.message.trim().length > 0
      ? raw.message.trim()
      : 'No card is ready for this context yet. Try another context or check back after the next refresh.';

    return { message };
  }, [isGuestMode, v6Payload, signedInResolvedOracle]);
  const signedInHeroId = v6Payload?.hero?.fragrance_id ?? (signedInResolvedOracle as any)?.today_pick?.fragrance_id ?? null;
  const signedInVisibleIsHeroCard = !!visibleCard && !!signedInHeroId && visibleCard.fragrance_id === signedInHeroId;
  const signedInPayloadAlternates = useMemo(() => {
    if (isGuestMode) return [];
    const raw = Array.isArray(v6Payload?.alternates)
      ? v6Payload.alternates
      : Array.isArray((signedInResolvedOracle as any)?.alternates)
        ? (signedInResolvedOracle as any).alternates
          : [];
    return raw
      .map((row: any) => normalizeAlternateRow(row))
      .filter((alt): alt is OracleAlternate => !!alt);
  }, [isGuestMode, v6Payload, signedInResolvedOracle]);

  useEffect(() => {
    if (!visibleCard) {
      setCurrentCardAlternates((current) => (current.length === 0 ? current : []));
      setCurrentCardAlternatesOwnerId((current) => (current === null ? current : null));
      return;
    }

    if (!isGuestMode && signedInVisibleIsHeroCard) {
      setCurrentCardAlternates((current) => (
        areSameOracleAlternates(current, signedInPayloadAlternates) ? current : signedInPayloadAlternates
      ));
      setCurrentCardAlternatesOwnerId((current) => (
        current === visibleCard.fragrance_id ? current : visibleCard.fragrance_id
      ));
      return;
    }

    const capturedSlot = stateKey;
    const capturedCardId = visibleCard.fragrance_id;
    let isActive = true;
    setCurrentCardAlternates((current) => (current.length === 0 ? current : []));
    setCurrentCardAlternatesOwnerId((current) => (current === null ? current : null));

    resolveAlternatesForCard(visibleCard).then((alternates) => {
      if (isActive && activeSlotRef.current === capturedSlot) {
        setCurrentCardAlternates((current) => (
          areSameOracleAlternates(current, alternates) ? current : alternates
        ));
        setCurrentCardAlternatesOwnerId((current) => (
          current === capturedCardId ? current : capturedCardId
        ));
      }
    });

    return () => {
      isActive = false;
    };
  }, [visibleCard, resolveAlternatesForCard, stateKey, isGuestMode, signedInVisibleIsHeroCard, signedInPayloadAlternates]);

  // Double-tap detector ref (replaces old swipe-gesture system).
  // double tap on card = like + lock
  const lastTapRef = useRef<{ time: number; x: number; y: number }>({ time: 0, x: 0, y: 0 });
  const unlockTimeoutRef = useRef<number | null>(null);
  const carryoverPulseTimeoutRef = useRef<number | null>(null);
  const carryoverCloseFlashTimeoutRef = useRef<number | null>(null);
  const DOUBLE_TAP_MS = 320;
  const DOUBLE_TAP_DIST = 32;

  const oracleHeroId = isGuestMode
    ? (activeOracle?.today_pick?.fragrance_id ?? null)
    : ((signedInResolvedOracle as any)?.today_pick?.fragrance_id ?? null);
  const isShowingHeroCard =
    !!visibleCard &&
    (
      // Signed-in: must match oracle hero id
      (!!oracleHeroId && visibleCard.fragrance_id === oracleHeroId) ||
      // Guest mode: today_pick may have null fragrance_id (pending_catalog) — still treat as hero
      (isGuestMode && !!activeOracle?.today_pick && visibleCard.isHero)
    );
  // Hero-style = real hero OR promoted alternate (shows alternates + layer)
  const isHeroStyle = isShowingHeroCard || promotedAltId === visibleCard?.fragrance_id;
  const renderType = isShowingHeroCard ? 'HERO' : promotedAltId === visibleCard?.fragrance_id ? 'PROMOTED_ALT' : 'QUEUE';

  const familyKey = visibleCard?.family ?? '';
  const tint = FAMILY_TINTS[familyKey] ?? DEFAULT_TINT;
  const heroCardVisual = getOdaraGlassCardVisualRecipe(tint, 'hero');
  const familyColor = FAMILY_COLORS[familyKey] ?? '#888';
  const familyLabel = FAMILY_LABELS[familyKey] ?? familyKey.toUpperCase();
  const getPreviewTone = (dateStr: string) => {
    const lane = isGuestMode
      ? (lockedSelections[`${dateStr}:${selectedContext}`] ?? null)
      : (signedInLockedLaneByDate[dateStr]?.[normalizePersistedContextKey(selectedContext)] ?? null);
    return {
      accent: lane?.mainColor ?? familyColor,
      glow: lane?.layerColor ?? lane?.mainColor ?? familyColor,
    };
  };

  // Build layer modes from slot-scoped mood cache — lazy loaded.
  // The v7 launch contract can arrive with layer_modes_deferred=true and
  // provider_meta.preview_depth=0, so first paint must tolerate missing
  // payload layer stacks. When a deferred surface later provides layer_modes,
  // the cache can be seeded from that payload.
  // moodCacheVersion is used to trigger re-renders when cache updates
  void moodCacheVersion; // consumed for reactivity
  const cardId = visibleCard?.fragrance_id ?? '';
  const slotPrefix = `${selectedDate}|${selectedContext}`;

  // ────────────────────────────────────────────────────────────────────
  // SIGNED-IN CANONICAL VIEW MODEL — get_signed_in_card_contract_v7.
  // Single resolved source for the visible signed-in card. All signed-in JSX
  // must read hero/layer/tokens through this object. The raw payload still
  // sits on `__v6` for legacy adapter compatibility only.
  //
  // Resolution order for the visible layer:
  //   1) lane cache for the current slot/card/mood
  //   2) payload.layer_modes[selectedMood].layers[activeIdx] when a deferred
  //      payload has already supplied mode-stack data
  //   3) payload.layer_modes[selectedMood] (flat per-mode fallback)
  //   4) payload.layer (top-level balance fallback)
  //
  // Tokens:
  //   hero  → payload.hero_tokens
  //   layer → visibleLayer.tokens ?? payload.layer_tokens (balance only) ?? []
  // ────────────────────────────────────────────────────────────────────
  const signedInVisibleAlternates = signedInVisibleIsHeroCard
    ? signedInPayloadAlternates
    : (currentCardAlternatesOwnerId === visibleCard?.fragrance_id ? currentCardAlternates : []);

  // Resolve mode results from the slot-scoped mood cache first. Hero cards can
  // also reuse payload layer_modes when a deferred surface has already supplied
  // them, but launch first paint must not assume full mode stacks are present.
  const modeResults: LayerModes = useMemo(() => {
    const lm: any = v6Payload?.layer_modes ?? (signedInResolvedOracle as any)?.layer_modes ?? null;
    const resolveMood = (mood: LayerMood) => {
      const moodKey = buildMoodLaneKey(slotPrefix, cardId, mood);
      const stack = readMoodLaneStack(moodKey);
      const idx = signedInLayerIdxByMood[mood] ?? 0;
      const laneEntry = stack.length > 0
        ? backendModeEntryToLayerMode(stack[Math.min(Math.max(idx, 0), stack.length - 1)] ?? stack[0] ?? null)
        : null;

      if (!signedInVisibleIsHeroCard) return laneEntry;

      const block = getNormalizedLayerModeBlock(lm, mood);
      if (!block) return laneEntry;
      const v6Stack = Array.isArray(block.layers) ? block.layers : [];
      const pickedV6 = v6Stack.length > 0
        ? v6Stack[Math.min(Math.max(idx, 0), v6Stack.length - 1)] ?? v6Stack[0]
        : block;
      const v6Entry = v6LayerToLayerMode(pickedV6, mood);

      // Hero cards can already ship deeper real candidates in v6 even before
      // the signed-in lane cache has fetched or re-seeded to the same depth.
      // When the selected index points beyond the current lane cache, prefer
      // the payload-backed candidate instead of clamping back to lane index 0.
      if (v6Stack.length > stack.length && idx >= stack.length) {
        return v6Entry ?? laneEntry;
      }

      return laneEntry ?? v6Entry;
    };
    return {
      balance: resolveMood('balance'),
      bold:    resolveMood('bold'),
      smooth:  resolveMood('smooth'),
      wild:    resolveMood('wild'),
    };
    // moodCacheVersion read above keeps this fresh when cache changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v6Payload, signedInResolvedOracle, signedInLayerIdxByMood, slotPrefix, cardId, moodCacheVersion, signedInVisibleIsHeroCard, readMoodLaneStack]);
  const visibleModeEntry = modeResults[betaSafeSignedInMood] ?? null;
  useEffect(() => {
    if (isGuestMode || !visibleCard?.fragrance_id || signedInVisibleIsHeroCard) return;
    const mood = betaSafeSignedInMood;
    const moodKey = buildMoodLaneKey(slotPrefix, visibleCard.fragrance_id, mood);
    if (readMoodLaneStack(moodKey).length > 0) return;
    const predecessorExclusionId = signedInResolvedDayDecisionSource === 'carryover-main'
      ? (signedInVerifiedPredecessorBaton?.excludedPreviousCard?.fragrance_id ?? null)
      : null;
    void ensureMoodLaneDepth(
      visibleCard.fragrance_id,
      mood,
      0,
      predecessorExclusionId ? [predecessorExclusionId] : [],
    );
  }, [
    isGuestMode,
    visibleCard?.fragrance_id,
    signedInVisibleIsHeroCard,
    betaSafeSignedInMood,
    slotPrefix,
    ensureMoodLaneDepth,
    readMoodLaneStack,
    signedInResolvedDayDecisionSource,
    signedInVerifiedPredecessorBaton,
  ]);

  useEffect(() => {
    if (isGuestMode || !visibleCard?.fragrance_id) return;
    const mood = betaSafeSignedInMood;
    const moodKey = buildMoodLaneKey(slotPrefix, visibleCard.fragrance_id, mood);
    syncMoodLaneSelectedEntry(moodKey, signedInLayerIdxByMood[mood] ?? 0);
  }, [
    isGuestMode,
    visibleCard?.fragrance_id,
    betaSafeSignedInMood,
    slotPrefix,
    signedInLayerIdxByMood,
    moodCacheVersion,
    syncMoodLaneSelectedEntry,
  ]);

  useEffect(() => {
    if (isGuestMode) return;

    const visibleHeroNeedsDetail = !!visibleCard?.fragrance_id
      && !fragranceDetailCacheRef.current.has(visibleCard.fragrance_id);
    if (visibleHeroNeedsDetail) {
      void fetchFragranceDetail(visibleCard!.fragrance_id).then((detail) => {
        if (!detail || !visibleCard || visibleCard.isHero) return;
        commitSignedInQueuedHero(visibleCard, detail);
      });
    } else if (visibleCard && !visibleCard.isHero) {
      const heroDetail = fragranceDetailCacheRef.current.get(visibleCard.fragrance_id) ?? null;
      if (heroDetail) {
        commitSignedInQueuedHero(visibleCard, heroDetail);
      }
    }

    const visibleLayerId = signedInForcedLayerCarryCard?.fragrance_id ?? visibleModeEntry?.id ?? null;
    const visibleLayerNeedsDetail = !!visibleLayerId
      && !fragranceDetailCacheRef.current.has(visibleLayerId);
    if (visibleLayerNeedsDetail) {
      void fetchFragranceDetail(visibleLayerId!);
    }
  }, [isGuestMode, visibleCard, visibleModeEntry, signedInForcedLayerCarryCard, fetchFragranceDetail, fragranceDetailVersion, commitSignedInQueuedHero, betaSafeSignedInMood]);

  // ── SINGLE-SOURCE RENDER for the signed-in main card — bound to v6. ──
  const activeMainCardRender = useMemo(() => {
    if (isGuestMode || !visibleCard) return null;
    if (signedInResolvedDayDecisionSource === 'locked' && signedInResolvedLockTruth) {
      const lockedRender = buildLockedMainCardRender(signedInResolvedLockTruth);
      if (lockedRender) return lockedRender;
    }
    // Prefer the v6 raw payload (carries hero_tokens / layer_tokens / per-mode
    // tokens). Fall back to legacy oracle prop for non-v6 paths.
    const v6: any = v6Payload;
    const o: any = signedInResolvedOracle ?? {};
    const heroId = (v6?.hero?.fragrance_id ?? o?.today_pick?.fragrance_id) ?? null;
    const manualHeroCard = signedInResolvedDayDecisionSource === 'manual'
      ? (signedInDayState.manualHeroCard ?? visibleCard)
      : null;
    const manualLayerCard = signedInResolvedDayDecisionSource === 'manual'
      ? (signedInDayState.manualLayerCard ?? signedInForcedLayerCarryCard)
      : null;
    const heroSourceCard = manualHeroCard ?? visibleCard;
    const isHeroCard = !manualHeroCard && !!heroId && visibleCard.fragrance_id === heroId;

    const heroDetail = fragranceDetailCacheRef.current.get(heroSourceCard.fragrance_id) ?? null;
    const queuedHeroSnapshot = !manualHeroCard && !isHeroCard
      ? (queue.find((card) => card.fragrance_id === heroSourceCard.fragrance_id) ?? null)
      : null;
    const queuedHeroSettled = !manualHeroCard && !isHeroCard
      ? (signedInQueuedHeroRef.current.get(heroSourceCard.fragrance_id) ?? null)
      : null;
    const queuedHeroSource = !manualHeroCard && !isHeroCard
      ? (mergeQueuedHeroCardSources(
          queuedHeroSettled,
          heroSourceCard,
          queuedHeroSnapshot,
        ) ?? heroSourceCard)
      : heroSourceCard;
    const resolvedHero = manualHeroCard
      ? resolveDisplayCardWithDetails(heroSourceCard, heroDetail)
      : isHeroCard
      ? resolveDisplayCardWithDetails(heroSourceCard, heroDetail)
      : resolveQueuedHeroDisplayWithDetails(queuedHeroSource, heroDetail);

    // Visible layer — resolved from the v6 mode stack (already in modeResults).
    const forcedLockedLayerMode = signedInResolvedDayDecisionSource === 'locked'
      ? (signedInResolvedLockTruth?.lockedLayerMode ?? null)
      : null;
    const manualLayerModes = manualLayerCard
      ? buildManualLayerModesFromDisplayCard(manualLayerCard)
      : null;
    const defaultMoodForCarryover = resolveActiveSignedInDefaultMood();
    const carryoverLayerMode = signedInResolvedDayDecisionSource === 'carryover-layer'
      && betaSafeSignedInMood === defaultMoodForCarryover
      && signedInForcedLayerCarryCard
        ? toLayerModeFromDisplayCard(signedInForcedLayerCarryCard, betaSafeSignedInMood)
        : null;
    const forcedLayerMode = manualLayerCard
      ? manualLayerModes?.balance ?? null
      : forcedLockedLayerMode
      ?? carryoverLayerMode;
    const layerSource = forcedLayerMode ?? visibleModeEntry;
    const visibleLayerDetail = layerSource?.id
      ? (fragranceDetailCacheRef.current.get(layerSource.id) ?? null)
      : null;
    const resolvedLayer = resolveLayerModeWithDetails(layerSource, visibleLayerDetail);

    let finalHero = resolvedHero;
    let finalHeroSource = !isHeroCard ? queuedHeroSource : resolvedHero;
    let finalLayer = resolvedLayer;
    const duplicateResolution = {
      kind: 'none' as 'none' | 'replace-main' | 'switch-layer' | 'single-scent',
      replacementMain: null as DisplayCard | null,
      preferredLayerIndex: null as number | null,
    };
    const predecessorExcludedCard = signedInVerifiedPredecessorBaton?.excludedPreviousCard ?? null;
    const predecessorCarriedCard = signedInVerifiedPredecessorBaton?.carriedCard ?? null;

    if (
      predecessorExcludedCard &&
      signedInResolvedDayDecisionSource === 'carryover-layer' &&
      isSameFragranceIdentity(finalHero, predecessorExcludedCard)
    ) {
      const replacementMain = pickFirstDisplayCardExcluding(
        queue,
        [resolvedLayer, predecessorExcludedCard, predecessorCarriedCard],
      );
      if (replacementMain) {
        const replacementMainDetail = fragranceDetailCacheRef.current.get(replacementMain.fragrance_id) ?? null;
        const replacementMainSettled = signedInQueuedHeroRef.current.get(replacementMain.fragrance_id) ?? replacementMain;
        finalHeroSource = mergeQueuedHeroCardSources(replacementMainSettled, replacementMain) ?? replacementMain;
        finalHero = resolveQueuedHeroDisplayWithDetails(finalHeroSource, replacementMainDetail);
        duplicateResolution.kind = 'replace-main';
        duplicateResolution.replacementMain = replacementMain;
      } else {
        finalLayer = null;
        duplicateResolution.kind = 'single-scent';
      }
    }

    if (
      predecessorExcludedCard &&
      signedInResolvedDayDecisionSource === 'carryover-main' &&
      finalLayer &&
      isSameFragranceIdentity(finalLayer, predecessorExcludedCard)
    ) {
        const uniqueLayerCandidate = isHeroCard
          ? findFirstAllowedLayerModeCandidate(
            getNormalizedLayerModeBlock(v6?.layer_modes ?? null, betaSafeSignedInMood),
            betaSafeSignedInMood,
            [finalHero, predecessorExcludedCard, predecessorCarriedCard],
          )
        : null;
      if (uniqueLayerCandidate) {
        const uniqueLayerDetail = uniqueLayerCandidate.layer.id
          ? (fragranceDetailCacheRef.current.get(uniqueLayerCandidate.layer.id) ?? null)
          : null;
        finalLayer = resolveLayerModeWithDetails(uniqueLayerCandidate.layer, uniqueLayerDetail);
        duplicateResolution.kind = 'switch-layer';
        duplicateResolution.preferredLayerIndex = uniqueLayerCandidate.index;
      } else {
        finalLayer = null;
        duplicateResolution.kind = 'single-scent';
      }
    }

    if (resolvedLayer && isSameFragranceIdentity(resolvedHero, resolvedLayer)) {
      if (signedInForcedLayerCarryCard) {
        const replacementMain = pickFirstUniqueDisplayCard(queue, resolvedLayer);
        if (replacementMain) {
          const replacementMainDetail = fragranceDetailCacheRef.current.get(replacementMain.fragrance_id) ?? null;
          const replacementMainSettled = signedInQueuedHeroRef.current.get(replacementMain.fragrance_id) ?? replacementMain;
          finalHeroSource = mergeQueuedHeroCardSources(replacementMainSettled, replacementMain) ?? replacementMain;
          finalHero = resolveQueuedHeroDisplayWithDetails(finalHeroSource, replacementMainDetail);
          duplicateResolution.kind = 'replace-main';
          duplicateResolution.replacementMain = replacementMain;
        } else {
          finalLayer = null;
          duplicateResolution.kind = 'single-scent';
        }
      } else {
        const uniqueLayerCandidate = isHeroCard
          ? findFirstUniqueLayerModeCandidate(getNormalizedLayerModeBlock(v6?.layer_modes ?? null, betaSafeSignedInMood), betaSafeSignedInMood, resolvedHero)
          : null;
        if (uniqueLayerCandidate) {
          const uniqueLayerDetail = uniqueLayerCandidate.layer.id
            ? (fragranceDetailCacheRef.current.get(uniqueLayerCandidate.layer.id) ?? null)
            : null;
          finalLayer = resolveLayerModeWithDetails(uniqueLayerCandidate.layer, uniqueLayerDetail);
          duplicateResolution.kind = 'switch-layer';
          duplicateResolution.preferredLayerIndex = uniqueLayerCandidate.index;
        } else {
          finalLayer = null;
          duplicateResolution.kind = 'single-scent';
        }
      }
    }

    const resolvedCurrentCardIsHeroCard = !!heroId && finalHero.fragrance_id === heroId;
    const reasonChip = duplicateResolution.kind === 'replace-main'
      ? readReasonChipFromSources(finalHeroSource, finalHero)
      : readReasonChipFromSources(
          isHeroCard ? v6?.hero : null,
          isHeroCard ? o?.today_pick : null,
          !isHeroCard ? queuedHeroSource : null,
          finalHero,
        );
    const heroFamilyKey = finalHero.family ?? '';
    const heroImageUrl = resolveBottleImageUrl(
      finalHeroSource,
      finalHero,
      isHeroCard ? v6?.hero : null,
      isHeroCard ? o?.today_pick : null,
    );
    const heroFamilyColorForDisplay = heroFamilyKey
      ? (FAMILY_COLORS[heroFamilyKey] ?? '#888')
      : '#888';
    const heroFamilyLabelForDisplay = heroFamilyKey
      ? (FAMILY_LABELS[heroFamilyKey] ?? heroFamilyKey.toUpperCase())
      : '';
    const finalLayerDetail = finalLayer?.id
      ? (fragranceDetailCacheRef.current.get(finalLayer.id) ?? null)
      : null;
    const sharedHeroLayerKeys = buildSharedTokenKeySet(
      finalHero.notes,
      finalHero.accords,
      finalLayer?.notes ?? [],
      finalLayer?.accords ?? [],
    );
    const heroTokensSrc: any[] = buildSemanticSurfaceTokens(
      finalHero.notes,
      finalHero.accords,
      sharedHeroLayerKeys,
      4,
    );

    const layerTokens: any[] = finalLayer
      ? buildSemanticSurfaceTokens(
          Array.isArray((finalLayer as any)?.notes) ? (finalLayer as any).notes : [],
          Array.isArray((finalLayer as any)?.accords) ? (finalLayer as any).accords : [],
          sharedHeroLayerKeys,
          4,
        )
      : [];
    const layerFamilyKey = finalLayer?.family_key ?? '';
    const layerHasFamily = layerFamilyKey.trim().length > 0;
    const layerHasTokens = layerTokens.length > 0;
    const layerSurfaceSettled = resolvedCurrentCardIsHeroCard || (!!finalLayer && (!!finalLayerDetail || (layerHasFamily && layerHasTokens)));
    const layerSurfacesReady = resolvedCurrentCardIsHeroCard || layerSurfaceSettled;
    const layerFamilyKeyForDisplay = layerSurfacesReady ? layerFamilyKey : '';
    const layerFamilyLabel = layerFamilyKeyForDisplay ? (FAMILY_LABELS[layerFamilyKeyForDisplay] ?? layerFamilyKeyForDisplay.toUpperCase()) : '';

    const visibleLayer = finalLayer
      ? {
          ...finalLayer,
          image_url: resolveBottleImageUrl(finalLayer, layerSource),
          family_key: layerSurfacesReady ? finalLayer.family_key : '',
          notes: layerSurfacesReady ? finalLayer.notes : [],
          accords: layerSurfacesReady ? finalLayer.accords : [],
        }
      : null;
    const finalAlternates = finalHero.fragrance_id === heroSourceCard.fragrance_id
      ? filterAlternatesAgainstVisibleScents(
          signedInVisibleAlternates,
          (alternate) => alternate,
          [finalHero, visibleLayer, manualHeroCard, manualLayerCard],
        )
      : [];
    const finalSelectedMode: LayerMood = manualLayerModes?.balance ? 'balance' : betaSafeSignedInMood;

    const resolvedCurrentCard = {
      fragrance_id: finalHero.fragrance_id,
      name: finalHero.name,
      brand: finalHero.brand,
      family: heroFamilyKey,
      image_url: heroImageUrl,
      familyLabel: heroFamilyLabelForDisplay,
      familyColor: heroFamilyColorForDisplay,
      reason_chip_label: reasonChip?.label ?? finalHero.reason_chip_label ?? null,
      reason_chip_explanation: reasonChip?.explanation ?? finalHero.reason_chip_explanation ?? null,
      notes: finalHero.notes,
      accords: finalHero.accords,
      hero: finalHero,
      heroTokens: heroTokensSrc,
      reasonChip,
      layer: visibleLayer,
      layerFamilyKey: layerFamilyKeyForDisplay,
      layerFamilyLabel: layerFamilyLabel,
      layerTokens: layerSurfacesReady ? layerTokens : [],
      layerModes: manualLayerModes ?? modeResults,
      alternates: finalAlternates,
      selectedMode: finalSelectedMode,
      visibleCardId: finalHero.fragrance_id,
      isHeroCard: resolvedCurrentCardIsHeroCard,
    };

    return {
      activeHero: finalHero,
      heroFamilyKey,
      heroFamilyColor: heroFamilyColorForDisplay,
      heroFamilyLabel: heroFamilyLabelForDisplay,
      activeHeroTokens: heroTokensSrc,
      activeReasonChip: reasonChip,
      activeLayer: visibleLayer,
      activeLayerFamilyKey: layerFamilyKeyForDisplay,
      activeLayerFamilyLabel: layerFamilyLabel,
      activeLayerTokens: layerSurfacesReady ? layerTokens : [],
      layerModes: manualLayerModes ?? modeResults,
      selectedMode: finalSelectedMode,
      visibleCardId: finalHero.fragrance_id,
      isLocked: lockState === 'locked',
      activeAlternates: finalAlternates,
      reasonChipLabel: reasonChip?.label ?? null,
      reasonChipExplanation: reasonChip?.explanation ?? null,
      queuedSurfacesReady: layerSurfacesReady,
      duplicateResolution,
      resolvedCurrentCard,
    };
  }, [isGuestMode, visibleCard, queue, v6Payload, signedInResolvedOracle, betaSafeSignedInMood, signedInLayerIdxByMood, visibleModeEntry, modeResults, lockState, moodCacheVersion, signedInVisibleAlternates, fragranceDetailVersion, signedInQueuedHeroVersion, signedInForcedLayerCarryCard, signedInResolvedDayDecisionSource, signedInResolvedLockTruth, signedInVerifiedPredecessorBaton, signedInDayState, resolveActiveSignedInDefaultMood]);

  useEffect(() => {
    if (isGuestMode || signedInIsReadOnlyHistoryCard || !activeMainCardRender || !visibleCard) return;

    const duplicateResolution = (activeMainCardRender as any).duplicateResolution as
      | { kind: 'none' | 'replace-main' | 'switch-layer' | 'single-scent'; replacementMain?: DisplayCard | null; preferredLayerIndex?: number | null }
      | undefined;

    if (!duplicateResolution || duplicateResolution.kind === 'none') return;

    if (duplicateResolution.kind === 'replace-main') {
      const replacementMain = duplicateResolution.replacementMain ?? null;
      if (replacementMain && !isSameFragranceIdentity(replacementMain, visibleCard)) {
        setVisibleCard(replacementMain);
        setPromotedAltId(null);
      }
      return;
    }

    if (duplicateResolution.kind === 'switch-layer') {
      const preferredLayerIndex = duplicateResolution.preferredLayerIndex ?? null;
      const currentLayerIndex = signedInLayerIdxByMood[betaSafeSignedInMood] ?? 0;
      if (preferredLayerIndex !== null && preferredLayerIndex !== currentLayerIndex) {
        setSignedInLayerIdxByMood((prev) => ({ ...prev, [betaSafeSignedInMood]: preferredLayerIndex }));
      }
      return;
    }

    if (signedInForcedLayerCarryCard) {
      setSignedInForcedLayerCarryCard(null);
    }

    if (lockState === 'locked') {
      updateSignedInDayState(currentDayStateKey, (current) => (
        current.lockedLayerCard || current.lockedLayerMode || current.lockedResolvedCurrentCard?.layer
          ? {
              ...current,
              lockedLayerCard: null,
              lockedLayerMode: null,
              lockedResolvedCurrentCard: current.lockedResolvedCurrentCard
                ? {
                    ...current.lockedResolvedCurrentCard,
                    layer: null,
                    layerFamilyKey: '',
                    layerFamilyLabel: '',
                    layerTokens: [],
                  }
                : null,
            }
          : current
      ));
    }
  }, [
    isGuestMode,
    activeMainCardRender,
    visibleCard,
    signedInLayerIdxByMood,
    selectedMood,
    signedInForcedLayerCarryCard,
    lockState,
    currentDateKey,
    updateSignedInDayState,
    signedInIsReadOnlyHistoryCard,
  ]);

  // (Skip gesture lifecycle reset effect lives just below swipeRef declaration.)

  // ── v6 mood tap handler ──
  // Different mood  → switch selectedMood; if no idx exists, start at 0.
  // Same mood again → advance deterministically deeper within this same lane.
  // Mood cycling source is a single signed-in lane stack per mood/card/slot.
  const handleMoodSelect = useCallback((mood: LayerMood) => {
    if (lockState === 'locked') return;
    if (!visibleCard) return;
    if (!isGuestMode && mood === 'wild') return;
    const currentCardId = visibleCard.fragrance_id;
    const slotPrefix = `${selectedDate}|${selectedContext}`;
    const moodKey = buildMoodLaneKey(slotPrefix, currentCardId, mood);
    const v6: any = (activeOracle as any)?.__v6 ?? (oracle as any)?.__v6 ?? null;
    const heroIdV6 = v6?.hero?.fragrance_id ?? null;
    const isHeroCard = !!heroIdV6 && currentCardId === heroIdV6;
    const stackArr = isHeroCard
      ? layerModeBlockToStack(getNormalizedLayerModeBlock(v6?.layer_modes ?? null, mood))
      : [];
    const predecessorExclusionId = signedInResolvedDayDecisionSource === 'carryover-main'
      ? (signedInVerifiedPredecessorBaton?.excludedPreviousCard?.fragrance_id ?? null)
      : null;
    const carryoverExclusionIds = predecessorExclusionId ? [predecessorExclusionId] : [];

    let currentLaneStack = readMoodLaneStack(moodKey);
    if (currentLaneStack.length === 0 && stackArr.length > 0) {
      currentLaneStack = writeMoodLaneStack(
        moodKey,
        stackArr.map((entry: any) => modeValueToBackendModeEntry(entry, mood)),
      );
      if (currentLaneStack.length > 0) {
        setMoodCacheVersion((version) => version + 1);
      }
    }

    if (mood !== betaSafeSignedInMood) {
      const nextHistory = [
        ...signedInModeHistoryRef.current,
        { mood: betaSafeSignedInMood, layerIndex: signedInLayerIdxByMood[betaSafeSignedInMood] ?? 0 },
      ];
      signedInModeHistoryRef.current = nextHistory;
      setSignedInModeHistory(nextHistory);
      setSelectedMood(mood);
      syncMoodLaneSelectedEntry(moodKey, signedInLayerIdxByMood[mood] ?? 0);
      if (currentLaneStack.length === 0) {
        void ensureMoodLaneDepth(currentCardId, mood, 0, carryoverExclusionIds);
      }
      return;
    }

    const currentIndex = signedInLayerIdxByMood[mood] ?? 0;
    const targetIndex = currentLaneStack.length > 0 ? currentIndex + 1 : 0;
    if (currentLaneStack.length > targetIndex) {
      setSignedInLayerIdxByMood((prev) => ({ ...prev, [mood]: targetIndex }));
      syncMoodLaneSelectedEntry(moodKey, targetIndex);
      return;
    }

    void ensureMoodLaneDepth(currentCardId, mood, targetIndex, carryoverExclusionIds).then((stack) => {
      if (stack.length > targetIndex) {
        setSignedInLayerIdxByMood((prev) => ({ ...prev, [mood]: targetIndex }));
        syncMoodLaneSelectedEntry(moodKey, targetIndex);
        return;
      }

      if (stack.length > 0) {
        setSignedInLayerIdxByMood((prev) => ({ ...prev, [mood]: 0 }));
        syncMoodLaneSelectedEntry(moodKey, 0);
        return;
      }

      syncMoodLaneSelectedEntry(moodKey, currentIndex);
      odaraDebugLog('[Odara][SignedIn][lane] mood re-tap exhausted', { mood, currentIndex, stackLen: stack.length });
    });
  }, [
    lockState,
    visibleCard,
    isGuestMode,
    activeOracle,
    oracle,
    betaSafeSignedInMood,
    signedInLayerIdxByMood,
    selectedDate,
    selectedContext,
    signedInResolvedDayDecisionSource,
    signedInVerifiedPredecessorBaton,
    readMoodLaneStack,
    writeMoodLaneStack,
    syncMoodLaneSelectedEntry,
    ensureMoodLaneDepth,
  ]);

  // Lock icon color
  const lockIconColor = lockState === 'locked' ? '#22c55e' : 'currentColor';

  // Helper: record/clear locked selection for weekly lanes
  const recordLockedSelection = useCallback(() => {
    const resolvedHeroFamily = activeMainCardRender?.activeHero?.family ?? visibleCard?.family ?? '';
    if (!resolvedHeroFamily) return;
    const key = `${selectedDate}:${selectedContext}`;
    const mainColor = FAMILY_COLORS[resolvedHeroFamily] ?? '#888';
    const layerFamily = activeMainCardRender?.activeLayer?.family_key ?? null;
    const layerColor = layerFamily ? FAMILY_COLORS[layerFamily] ?? null : null;
    setLockedSelections(prev => ({ ...prev, [key]: { mainColor, layerColor } }));
  }, [activeMainCardRender, visibleCard?.family, selectedDate, selectedContext]);

  const recordGuestLockedSelection = useCallback(() => {
    if (!activeGuestRender?.activeHero) return;
    const key = `${selectedDate}:${selectedContext}`;
    const mainFamily = activeGuestRender.activeHero.family ?? '';
    const layerFamily = activeGuestRender.activeLayer?.family ?? null;
    const mainColor = FAMILY_COLORS[mainFamily] ?? '#888';
    const layerColor = layerFamily ? FAMILY_COLORS[layerFamily] ?? null : null;
    setLockedSelections(prev => ({ ...prev, [key]: { mainColor, layerColor } }));
  }, [activeGuestRender, selectedDate, selectedContext]);

  // ── Skip = advance through queue cards ──
  const handleSkipLocal = useCallback(async () => {
    if (skipLoading || !visibleCard || lockState === 'locked' || signedInIsReadOnlyHistoryCard) return;

    let effectiveVisibleCard = visibleCard;
    let effectivePromotedAltId = promotedAltId;
    let effectiveSelectedMood: LayerMood = betaSafeSignedInMood;

    const hasManualPreview = signedInResolvedDayDecisionSource === 'manual'
      || !!signedInDayState.manualHeroCard
      || !!signedInDayState.manualLayerCard;

    if (hasManualPreview) {
      const currentDayState = signedInDayStateMapRef.current[currentDayStateKey] ?? createDefaultSignedInDayState();
      const clearedDayState: SignedInDayState = {
        ...currentDayState,
        manualHeroCard: null,
        manualLayerCard: null,
      };
      const previewClearedDecision = resolveSearchPreviewDecision(clearedDayState);

      updateSignedInDayState(currentDayStateKey, (current) => (
        current.manualHeroCard || current.manualLayerCard
          ? { ...current, manualHeroCard: null, manualLayerCard: null }
          : current
      ));
      clearSignedInSearchPreviewSnapshot(currentDayStateKey);

      applySignedInSearchPreviewDecision(previewClearedDecision);
      if (!previewClearedDecision?.visibleCard) return;

      effectiveVisibleCard = previewClearedDecision.visibleCard;
      effectivePromotedAltId = previewClearedDecision.promotedAltId;
      effectiveSelectedMood = getBetaSafeLayerMood(previewClearedDecision.selectedMood ?? 'balance');
    }

    setSkipLoading(true);

    // Fire-and-forget backend skip via canonical RPC
    void odaraSupabase.rpc('skip_oracle_selection_v1' as any, {
      p_user: userId,
      p_fragrance_id: effectiveVisibleCard.fragrance_id,
      p_context: selectedContext,
      p_skip_date: selectedDate,
    }).then(
      () => odaraDebugLog('[Odara] skip rpc success (fire-forget)', { userId, fragranceId: effectiveVisibleCard.fragrance_id, context: selectedContext, skipDate: selectedDate, rpc: 'skip_oracle_selection_v1' }),
      (err: any) => console.error('[Odara] skip rpc fail (fire-forget)', { userId, fragranceId: effectiveVisibleCard.fragrance_id, context: selectedContext, skipDate: selectedDate, rpc: 'skip_oracle_selection_v1', error: err?.message })
    );

    // Slide the card down
    setSkipAnimating(true);
    await new Promise(r => window.setTimeout(r, 350));
    setSkipAnimating(false);

    try {
      const currentMoodKey = effectiveSelectedMood ?? 'balance';
      const currentResolvedEntry = getResolvedMoodLaneEntry(effectiveVisibleCard.fragrance_id, currentMoodKey);
      odaraDebugLog('[Odara] history push (skip)', { id: effectiveVisibleCard.fragrance_id, mood: currentMoodKey, resolved: currentResolvedEntry ? { id: currentResolvedEntry.layer_fragrance_id, name: currentResolvedEntry.layer_name } : null });
      setViewHistory(h => [
        ...h.slice(-(MAX_SESSION_HISTORY - 1)),
        {
          card: effectiveVisibleCard,
          queuePointerBefore: queuePointer,
          promotedAltId: effectivePromotedAltId,
          selectedMood: effectiveSelectedMood,
          resolvedVisibleModeEntry: currentResolvedEntry,
        },
      ]);

      if (queuePointer < queue.length) {
        const nextCard = queue[queuePointer];
        setVisibleCard(nextCard);
        setQueuePointer(queuePointer + 1);
      } else {
        const newQueue = await fetchQueue(effectiveVisibleCard.fragrance_id);
        if (newQueue.length > 0) {
          setQueue(newQueue);
          setVisibleCard(newQueue[0]);
          setQueuePointer(1);
        }
      }

      setPromotedAltId(null);
      setSelectedMood('balance');
      setSignedInLayerIdxByMood({ balance: 0, bold: 0, smooth: 0, wild: 0 });
      setLayerExpanded(false);
      setLockState('neutral');
    } finally {
      setSkipLoading(false);
    }
  }, [skipLoading, visibleCard, lockState, signedInIsReadOnlyHistoryCard, signedInResolvedDayDecisionSource, signedInDayState, currentDateKey, queue, queuePointer, fetchQueue, userId, selectedContext, selectedDate, betaSafeSignedInMood, promotedAltId, setLockState, getResolvedMoodLaneEntry, updateSignedInDayState, resolveSearchPreviewDecision, applySignedInSearchPreviewDecision, getBetaSafeLayerMood, clearSignedInSearchPreviewSnapshot, currentDayStateKey]);

  // ── Back button — restore exact history snapshot ──
  const handleBack = useCallback(() => {
    // Guest v5: unwind alternate state, then mode-layer depth, before normal back.
    if (handleGuestBack()) return;
    if (viewHistory.length === 0 || lockState === 'locked' || signedInIsReadOnlyHistoryCard) return;
    const entry = viewHistory[viewHistory.length - 1];

    const restoredMood = getBetaSafeLayerMood(entry.selectedMood ?? 'balance');
    odaraDebugLog('[Odara] back restore', {
      restoredId: entry.card.fragrance_id,
      restoredMood,
      restoredPromotedAltId: entry.promotedAltId,
      resolvedEntry: entry.resolvedVisibleModeEntry ? { id: entry.resolvedVisibleModeEntry.layer_fragrance_id, name: entry.resolvedVisibleModeEntry.layer_name } : null,
      historyDepth: viewHistory.length,
    });

    // Seed the mood cache with the saved resolved entry so visibleModeEntry is immediately correct
    if (entry.resolvedVisibleModeEntry) {
      const restoreCacheKey = buildMoodLaneKey(`${selectedDate}|${selectedContext}`, entry.card.fragrance_id, restoredMood);
      const restoredStack = appendUniqueBackendModeEntries(readMoodLaneStack(restoreCacheKey), [entry.resolvedVisibleModeEntry]);
      const restoredIndex = Math.max(
        0,
        restoredStack.findIndex((candidate) => isSameBackendModeEntryIdentity(candidate, entry.resolvedVisibleModeEntry)),
      );
      writeMoodLaneStack(restoreCacheKey, restoredStack, restoredIndex);
      setMoodCacheVersion((version) => version + 1);
    }

    setVisibleCard(entry.card);
    setQueuePointer(entry.queuePointerBefore);
    setPromotedAltId(entry.promotedAltId);
    setSelectedMood(restoredMood);
    setViewHistory(h => h.slice(0, -1));
    setLayerExpanded(false);
    setLockState('neutral');
  }, [viewHistory, handleGuestBack, lockState, signedInIsReadOnlyHistoryCard, selectedDate, selectedContext, readMoodLaneStack, writeMoodLaneStack, getBetaSafeLayerMood]);

  const pulseLock = useCallback((type: 'lock' | 'unlock' = 'lock') => {
    setLockPulse(true);
    setLockPulseType(type);
    if (lockPulseTimeoutRef.current !== null) {
      window.clearTimeout(lockPulseTimeoutRef.current);
    }
    lockPulseTimeoutRef.current = window.setTimeout(() => {
      setLockPulse(false);
      setLockPulseType(null);
      lockPulseTimeoutRef.current = null;
    }, 400);
  }, []);

  const unlockGuestCard = useCallback(() => {
    setGuestLocked(false);
    setLockedGuestSnapshot(null);
    clearLockedSelection();
    setGuestUnlockFlash(true);
    window.setTimeout(() => setGuestUnlockFlash(false), 700);
    pulseLock('unlock');
    haptic('success');
  }, [clearLockedSelection, pulseLock]);

  const engageGuestLock = useCallback(() => {
    if (guestLocked || !activeGuestRender) return;
    setLockedGuestSnapshot(activeGuestRender);
    setGuestLocked(true);
    recordGuestLockedSelection();
    setGuestLockFlash(true);
    window.setTimeout(() => setGuestLockFlash(false), 700);
    haptic('success');
  }, [guestLocked, activeGuestRender, recordGuestLockedSelection]);

  const clearUnlockTimeout = useCallback(() => {
    if (unlockTimeoutRef.current !== null) {
      window.clearTimeout(unlockTimeoutRef.current);
      unlockTimeoutRef.current = null;
    }
  }, []);

  const clearCarryoverPulseTimeout = useCallback(() => {
    if (carryoverPulseTimeoutRef.current !== null) {
      window.clearTimeout(carryoverPulseTimeoutRef.current);
      carryoverPulseTimeoutRef.current = null;
    }
  }, []);

  const clearCarryoverCloseFlashTimeout = useCallback(() => {
    if (carryoverCloseFlashTimeoutRef.current !== null) {
      window.clearTimeout(carryoverCloseFlashTimeoutRef.current);
      carryoverCloseFlashTimeoutRef.current = null;
    }
  }, []);

  const triggerSignedInCarryoverPulse = useCallback((target: Exclude<SignedInCarryoverTarget, 'off'> | null) => {
    clearCarryoverPulseTimeout();
    setSignedInCarryoverPulseTarget(target);
    if (!target) return;
    carryoverPulseTimeoutRef.current = window.setTimeout(() => {
      setSignedInCarryoverPulseTarget((current) => (current === target ? null : current));
      carryoverPulseTimeoutRef.current = null;
    }, 700);
  }, [clearCarryoverPulseTimeout]);

  const triggerSignedInCarryoverCloseFlash = useCallback(() => {
    clearCarryoverCloseFlashTimeout();
    setSignedInCarryoverCloseFlash(true);
    carryoverCloseFlashTimeoutRef.current = window.setTimeout(() => {
      setSignedInCarryoverCloseFlash(false);
      carryoverCloseFlashTimeoutRef.current = null;
    }, 520);
  }, [clearCarryoverCloseFlashTimeout]);

  useEffect(() => {
    return () => clearUnlockTimeout();
  }, [clearUnlockTimeout]);

  useEffect(() => {
    return () => clearCarryoverPulseTimeout();
  }, [clearCarryoverPulseTimeout]);

  useEffect(() => {
    return () => clearCarryoverCloseFlashTimeout();
  }, [clearCarryoverCloseFlashTimeout]);

  useEffect(() => {
    setDaySwipeOffset(0);
    setDaySwipeDragging(false);
    suppressCardClickRef.current = false;
    setSignedInCarryoverPulseTarget(null);
    clearCarryoverPulseTimeout();
    setSignedInCarryoverCloseFlash(false);
    clearCarryoverCloseFlashTimeout();
  }, [selectedDate, clearCarryoverPulseTimeout, clearCarryoverCloseFlashTimeout]);

  /* ──────────────────────────────────────────────────────────────
   * Card interaction contract:
   *   - guest: double tap on the main scent-card shell = lock
   *   - signed-in: double tap on the overall card = like + lock
   *   - single tap on the layer section = expand/collapse
   *     (LayerCard handles its own onClick + stopPropagation)
   *   - swipe-up lock has been REMOVED
   *   - manual unlock is still available via the lock icon button
   * ────────────────────────────────────────────────────────────── */
  const handleCardClick = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!visibleCard) return;
    if (suppressCardClickRef.current) {
      suppressCardClickRef.current = false;
      return;
    }

    const target = e.target as HTMLElement;
    // Never treat taps on action stack buttons, layer section, or other
    // interactive elements as a card double-tap.
    if (target.closest('[data-action-stack]')) return;
    if (target.closest('[data-debug-controls]')) return;
    if (target.closest('[data-layer-section]')) return;
    if (target.closest('[data-guest-profile-reserved]')) return;
    if (target.closest('button, a, input, textarea, select, [role="button"]')) return;

    const now = Date.now();
    const last = lastTapRef.current;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    const within = (now - last.time) <= DOUBLE_TAP_MS &&
      Math.hypot(dx, dy) <= DOUBLE_TAP_DIST;

    if (isGuestMode) {
      if (!within) {
        lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };
        return;
      }
      lastTapRef.current = { time: 0, x: 0, y: 0 };
      if (guestLocked) {
        // Double-tap on locked guest card → unlock (visible scent decision
        // stays exactly as it currently renders).
        unlockGuestCard();
        return;
      }
      engageGuestLock();
      return;
    }

    // Signed-in
    if (signedInIsReadOnlyHistoryCard) return;

    if (!within) {
      lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };
      return;
    }
    lastTapRef.current = { time: 0, x: 0, y: 0 };

    if (lockState === 'locked') {
      // Double-tap on locked signed-in card → unlock only.
      // Do NOT call onAccept, do NOT change hero/layer/mood/alternates/date/context.
      clearUnlockTimeout();
      setLockState('neutral');
      clearLockedSelection();
      setUnlockFlash(true);
      window.setTimeout(() => setUnlockFlash(false), 700);
      pulseLock('unlock');
      haptic('light');
      return;
    }

    // Second tap on unlocked card → like + lock together.
    clearUnlockTimeout();
    const didLock = engageSignedInLock();
    if (!didLock) return;
    haptic('medium');

    // Visual confirmation: like pulse + lock burst.
    setLikeFlash(true);
    window.setTimeout(() => setLikeFlash(false), 600);
    setLockFlash(true);
    window.setTimeout(() => setLockFlash(false), 700);
    pulseLock('lock');

    // NOTE: backend "like" persistence is not yet wired — when it lands,
    // call it here alongside onAccept. Lock persistence runs through onAccept.
    const visibleHeroId = activeMainCardRender?.resolvedCurrentCard?.fragrance_id ?? visibleCard.fragrance_id;
    const visibleLayerId = activeMainCardRender?.activeLayer?.id ?? null;
    try {
      await onAccept(visibleHeroId, visibleLayerId);
    } catch (err) {
      console.warn('[Odara] onAccept failed after double-tap lock', err);
    }
  }, [
    visibleCard,
    activeMainCardRender,
    isGuestMode,
    guestLocked,
    engageGuestLock,
    unlockGuestCard,
    signedInIsReadOnlyHistoryCard,
    lockState,
    setLockState,
    clearLockedSelection,
    clearUnlockTimeout,
    pulseLock,
    onAccept,
  ]);

  const handleCardClickCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressCardClickRef.current) return;
    suppressCardClickRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /* ──────────────────────────────────────────────────────────────
   * Hero-card day gestures:
   *   - horizontal swipe → day navigation
   *   - vertical movement → native page scroll only
   * Touch and pointer each get a native path so real mobile/webview swipes
   * do not depend on pointer-event quirks.
   * Swipe-up-to-lock and swipe-down-to-skip are intentionally disabled.
   * ────────────────────────────────────────────────────────────── */
  const buildIdleSwipeState = () => ({
    active: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    startTs: 0,
    lastTs: 0,
    direction: 'none' as const,
    fired: false,
    pointerId: null as number | null,
    source: null as 'pointer' | 'touch' | null,
  });
  const swipeRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    startTs: number;
    lastTs: number;
    direction: 'none' | 'horizontal';
    fired: boolean;
    pointerId: number | null;
    source: 'pointer' | 'touch' | null;
  }>(buildIdleSwipeState());
  const lastCardPointerTypeRef = useRef<string>('');

  // ── CARD GESTURE LIFECYCLE RESET ──
  // Any pending pointer/gesture state from the prior visible card MUST be
  // cleared the instant a new visible card mounts. Without this, a leaked
  // `fired:true` flag (e.g. from an aborted pointer or rapid card swap) can
  // block subsequent horizontal day-swipes from firing on later cards.
  useEffect(() => {
    swipeRef.current = buildIdleSwipeState();
    lastCardPointerTypeRef.current = '';
    setDaySwipeOffset(0);
    setDaySwipeDragging(false);
    suppressCardClickRef.current = false;
  }, [visibleCard?.fragrance_id, lockState, queuePointer, viewHistory.length, skipAnimating]);

  // Horizontal day-swipes may start anywhere on the visible card body,
  // including the layer/alternates area. Only genuine interactive controls
  // (buttons, links, inputs, explicit opt-outs) block the gesture from
  // starting — large content regions must remain swipable on mobile.
  const isInteractiveSwipeTarget = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    if (!el || !el.closest) return false;
    if (el.closest('[data-card-swipe-allow]')) return false;
    return !!(
      el.closest('[data-no-card-swipe]') ||
      el.closest('button, a, input, textarea, select, [role="button"], [role="slider"], [role="switch"]')
    );
  };

  const resolveSwipeStartTarget = (
    fallbackTarget: EventTarget | null,
    clientX: number,
    clientY: number,
  ) => {
    if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
      return fallbackTarget;
    }
    return document.elementFromPoint(clientX, clientY) ?? fallbackTarget;
  };

  const handleCardPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!visibleCard) return;
    if (e.pointerType === 'touch') return;
    if (isInteractiveSwipeTarget(resolveSwipeStartTarget(e.target, e.clientX, e.clientY))) return;
    lastCardPointerTypeRef.current = e.pointerType;
    // The hero card uses touchAction: 'pan-y', so native vertical scrolling
    // remains intact while we selectively claim clear horizontal day-swipes.
    swipeRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      startTs: e.timeStamp,
      lastTs: e.timeStamp,
      direction: 'none',
      fired: false,
      pointerId: e.pointerId,
      source: 'pointer',
    };
  }, [visibleCard]);

  const handleCardPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = swipeRef.current;
    if (!s.active || s.source !== 'pointer' || s.pointerId !== e.pointerId || s.fired) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    s.lastX = e.clientX;
    s.lastY = e.clientY;
    s.lastTs = e.timeStamp;
    if (s.direction === 'none') {
      // Require a CLEAR horizontal intent before claiming a day-swipe. Vertical
      // motion (including downward) is left to the browser via touch-action:
      // pan-y so normal page scrolling never feels hijacked. We only lock
      // horizontal when the gesture is clearly sideways.
      if (!shouldLockHorizontalDaySwipe(dx, dy)) return;
      s.direction = 'horizontal';
      try {
        if (e.currentTarget.setPointerCapture) {
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      } catch { /* noop */ }
    }
    if (s.direction === 'horizontal') {
      const clampedDx = clampDayDragOffset(dx, {
        hasPrevDay: !!prevForecastDay,
        hasNextDay: !!nextForecastDay,
        maxOffset: DAY_SWIPE_MAX_OFFSET,
      });
      setDaySwipeDragging(true);
      setDaySwipeOffset(clampedDx);
      if (Math.abs(dx) > 10) suppressCardClickRef.current = true;
      return;
    }
  }, [
    visibleCard,
    prevForecastDay,
    nextForecastDay,
  ]);

  const handleCardPointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = swipeRef.current;
    if (s.source !== 'pointer' || s.pointerId !== e.pointerId) return;
    const didCancel = e.type === 'pointercancel';
    try {
      if (e.currentTarget.releasePointerCapture && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* safe release */
    }
    if (s.direction === 'horizontal') {
      const dx = e.clientX - s.startX;
      const velocityElapsedMs = Math.max(1, e.timeStamp - (s.lastTs || s.startTs));
      const totalElapsedMs = Math.max(1, e.timeStamp - s.startTs);
      const releaseVelocityX = Math.abs(e.clientX - s.lastX) > 0
        ? (e.clientX - s.lastX) / velocityElapsedMs
        : dx / totalElapsedMs;
      const commit = resolveDayCommit({
        dx,
        velocityX: releaseVelocityX,
        didCancel,
        hasPrevDay: !!prevForecastDay,
        hasNextDay: !!nextForecastDay,
      });
      const targetDate =
        commit === 'next'
          ? (nextForecastDay?.dateStr ?? null)
          : commit === 'prev'
            ? (prevForecastDay?.dateStr ?? null)
            : null;
      setDaySwipeDragging(false);
      setDaySwipeOffset(0);
      if (selectNavigationDay(targetDate)) {
        suppressCardClickRef.current = true;
        haptic('selection');
      }
      swipeRef.current = buildIdleSwipeState();
      return;
    }
    swipeRef.current = buildIdleSwipeState();
  }, [nextForecastDay, prevForecastDay, selectNavigationDay]);

  const resolveTrackedTouch = (
    touchList: React.TouchList,
    touchId: number | null,
  ) => {
    if (touchId == null) return null;
    for (let i = 0; i < touchList.length; i += 1) {
      const touch = touchList.item(i);
      if (touch?.identifier === touchId) {
        return touch;
      }
    }
    return null;
  };

  const handleCardTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!visibleCard) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    if (isInteractiveSwipeTarget(resolveSwipeStartTarget(e.target, touch.clientX, touch.clientY))) return;
    lastCardPointerTypeRef.current = 'touch';
    swipeRef.current = {
      active: true,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      startTs: e.timeStamp,
      lastTs: e.timeStamp,
      direction: 'none',
      fired: false,
      pointerId: touch.identifier,
      source: 'touch',
    };
  }, [visibleCard]);

  const handleCardTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const s = swipeRef.current;
    if (!s.active || s.source !== 'touch' || s.pointerId == null || s.fired) return;
    const touch = resolveTrackedTouch(e.touches, s.pointerId) ?? resolveTrackedTouch(e.changedTouches, s.pointerId);
    if (!touch) return;
    const dx = touch.clientX - s.startX;
    const dy = touch.clientY - s.startY;
    s.lastX = touch.clientX;
    s.lastY = touch.clientY;
    s.lastTs = e.timeStamp;
    if (s.direction === 'none') {
      if (!shouldLockHorizontalDaySwipe(dx, dy)) return;
      s.direction = 'horizontal';
    }
    if (s.direction === 'horizontal') {
      if (e.cancelable) {
        e.preventDefault();
      }
      const clampedDx = clampDayDragOffset(dx, {
        hasPrevDay: !!prevForecastDay,
        hasNextDay: !!nextForecastDay,
        maxOffset: DAY_SWIPE_MAX_OFFSET,
      });
      setDaySwipeDragging(true);
      setDaySwipeOffset(clampedDx);
      if (Math.abs(dx) > 10) suppressCardClickRef.current = true;
    }
  }, [nextForecastDay, prevForecastDay]);

  const handleCardTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const s = swipeRef.current;
    if (s.source !== 'touch' || s.pointerId == null) return;
    const didCancel = e.type === 'touchcancel';
    const touch = resolveTrackedTouch(e.changedTouches, s.pointerId);
    const clientX = touch?.clientX ?? s.lastX;
    if (s.direction === 'horizontal') {
      const dx = clientX - s.startX;
      const velocityElapsedMs = Math.max(1, e.timeStamp - (s.lastTs || s.startTs));
      const totalElapsedMs = Math.max(1, e.timeStamp - s.startTs);
      const releaseVelocityX = touch && Math.abs(clientX - s.lastX) > 0
        ? (clientX - s.lastX) / velocityElapsedMs
        : dx / totalElapsedMs;
      const commit = resolveDayCommit({
        dx,
        velocityX: releaseVelocityX,
        didCancel,
        hasPrevDay: !!prevForecastDay,
        hasNextDay: !!nextForecastDay,
      });
      const targetDate =
        commit === 'next'
          ? (nextForecastDay?.dateStr ?? null)
          : commit === 'prev'
            ? (prevForecastDay?.dateStr ?? null)
            : null;
      setDaySwipeDragging(false);
      setDaySwipeOffset(0);
      if (selectNavigationDay(targetDate)) {
        suppressCardClickRef.current = true;
        haptic('selection');
      }
      swipeRef.current = buildIdleSwipeState();
      return;
    }
    swipeRef.current = buildIdleSwipeState();
  }, [nextForecastDay, prevForecastDay, selectNavigationDay]);

  const handlePromoteAlternate = useCallback((alt: OracleAlternate) => {
    if (lockState === 'locked') return;

    const prevHeroId = visibleCard?.fragrance_id ?? '(none)';
    odaraDebugLog('[Odara] alternate promotion', {
      tappedAltId: alt.fragrance_id,
      tappedAltName: alt.name,
      previousHeroId: prevHeroId,
    });

    const promoted: DisplayCard = {
      fragrance_id: alt.fragrance_id,
      name: alt.name,
      family: alt.family,
      reason: alt.reason,
      brand: alt.brand ?? '',
      notes: alt.notes ?? [],
      accords: alt.accords ?? [],
      reason_chip_label: alt.reason_chip_label ?? null,
      reason_chip_explanation: alt.reason_chip_explanation ?? null,
      isHero: false,
    };

    // 1. Save history
    const currentMoodKey2 = betaSafeSignedInMood;
    const currentResolvedEntry2 = getResolvedMoodLaneEntry(visibleCard!.fragrance_id, currentMoodKey2);
    odaraDebugLog('[Odara] history push (promote)', { id: visibleCard!.fragrance_id, mood: currentMoodKey2, resolved: currentResolvedEntry2 ? { id: currentResolvedEntry2.layer_fragrance_id, name: currentResolvedEntry2.layer_name } : null });
    setViewHistory(h => [
      ...h.slice(-(MAX_SESSION_HISTORY - 1)),
      { card: visibleCard!, queuePointerBefore: queuePointer, promotedAltId, selectedMood: currentMoodKey2, resolvedVisibleModeEntry: currentResolvedEntry2 },
    ]);

    // 2. Clear stale state completely
    setLayerExpanded(false);
    setLockState('neutral');
    updateSignedInDayState(currentDayStateKey, (current) => (
      current.manualHeroCard || current.manualLayerCard
        ? { ...current, manualHeroCard: null, manualLayerCard: null }
        : current
    ));
    clearSignedInSearchPreviewSnapshot(currentDayStateKey);
    setModeLoading({ balance: false, bold: false, smooth: false, wild: false });
    setModeErrors({ balance: null, bold: null, smooth: null, wild: null });

    // 3. Set new card state BEFORE fetch
    setVisibleCard(promoted);
    setPromotedAltId(alt.fragrance_id);
    setSignedInResolvedDayDecisionSource('oracle');
    setSelectedMood('balance');
    setSignedInLayerIdxByMood({ balance: 0, bold: 0, smooth: 0, wild: 0 });

    // 4. Immediately trigger BALANCE layer fetch for the promoted scent
    const capturedAltId = alt.fragrance_id;
    odaraDebugLog('[Odara] alternate promotion: fetching balance for', capturedAltId);
    void fetchMoodForCard(capturedAltId, 'balance').then((entry) => {
      odaraDebugLog('[Odara] alternate promotion: balance result', {
        promotedId: capturedAltId,
        balanceLayerName: entry?.layer_name ?? '(null)',
        balanceLayerId: entry?.layer_fragrance_id ?? '(null)',
      });
    });
  }, [lockState, visibleCard, queuePointer, promotedAltId, fetchMoodForCard, selectedDate, selectedContext, getResolvedMoodLaneEntry, updateSignedInDayState, currentDateKey, clearSignedInSearchPreviewSnapshot, currentDayStateKey]);

  // ─────────────────────────────────────────────────────────────────────────
  // SHARED CARD CONTROLLER BRIDGE
  // Minimal-diff normalization layer over existing guest/signed-in handlers.
  // JSX must call cardController.actions instead of the underlying handlers
  // so the same interaction gates apply to BOTH modes.
  // ─────────────────────────────────────────────────────────────────────────

  // (1) Normalized guest action key — current visible guest card only.
  //     Excludes mood/layerIdx/expanded/animation state by design.
  // Star key reads from the visible card so a locked snapshot stays scoped
  // to whatever the user actually sees.
  const guestHero: any = visibleGuestRender?.activeHero ?? null;
  const guestHeroId =
    guestHero?.fragrance_id ??
    guestHero?.id ??
    guestHero?.name ??
    '';
  const guestHeroBrand = guestHero?.brand ?? '';

  // Star = card-scoped (date + context + visible hero id + brand).
  const guestStarKey = isGuestMode
    ? `${selectedDate}|${selectedContext}|${guestHeroId}|${guestHeroBrand}`
    : '';

  // (2) Single normalized lock gate — guest lock is one authoritative boolean.
  const guestLockedForCurrentCard = isGuestMode && guestLocked;
  const signedInResolvedLockActive = !isGuestMode && !!signedInResolvedLockTruth;
  const isCardLocked = isGuestMode
    ? guestLockedForCurrentCard
    : signedInResolvedLockActive;
  const isReadOnlyHistoryCard = signedInIsReadOnlyHistoryCard;

  // (3) Normalized action-rail state.
  const guestStarredForCurrentCard =
    isGuestMode && !!guestStarredByKey[guestStarKey];
  const guestHasRealHistory =
    isGuestMode && (selectedAlternateIdx !== null || guestSkipHistory.length > 0);
  const isLayerDetailExpanded = isGuestMode ? guestLayerExpanded : layerExpanded;
  const guestModeHistoryAvailable =
    isGuestMode && !guestLockedForCurrentCard && !isReadOnlyHistoryCard && guestModeHistory.length > 0;
  const signedInModeHistoryAvailable =
    !isGuestMode && !signedInResolvedLockActive && !isReadOnlyHistoryCard && signedInModeHistory.length > 0;
  const showPreviewBack = !isGuestMode && !isReadOnlyHistoryCard && (signedInManualPreviewActive || signedInSearchPreviewSnapshotActive);
  const showModeBack = isGuestMode ? guestModeHistoryAvailable : signedInModeHistoryAvailable;
  const showHistoryBack = isGuestMode ? guestHasRealHistory : hasHistory;
  const actionRailState = {
    locked: isCardLocked,
    starred: isGuestMode ? guestStarredForCurrentCard : signedInFavoriteActive,
    showBack: isLayerDetailExpanded || showPreviewBack || showModeBack || showHistoryBack,
    showDetailBack: isLayerDetailExpanded,
    showPreviewBack,
    showModeBack,
    showHistoryBack,
  };

  // (4) cardController — single behavior contract for both modes.
  //     Each action enforces isCardLocked before delegating to the existing
  //     mode-specific handler. JSX must call these — not the raw handlers.
  const cardController = {
    state: {
      isCardLocked,
      actionRailState,
    },
    actions: {
      toggleLock: () => {
        if (isGuestMode) {
          // Guest lock is an engage-only latch from the icon. Unlocking stays
          // on the locked-card interaction path so guest remains read-only and
          // predictable.
          if (guestLocked) {
            return;
          }
          if (!activeGuestRender) {
            return;
          }
          engageGuestLock();
          return;
        }
        if (isReadOnlyHistoryCard) return;
        if (lockState === 'locked') {
          setLockState('neutral');
          clearLockedSelection();
          setUnlockFlash(true);
          window.setTimeout(() => setUnlockFlash(false), 700);
          pulseLock('unlock');
          // Lighter tick on unlock — fired only after the unlock is accepted.
          haptic('light');
          return;
        }
        clearUnlockTimeout();
        const didLock = engageSignedInLock();
        if (!didLock) return;
        setLockFlash(true);
        window.setTimeout(() => setLockFlash(false), 700);
        pulseLock('lock');
        // Stronger tick on lock — fired only after the lock is accepted.
        haptic('medium');
      },
      toggleStar: () => {
        if (isGuestMode) {
          if (!guestStarKey) return;
          const wasStarred = guestStarredForCurrentCard;
          setGuestStarredByKey(prev => {
            const next = { ...prev };
            if (wasStarred) delete next[guestStarKey];
            else next[guestStarKey] = true;
            return next;
          });
          setGuestStarFlash(true);
          window.setTimeout(() => setGuestStarFlash(false), 500);
          haptic(wasStarred ? 'selection' : 'success');
          return;
        }
        if (isReadOnlyHistoryCard) return;
        if (!userId || !signedInActionFragranceId || signedInFavoritePending) return;
        const fragranceId = signedInActionFragranceId;
        const nextFavorite = !signedInFavoriteActive;
        const previousFavorite = signedInFavoriteByFragranceId[fragranceId] === true;

        setSignedInFavoriteByFragranceId(prev => ({ ...prev, [fragranceId]: nextFavorite }));
        setFavoriteWritePendingByFragranceId(prev => ({ ...prev, [fragranceId]: true }));
        haptic(nextFavorite ? 'success' : 'light');

        void Promise.resolve(odaraSupabase.rpc('set_user_fragrance_favorite_v1' as any, {
          p_fragrance_id: fragranceId,
          p_favorite: nextFavorite,
          p_source: 'odara_action_row',
        } as any)).then(({ error, data }: any) => {
          if (error) throw error;

          const resolvedFavorite = Boolean(
            (data as any)?.favorite
            ?? (data as any)?.wear_more
            ?? nextFavorite
          );
          setSignedInFavoriteByFragranceId(prev => ({ ...prev, [fragranceId]: resolvedFavorite }));
        }).catch((error: any) => {
          console.error('[Odara] favorite write failed', error);
          setSignedInFavoriteByFragranceId(prev => ({ ...prev, [fragranceId]: previousFavorite }));
        }).finally(() => {
          setFavoriteWritePendingByFragranceId(prev => {
            const next = { ...prev };
            delete next[fragranceId];
            return next;
          });
        });
      },
      selectMood: (mood: any) => {
        if (isCardLocked || isReadOnlyHistoryCard) return;
        if (isGuestMode) {
          handleGuestModeTap(mood as GuestModeKey);
        } else {
          handleMoodSelect(mood as LayerMood);
        }
      },
      promoteAlternate: (alt: any, idx?: number) => {
        if (isCardLocked || isReadOnlyHistoryCard) return;
        if (isGuestMode) {
          if (typeof idx === 'number') handleGuestAlternateTap(idx);
        } else {
          handlePromoteAlternate(alt);
        }
      },
      back: () => {
        // Back never modifies the locked decision — the locked card stays
        // visible. We still allow back to be a no-op while locked.
        if (isCardLocked || isReadOnlyHistoryCard) return;
        handleBack();
      },
      nextPick: async () => {
        if (isCardLocked) return 'locked' as const;
        if (isReadOnlyHistoryCard) return 'read_only' as const;
        if (isGuestMode) {
          return await handleGuestNextLocal();
        }
        await handleSkipLocal();
        return 'advanced' as const;
      },
    },
  };

  const handleNextButtonPress = useCallback(() => {
    void cardController.actions.nextPick().then((result) => {
      if (result === 'read_only') return;

      if (result === 'locked') {
        setNextLabelText('Locked');
      } else if (result === 'unavailable') {
        setNextLabelText(isGuestMode ? 'No next pick' : 'Unavailable');
      } else {
        setNextLabelText('Next');
      }

      setNextLabelTick((tick) => tick + 1);
    });
  }, [cardController.actions, isGuestMode]);

  const collapseLayerDetail = useCallback(() => {
    if (isGuestMode) {
      setGuestLayerExpanded(false);
      return;
    }
    setLayerExpanded(false);
  }, [isGuestMode]);

  const handleLocalLayerBack = useCallback(() => {
    if (isLayerDetailExpanded) {
      collapseLayerDetail();
      return true;
    }

    if (!isGuestMode && (signedInManualPreviewActive || signedInSearchPreviewSnapshotActive)) {
      void clearSearchPreviewFromSelectedDay('all');
      return true;
    }

    if (isGuestMode) {
      if (!guestModeHistoryAvailable) return false;
      const nextHistory = guestModeHistoryRef.current.slice(0, -1);
      const previous = guestModeHistoryRef.current[guestModeHistoryRef.current.length - 1] ?? null;
      if (!previous) return false;
      guestModeHistoryRef.current = nextHistory;
      setGuestModeHistory(nextHistory);
      setGuestSelectedMood(previous.mood);
      setGuestLayerIdxByMood((current) => ({ ...current, [previous.mood]: previous.layerIndex }));
      return true;
    }

    if (!signedInModeHistoryAvailable || !visibleCard) return false;
    const nextHistory = signedInModeHistoryRef.current.slice(0, -1);
    const previous = signedInModeHistoryRef.current[signedInModeHistoryRef.current.length - 1] ?? null;
    if (!previous) return false;
    const restoredMood = getBetaSafeLayerMood(previous.mood);
    signedInModeHistoryRef.current = nextHistory;
    setSignedInModeHistory(nextHistory);
    setSelectedMood(restoredMood);
    setSignedInLayerIdxByMood((prev) => ({ ...prev, [restoredMood]: previous.layerIndex }));
    const moodKey = buildMoodLaneKey(`${selectedDate}|${selectedContext}`, visibleCard.fragrance_id, restoredMood);
    syncMoodLaneSelectedEntry(moodKey, previous.layerIndex);
    return true;
  }, [
    isLayerDetailExpanded,
    collapseLayerDetail,
    isGuestMode,
    signedInManualPreviewActive,
    signedInSearchPreviewSnapshotActive,
    clearSearchPreviewFromSelectedDay,
    guestModeHistoryAvailable,
    signedInModeHistoryAvailable,
    visibleCard,
    selectedDate,
    selectedContext,
    syncMoodLaneSelectedEntry,
    getBetaSafeLayerMood,
  ]);

  if (isGuestMode) {
    const o: any = oracle ?? {};
    odaraDebugLog('[Odara][Guest] render summary', {
      style_key: o.style_key ?? null,
      style_name: o.style_name ?? null,
      weekday_slot: o.weekday_slot ?? null,
      hero_name: o.today_pick?.name ?? null,
      hero_bind_status: o.today_pick?.bind_status ?? null,
      layer_name: o.layer?.name ?? null,
      alternates_count: Array.isArray(o.alternates) ? o.alternates.length : 0,
      visibleCardId: visibleCard?.fragrance_id ?? null,
      isShowingHeroCard,
    });
  }

  const guestResolvedCurrentCard = useMemo(() => {
    if (!isGuestMode || !visibleGuestRender?.activeHero) return null;

    const hero: any = visibleGuestRender.activeHero ?? null;
    const heroId = hero?.fragrance_id ?? hero?.id ?? null;
    const heroDetail = heroId ? (fragranceDetailCacheRef.current.get(heroId) ?? null) : null;
    const heroImageUrl = resolveBottleImageUrl(hero, heroDetail);
    const heroFamilyKey = typeof hero?.family === 'string' ? hero.family : '';
    const heroFamilyLabel = heroFamilyKey
      ? (FAMILY_LABELS[heroFamilyKey] ?? heroFamilyKey.toUpperCase())
      : '';
    const heroFamilyColor = heroFamilyKey
      ? (FAMILY_COLORS[heroFamilyKey] ?? '#888')
      : '#888';
    const heroNotes = sanitizeTokenSource(hero?.notes);
    const heroAccords = sanitizeTokenSource(hero?.accords);
    const heroTokens = (Array.isArray(visibleGuestRender.activeHeroTokens) ? visibleGuestRender.activeHeroTokens : [])
      .filter((token: any) => {
        const label = token?.token_label ?? token?.label ?? token?.name ?? '';
        return typeof label === 'string' && label.trim().length > 0;
      });
    const layer = guestLayerToModeEntry(visibleGuestRender.activeLayer);
    const layerDetail = layer?.id ? (fragranceDetailCacheRef.current.get(layer.id) ?? null) : null;
    const layerImageUrl = resolveBottleImageUrl(visibleGuestRender.activeLayer, layer, layerDetail);
    const layerTokens = resolveGuestLayerTokens(
      visibleGuestRender.activeLayer,
      hero,
      Array.isArray(visibleGuestRender.activeLayer?.tokens) ? visibleGuestRender.activeLayer.tokens : [],
    )
      .filter((token: any) => {
        const label = token?.token_label ?? token?.label ?? token?.name ?? '';
        return typeof label === 'string' && label.trim().length > 0;
      });
    const layerFamilyKey = layer?.family_key ?? '';
    const layerFamilyLabel = layerFamilyKey
      ? (FAMILY_LABELS[layerFamilyKey] ?? layerFamilyKey.toUpperCase())
      : '';
    const reasonChip = visibleGuestRender.reasonChipLabel
      ? {
          label: visibleGuestRender.reasonChipLabel,
          explanation: visibleGuestRender.reasonChipExplanation ?? null,
        }
      : null;
    const guestAlternates = (Array.isArray(visibleGuestRender.alternates) ? visibleGuestRender.alternates : [])
      .map((bundle: any, originalIdx: number) => {
        const altHero = bundle?.hero ?? null;
        const altFamily = typeof altHero?.family === 'string' ? altHero.family : '';
        return {
          key: `guest-alt-${originalIdx}-${altHero?.fragrance_id ?? altHero?.name ?? 'unknown'}`,
          label: getDisplayName(altHero?.name ?? '', altHero?.brand ?? null),
          family: altFamily,
          source: 'guest' as const,
          alternate: bundle,
          originalIdx,
        };
      })
      .filter((item) => item.label && item.originalIdx !== selectedAlternateIdx);
    const filteredGuestAlternates = filterAlternatesAgainstVisibleScents(
      guestAlternates,
      (item: any) => item?.alternate?.hero ?? null,
      [hero, layer],
    );

    return {
      fragrance_id: hero?.fragrance_id ?? hero?.id ?? null,
      name: hero?.name ?? '',
      brand: hero?.brand ?? '',
      family: heroFamilyKey,
      image_url: heroImageUrl,
      familyLabel: heroFamilyLabel,
      familyColor: heroFamilyColor,
      notes: heroNotes,
      accords: heroAccords,
      layer: layer ? { ...layer, image_url: layerImageUrl ?? layer.image_url ?? null } : null,
      layerFamilyKey,
      layerFamilyLabel,
      layerTokens,
      layerModes: guestLayerModesToModeSelector(visibleGuestRender.layerModes),
      alternates: filteredGuestAlternates,
      selectedMode: visibleGuestRender.selectedMode,
      resolvedHeroRail: {
        familyLabel: heroFamilyLabel,
        familyColor: heroFamilyColor,
        reasonChip,
        tokens: heroTokens,
      },
    };
  }, [isGuestMode, visibleGuestRender, selectedAlternateIdx, fragranceDetailVersion]);

  const signedInResolvedCurrentCard = useMemo(() => {
    if (isGuestMode || !activeMainCardRender?.resolvedCurrentCard) return null;

    const current = activeMainCardRender.resolvedCurrentCard;
    const familyLabel = typeof current.familyLabel === 'string' && current.familyLabel.trim().length > 0
      ? current.familyLabel.trim()
      : (current.family ? (FAMILY_LABELS[current.family] ?? current.family.toUpperCase()) : '');
    const normalizedNotes = sanitizeTokenSource(current.notes);
    const normalizedAccords = sanitizeTokenSource(current.accords);
    const layerTokens = (Array.isArray(current.layerTokens) ? current.layerTokens : [])
      .filter((token: any) => {
        const label = token?.token_label ?? token?.label ?? token?.name ?? '';
        return typeof label === 'string' && label.trim().length > 0;
      });
    const currentAny = current as any;
    const resolvedHeroRailReasonChip = current.isHeroCard
      ? (
          resolveReasonChip(current.reason_chip_label, current.reason_chip_explanation)
          ?? currentAny.reasonChip
          ?? null
        )
      : resolveReasonChip(current.reason_chip_label, current.reason_chip_explanation);
    const resolvedHeroRailTokenSource = Array.isArray(currentAny.heroTokens) && currentAny.heroTokens.length > 0
      ? currentAny.heroTokens
      : buildSemanticSurfaceTokens(normalizedNotes, normalizedAccords, new Set(), 4);
    const resolvedHeroRailTokens = resolvedHeroRailTokenSource.filter((token: any) => {
      const label = token?.token_label ?? token?.label ?? token?.name ?? '';
      return typeof label === 'string' && label.trim().length > 0;
    });


    return {
      ...current,
      notes: normalizedNotes,
      accords: normalizedAccords,
      familyLabel,
      layerTokens,
      alternates: Array.isArray(current.alternates) ? current.alternates : [],
      resolvedHeroRail: {
        familyLabel,
        familyColor: current.familyColor ?? '#888',
        reasonChip: resolvedHeroRailReasonChip,
        tokens: resolvedHeroRailTokens,
      },
    };
  }, [isGuestMode, activeMainCardRender]);

  const signedInVisibleLayer = signedInResolvedCurrentCard?.layer ?? null;
  const signedInVisibleLayerModes = signedInResolvedCurrentCard?.layerModes ?? modeResults;
  const visibleResolvedCurrentCard = isGuestMode ? guestResolvedCurrentCard : signedInResolvedCurrentCard;
  const visibleResolvedHeroRail = visibleResolvedCurrentCard?.resolvedHeroRail ?? null;
  const visibleResolvedLayer = isGuestMode
    ? (guestResolvedCurrentCard?.layer ?? null)
    : signedInVisibleLayer;
  const visibleResolvedSelectedMood = getBetaSafeLayerMood(
    (visibleResolvedCurrentCard?.selectedMode ?? selectedMood) as LayerMood | null | undefined,
  );
  const visibleHeroBottleImageUrl = visibleResolvedCurrentCard?.image_url ?? null;
  const visibleHeroBottleImageCandidates = buildPreferredBottleImageCandidates(visibleResolvedCurrentCard, visibleHeroBottleImageUrl);
  const likelyTransparentHeroBottleImage = isLikelyTransparentBottleImageUrl(visibleHeroBottleImageCandidates[0] ?? visibleHeroBottleImageUrl);
  const visibleLayerBottleImageUrl = visibleResolvedLayer?.image_url ?? null;
  const visibleLayerSprayCounts = useMemo(
    () => deriveSprayCountsFromLayerMode(visibleResolvedLayer as any),
    [visibleResolvedLayer]
  );
  const visibleHeroSprayCount = visibleLayerSprayCounts.main;
  const visibleLayerSprayCount = visibleLayerSprayCounts.layer;
  const heroTitlePressRef = useRef<{
    pointerId: number;
    startedAt: number;
    startX: number;
    startY: number;
  } | null>(null);
  const layerDetailIdentityKey = useMemo(() => (
    `${selectedDate}|${selectedContext}|${visibleResolvedCurrentCard?.fragrance_id ?? 'none'}|${visibleResolvedLayer?.id ?? 'none'}|${visibleResolvedSelectedMood}|${isGuestMode ? (selectedAlternateIdx ?? 'main') : (promotedAltId ?? 'base')}`
  ), [
    selectedDate,
    selectedContext,
    visibleResolvedCurrentCard?.fragrance_id,
    visibleResolvedLayer?.id,
    visibleResolvedSelectedMood,
    isGuestMode,
    selectedAlternateIdx,
    promotedAltId,
  ]);
  const openVisibleHeroDetail = useCallback(() => {
    if (!visibleResolvedCurrentCard) return;
    const heroFamilyLabelForDetail = visibleResolvedHeroRail?.familyLabel ?? '';
    openFragranceDetailSheet({
      ...buildFragranceDetailSurfaceStateFromDisplayCard(visibleResolvedCurrentCard as any),
      collection_status: 'today_pick',
      source_label: 'Today pick',
      family_label: formatPlainFamilyStyleLabel(heroFamilyLabelForDetail) ?? heroFamilyLabelForDetail ?? null,
      image_url: visibleHeroBottleImageUrl ?? visibleResolvedCurrentCard.image_url ?? null,
    });
  }, [openFragranceDetailSheet, visibleHeroBottleImageUrl, visibleResolvedCurrentCard, visibleResolvedHeroRail?.familyLabel]);
  const openVisibleLayerDetail = useCallback(() => {
    if (!visibleResolvedLayer) return;
    openFragranceDetailSheet(buildFragranceDetailSurfaceStateFromLayerEntry(
      visibleResolvedLayer,
      visibleLayerBottleImageUrl,
    ));
  }, [openFragranceDetailSheet, visibleLayerBottleImageUrl, visibleResolvedLayer]);
  const openSearchResultFragranceDetail = useCallback((result: OdaraSearchFragranceResult) => {
    if (!result?.fragrance_id) return;
    openFragranceDetailSheet(buildFragranceDetailSurfaceStateFromSearchResult(result));
  }, [openFragranceDetailSheet]);
  const handleHeroTitlePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    heroTitlePressRef.current = {
      pointerId: event.pointerId,
      startedAt: Date.now(),
      startX: event.clientX,
      startY: event.clientY,
    };
  }, []);
  const handleHeroTitlePointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const current = heroTitlePressRef.current;
    heroTitlePressRef.current = null;
    if (!current || current.pointerId !== event.pointerId) return;
    const duration = Date.now() - current.startedAt;
    const deltaX = Math.abs(event.clientX - current.startX);
    const deltaY = Math.abs(event.clientY - current.startY);
    if (duration > 320 || deltaX > 10 || deltaY > 10) return;
    openVisibleHeroDetail();
  }, [openVisibleHeroDetail]);
  const visibleResolvedLayerModes = isGuestMode
    ? (guestResolvedCurrentCard?.layerModes ?? { balance: null, bold: null, smooth: null, wild: null })
    : signedInVisibleLayerModes;
  const signedInCurrentHeroCarryCard = useMemo(
    () => toDisplayCardFromResolvedCurrentCard(signedInResolvedCurrentCard),
    [signedInResolvedCurrentCard]
  );
  const signedInCurrentLayerCarryCard = useMemo(
    () => toDisplayCardFromLayerMode(signedInVisibleLayer),
    [signedInVisibleLayer]
  );
  function buildCurrentSignedInLockedSnapshot(): Partial<SignedInDayState> | null {
    if (isGuestMode || slotChangedSinceLastCommit) return null;

    const lockedCard = signedInCurrentHeroCarryCard;
    if (!lockedCard) return null;

    const snapshotSource = signedInResolvedCurrentCard ?? activeMainCardRender?.resolvedCurrentCard ?? {
      fragrance_id: lockedCard.fragrance_id,
      name: lockedCard.name,
      brand: lockedCard.brand,
      family: lockedCard.family,
      image_url: lockedCard.image_url ?? null,
      familyLabel: visibleResolvedHeroRail?.familyLabel ?? (lockedCard.family ? (FAMILY_LABELS[lockedCard.family] ?? lockedCard.family.toUpperCase()) : ''),
      familyColor: visibleResolvedHeroRail?.familyColor ?? (lockedCard.family ? (FAMILY_COLORS[lockedCard.family] ?? '#888') : '#888'),
      reason_chip_label: lockedCard.reason_chip_label ?? null,
      reason_chip_explanation: lockedCard.reason_chip_explanation ?? null,
      notes: lockedCard.notes,
      accords: lockedCard.accords,
      layer: signedInVisibleLayer ?? null,
      layerFamilyKey: signedInVisibleLayer?.family_key ?? '',
      layerFamilyLabel: signedInVisibleLayer?.family_key
        ? (FAMILY_LABELS[signedInVisibleLayer.family_key] ?? signedInVisibleLayer.family_key.toUpperCase())
        : '',
      layerTokens: Array.isArray(visibleResolvedCurrentCard?.layerTokens) ? visibleResolvedCurrentCard.layerTokens : [],
      layerModes: visibleResolvedLayerModes,
      alternates: signedInVisibleAlternates,
      selectedMode: visibleResolvedSelectedMood,
      resolvedHeroRail: visibleResolvedHeroRail,
      visibleCardId: lockedCard.fragrance_id,
      isHeroCard: true,
    };

    return {
      lockState: 'locked' as const,
      lockedCard,
      lockedLayerCard: signedInCurrentLayerCarryCard,
      lockedLayerMode: toPersistedLayerModeSnapshot(signedInVisibleLayer),
      lockedResolvedCurrentCard: toPersistedResolvedCurrentCardSnapshot(snapshotSource),
      lockedContext: selectedContext,
      lockedMood: visibleResolvedSelectedMood,
      lockedPromotedAltId: promotedAltId,
      resolvedHeroCard: lockedCard,
      resolvedLayerCard: signedInCurrentLayerCarryCard ?? null,
      manualHeroCard: null,
      manualLayerCard: null,
    };
  }
  function engageSignedInLock(): boolean {
    const snapshot = buildCurrentSignedInLockedSnapshot();
    if (!snapshot) return false;

    updateSignedInDayState(currentDayStateKey, (current) => ({
      ...current,
      ...snapshot,
    }));
    return true;
  }
  const signedInResolvedSequelState = useMemo(() => {
    if (isGuestMode) {
      return {
        enabled: false,
        mode: 'off' as SignedInCarryoverTarget,
        origin: null as SignedInDayState['carryoverOrigin'],
        selectedCard: null as DisplayCard | null,
        visualTarget: 'off' as SignedInCarryoverTarget,
      };
    }

    const enabled = signedInDayState.daisyChainEnabled === true;
    const mode = signedInDayState.carryoverMode;
    const origin = signedInDayState.carryoverOrigin;
    const carryoverPreviewBlocked = !!signedInDayState.manualHeroCard || !!signedInDayState.manualLayerCard;
    const selectedCard = enabled && mode === 'hero'
      ? (
          (carryoverPreviewBlocked ? null : signedInCurrentHeroCarryCard)
          ?? signedInDayState.carryoverHeroCard
          ?? signedInDayState.carryoverSelectedCard
          ?? null
        )
      : enabled && mode === 'layer'
        ? (
            (carryoverPreviewBlocked ? null : signedInCurrentLayerCarryCard)
            ?? signedInDayState.carryoverLayerCard
            ?? signedInDayState.carryoverSelectedCard
            ?? null
          )
        : null;

    const heroCarryMatchesCurrent = enabled
      && origin === 'manual'
      && mode === 'hero'
      && !!selectedCard
      && !!signedInCurrentHeroCarryCard
      && isSameRenderableFragranceIdentity(selectedCard, signedInCurrentHeroCarryCard);
    const layerCarryMatchesCurrent = enabled
      && origin === 'manual'
      && mode === 'layer'
      && !!selectedCard
      && !!signedInCurrentLayerCarryCard
      && isSameRenderableFragranceIdentity(selectedCard, signedInCurrentLayerCarryCard);

    return {
      enabled,
      mode,
      origin,
      selectedCard,
      visualTarget: (heroCarryMatchesCurrent ? 'hero' : layerCarryMatchesCurrent ? 'layer' : 'off') as SignedInCarryoverTarget,
    };
  }, [
    isGuestMode,
    signedInDayState,
    signedInCurrentHeroCarryCard,
    signedInCurrentLayerCarryCard,
  ]);
  const visibleAlternateRailItems = useMemo(() => {
    if (isGuestMode) {
      return Array.isArray(guestResolvedCurrentCard?.alternates) ? guestResolvedCurrentCard.alternates : [];
    }

    return (signedInResolvedCurrentCard?.alternates ?? []).map((alt: any, index: number) => ({
      key: alt.fragrance_id || `signed-in-alt-${index}`,
      label: getDisplayName(alt.name, alt.brand ?? null),
      family: alt.family ?? '',
      source: 'signed_in' as const,
      alternate: alt,
      disabled: !alt.fragrance_id || alt.fragrance_id.startsWith('__guest_alt_'),
    }));
  }, [isGuestMode, guestResolvedCurrentCard, signedInResolvedCurrentCard]);
  const alternatesRendered = visibleAlternateRailItems.length > 0;
  const visibleHeroFamilyColor = visibleResolvedHeroRail?.familyColor ?? '#888';
  const visibleHeroFamilyLabel = visibleResolvedHeroRail?.familyLabel ?? '';
  const visibleHeroDetail = useMemo(() => {
    const fragranceId = visibleResolvedCurrentCard?.fragrance_id;
    if (!fragranceId) return null;
    return fragranceDetailCacheRef.current.get(fragranceId) ?? null;
  }, [visibleResolvedCurrentCard?.fragrance_id, fragranceDetailVersion]);
  const heroCardChips = useMemo<Array<{ label: string; position: string; slug?: string }>>(() => {
    const chips: Array<{ label: string; position: string }> = [];
    const seen = new Set<string>();
    const pushChip = (rawLabel: string | null | undefined, position: string) => {
      const label = typeof rawLabel === 'string' ? rawLabel.trim() : '';
      if (!label) return;
      const key = label.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      chips.push({ label, position });
    };

    const accordSource = (visibleHeroDetail?.accords?.length ?? 0) > 0
      ? visibleHeroDetail?.accords
      : visibleResolvedCurrentCard?.accords;
    const accordLabels = normalizeNotes(sanitizeTokenSource(accordSource), 6).slice(0, 3);
    accordLabels.forEach((label) => pushChip(label, 'accord'));

    const structuredNotes = [
      { position: 'top', values: normalizeNotes(sanitizeTokenSource(visibleHeroDetail?.top_notes), 4) },
      { position: 'heart', values: normalizeNotes(sanitizeTokenSource(visibleHeroDetail?.middle_notes), 4) },
      { position: 'base', values: normalizeNotes(sanitizeTokenSource(visibleHeroDetail?.base_notes), 4) },
    ];
    const hasStructuredNotes = structuredNotes.some((section) => section.values.length > 0);
    let noteCount = 0;

    if (hasStructuredNotes) {
      for (const section of structuredNotes) {
        for (const label of section.values) {
          if (chips.length >= 6 || noteCount >= 3) break;
          const before = chips.length;
          pushChip(label, section.position);
          if (chips.length > before) noteCount += 1;
        }
        if (chips.length >= 6 || noteCount >= 3) break;
      }
    } else {
      const noteSource = (visibleHeroDetail?.notes?.length ?? 0) > 0
        ? visibleHeroDetail?.notes
        : visibleResolvedCurrentCard?.notes;
      for (const label of normalizeNotes(sanitizeTokenSource(noteSource), 6)) {
        if (chips.length >= 6 || noteCount >= 3) break;
        const before = chips.length;
        pushChip(label, 'material');
        if (chips.length > before) noteCount += 1;
      }
    }

    const familyKey = visibleHeroDetail?.family_key ?? visibleResolvedCurrentCard?.family ?? null;
    const familyLabel = formatPlainFamilyStyleLabel(
      visibleHeroFamilyLabel || (familyKey ? getFamilyLabelText(familyKey) : null),
    );

    if (familyLabel && (chips.length === 0 || chips.length <= 4)) {
      pushChip(familyLabel, 'family');
    }

    if (chips.length > 0) {
      return expandAndDeduplicateScentIntelDisplayTerms(chips)
        .slice(0, 6)
        .map((t) => ({ label: t.label, position: t.position ?? '', slug: t.slug ?? undefined }));
    }

    const fallbackTokens = Array.isArray(visibleResolvedHeroRail?.tokens)
      ? visibleResolvedHeroRail.tokens
      : [];
    for (const token of fallbackTokens) {
      if (chips.length >= 2) break;
      const label = typeof (token?.token_label ?? token?.label ?? token?.name) === 'string'
        ? String(token.token_label ?? token.label ?? token.name).trim()
        : '';
      if (!label) continue;
      if (/\b(day|night|office|weekend|mood|weather|context|queue|today|pick)\b/i.test(label)) continue;
      pushChip(label, 'accord');
    }

    return expandAndDeduplicateScentIntelDisplayTerms(chips)
      .slice(0, 4)
      .map((t) => ({ label: t.label, position: t.position ?? '', slug: t.slug ?? undefined }));
  }, [
    fragranceDetailVersion,
    visibleHeroDetail?.accords,
    visibleHeroDetail?.family_key,
    visibleHeroDetail?.middle_notes,
    visibleHeroDetail?.notes,
    visibleHeroDetail?.top_notes,
    visibleHeroDetail?.base_notes,
    visibleHeroFamilyLabel,
    visibleResolvedCurrentCard?.accords,
    visibleResolvedCurrentCard?.family,
    visibleResolvedCurrentCard?.notes,
    visibleResolvedHeroRail?.tokens,
  ]);
  const signedInCarryoverSelectedCard = signedInResolvedSequelState.selectedCard;
  const signedInHeroCarryColor = signedInCarryoverSelectedCard?.family
    ? (FAMILY_COLORS[signedInCarryoverSelectedCard.family] ?? '#888')
    : (signedInResolvedCurrentCard?.familyColor
      ?? (signedInResolvedCurrentCard?.family ? (FAMILY_COLORS[signedInResolvedCurrentCard.family] ?? '#888') : '#888'));
  const signedInLayerCarryColor = signedInCarryoverSelectedCard?.family
    ? (FAMILY_COLORS[signedInCarryoverSelectedCard.family] ?? '#888')
    : (signedInResolvedCurrentCard?.layerFamilyKey
      ? (FAMILY_COLORS[signedInResolvedCurrentCard.layerFamilyKey] ?? '#888')
      : (signedInVisibleLayer?.family_key ? (FAMILY_COLORS[signedInVisibleLayer.family_key] ?? '#888') : '#888'));
  const signedInCarryoverVisualTarget: SignedInCarryoverTarget = signedInResolvedSequelState.visualTarget;
  const signedInCarryoverColor = signedInCarryoverVisualTarget === 'hero'
    ? signedInHeroCarryColor
    : signedInCarryoverVisualTarget === 'layer'
      ? signedInLayerCarryColor
      : null;
  const signedInCarryoverUiActive = !isGuestMode
    && hasStoredSignedInDayState
    && signedInResolvedSequelState.origin === 'manual'
    && signedInResolvedSequelState.enabled
    && signedInCarryoverVisualTarget !== 'off';
  // The main hero card already owns the atmosphere for the hero scent. Keep the
  // inner hero shell clean and untinted so it does not read as a second inset card.
  const signedInHeroCarrySurfaceStyle: React.CSSProperties | undefined = undefined;
  // No wrapper background or ring around the LayerCard — the LayerCard owns its
  // own surface. An outer tint/ring here reads as a hidden "shelf" or duplicate
  // window beneath the card. Keep this undefined to remove that double-window.
  const signedInLayerCarrySurfaceStyle: React.CSSProperties | undefined = undefined;
  const signedInCarryoverUiColor = signedInCarryoverUiActive ? signedInCarryoverColor : null;
  const signedInCarryoverButtonStyle = signedInCarryoverCloseFlash
    ? {
        color: '#ef4444',
        background: 'rgba(239,68,68,0.14)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 12px 26px rgba(239,68,68,0.20)',
        filter: 'none',
      }
    : signedInCarryoverUiColor
    ? {
        color: signedInCarryoverUiColor,
        background: `${signedInCarryoverUiColor}16`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05), 0 12px 26px ${signedInCarryoverUiColor}18`,
        filter: 'none',
      }
    : {
        color: 'rgba(255,255,255,0.62)',
        background: 'rgba(255,255,255,0.035)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        filter: 'none',
      };
  const bottomStarActive = actionRailState.starred;
  const sharedBottomActionButtonStyle = {
    border: '1px solid rgba(255,255,255,0.06)',
    backdropFilter: 'blur(12px)',
  } as const;
  const bottomCarryoverButtonStyle = signedInCarryoverButtonStyle;
  const nextActionButtonStyle = {
    background: 'linear-gradient(180deg, rgba(14,15,18,0.94) 0%, rgba(8,9,12,0.96) 100%)',
    border: '1px solid rgba(255,255,255,0.08)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -10px 18px rgba(255,255,255,0.02), 0 12px 24px rgba(0,0,0,0.20)',
    color: 'rgba(255,255,255,0.76)',
    backdropFilter: 'blur(14px)',
  } as const;
  useEffect(() => {
    if (isGuestMode) return;
    if (signedInCarryoverOrigin !== 'inherited') return;

    updateSignedInDayState(currentDayStateKey, (current) => {
      if (current.carryoverOrigin !== 'inherited') {
        return current;
      }

      return {
        ...current,
        daisyChainEnabled: null,
        carryoverMode: 'off',
        carryoverOrigin: null,
        carryoverNextDayRole: null,
        carryoverSourceDateKey: null,
        carryoverTargetDateKey: null,
        carryoverContextKey: null,
        carryoverSelectedCard: null,
        carryoverHeroCard: null,
        carryoverLayerCard: null,
      };
    });
  }, [
    isGuestMode,
    signedInCarryoverOrigin,
    currentDayStateKey,
    updateSignedInDayState,
  ]);
  useEffect(() => {
    if (isGuestMode) return;
    if (slotChangedSinceLastCommit) return;
    if (signedInManualPreviewActive) return;

    const current = signedInDayStateMapRef.current[currentDayStateKey] ?? createDefaultSignedInDayState();
    if (current.carryoverMode === 'off' || current.daisyChainEnabled !== true) {
      return;
    }
    if (current.lockState === 'locked' || signedInResolvedDayDecisionSource === 'locked') {
      return;
    }
    const nextResolvedHeroCard = signedInCurrentHeroCarryCard ?? current.resolvedHeroCard;
    const nextResolvedLayerCard = signedInCurrentLayerCarryCard ?? current.resolvedLayerCard;
    const nextCarryoverSelectedCard = current.carryoverMode === 'hero' && signedInCurrentHeroCarryCard
      ? signedInCurrentHeroCarryCard
      : current.carryoverMode === 'layer' && signedInCurrentLayerCarryCard
        ? signedInCurrentLayerCarryCard
        : current.carryoverSelectedCard;
    const nextCarryoverHeroCard = current.carryoverMode === 'hero' && signedInCurrentHeroCarryCard
      ? signedInCurrentHeroCarryCard
      : current.carryoverHeroCard;
    const nextCarryoverLayerCard = current.carryoverMode === 'layer' && signedInCurrentLayerCarryCard
      ? signedInCurrentLayerCarryCard
      : current.carryoverLayerCard;

    const alreadySynced =
      areSameDisplayCards(current.resolvedHeroCard, nextResolvedHeroCard) &&
      areSameDisplayCards(current.resolvedLayerCard, nextResolvedLayerCard) &&
      areSameDisplayCards(current.carryoverSelectedCard, nextCarryoverSelectedCard) &&
      areSameDisplayCards(current.carryoverHeroCard, nextCarryoverHeroCard) &&
      areSameDisplayCards(current.carryoverLayerCard, nextCarryoverLayerCard);

    if (alreadySynced) return;

    updateSignedInDayState(currentDayStateKey, (current) => {
      let next = {
        ...current,
        resolvedHeroCard: nextResolvedHeroCard,
        resolvedLayerCard: nextResolvedLayerCard,
      };

      if (current.carryoverMode === 'hero' && signedInCurrentHeroCarryCard) {
        next = {
          ...next,
          carryoverSelectedCard: nextCarryoverSelectedCard,
          resolvedHeroCard: nextResolvedHeroCard,
          carryoverHeroCard: nextCarryoverHeroCard,
        };
      }

      if (current.carryoverMode === 'layer' && signedInCurrentLayerCarryCard) {
        next = {
          ...next,
          carryoverSelectedCard: nextCarryoverSelectedCard,
          resolvedLayerCard: nextResolvedLayerCard,
          carryoverLayerCard: nextCarryoverLayerCard,
        };
      }

      return next;
    });
  }, [
    isGuestMode,
    currentDayStateKey,
    slotChangedSinceLastCommit,
    updateSignedInDayState,
    signedInManualPreviewActive,
    signedInResolvedDayDecisionSource,
    signedInCurrentHeroCarryCard,
    signedInCurrentLayerCarryCard,
  ]);
  const handleSignedInCarryoverToggle = useCallback(() => {
    if (isGuestMode || signedInIsReadOnlyHistoryCard) return 'off' as SignedInCarryoverTarget;
    if (signedInManualPreviewActive) return 'off' as SignedInCarryoverTarget;
    const hasLayer = !!signedInCurrentLayerCarryCard;
    const nextTarget = resolveNextSignedInCarryoverTarget(signedInResolvedSequelState, hasLayer);
    const nextSelectedCard = nextTarget === 'hero'
      ? signedInCurrentHeroCarryCard
      : nextTarget === 'layer'
        ? signedInCurrentLayerCarryCard
        : null;
    const nextDayRole = resolveCarryoverNextDayRole(nextTarget);
    const nextTargetDateKey = nextTarget === 'off' ? null : getNextDateKey(currentDateKey);
    const normalizedContextKey = normalizePersistedContextKey(selectedContext);
    const turningOff = signedInResolvedSequelState.origin === 'manual' && signedInResolvedSequelState.enabled && nextTarget === 'off';
    updateSignedInDayState(currentDayStateKey, (current) => ({
      ...current,
      daisyChainEnabled: nextTarget === 'off' ? false : true,
      carryoverMode: nextTarget,
      carryoverOrigin: nextTarget === 'off' ? null : 'manual',
      carryoverNextDayRole: nextDayRole,
      carryoverSourceDateKey: nextTarget === 'off' ? null : currentDateKey,
      carryoverTargetDateKey: nextTargetDateKey,
      carryoverContextKey: nextTarget === 'off' ? null : normalizedContextKey,
      carryoverSelectedCard: nextSelectedCard,
      resolvedHeroCard: signedInCurrentHeroCarryCard ?? current.resolvedHeroCard,
      resolvedLayerCard: signedInCurrentLayerCarryCard ?? current.resolvedLayerCard,
      carryoverHeroCard: nextTarget === 'hero'
        ? (signedInCurrentHeroCarryCard ?? current.carryoverHeroCard)
        : nextTarget === 'off' ? null : current.carryoverHeroCard,
      carryoverLayerCard: nextTarget === 'layer'
        ? (signedInCurrentLayerCarryCard ?? current.carryoverLayerCard)
        : nextTarget === 'off' ? null : current.carryoverLayerCard,
    }));
    if (turningOff) {
      triggerSignedInCarryoverPulse(null);
      triggerSignedInCarryoverCloseFlash();
    } else {
      triggerSignedInCarryoverPulse(nextTarget === 'off' ? null : nextTarget);
    }
    haptic('selection');
    return nextTarget;
  }, [
    isGuestMode,
    signedInIsReadOnlyHistoryCard,
    signedInManualPreviewActive,
    signedInCurrentHeroCarryCard,
    signedInCurrentLayerCarryCard,
    signedInResolvedSequelState,
    currentDayStateKey,
    currentDateKey,
    selectedContext,
    triggerSignedInCarryoverPulse,
    triggerSignedInCarryoverCloseFlash,
    updateSignedInDayState,
  ]);
  const searchHasQuery = searchQuery.trim().length > 0;

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "'Geist Sans', system-ui, sans-serif" }}>
      {/* Compact ODARA root menu — floating overlay anchored to the menu button.
          Home stays visible behind. No full-screen takeover. */}
      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(2px)' }}
            onClick={() => setMenuOpen(false)}
          />
          <div
            className="fixed z-50 overflow-hidden"
            style={{
              top: 'calc(env(safe-area-inset-top, 0px) + 56px)',
              left: 12,
              width: 236,
              borderRadius: 20,
              ...menuPanelVisual.surfaceStyle,
              backdropFilter: 'blur(28px)',
              WebkitBackdropFilter: 'blur(28px)',
            }}
            role="menu"
          >
            <div className={menuPanelVisual.atmosphereClassName} style={{ ...menuPanelVisual.atmosphereStyle, opacity: 0.22 }} />
            <div className="relative z-[1] px-2 py-2.5">
              {([
                { key: 'profile', label: 'Profile' },
                { key: 'collection', label: 'Collection' },
                { key: 'planner', label: 'Planner' },
                { key: 'settings', label: 'Settings' },
              ] as const).map((item) => {
                const disabled = isGuestMode;
                return (
                  <button
                    key={item.key}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setMenuOpen(false);
                      setCollectionPreset('all');
                      setMenuPage(item.key);
                    }}
                    className={`flex w-full items-center justify-between rounded-[14px] px-3 py-3 text-left text-[14px] transition-colors ${
                      disabled
                        ? 'cursor-not-allowed text-foreground/25'
                        : 'text-foreground/88 hover:bg-white/[0.05] active:bg-white/[0.06]'
                    }`}
                    style={{
                      opacity: disabled ? 0.46 : 1,
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    <span style={{ letterSpacing: '0.005em' }}>{item.label}</span>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/32">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>
                );
              })}
            </div>
            <div className="relative z-[1] mx-3 border-t border-white/[0.06] pt-1.5 pb-2.5">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onSignOut();
                }}
                className="flex w-full items-center justify-between rounded-[14px] px-3 py-3 text-left text-[13px] text-foreground/62 transition-colors hover:bg-white/[0.05] hover:text-foreground/85 active:bg-white/[0.06]"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <span>{shellAuthActionLabel}</span>
                {!isGuestMode ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/32">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                ) : null}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Destination pages opened from the root menu. ODARA-native styling. */}
      {menuPage && (
        <OdaraMenuDestination
          page={menuPage}
          onClose={() => setMenuPage(null)}
          onOpenCollection={(preset = 'all') => {
            setCollectionPreset(preset);
            setMenuPage('collection');
          }}
          onCapturePreferenceMoment={captureSignedInPreferenceMoment}
          onSearch={() => {
            setMenuPage(null);
            setMenuOpen(false);
            setSearchOpen(true);
          }}
          onOpenFragranceDetail={openFragranceDetailSheet}
          onOpenScentIntel={openScentIntelSheet}
          userId={userId}
          isGuestMode={isGuestMode}
          selectedContext={selectedContext}
          collectionPreset={collectionPreset}
        />
      )}

      <OdaraFragranceDetailSheet
        open={!!fragranceDetailSheet}
        detail={fragranceDetailSheet}
        onClose={() => setFragranceDetailSheet(null)}
        onOpenScentIntel={openScentIntelSheet}
      />

      <OdaraScentIntelSheet
        state={scentIntelSheet}
        onClose={() => setScentIntelSheet(null)}
        onOpenTerm={openScentIntelSheet}
      />

      <div className="max-w-md mx-auto px-4 pt-3 pb-6 flex flex-col gap-0">
        {/* Top bar — chrome-less icons, inline expanding search. */}
        <div className="relative mb-3 flex items-center justify-between min-h-[40px]">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => {
              closeSearchSurface();
              setMenuOpen(true);
            }}
            className="flex h-10 w-10 items-center justify-center text-foreground/70 transition-colors hover:text-foreground/95"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M4 7h16" />
              <path d="M4 12h16" />
              <path d="M4 17h16" />
            </svg>
          </button>

          {/* Centered VESPER wordmark with the occasion selector hidden in the
              small dot beneath the V. Hidden when search expands. */}
          {!searchOpen && (
            <div
              ref={occasionSelectorRef}
              className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
            >
              <div
                className="relative inline-flex items-start justify-center text-[13px] font-semibold uppercase text-foreground/90"
                style={{
                  fontFamily: "'Geist Sans', system-ui, sans-serif",
                  letterSpacing: '0.42em',
                }}
              >
                {VESPER_WORDMARK_LETTERS.map((letter, index) => (
                  <span
                    key={`${letter}-${index}`}
                    className="pointer-events-none"
                    style={{ marginRight: index === VESPER_WORDMARK_LETTERS.length - 1 ? 0 : '0.42em' }}
                  >
                    {letter}
                  </span>
                ))}
                <button
                  type="button"
                  aria-label={`Select occasion: ${formatOccasionLabel(selectedContext)}`}
                  aria-haspopup="menu"
                  aria-expanded={occasionSelectorOpen}
                  onClick={() => {
                    closeSearchSurface();
                    setMenuOpen(false);
                    setOccasionSelectorOpen((current) => !current);
                  }}
                  className="absolute flex h-5 w-5 -translate-x-1/2 items-center justify-center"
                  style={{
                    top: 'calc(100% - 6px)',
                    left: '0.34em',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <span
                    aria-hidden
                    className="relative block h-[6px] w-[6px] rounded-full bg-white"
                    style={{
                      boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 1px 4px rgba(255,255,255,0.12)',
                    }}
                  >
                    <span
                      aria-hidden
                      className="absolute left-1/2 top-1/2 h-[2px] w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80"
                    />
                  </span>
                </button>
                {occasionSelectorOpen && (
                  <div
                    role="menu"
                    className="absolute left-1/2 top-full mt-6 min-w-[128px] -translate-x-1/2 overflow-hidden rounded-[16px] border border-white/10 px-1.5 py-1.5"
                    style={{
                      background: 'linear-gradient(180deg, rgba(18,20,26,0.74) 0%, rgba(10,12,16,0.66) 100%)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 20px 38px rgba(0,0,0,0.26)',
                      backdropFilter: 'blur(24px)',
                      WebkitBackdropFilter: 'blur(24px)',
                    }}
                  >
                    {CONTEXTS.map((ctx) => {
                      const active = selectedContext === ctx;
                      return (
                        <button
                          key={ctx}
                          type="button"
                          role="menuitemradio"
                          aria-checked={active}
                          onClick={() => {
                            onContextChange(ctx);
                            setOccasionSelectorOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-[12px] px-3 py-2 text-[11px] uppercase tracking-[0.12em] transition-colors ${
                            active
                              ? 'text-foreground'
                              : 'text-foreground/55 hover:text-foreground/84'
                          }`}
                          style={{
                            background: active ? 'rgba(255,255,255,0.07)' : 'transparent',
                            WebkitTapHighlightColor: 'transparent',
                          }}
                        >
                          <span>{formatOccasionLabel(ctx)}</span>
                          <span
                            aria-hidden
                            className="h-[5px] w-[5px] rounded-full"
                            style={{ background: active ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.16)' }}
                          />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Inline expanding search — same top-bar region.
              Card / state remain untouched underneath. */}
          <div
            ref={searchBarRef}
            className="flex items-center justify-end overflow-hidden transition-[width] duration-300"
            style={{
              width: searchOpen ? 'calc(100% - 56px)' : '40px',
              transitionTimingFunction: 'cubic-bezier(0.2,0,0,1)',
            }}
          >
            {!searchOpen ? (
              <button
                type="button"
                aria-label="Open search"
                onClick={() => {
                  setMenuOpen(false);
                  setSearchOpen(true);
                }}
                className="flex h-10 w-10 items-center justify-center text-foreground/70 transition-colors hover:text-foreground/95"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="M16 16l4 4" />
                </svg>
              </button>
            ) : (
              <div
                className="flex h-10 w-full items-center gap-1.5 rounded-full border border-white/10 px-3 backdrop-blur-[22px]"
                style={{
                  background: 'linear-gradient(180deg, rgba(18,20,26,0.66) 0%, rgba(10,12,16,0.54) 100%)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 16px 30px rgba(0,0,0,0.22)',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground/55">
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="M16 16l4 4" />
                </svg>
                <input
                  autoFocus
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search fragrances, notes, accords…"
                  className="h-9 flex-1 min-w-0 bg-transparent text-[13px] text-foreground placeholder:text-foreground/34 outline-none"
                />
                <button
                  type="button"
                  aria-label="Close search"
                  onClick={() => {
                    closeSearchSurface();
                  }}
                  className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full text-foreground/55 hover:text-foreground/95"
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M6 6l12 12" />
                    <path d="M18 6L6 18" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Inline search results — appear DIRECTLY UNDER the search bar.
            Lightweight, scrollable, integrated into the same screen. */}
        {searchOpen && (searchHasQuery || searchLoading || !!searchError || searchResults.length > 0) && (
          <div
            ref={searchResultsRef}
            className="mb-3 rounded-[18px] border border-white/10 px-4 py-3 animate-in fade-in slide-in-from-top-1 duration-200"
            style={{
              maxHeight: '40vh',
              overflowY: 'auto',
              background: 'linear-gradient(180deg, rgba(18,20,26,0.68) 0%, rgba(11,13,18,0.58) 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 24px 40px rgba(0,0,0,0.24)',
              backdropFilter: 'blur(24px) saturate(135%)',
            }}
          >
            {searchLoading ? (
              <p className="text-[12.5px] text-foreground/52">
                Searching scents…
              </p>
            ) : searchError ? (
              <p className="text-[12.5px] text-foreground/52">
                {searchError}
              </p>
            ) : searchResults.length > 0 ? (
              <div className="flex flex-col divide-y divide-white/6">
                {searchResults.map((result) => {
                  const familyColor = result.family_key
                    ? (FAMILY_COLORS[result.family_key] ?? '#888')
                    : '#888';
                  const familyLabel = result.family_key
                    ? getFamilyLabelText(result.family_key)
                    : '';
                  const feedbackText = searchAddFeedback?.fragranceId === result.fragrance_id
                    ? searchAddFeedback.text
                    : null;
                  const isAdding = searchAddPendingFragranceId === result.fragrance_id;
                  const isSignedInAddDisabled = !isGuestMode && !!signedInSearchPreviewDisabledReason;
                  const addDisabledReason = isSignedInAddDisabled
                    ? signedInSearchPreviewDisabledReason
                    : null;
                  const previewRole = result.fragrance_id === activeSearchPreviewLayerId
                    ? 'layer'
                    : result.fragrance_id === activeSearchPreviewTopId
                      ? 'top'
                      : null;
                  const buttonTone = isSignedInAddDisabled
                    ? {
                        color: 'rgba(255,255,255,0.34)',
                        background: 'rgba(255,255,255,0.025)',
                        borderColor: 'rgba(255,255,255,0.08)',
                      }
                    : previewRole === 'top'
                    ? {
                        color: familyColor,
                        background: `${familyColor}14`,
                        borderColor: `${familyColor}42`,
                      }
                    : previewRole === 'layer'
                      ? {
                          color: 'rgba(255,255,255,0.84)',
                          background: 'rgba(255,255,255,0.09)',
                          borderColor: 'rgba(255,255,255,0.18)',
                        }
                      : {
                          color: 'rgba(255,255,255,0.74)',
                          background: 'rgba(255,255,255,0.03)',
                          borderColor: 'rgba(255,255,255,0.10)',
                        };
                  const statusText = feedbackText ?? addDisabledReason;
                  const statusTone = addDisabledReason
                    ? 'rgba(255,255,255,0.42)'
                    : feedbackText === 'Removed'
                      ? 'rgba(161,161,170,0.9)'
                      : previewRole === 'top'
                        ? familyColor
                        : 'rgba(255,255,255,0.52)';

                  return (
                    <div
                      key={`${result.source}-${result.fragrance_id}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => openSearchResultFragranceDetail(result)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openSearchResultFragranceDetail(result);
                        }
                      }}
                      className="flex cursor-pointer items-start justify-between gap-3 rounded-[14px] py-3 transition-colors first:pt-1 last:pb-1 hover:bg-white/[0.025] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/18"
                      style={{ WebkitTapHighlightColor: 'transparent' }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] text-foreground/92">
                          {result.title}
                        </div>
                        <div className="mt-0.5 truncate text-[11.5px] text-foreground/52">
                          {result.subtitle || result.brand || 'Fragrance'}
                        </div>
                        {(familyLabel || result.supporting_text) && (
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            {familyLabel ? (
                              <span
                                className="rounded-full border px-2 py-0.5 text-[9.5px] uppercase tracking-[0.12em]"
                                style={{
                                  color: familyColor,
                                  borderColor: `${familyColor}36`,
                                  background: `${familyColor}10`,
                                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
                                }}
                              >
                                {familyLabel}
                              </span>
                            ) : null}
                            {result.supporting_text ? (
                              <span className="truncate text-[10.5px] text-foreground/44">
                                {result.supporting_text}
                              </span>
                            ) : null}
                          </div>
                        )}
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <button
                          type="button"
                          aria-label={addDisabledReason
                            ? `${addDisabledReason}: ${result.title}`
                            : previewRole === 'top'
                              ? `Add ${result.title} as layer for ${getDateLabel(currentDateKey)}`
                              : previewRole === 'layer'
                                ? `Remove ${result.title} from ${getDateLabel(currentDateKey)}`
                                : `Add ${result.title} to ${getDateLabel(currentDateKey)}`}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleAddSearchResultToSelectedDay(result);
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-full border transition-colors hover:text-foreground/96 disabled:cursor-not-allowed disabled:opacity-60"
                          style={{
                            WebkitTapHighlightColor: 'transparent',
                            ...buttonTone,
                            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
                          }}
                          title={addDisabledReason ?? undefined}
                          disabled={isAdding || isSignedInAddDisabled}
                        >
                          {isAdding ? (
                            <span className="h-3.5 w-3.5 rounded-full border border-current border-t-transparent animate-spin" />
                          ) : previewRole === 'layer' ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                              <path d="M6 6l12 12" />
                              <path d="M18 6L6 18" />
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                              <path d="M12 5v14" />
                              <path d="M5 12h14" />
                            </svg>
                          )}
                        </button>
                        {statusText ? (
                          <span
                            className="text-[10px] uppercase tracking-[0.12em]"
                            style={{ color: statusTone }}
                          >
                            {statusText}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[12.5px] text-foreground/52">
                Nothing found yet. Try a fragrance, brand, note, accord, or family.
              </p>
            )}
          </div>
        )}

        {/* ── Weekly navigator + lane tracker ── */}
        <div className="mb-2 px-0 py-0.5">
          <div
            ref={navigationStripRef}
            className="hide-horizontal-scrollbar snap-x snap-mandatory overflow-x-auto pb-0.5"
            style={{
              msOverflowStyle: 'none',
              scrollbarWidth: 'none',
              WebkitOverflowScrolling: 'touch',
              touchAction: 'pan-x',
              scrollSnapType: 'x mandatory',
            }}
          >
            <div
              ref={navigationContentRef}
              className="relative flex w-max min-w-full gap-0"
            >
              {orbGeom && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute"
                  style={{
                    left: `${orbGeom.left}px`,
                    top: `${orbGeom.topY}px`,
                    transform: 'translate(-50%, -50%)',
                    width: '9px',
                    height: '9px',
                    zIndex: 5,
                    transition: 'left 800ms ease',
                    borderRadius: '999px',
                    background: 'radial-gradient(circle, rgba(255,245,206,0.98) 0%, rgba(255,183,72,0.88) 36%, rgba(244,126,24,0.20) 64%, rgba(244,126,24,0) 72%)',
                    boxShadow: '0 0 7px rgba(255,177,56,0.55), 0 0 15px rgba(242,123,23,0.24)',
                  }}
                >
                  <span
                    className="absolute left-1/2 top-1/2 h-px w-[13px] -translate-x-1/2 -translate-y-1/2"
                    style={{ background: 'linear-gradient(90deg, rgba(255,191,75,0), rgba(255,211,121,0.55), rgba(255,191,75,0))' }}
                  />
                  <span
                    className="absolute left-1/2 top-1/2 h-[13px] w-px -translate-x-1/2 -translate-y-1/2"
                    style={{ background: 'linear-gradient(180deg, rgba(255,191,75,0), rgba(255,211,121,0.44), rgba(255,191,75,0))' }}
                  />
                </div>
              )}

              <span
                aria-hidden
                className="pointer-events-none absolute z-0 h-px -translate-y-1/2"
                style={{
                  top: `${FORECAST_RAIL_TRACK_TOP_PX}px`,
                  left: navigationDayCellWidth ? `${navigationDayCellWidth / 2}px` : '22px',
                  right: navigationDayCellWidth ? `${navigationDayCellWidth / 2}px` : '22px',
                  background: 'linear-gradient(90deg, rgba(120,185,255,0.06), rgba(143,211,255,0.24) 42%, rgba(143,211,255,0.24) 58%, rgba(120,185,255,0.06))',
                  boxShadow: '0 0 6px rgba(143,211,255,0.08)',
                }}
              />
              {orbGeom?.weekNotches.map((notchLeft, index) => (
                <span
                  key={`forecast-noon-notch-${navigationDays[index]?.dateStr ?? index}`}
                  aria-hidden
                  className="pointer-events-none absolute z-[1] w-px -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    left: `${notchLeft}px`,
                    top: `${FORECAST_RAIL_TRACK_TOP_PX}px`,
                    height: '9px',
                    background: 'linear-gradient(180deg, rgba(143,211,255,0), rgba(166,223,255,0.28), rgba(143,211,255,0))',
                    boxShadow: '0 0 4px rgba(143,211,255,0.08)',
                  }}
                />
              ))}

              {navigationDays.map((fd, i) => {
                const lockedLane = isGuestMode
                  ? (lockedSelections[`${fd.dateStr}:${selectedContext}`] ?? null)
                  : (signedInLockedLaneByDate[fd.dateStr]?.[normalizedSelectedContextKey] ?? null);
                return (
                  <button
                    key={fd.dateStr}
                    ref={(el) => { navigationDayCellRefs.current[i] = el; }}
                    onClick={() => {
                      selectNavigationDay(fd.dateStr);
                    }}
                    className="relative flex min-w-[44px] flex-none snap-start flex-col items-center rounded-[14px] px-1.5 pb-1.5 pt-1 transition-all duration-200 sm:min-w-[46px]"
                    style={{
                      width: navigationDayCellWidth ? `${navigationDayCellWidth}px` : undefined,
                      minWidth: navigationDayCellWidth ? `${navigationDayCellWidth}px` : undefined,
                      maxWidth: navigationDayCellWidth ? `${navigationDayCellWidth}px` : undefined,
                      scrollSnapAlign: 'start',
                      zIndex: 2,
                    }}
                  >
                    <span className={`text-[10px] leading-none tracking-[0.08em] transition-colors ${
                      fd.isSelected ? 'text-foreground font-semibold' : 'text-muted-foreground/40'
                    }`}>
                      {fd.label}
                    </span>
                    <div className="relative mt-3 h-[24px] w-full">
                      <span
                        ref={(el) => { navigationDayIndicatorRefs.current[i] = el; }}
                        aria-hidden
                        className="absolute left-1/2 top-1/2 block h-px w-px -translate-x-1/2 -translate-y-1/2 opacity-0"
                      />
                      <OdaraDayMoonPhaseIcon dateStr={fd.dateStr} isActive={fd.isSelected} />
                    </div>
                    <span className={`mt-2 text-[15px] leading-none transition-colors ${
                      fd.isSelected ? 'font-medium text-foreground' : 'text-muted-foreground/40'
                    }`}>
                      {fd.day}
                    </span>
                    <span
                      aria-hidden
                      className="mt-2 block h-[2px] w-5 rounded-full transition-opacity duration-200"
                      style={{
                        opacity: lockedLane ? (fd.isSelected ? 1 : 0.4) : 0,
                        background: 'linear-gradient(90deg, rgba(194,93,255,0.70), rgba(211,107,255,0.98))',
                        boxShadow: fd.isSelected ? '0 0 8px rgba(206,88,255,0.34)' : '0 0 4px rgba(206,88,255,0.16)',
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Loading / Error */}
        {oracleLoading && (
          <div className="flex flex-col gap-3 items-center py-16">
            <div className="w-8 h-8 border-2 border-foreground/20 border-t-foreground/60 rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Preparing today&apos;s pick…</span>
          </div>
        )}
        {oracleError && (
          <div className="rounded-xl px-4 py-4 text-xs flex flex-col gap-1.5" style={{ background: 'rgba(220,60,60,0.08)', border: '1px solid rgba(220,60,60,0.15)', color: '#e55' }}>
            <span className="font-semibold text-sm">Oracle request failed</span>
            <span>error: {oracleError}</span>
            <span>userId: {userId ?? 'null'}</span>
            <span>origin: {typeof window !== 'undefined' ? window.location.origin : '?'}</span>
            <span>oracleKey: {`${userId}|${selectedContext}|${selectedDate}|${resolvedTemperature}`}</span>
          </div>
        )}
        {queueError && (
          <div className="rounded-xl px-4 py-2 text-[10px] mt-1" style={{ background: 'rgba(220,160,60,0.08)', border: '1px solid rgba(220,160,60,0.15)', color: '#da3' }}>
            Queue: {queueError}
          </div>
        )}
        {!oracleLoading && !oracleError && !visibleCard && (
          <div
            className="relative mt-1 overflow-hidden rounded-[24px] px-6 py-10 text-center"
            data-card-unavailable-state
            style={{
              background: 'linear-gradient(165deg, rgba(255,255,255,0.08) 0%, rgba(15,12,8,0.96) 72%)',
              border: '1px solid rgba(255,255,255,0.12)',
              boxShadow: '0 22px 54px rgba(0,0,0,0.46), inset 0 1px 1px rgba(255,255,255,0.06)',
            }}
          >
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.08] to-transparent opacity-40" />
            <div className="relative z-[1] mx-auto flex max-w-[320px] flex-col items-center gap-3">
              <span className="text-[10px] uppercase tracking-[0.18em] text-white/45">No card ready</span>
              <p className="text-[15px] leading-relaxed text-white/78">
                {backendCardUnavailable?.message ?? 'No card is ready for this context yet. Try another context or check back after the next refresh.'}
              </p>
            </div>
          </div>
        )}

        {/* ── Unified main card with gestures ── */}
        {!oracleLoading && !oracleError && visibleCard && (
          <div className="relative mt-0 pb-8 overflow-visible" style={{ perspective: '1600px' }}>
            <div
              className="pointer-events-none absolute inset-x-[10%] -bottom-4 z-0 h-16 rounded-[999px]"
              style={{
                background: `radial-gradient(ellipse at center, ${tint.glow} 0%, rgba(0,0,0,0.38) 46%, transparent 80%)`,
                filter: 'blur(18px)',
                opacity: 0.68,
              }}
            />
            <div
              className="pointer-events-none absolute inset-x-[20%] bottom-[6px] z-0 h-10 rounded-[999px]"
              style={{
                background: 'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.0) 100%)',
                filter: 'blur(10px)',
                opacity: 0.14,
                transform: 'scaleY(-1)',
              }}
            />

            <div
              className="relative overflow-visible"
              style={{
                transform: `translate3d(${daySwipeOffset}px, 0, 0)`,
                transition: daySwipeDragging ? 'none' : 'transform 360ms cubic-bezier(0.22, 1, 0.36, 1)',
                willChange: 'transform',
              }}
            >
              {prevForecastDay && (() => {
                const tone = getPreviewTone(prevForecastDay.dateStr);
                return (
                  <div
                    className="pointer-events-none absolute inset-y-[16px] left-[-13%] z-0 w-[84%] overflow-hidden rounded-[22px]"
                    style={{
                      background: `linear-gradient(165deg, ${tone.accent}18 0%, rgba(12,10,8,0.94) 74%)`,
                      border: `1px solid ${tone.accent}33`,
                      boxShadow: `0 18px 44px rgba(0,0,0,0.42), 0 0 28px ${tone.glow}22`,
                      opacity: 0.5,
                      filter: 'blur(3px)',
                      transform: 'translate3d(0, 16px, 0) scale(0.9) rotateY(18deg)',
                      transformOrigin: 'right center',
                      backdropFilter: 'blur(18px)',
                    }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-b from-white/[0.08] to-transparent opacity-40" />
                    <div className="relative z-[1] flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
                      <span className="text-[10px] uppercase tracking-[0.18em] text-white/30">{prevForecastDay.label}</span>
                      <span
                        className="text-[34px] leading-none text-white/42"
                        style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
                      >
                        {prevForecastDay.day}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {nextForecastDay && (() => {
                const tone = getPreviewTone(nextForecastDay.dateStr);
                return (
                  <div
                    className="pointer-events-none absolute inset-y-[16px] right-[-13%] z-0 w-[84%] overflow-hidden rounded-[22px]"
                    style={{
                      background: `linear-gradient(165deg, ${tone.accent}18 0%, rgba(12,10,8,0.94) 74%)`,
                      border: `1px solid ${tone.accent}33`,
                      boxShadow: `0 18px 44px rgba(0,0,0,0.42), 0 0 28px ${tone.glow}22`,
                      opacity: 0.5,
                      filter: 'blur(3px)',
                      transform: 'translate3d(0, 16px, 0) scale(0.9) rotateY(-18deg)',
                      transformOrigin: 'left center',
                      backdropFilter: 'blur(18px)',
                    }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-b from-white/[0.08] to-transparent opacity-40" />
                    <div className="relative z-[1] flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
                      <span className="text-[10px] uppercase tracking-[0.18em] text-white/30">{nextForecastDay.label}</span>
                      <span
                        className="text-[34px] leading-none text-white/42"
                        style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
                      >
                        {nextForecastDay.day}
                      </span>
                    </div>
                  </div>
                );
              })()}

              <div
                className={`rounded-[24px] px-[22px] pt-3 pb-[18px] flex flex-col relative z-10 overflow-hidden transition-transform duration-150 ${skipAnimating ? '' : ''}`}
                style={{
                  ...heroCardVisual.surfaceStyle,
                  // Allow native vertical scroll from the hero card. We only
                  // claim the gesture on clear horizontal intent (day-swipe).
                  touchAction: 'pan-y',
                  // iOS Safari: suppress the long-press callout, text selection,
                  // and tap highlight so the hero card behaves like a native
                  // gesture surface (no blue flash, no magnifier, no copy menu).
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                  WebkitTapHighlightColor: 'transparent',
                  ...(skipAnimating ? { animation: 'cardSlideDown 0.35s ease-in forwards' } : {}),
                }}
                onClickCapture={handleCardClickCapture}
                onClick={handleCardClick}
                onPointerDown={handleCardPointerDown}
                onPointerMove={handleCardPointerMove}
                onPointerUp={handleCardPointerEnd}
                onPointerCancel={handleCardPointerEnd}
                onTouchStart={handleCardTouchStart}
                onTouchMove={handleCardTouchMove}
                onTouchEnd={handleCardTouchEnd}
                onTouchCancel={handleCardTouchEnd}
              >
            {/* Glow orb */}
            <div
              className={heroCardVisual.atmosphereClassName}
              style={heroCardVisual.atmosphereStyle}
            />

            {/* Like flash — restrained white pulse confirming the "like" half
                of the double-tap. Lock burst lives on the lock icon. */}
            {likeFlash && (
              <div
                className="absolute inset-0 pointer-events-none rounded-[24px] z-[1]"
                style={{
                  background:
                    'radial-gradient(circle at 50% 45%, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 60%)',
                  animation: 'orbBreathe 0.55s ease-out forwards',
                }}
              />
            )}
            <div
              className={isGuestMode
                ? "relative flex w-full flex-col px-3 pt-0 pb-1"
                : "relative flex w-full flex-col px-3 pt-0 pb-1 transition-all duration-300"}
              style={signedInHeroCarrySurfaceStyle}
            >
              {/* Recipe header — Guest Recipe Mode only. Rendered above hero
                  title in quotes using backend-provided color_hex. Source:
                  option.recipe_header (attached to hero by guest-recipe.ts). */}
              {isGuestMode && (() => {
                const rh: any =
                  (visibleGuestRender?.activeHero as any)?.recipe_header ??
                  ((activeOracle ?? oracle) as any)?.main_bundle?.recipe_header ??
                  null;
                if (!rh?.text) return null;
                const color = typeof rh.color_hex === 'string' && rh.color_hex.startsWith('#')
                  ? rh.color_hex
                  : undefined;
                return (
                  <div
                    className="mb-1 ml-3 mt-1 text-left text-[12px] font-medium uppercase tracking-[0.22em]"
                    style={color ? { color } : undefined}
                    data-recipe-header
                  >
                    {rh.text}
                  </div>
                );
              })()}

              <div className="relative w-full px-3 pb-1">
                {actionRailState.showBack && (
                  <button
                    type="button"
                    className="absolute right-0 top-[8px] z-10 flex h-6 w-6 items-center justify-center text-foreground/50 transition-all duration-200 hover:text-foreground/72 active:scale-95"
                    onClick={() => {
                      if (handleLocalLayerBack()) {
                        return;
                      }
                      cardController.actions.back();
                    }}
                    aria-label="Back"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                <div className="flex items-start justify-between gap-4">
                  <div
                    className="min-w-0 flex-1 text-left"
                    style={{
                      paddingRight: actionRailState.showBack && visibleHeroBottleImageCandidates.length === 0 ? '2rem' : undefined,
                    }}
                  >
                    {/* Fragrance name */}
                    <h2
                      className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-left text-[32px] font-normal leading-[1.1] text-foreground"
                      style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
                    >
                      <button
                        type="button"
                        data-odara-hero-title-button
                        data-card-swipe-allow
                        data-guest-profile-reserved
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onPointerDown={handleHeroTitlePointerDown}
                        onPointerUp={handleHeroTitlePointerUp}
                        onPointerCancel={() => {
                          heroTitlePressRef.current = null;
                        }}
                        className="min-w-0 bg-transparent p-0 text-left text-inherit"
                      >
                        {getDisplayName(visibleResolvedCurrentCard?.name ?? '', visibleResolvedCurrentCard?.brand ?? null)}
                      </button>
                      <SprayDots
                        count={visibleHeroSprayCount}
                        color={visibleHeroFamilyColor}
                        className="inline-flex items-center gap-1 pt-1"
                      />
                    </h2>

                    {/* Brand */}
                    <span className="mb-1.5 block text-left text-[13px] text-muted-foreground/60">
                      {visibleResolvedCurrentCard?.brand ?? ''}
                    </span>

                    {/* Family label */}
                    {visibleHeroFamilyLabel ? (
                      <ScentIntelChipButton
                        label={visibleHeroFamilyLabel}
                        slug={visibleHeroDetail?.family_key ?? visibleResolvedCurrentCard?.family ?? null}
                        onOpen={isReadOnlyHistoryCard ? undefined : openScentIntelSheet}
                        fragranceId={visibleResolvedCurrentCard?.fragrance_id ?? null}
                        fragranceName={visibleResolvedCurrentCard?.name ?? null}
                        fragranceBrand={visibleResolvedCurrentCard?.brand ?? null}
                        position="family"
                        className="mb-2 inline-flex flex-shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.12em]"
                        style={{
                          color: visibleHeroFamilyColor,
                          border: `1px solid ${visibleHeroFamilyColor}36`,
                          background: `${visibleHeroFamilyColor}10`,
                          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.03), 0 0 12px ${visibleHeroFamilyColor}20`,
                        }}
                      />
                    ) : null}

                    {heroCardChips.length > 0 && (
                      <div className="mt-0.5 mb-2.5 w-full">
                        <div
                          data-no-card-swipe
                          className="odara-token-rail-fade hide-horizontal-scrollbar flex w-full flex-nowrap items-center justify-start gap-1.5 overflow-x-auto pr-2"
                          style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x' }}
                        >
                          {heroCardChips.map((chip, i) => {
                            const tone = getAccordChipTone(
                              chip.label,
                              visibleHeroDetail?.family_key ?? visibleResolvedCurrentCard?.family ?? null,
                            );
                            return (
                              <ScentIntelChipButton
                                key={`hero-tok-${chip.position}-${chip.label}-${i}`}
                                label={chip.label}
                                slug={chip.slug ?? null}
                                onOpen={isReadOnlyHistoryCard ? undefined : openScentIntelSheet}
                                fragranceId={visibleResolvedCurrentCard?.fragrance_id ?? null}
                                fragranceName={visibleResolvedCurrentCard?.name ?? null}
                                fragranceBrand={visibleResolvedCurrentCard?.brand ?? null}
                                position={chip.position}
                                className="flex-shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.12em]"
                                style={{
                                  color: tone.color,
                                  border: `1px solid ${tone.border}`,
                                  background: tone.background,
                                  boxShadow: `0 0 12px ${tone.glow}`,
                                }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {visibleHeroBottleImageCandidates.length > 0 ? (
                    <div className="pointer-events-none relative mt-1 h-[108px] w-[78px] shrink-0 sm:h-[118px] sm:w-[86px]">
                      <OdaraBottleImage
                        candidates={visibleHeroBottleImageCandidates}
                        alt={`${visibleResolvedCurrentCard?.name ?? 'Fragrance'} bottle`}
                        className="h-full w-full object-contain object-center"
                        draggable={false}
                        style={{
                          opacity: 0.92,
                          borderRadius: likelyTransparentHeroBottleImage ? undefined : 18,
                          filter: likelyTransparentHeroBottleImage
                            ? 'drop-shadow(0 16px 24px rgba(0,0,0,0.34))'
                            : 'contrast(1.03) saturate(0.96) drop-shadow(0 16px 24px rgba(0,0,0,0.34))',
                          mixBlendMode: likelyTransparentHeroBottleImage ? undefined : 'darken',
                        }}
                        fallback={null}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {/* ── Layer card — shared layout contract for signed-in and guest. ── */}
            {visibleResolvedLayer ? (
              <div
                data-layer-section
                className="rounded-[22px] transition-all duration-300"
                style={!isGuestMode ? signedInLayerCarrySurfaceStyle : undefined}
              >
                <LayerCard
                  mainName={visibleResolvedCurrentCard?.name ?? ''}
                  mainBrand={visibleResolvedCurrentCard?.brand ?? null}
                  mainNotes={visibleResolvedCurrentCard?.notes ?? []}
                  mainTopNotes={visibleHeroDetail?.top_notes ?? null}
                  mainMiddleNotes={visibleHeroDetail?.middle_notes ?? null}
                  mainBaseNotes={visibleHeroDetail?.base_notes ?? null}
                  mainFamily={visibleResolvedCurrentCard?.family ?? null}
                  mainProjection={isGuestMode
                    ? (typeof visibleGuestRender?.activeHero?.projection === 'number' ? visibleGuestRender.activeHero.projection : null)
                    : null}
                  layerModes={visibleResolvedLayerModes}
                  visibleLayerMode={visibleResolvedLayer}
                  selectedMood={visibleResolvedSelectedMood}
                  onSelectMood={(mood) => cardController.actions.selectMood(mood)}
                  selectedRatio={selectedRatio}
                  onSelectRatio={isReadOnlyHistoryCard ? (() => {}) : setSelectedRatio}
                  isExpanded={isGuestMode ? guestLayerExpanded : layerExpanded}
                  onToggleExpand={() => {
                    if (isGuestMode) {
                      setGuestLayerExpanded((value) => !value);
                    } else {
                      setLayerExpanded((value) => !value);
                    }
                  }}
                  lockPulse={!isGuestMode ? lockPulse : undefined}
                  locked={isCardLocked}
                  consumeLockedMoodTap={isGuestMode || undefined}
                  modeLoading={!isGuestMode ? modeLoading : undefined}
                  modeErrors={!isGuestMode ? modeErrors : undefined}
                  disabledMoodReasons={!isGuestMode ? signedInDisabledMoodReasons : undefined}
                  onRetryMood={!isGuestMode && !isReadOnlyHistoryCard ? ((mood) => {
                    const currentCardId = signedInResolvedCurrentCard?.fragrance_id;
                    if (!currentCardId) return;
                    const predecessorExclusionId = signedInResolvedDayDecisionSource === 'carryover-main'
                      ? (signedInVerifiedPredecessorBaton?.excludedPreviousCard?.fragrance_id ?? null)
                      : null;
                    void fetchMoodForCard(
                      currentCardId,
                      mood,
                      true,
                      predecessorExclusionId ? [predecessorExclusionId] : [],
                    );
                  }) : undefined}
                  layerTokens={visibleResolvedCurrentCard?.layerTokens ?? null}
                  layerImageUrl={visibleLayerBottleImageUrl}
                  mainSprayCount={visibleHeroSprayCount}
                  layerSprayCount={visibleLayerSprayCount}
                  detailIdentityKey={layerDetailIdentityKey}
                  showLegacyAccordsText={false}
                  onOpenFragranceDetail={openVisibleLayerDetail}
                  onOpenScentIntel={isReadOnlyHistoryCard ? undefined : openScentIntelSheet}
                  resolveScentChipTone={getAccordChipTone}
                />
              </div>
            ) : null}

            <div
              className="mt-1 flex w-full flex-col items-center gap-3 pb-1"
              data-card-footer-shell
            >
              {/* ── Alternatives — shared rail for signed-in and guest. ── */}
              {alternatesRendered && (
                <div className="flex flex-col items-center gap-2 w-full">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/40">
                    Alternatives
                  </span>
                  <div
                    data-no-card-swipe
                    className="hide-horizontal-scrollbar w-full overflow-x-auto pb-1"
                    style={{
                      scrollbarWidth: 'none',
                      WebkitOverflowScrolling: 'touch',
                      scrollPaddingLeft: '12px',
                      scrollPaddingRight: '12px',
                      touchAction: 'pan-x',
                    }}
                  >
                    <div className="flex w-max min-w-full items-center justify-center gap-2 px-1.5">
                      {visibleAlternateRailItems.map((item, index) => {
                        const altColor = FAMILY_COLORS[item.family] ?? '#888';
                        const promotionDisabled = !!item.disabled;
                        return (
                          <button
                            key={item.key || index}
                            type="button"
                            aria-disabled={promotionDisabled || isCardLocked || undefined}
                            data-alternate-chip
                            onPointerDown={(e) => {
                              if (!isCardLocked) return;
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isCardLocked || promotionDisabled) return;
                              if (item.source === 'guest') {
                                cardController.actions.promoteAlternate(item.alternate, item.originalIdx);
                              } else {
                                cardController.actions.promoteAlternate(item.alternate);
                              }
                            }}
                            disabled={promotionDisabled}
                            className={`flex-shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition-all duration-200
                              text-foreground/70 ${promotionDisabled ? 'cursor-default' : 'hover:text-foreground/90 active:scale-95'}
                              ${isCardLocked ? 'opacity-30 pointer-events-none' : ''}`}
                            style={{
                              border: `1px solid ${altColor}44`,
                              background: `${altColor}0A`,
                            }}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              <div
                className="flex min-h-10 w-full items-center justify-center gap-8 sm:gap-10"
                data-shared-bottom-action-row
                role="group"
                aria-label="Card actions"
              >
                <button
                  ref={favoriteButtonRef}
                  type="button"
                  aria-label="Favorite"
                  aria-pressed={bottomStarActive}
                  aria-disabled={isReadOnlyHistoryCard || signedInFavoritePending || undefined}
                  disabled={isReadOnlyHistoryCard || signedInFavoritePending}
                  onClick={() => {
                    if (isReadOnlyHistoryCard || signedInFavoritePending) return;
                    cardController.actions.toggleStar();
                    setFavoriteLabelText(bottomStarActive ? 'Removed' : 'Favorite');
                    setFavoriteLabelTick((t) => t + 1);
                  }}
                className="relative flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300 active:scale-95"
                style={{
                  ...sharedBottomActionButtonStyle,
                  color: bottomStarActive ? '#eab308' : 'rgba(255,255,255,0.62)',
                  background: bottomStarActive ? 'rgba(234,179,8,0.14)' : 'rgba(255,255,255,0.035)',
                  boxShadow: bottomStarActive
                    ? 'inset 0 1px 0 rgba(255,255,255,0.06), 0 12px 24px rgba(234,179,8,0.14)'
                    : 'inset 0 1px 0 rgba(255,255,255,0.04)',
                }}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill={bottomStarActive ? '#eab308' : 'none'}
                  stroke={bottomStarActive ? '#eab308' : 'currentColor'}
                  strokeWidth="1.55"
                  className="transition-all duration-300"
                  style={{
                    filter: bottomStarActive ? 'drop-shadow(0 0 5px rgba(234,179,8,0.38))' : undefined,
                    transform: isGuestMode && guestStarFlash ? 'scale(1.12)' : undefined,
                  }}
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                <FloatingActionLabel
                  triggerKey={favoriteLabelTick || null}
                  text={favoriteLabelText}
                  anchorRef={favoriteButtonRef}
                  color={favoriteLabelText === 'Removed' ? '#a1a1aa' : bottomStarActive ? '#eab308' : undefined}
                />
              </button>

              {(() => {
                const heartKey = visibleCard
                  ? `${selectedDate}|${selectedContext}|${visibleCard.fragrance_id}`
                  : '';
                const heartState: HeartState = isGuestMode
                  ? (heartKey ? (heartStateByKey[heartKey] ?? 0) : 0)
                  : signedInHeartState;
                return (
                  <HeartReactionButton
                    state={heartState}
                    disabled={(!heartKey && isGuestMode) || isReadOnlyHistoryCard || signedInHeartPending}
                    onChange={(next) => {
                      if (isReadOnlyHistoryCard) return;
                      if (isGuestMode) {
                        if (!heartKey) return;
                        setHeartStateByKey(prev => ({ ...prev, [heartKey]: next }));
                        return;
                      }
                      if (!userId || !signedInActionFragranceId || signedInHeartPending) return;

                      const fragranceId = signedInActionFragranceId;
                      const previousHeartState = signedInHeartStateByFragranceId[fragranceId] ?? 0;

                      setSignedInHeartStateByFragranceId(prev => ({ ...prev, [fragranceId]: next }));
                      setHeartWritePendingByFragranceId(prev => ({ ...prev, [fragranceId]: true }));

                      void Promise.resolve(odaraSupabase.rpc('set_user_fragrance_preference_v1' as any, {
                        p_fragrance_id: fragranceId,
                        p_next_state: heartStateToPreferenceState(next),
                        p_source: 'odara_action_row',
                      } as any)).then(({ error, data }: any) => {
                        if (error) throw error;

                        const resolvedHeartState = preferenceStateToHeartState((data as any)?.preference_state);
                        setSignedInHeartStateByFragranceId(prev => ({ ...prev, [fragranceId]: resolvedHeartState }));
                        if (resolvedHeartState > 0 && visibleResolvedCurrentCard) {
                          captureSignedInPreferenceMoment({
                            preference_state: resolvedHeartState === 2 ? 'loved' : 'liked',
                            source: 'odara_action_row',
                            main: {
                              fragrance_id: visibleResolvedCurrentCard.fragrance_id,
                              name: visibleResolvedCurrentCard.name,
                              brand: visibleResolvedCurrentCard.brand,
                              family_key: visibleResolvedCurrentCard.family,
                              image_url: visibleResolvedCurrentCard.image_url ?? visibleHeroBottleImageUrl ?? null,
                            },
                            layer: visibleResolvedLayer
                              ? {
                                  fragrance_id: visibleResolvedLayer.id,
                                  name: visibleResolvedLayer.name,
                                  brand: visibleResolvedLayer.brand,
                                  family_key: visibleResolvedLayer.family_key,
                                  image_url: visibleResolvedLayer.image_url ?? visibleLayerBottleImageUrl ?? null,
                                }
                              : null,
                          });
                        }
                      }).catch((error: any) => {
                        console.error('[Odara] heart preference write failed', error);
                        setSignedInHeartStateByFragranceId(prev => ({ ...prev, [fragranceId]: previousHeartState }));
                      }).finally(() => {
                        setHeartWritePendingByFragranceId(prev => {
                          const nextPending = { ...prev };
                          delete nextPending[fragranceId];
                          return nextPending;
                        });
                      });
                    }}
                    onHaptic={(intensity) => haptic(intensity === 'medium' ? 'success' : 'selection')}
                  />
                );
              })()}

              <button
                ref={daisyButtonRef}
                type="button"
                aria-label="Daisy chain"
                aria-pressed={signedInCarryoverUiActive}
                aria-disabled={isGuestMode || isReadOnlyHistoryCard || undefined}
                onClick={isGuestMode || isReadOnlyHistoryCard ? undefined : () => {
                  const nextTarget = handleSignedInCarryoverToggle();
                  setDaisyLabelText(getSignedInCarryoverFeedbackLabel(nextTarget));
                  setDaisyLabelTick((t) => t + 1);
                }}
                className={`relative flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300 ${isGuestMode ? '' : 'active:scale-95'}`}
                style={{
                  ...sharedBottomActionButtonStyle,
                  ...bottomCarryoverButtonStyle,
                  cursor: isGuestMode ? 'default' : 'pointer',
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.65"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10 14l-1.6 1.6a3 3 0 0 1-4.2-4.2l3.2-3.2a3 3 0 0 1 4.2 0" />
                  <path d="M14 10l1.6-1.6a3 3 0 0 1 4.2 4.2l-3.2 3.2a3 3 0 0 1-4.2 0" />
                  <path d="M9 15l6-6" />
                </svg>
                <FloatingActionLabel
                  triggerKey={daisyLabelTick || null}
                  text={daisyLabelText}
                  anchorRef={daisyButtonRef}
                  color={daisyLabelText === 'Off' ? '#ef4444' : undefined}
                />
              </button>

              <button
                ref={nextButtonRef}
                type="button"
                aria-label="Next"
                aria-disabled={isCardLocked || skipLoading || isReadOnlyHistoryCard || undefined}
                disabled={isCardLocked || skipLoading || isReadOnlyHistoryCard}
                onClick={() => {
                  if (skipLoading) return;
                  handleNextButtonPress();
                }}
                className="relative flex h-11 w-11 items-center justify-center rounded-full transition-all duration-300 active:scale-[0.97]"
                style={{
                  ...nextActionButtonStyle,
                  opacity: isCardLocked || isReadOnlyHistoryCard ? 0.42 : 1,
                  transform: skipLoading ? 'translateY(0.5px)' : undefined,
                }}
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M7 10.5l5 5 5-5" />
                  <path d="M8 7.5h8" opacity="0.46" />
                </svg>
                <FloatingActionLabel
                  triggerKey={nextLabelTick || null}
                  text={nextLabelText}
                  anchorRef={nextButtonRef}
                />
              </button>
            </div>
            </div>


              </div>
            </div>
          </div>
        )}
        {/* No data state */}
        {!oracleLoading && !oracleError && !oracle && (
          <div className="text-center py-12">
            <span className="text-sm text-muted-foreground">No oracle data returned</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default OdaraScreen;
