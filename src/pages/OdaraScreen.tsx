import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { normalizeNotes } from "@/lib/normalizeNotes";
import { odaraSupabase } from "@/lib/odara-client";
import LayerCard from "@/components/LayerCard";
import { LAYER_MODE_ORDER, type LayerMood, type LayerModes, type InteractionType } from "@/components/ModeSelector";
import { normalizeOracleHomePayload } from "@/lib/normalizeOracleHomePayload";
import { haptic } from "@/lib/haptics";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
// NOTE: guest-content.ts is INTENTIONALLY no longer imported.
// Guest mode renders strictly from the backend payload returned by
// get_guest_oracle_home_v1 (today_pick, layer, alternates, layer_modes,
// layer_mode_order, ui_default_mode, hero_tokens, layer_tokens,
// accord_tokens). Do NOT reintroduce frontend curation here.

type GuestModeKey = 'balance' | 'bold' | 'smooth' | 'wild';
const GUEST_DEFAULT_MODE_ORDER: GuestModeKey[] = ['balance', 'bold', 'smooth', 'wild'];

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

function isGuestModeKey(value: any): value is GuestModeKey {
  return value === 'balance' || value === 'bold' || value === 'smooth' || value === 'wild';
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
  const modeOrder = modeOrderRaw.filter(isGuestModeKey);
  const layerModesObj: Record<string, any> = bundle?.layer_modes && typeof bundle.layer_modes === 'object'
    ? bundle.layer_modes
    : {};
  const defaultMode: GuestModeKey = isGuestModeKey(bundle?.ui_default_mode)
    ? bundle.ui_default_mode
    : modeOrder.find((mode) => !!layerModesObj[mode]) ?? 'balance';

  let selectedMode: GuestModeKey = state.selectedMood;
  if (!layerModesObj[selectedMode]) {
    selectedMode = defaultMode;
  }
  if (!layerModesObj[selectedMode]) {
    selectedMode = modeOrder.find((mode) => !!layerModesObj[mode]) ?? defaultMode;
  }

  const modeLayerStack: any[] = Array.isArray(layerModesObj[selectedMode]?.layers)
    ? layerModesObj[selectedMode].layers
    : [];
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
  const layerTokens = Array.isArray(layerFromMode?.tokens) && layerFromMode.tokens.length > 0
    ? layerFromMode.tokens
    : Array.isArray(bundle?.layer_tokens)
      ? bundle.layer_tokens
      : Array.isArray(bundle?.layer?.tokens)
        ? bundle.layer.tokens
        : [];
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
      balance: layerModesObj.balance ?? null,
      bold: layerModesObj.bold ?? null,
      smooth: layerModesObj.smooth ?? null,
      wild: layerModesObj.wild ?? null,
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
  return {
    id: layer.fragrance_id ?? layer.id ?? '',
    name: layer.name ?? '',
    brand: layer.brand ?? null,
    family_key: layer.family ?? layer.family_key ?? '',
    notes: Array.isArray(layer.notes) ? layer.notes : null,
    accords: Array.isArray(layer.accords) ? layer.accords : null,
    interactionType: (layer.interaction_type ?? layer.layer_mode ?? 'balance') as InteractionType,
    reason: layer.reason ?? '',
    why_it_works: layer.why_it_works ?? '',
    projection: typeof layer.projection === 'number' ? layer.projection : null,
    ratio_hint: layer.ratio_hint ?? undefined,
    application_style: layer.application_style ?? undefined,
    placement_hint: layer.placement_hint ?? undefined,
    spray_guidance: layer.spray_guidance ?? undefined,
  };
}

function guestLayerModesToModeSelector(layerModes: Record<GuestModeKey, any | null>): LayerModes {
  return {
    balance: guestLayerToModeEntry(layerModes.balance),
    bold: guestLayerToModeEntry(layerModes.bold),
    smooth: guestLayerToModeEntry(layerModes.smooth),
    wild: guestLayerToModeEntry(layerModes.wild),
  };
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
}

export interface OracleAlternate {
  fragrance_id: string; name: string; family: string; reason: string;
  brand?: string; notes?: string[]; accords?: string[];
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
  layer_notes: string[];
  layer_accords: string[];
  layer_score: number;
  reason: string;
  why_it_works: string;
  ratio_hint: string;
  application_style: string;
  placement_hint: string;
  spray_guidance: string;
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

interface FragranceDetail {
  id: string;
  name: string;
  brand: string | null;
  family_key: string | null;
  notes: string[];
  accords: string[];
}

/** Normalized card for display — shared between hero and queue */
interface DisplayCard {
  fragrance_id: string;
  name: string;
  family: string;
  reason: string;
  brand: string;
  notes: string[];
  accords: string[];
  reason_chip_label?: string | null;
  reason_chip_explanation?: string | null;
  isHero: boolean; // true = oracle hero, false = queue card
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
  userId: string;
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

function buildForecastDays(selectedDate: string) {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();
  const todayStr = fmtLocalDateStr(today);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
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
  const d = new Date(dateStr + 'T12:00:00');
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return `${days[d.getDay()]} · ${d.getDate()}`;
}

function getPreviousDateKey(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return fmtLocalDateStr(d);
}

/* ── Lock state type ── */
type LockState = 'neutral' | 'locked' | 'skipping';
type SignedInCarryoverTarget = 'off' | 'hero' | 'layer';

/* ── Gesture constants ──
 * Card approval is a double-tap (click-based).
 * Swipe-up-to-lock is REMOVED and must not be reintroduced.
 * Swipe-DOWN remains a two-step contract:
 *   - locked   → swipe down = unlock
 *   - neutral  → swipe down = skip
 */
const SWIPE_DOWN_DISTANCE = 60;     // px of downward travel to trigger
const SWIPE_DIRECTION_LOCK = 8;     // px before we lock direction
const SWIPE_HORIZONTAL_TOLERANCE = 1.2; // |dy| must exceed |dx| * this
const DAY_SWIPE_THRESHOLD = 72;     // px before a day-change commits
const DAY_SWIPE_MAX_OFFSET = 148;   // px visual drag clamp for card stack

function backendModeEntryToLayerMode(
  entry: BackendModeEntry | null | undefined,
): NonNullable<LayerModes[LayerMood]> | null {
  if (!entry) return null;

  return {
    id: entry.layer_fragrance_id,
    name: entry.layer_name || '',
    brand: entry.layer_brand || '',
    family_key: entry.layer_family || '',
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
  };
}

/** Convert a v6 layer entry (from get_signed_in_card_contract_v6, either the
 *  top-level `layer` object or `layer_modes[mood].layers[idx]`) into the
 *  LayerMode shape consumed by LayerCard. Pure mapping — no inference. */
function v6LayerToLayerMode(
  layer: any,
  mood: LayerMood,
): NonNullable<LayerModes[LayerMood]> | null {
  if (!layer || typeof layer !== 'object') return null;
  const id = layer.fragrance_id ?? layer.layer_fragrance_id ?? layer.id ?? '';
  const name = layer.name ?? layer.layer_name ?? '';
  if (!id && !name) return null;
  return {
    id,
    name,
    brand: layer.brand ?? layer.layer_brand ?? '',
    family_key: layer.family ?? layer.family_key ?? layer.layer_family ?? '',
    notes: Array.isArray(layer.notes) ? layer.notes : Array.isArray(layer.layer_notes) ? layer.layer_notes : [],
    accords: Array.isArray(layer.accords) ? layer.accords : Array.isArray(layer.layer_accords) ? layer.layer_accords : [],
    interactionType: ((layer.interaction_type ?? layer.layer_mode ?? mood) as InteractionType) || mood,
    reason: layer.reason ?? '',
    why_it_works: layer.why_it_works ?? '',
    projection: layer.projection ?? null,
    ratio_hint: layer.ratio_hint ?? '',
    application_style: layer.application_style ?? '',
    placement_hint: layer.placement_hint ?? '',
    spray_guidance: layer.spray_guidance ?? '',
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

  return {
    fragrance_id,
    name,
    family,
    reason,
    brand,
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

function displayCardNeedsDetailHydration(card: DisplayCard | null | undefined): boolean {
  if (!card) return false;
  return !hasResolvedFamilyValue(card.family) || !hasRenderableRailTokens(card.accords, card.notes);
}

function layerModeNeedsDetailHydration(layer: NonNullable<LayerModes[LayerMood]> | null | undefined): boolean {
  if (!layer) return false;
  return !hasResolvedFamilyValue(layer.family_key) || !hasRenderableRailTokens(layer.accords, layer.notes);
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
    reason: sources.find((source) => source.reason)?.reason ?? '',
    notes: bestNotes,
    accords: bestAccords,
    reason_chip_label: resolvedReasonChip?.label ?? null,
    reason_chip_explanation: resolvedReasonChip?.explanation ?? null,
  };
}

function areSameDisplayCards(a: DisplayCard | null | undefined, b: DisplayCard | null | undefined) {
  if (!a || !b) return false;
  return (
    a.fragrance_id === b.fragrance_id &&
    a.name === b.name &&
    a.brand === b.brand &&
    a.family === b.family &&
    a.reason_chip_label === b.reason_chip_label &&
    a.reason_chip_explanation === b.reason_chip_explanation &&
    a.notes.length === b.notes.length &&
    a.notes.every((note, idx) => note === b.notes[idx]) &&
    a.accords.length === b.accords.length &&
    a.accords.every((accord, idx) => accord === b.accords[idx])
  );
}

function normalizeFragranceIdentityText(value: string | null | undefined) {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
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

function pickFirstUniqueDisplayCard(
  candidates: Array<DisplayCard | null | undefined>,
  against: { fragrance_id?: string | null; id?: string | null; name?: string | null; brand?: string | null } | null | undefined,
) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!isSameFragranceIdentity(candidate, against)) {
      return candidate;
    }
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
      notes: layerNotes,
      accords: layerAccords,
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
    notes: preferredRail.notes,
    accords: preferredRail.accords,
  };
}

/** Convert an OraclePick to a DisplayCard (hero) */
function heroToDisplay(pick: OraclePick): DisplayCard {
  return {
    ...pick,
    isHero: true,
  };
}

/** Tracks locked scent colors per day+context for weekly lane rendering */
type LockedLaneInfo = { mainColor: string; layerColor: string | null };
type LockedSelectionsMap = Record<string, LockedLaneInfo>; // key = "dateStr:context"

/** Persisted lock state per day+context */
type FavoriteCombo = {
  mainId: string;
  layerId: string | null;
  mood: LayerMood;
  ratio: string;
};
type FavoriteMap = Record<string, FavoriteCombo>; // key = "dateStr:context"

type SignedInDayState = {
  lockState: LockState;
  carryoverMode: SignedInCarryoverTarget;
  carryoverOrigin: 'manual' | 'inherited' | null;
  carryoverNextDayRole: 'main' | 'layer' | null;
  carryoverSelectedCard: DisplayCard | null;
  carryoverHeroCard: DisplayCard | null;
  carryoverLayerCard: DisplayCard | null;
  lockedCard: DisplayCard | null;
  lockedLayerCard: DisplayCard | null;
  lockedMood: LayerMood;
  lockedPromotedAltId: string | null;
};

type SignedInDayStateMap = Record<string, SignedInDayState>; // key = "dateStr"
type SignedInResolvedDayDecision = {
  visibleCard: DisplayCard | null;
  forcedLayerCarryCard: DisplayCard | null;
  selectedMood: LayerMood;
  promotedAltId: string | null;
  source: 'locked' | 'carryover-main' | 'carryover-layer' | 'oracle';
};

function createDefaultSignedInDayState(): SignedInDayState {
  return {
    lockState: 'neutral',
    carryoverMode: 'off',
    carryoverOrigin: null,
    carryoverNextDayRole: null,
    carryoverSelectedCard: null,
    carryoverHeroCard: null,
    carryoverLayerCard: null,
    lockedCard: null,
    lockedLayerCard: null,
    lockedMood: 'balance',
    lockedPromotedAltId: null,
  };
}

function resolveCarryoverSelectedCard(dayState: SignedInDayState | null | undefined): DisplayCard | null {
  if (!dayState || dayState.carryoverMode === 'off') return null;
  return dayState.carryoverSelectedCard
    ?? (
      dayState.carryoverMode === 'hero'
        ? dayState.carryoverHeroCard
        : dayState.carryoverMode === 'layer'
          ? dayState.carryoverLayerCard
          : null
    )
    ?? null;
}

function resolveCarryoverNextDayRole(source: SignedInCarryoverTarget): 'main' | 'layer' | null {
  if (source === 'hero') return 'layer';
  if (source === 'layer') return 'main';
  return null;
}

function resolveSignedInDayDecision(
  currentDayState: SignedInDayState,
  hasCurrentDayState: boolean,
  previousDayState: SignedInDayState,
  oraclePick: OraclePick | null | undefined,
  defaultMood: LayerMood,
): SignedInResolvedDayDecision {
  const lockedVisibleCard = currentDayState.lockState === 'locked' ? currentDayState.lockedCard : null;
  if (lockedVisibleCard) {
    return {
      visibleCard: lockedVisibleCard,
      forcedLayerCarryCard: currentDayState.lockedLayerCard,
      selectedMood: currentDayState.lockedMood ?? defaultMood,
      promotedAltId: currentDayState.lockedPromotedAltId,
      source: 'locked',
    };
  }

  if (hasCurrentDayState && currentDayState.carryoverMode === 'off') {
    return {
      visibleCard: oraclePick ? heroToDisplay(oraclePick) : null,
      forcedLayerCarryCard: null,
      selectedMood: defaultMood,
      promotedAltId: null,
      source: 'oracle',
    };
  }

  const previousSelectedCard = resolveCarryoverSelectedCard(previousDayState);
  const previousNextDayRole = previousDayState?.carryoverNextDayRole
    ?? resolveCarryoverNextDayRole(previousDayState?.carryoverMode ?? 'off');

  if (previousSelectedCard && previousNextDayRole === 'main') {
    return {
      visibleCard: previousSelectedCard,
      forcedLayerCarryCard: null,
      selectedMood: defaultMood,
      promotedAltId: null,
      source: 'carryover-main',
    };
  }

  if (previousSelectedCard && previousNextDayRole === 'layer') {
    return {
      visibleCard: oraclePick ? heroToDisplay(oraclePick) : null,
      forcedLayerCarryCard: previousSelectedCard,
      selectedMood: defaultMood,
      promotedAltId: null,
      source: 'carryover-layer',
    };
  }

  return {
    visibleCard: oraclePick ? heroToDisplay(oraclePick) : null,
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
    notes: Array.isArray(card.notes) ? card.notes : [],
    accords: Array.isArray(card.accords) ? card.accords : [],
    interactionType: mood,
    reason: card.reason ?? '',
    why_it_works: '',
    projection: null,
    ratio_hint: '',
    application_style: '',
    placement_hint: '',
    spray_guidance: '',
  } as any;
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
  const forecastDays = buildForecastDays(selectedDate);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [reasonChipExpanded, setReasonChipExpanded] = useState(false);
  const [daySwipeOffset, setDaySwipeOffset] = useState(0);
  const [daySwipeDragging, setDaySwipeDragging] = useState(false);
  const suppressCardClickRef = useRef(false);
  const selectedForecastIndex = Math.max(0, forecastDays.findIndex((fd) => fd.dateStr === selectedDate));
  const prevForecastDay = selectedForecastIndex > 0 ? forecastDays[selectedForecastIndex - 1] : null;
  const nextForecastDay = selectedForecastIndex < forecastDays.length - 1 ? forecastDays[selectedForecastIndex + 1] : null;

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

  const hasHistory = viewHistory.length > 0;

  const commitSignedInQueuedHero = useCallback((card: DisplayCard, detail: FragranceDetail | null | undefined) => {
    if (isGuestMode || card.isHero) {
      return card;
    }

    const previous = signedInQueuedHeroRef.current.get(card.fragrance_id);
    const mergedCard = previous
      ? {
          ...card,
          family: card.family || previous.family,
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
      const { data, error } = await odaraSupabase
        .from('fragrances')
        .select('id, name, brand, family_key, notes, accords')
        .in('id', missingIds);

      if (error) {
        return details;
      }

      let cacheUpdated = false;
      for (const row of Array.isArray(data) ? data : []) {
        if (!row?.id) continue;
        const detail: FragranceDetail = {
          id: row.id,
          name: row.name ?? '',
          brand: row.brand ?? null,
          family_key: row.family_key ?? null,
          notes: Array.isArray(row.notes) ? row.notes : [],
          accords: Array.isArray(row.accords) ? row.accords : [],
        };
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
      .filter((row): row is QueueCard => !!row && (!excludeId || row.fragrance_id !== excludeId));

    return normalizedRows.map((row) => commitSignedInQueuedHero(queueCardToDisplay(row), null));
  }, [commitSignedInQueuedHero]);

  const stateKey = `${selectedDate}:${selectedContext}`;

  // Fetch queue from backend — background only, never blocks hero.
  // GUEST MODE: skip — queue is signed-in only.
  const fetchQueue = useCallback(async (excludeId?: string) => {
    if (isGuestMode) {
      console.log('[Odara][Guest] queue fetch skipped (read-only)');
      return [];
    }
    const requestKey = `${stateKey}|${excludeId ?? '(none)'}`;
    const inFlight = queueFetchInFlightRef.current.get(requestKey);
    if (inFlight) {
      console.log('[Odara] queue fetch reuse', requestKey);
      return inFlight;
    }

    console.log('[Odara] queue fetch start', requestKey);
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
        console.log('[Odara] queue fetch success', seededQueue.length, 'cards');
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
    if (cached) return cached;

    const inFlight = fragranceDetailInFlightRef.current.get(fragranceId);
    if (inFlight) return inFlight;

    const request = (async (): Promise<FragranceDetail | null> => {
      try {
        const { data, error } = await odaraSupabase
          .from('fragrances')
          .select('id, name, brand, family_key, notes, accords')
          .eq('id', fragranceId)
          .maybeSingle();

        if (error || !data?.id) {
          return null;
        }

        const detail: FragranceDetail = {
          id: data.id,
          name: data.name ?? '',
          brand: data.brand ?? null,
          family_key: data.family_key ?? null,
          notes: Array.isArray(data.notes) ? data.notes : [],
          accords: Array.isArray(data.accords) ? data.accords : [],
        };

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
  }, []);

  // Interactive state
  const [selectedMood, setSelectedMood] = useState<LayerMood>('balance');
  const [selectedRatio, setSelectedRatio] = useState('1:1');
  const [layerExpanded, setLayerExpanded] = useState(false);
  // ── Signed-in v6: per-mood active layer index into payload.layer_modes[mood].layers[]
  // Reset to {balance:0,bold:0,smooth:0,wild:0} on every payload change.
  // Repeated taps on the same mood cycle this index modulo stack length.
  const [signedInLayerIdxByMood, setSignedInLayerIdxByMood] = useState<Record<LayerMood, number>>({
    balance: 0, bold: 0, smooth: 0, wild: 0,
  });

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
  const [guestActiveLayerIdx, setGuestActiveLayerIdx] = useState(0);
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
    setGuestActiveLayerIdx(0);
    setGuestLocked(false);
    setLockedGuestSnapshot(null);
    const def = (oracle as any)?.main_bundle?.ui_default_mode ?? (oracle as any)?.ui_default_mode;
    const safeDef: GuestModeKey = (def === 'balance' || def === 'bold' || def === 'smooth' || def === 'wild') ? def : 'balance';
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
      activeLayer: resolved.layer ? { ...resolved.layer, tokens: resolved.layerTokens } : null,
      layerModes: resolved.layerModes,
      modeLayerStack: resolved.modeLayerStack,
      alternates: resolved.alternates,
      renderedFromFullBundle: resolved.renderedFromFullBundle,
      reasonChipLabel: resolved.reasonChipLabel,
      reasonChipExplanation: resolved.reasonChipExplanation,
    };
  }, [isGuestMode, oracle, activeOracle, selectedAlternateIdx, guestSelectedMood, guestActiveLayerIdx, selectedContext, selectedDate]);

  useEffect(() => {
    if (!isGuestMode || !activeGuestRender) return;
    const heroTokens = Array.isArray(activeGuestRender.activeHeroTokens) ? activeGuestRender.activeHeroTokens : [];
    const layerTokens = Array.isArray(activeGuestRender.activeLayer?.tokens) ? activeGuestRender.activeLayer.tokens : [];
    const modeKeys = Object.keys(activeGuestRender.layerModes ?? {}).filter((key) => !!(activeGuestRender.layerModes as any)?.[key]);
    console.info('ODARA_GUEST_VM_RENDER_PROOF', {
      source: activeGuestRender.source,
      selectedAlternateIdx,
      heroName: activeGuestRender.activeHero?.name ?? null,
      heroTokenCount: heroTokens.length,
      layerName: activeGuestRender.activeLayer?.name ?? null,
      layerTokenCount: layerTokens.length,
      hasLayer: !!activeGuestRender.activeLayer,
      hasLayerModes: modeKeys.length > 0,
      modeKeys,
      hasBalance: !!activeGuestRender.layerModes?.balance,
      hasBold: !!activeGuestRender.layerModes?.bold,
      hasSmooth: !!activeGuestRender.layerModes?.smooth,
      hasWild: !!activeGuestRender.layerModes?.wild,
      renderedFromFullBundle: !!activeGuestRender.renderedFromFullBundle,
    });
  }, [isGuestMode, activeGuestRender, selectedAlternateIdx]);

  // Single authoritative guest lock boolean — used by every guest mutation handler.
  const isGuestLocked = isGuestMode && guestLocked;

  // Visible guest render: while locked, the JSX must render the frozen
  // snapshot. When unlocked (or no snapshot yet), fall back to the live
  // resolver. activeGuestRender remains the live source of truth.
  const visibleGuestRender =
    isGuestMode && guestLocked && lockedGuestSnapshot
      ? lockedGuestSnapshot
      : activeGuestRender;

  // Guest mode-row tap: different mode → switch + reset idx; same mode → cycle.
  const handleGuestModeTap = useCallback((mode: GuestModeKey) => {
    if (isGuestLocked) return;
    const o: any = oracle ?? activeOracle ?? {};
    const resolved = resolveGuestCardVM(o, selectedAlternateIdx, {
      source: guestRenderSourceRef.current,
      selectedMood: mode,
      activeLayerIdx: 0,
    });
    const stack: any[] = Array.isArray(resolved?.layerModes?.[mode]?.layers) ? resolved!.layerModes[mode]!.layers : [];
    if (stack.length === 0) return;
    if (mode !== guestSelectedMood) {
      setGuestSelectedMood(mode);
      setGuestActiveLayerIdx(0);
    } else {
      // cycle within current mode using backend layers.length (no hard-coded N)
      setGuestActiveLayerIdx((cur) => (cur + 1) % stack.length);
    }
  }, [oracle, activeOracle, guestSelectedMood, selectedAlternateIdx, isGuestLocked]);

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
        setGuestActiveLayerIdx(prev.idx);
      }
      guestPrevMainStateRef.current = null;
      guestRenderSourceRef.current = 'guest_main_bundle';
      setSelectedAlternateIdx(null);
      return true; // consumed
    }
    if (guestActiveLayerIdx > 0) {
      setGuestActiveLayerIdx((cur) => Math.max(0, cur - 1));
      return true; // consumed
    }
    return false; // let normal back run
  }, [isGuestMode, selectedAlternateIdx, guestActiveLayerIdx, guestSkipHistory, oracle, activeOracle, isGuestLocked]);

  // Lock + carryover state — persisted per signed-in calendar day
  const [signedInDayStateMap, setSignedInDayStateMap] = useState<SignedInDayStateMap>({});
  const [signedInForcedLayerCarryCard, setSignedInForcedLayerCarryCard] = useState<DisplayCard | null>(null);
  const [signedInResolvedDayDecisionSource, setSignedInResolvedDayDecisionSource] = useState<SignedInResolvedDayDecision['source']>('oracle');
  const currentDateKey = selectedDate;
  const previousDateKey = useMemo(() => getPreviousDateKey(selectedDate), [selectedDate]);
  const hasStoredSignedInDayState = Object.prototype.hasOwnProperty.call(signedInDayStateMap, currentDateKey);
  const signedInDayState = signedInDayStateMap[currentDateKey] ?? createDefaultSignedInDayState();
  const lockState: LockState = signedInDayState.lockState;
  const setLockState = useCallback((ls: LockState) => {
    setSignedInDayStateMap(prev => {
      const current = prev[currentDateKey] ?? createDefaultSignedInDayState();
      const next: SignedInDayState = ls === 'locked'
        ? { ...current, lockState: ls }
        : {
            ...current,
            lockState: ls,
            lockedCard: null,
            lockedLayerCard: null,
            lockedMood: 'balance',
            lockedPromotedAltId: null,
          };
      if (
        current.lockState === next.lockState &&
        current.lockedCard === next.lockedCard &&
        current.lockedLayerCard === next.lockedLayerCard &&
        current.lockedMood === next.lockedMood &&
        current.lockedPromotedAltId === next.lockedPromotedAltId
      ) {
        return prev;
      }
      return { ...prev, [currentDateKey]: next };
    });
  }, [currentDateKey]);

  const [lockPulse, setLockPulse] = useState(false);
  const [unlockFlash, setUnlockFlash] = useState(false);
  const [lockFlash, setLockFlash] = useState(false);
  const [likeFlash, setLikeFlash] = useState(false);
  const [skipFlash, setSkipFlash] = useState(false);
  const [skipAnimating, setSkipAnimating] = useState(false);

  // Locked selections for weekly lanes
  const [lockedSelections, setLockedSelections] = useState<LockedSelectionsMap>({});

  // Favorite state — persisted per day+context
  const [favoriteMap, setFavoriteMap] = useState<FavoriteMap>({});
  const currentFavorite = favoriteMap[stateKey] ?? null;
  const isFavorited = !!(currentFavorite && visibleCard &&
    currentFavorite.mainId === visibleCard.fragrance_id);
  const signedInCarryoverOrigin = signedInDayState.carryoverOrigin;
  const [signedInCarryoverPulseTarget, setSignedInCarryoverPulseTarget] = useState<Exclude<SignedInCarryoverTarget, 'off'> | null>(null);
  const [signedInCarryoverCloseFlash, setSignedInCarryoverCloseFlash] = useState(false);
  const updateSignedInDayState = useCallback((
    key: string,
    updater: (current: SignedInDayState) => SignedInDayState,
  ) => {
    setSignedInDayStateMap(prev => {
      const current = prev[key] ?? createDefaultSignedInDayState();
      const next = updater(current);
      if (
        current.lockState === next.lockState &&
        current.carryoverMode === next.carryoverMode &&
        current.carryoverOrigin === next.carryoverOrigin &&
        current.carryoverNextDayRole === next.carryoverNextDayRole &&
        current.lockedMood === next.lockedMood &&
        current.lockedPromotedAltId === next.lockedPromotedAltId &&
        areSameDisplayCards(current.carryoverSelectedCard, next.carryoverSelectedCard) &&
        areSameDisplayCards(current.carryoverHeroCard, next.carryoverHeroCard) &&
        areSameDisplayCards(current.carryoverLayerCard, next.carryoverLayerCard) &&
        areSameDisplayCards(current.lockedCard, next.lockedCard) &&
        areSameDisplayCards(current.lockedLayerCard, next.lockedLayerCard)
      ) {
        return prev;
      }
      return { ...prev, [key]: next };
    });
  }, []);

  // ── Lazy per-mood fetcher via get_layer_for_card_mode_v1 (slot-scoped) ──
  const fetchMoodForCard = useCallback(async (fragranceId: string, mood: LayerMood, isRetry = false) => {
    if (isGuestMode) {
      console.log('[Odara][Guest] mood fetch skipped (read-only)', { mood, fragranceId });
      return null;
    }
    const slotPrefix = `${selectedDate}|${selectedContext}`;
    const moodKey = `${slotPrefix}|${fragranceId}|${mood}`;
    const cached = moodCacheRef.current.get(moodKey);
    if (cached !== undefined && !isRetry) {
      console.log('[Odara] mood cache hit', moodKey);
      return cached;
    }

    // In-flight dedupe: reuse pending promise for same key
    const inFlight = moodInFlightRef.current.get(moodKey);
    if (inFlight && !isRetry) {
      console.log('[Odara] mood in-flight reuse', moodKey);
      return inFlight;
    }

    console.log('[Odara] mood cache miss', moodKey, isRetry ? '(retry)' : '');

    // Capture slot at launch for stale guard
    const capturedSlot = stateKey;

    // Gather already-loaded layer fragrance ids for exclusion — CURRENT SLOT ONLY
    const excludeIds: string[] = [];
    for (const m of ['balance', 'bold', 'smooth', 'wild'] as LayerMood[]) {
      const existing = moodCacheRef.current.get(`${slotPrefix}|${fragranceId}|${m}`);
      if (existing?.layer_fragrance_id) excludeIds.push(existing.layer_fragrance_id);
    }
    // Also include oracle.layer id if present
    const ol = activeOracle?.layer;
    if (ol?.fragrance_id) excludeIds.push(ol.fragrance_id);

    const fetchPromise = (async (): Promise<BackendModeEntry | null> => {
      try {
        console.log('[Odara] lazy mood fetch start', mood, fragranceId, 'slot', capturedSlot);
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
          console.log('[Odara] ignoring stale mood result for old slot', capturedSlot, '→ current', activeSlotRef.current);
          return null;
        }

        if (error) {
          console.error('[Odara] lazy mood fetch fail', mood, error.message);
          // Fallback: if the home payload pre-seeded this mood block, hydrate
          // from there instead of surfacing a hard error to the user. This
          // keeps mode buttons functional even when the per-mode RPC is
          // unavailable on the backend.
          const hp: any = activeOracle ?? oracle ?? {};
          const heroIdHp = hp?.today_pick?.fragrance_id ?? null;
          const seed: any = (heroIdHp === fragranceId) ? hp?.layer_modes?.[mood] : null;
          if (seed && (seed.layer_fragrance_id || seed.fragrance_id || seed.layer_name || seed.name)) {
            const fbEntry: BackendModeEntry = {
              mode: mood,
              layer_fragrance_id: seed.layer_fragrance_id ?? seed.fragrance_id ?? '',
              layer_name: seed.layer_name ?? seed.name ?? '',
              layer_brand: seed.layer_brand ?? seed.brand ?? '',
              layer_family: seed.layer_family ?? seed.family ?? '',
              layer_notes: Array.isArray(seed.layer_notes) ? seed.layer_notes : Array.isArray(seed.notes) ? seed.notes : [],
              layer_accords: Array.isArray(seed.layer_accords) ? seed.layer_accords : Array.isArray(seed.accords) ? seed.accords : [],
              layer_score: seed.layer_score ?? 0,
              reason: seed.reason ?? '',
              why_it_works: seed.why_it_works ?? '',
              ratio_hint: seed.ratio_hint ?? '',
              application_style: seed.application_style ?? '',
              placement_hint: seed.placement_hint ?? '',
              spray_guidance: seed.spray_guidance ?? '',
              interaction_type: seed.interaction_type ?? mood,
            };
            (fbEntry as any).tokens = Array.isArray(seed.tokens) ? seed.tokens : undefined;
            moodCacheRef.current.set(moodKey, fbEntry);
            setModeErrors(prev => ({ ...prev, [mood]: null }));
            setLayerDebugSource(`fallback:${mood}`);
            setModeLoading(prev => ({ ...prev, [mood]: false }));
            setMoodCacheVersion(v => v + 1);
            console.log('[Odara] mood RPC failed → seeded from home payload', mood);
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

        const entry: BackendModeEntry = {
          mode: mood,
          layer_fragrance_id: row.layer_fragrance_id ?? '',
          layer_name: row.layer_name ?? '',
          layer_brand: row.layer_brand ?? '',
          layer_family: row.layer_family ?? '',
          layer_notes: Array.isArray(row.layer_notes) ? row.layer_notes : [],
          layer_accords: Array.isArray(row.layer_accords) ? row.layer_accords : [],
          layer_score: row.layer_score ?? 0,
          reason: row.reason ?? '',
          why_it_works: row.why_it_works ?? '',
          ratio_hint: row.ratio_hint ?? '',
          application_style: row.application_style ?? '',
          placement_hint: row.placement_hint ?? '',
          spray_guidance: row.spray_guidance ?? '',
          interaction_type: row.interaction_type ?? mood,
        };

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

        moodCacheRef.current.set(moodKey, entry);
        console.log('[Odara] lazy mood fetch success', mood, entry.layer_name, 'slot', capturedSlot);
        setLayerDebugSource(`rpc:${mood}`);
        setModeLoading(prev => ({ ...prev, [mood]: false }));
        setMoodCacheVersion(v => v + 1);
        return entry;
      } catch (e: any) {
        if (activeSlotRef.current !== capturedSlot) {
          console.log('[Odara] ignoring stale mood error for old slot', capturedSlot);
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
  }, [userId, selectedContext, selectedDate, activeOracle, stateKey, isGuestMode, fetchFragranceDetail]);

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
      console.log('[Odara][Guest] alternates from raw payload', { count: guestAlts.length });
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
        console.log('[Odara] ignoring stale alternates for old slot', capturedSlot);
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

  // Effect 1: CLEAR card state immediately when the slot (date or context) changes
  useEffect(() => {
    if (prevSlotRef.current === stateKey) return; // same slot, no-op
    const oldSlot = prevSlotRef.current;
    prevSlotRef.current = stateKey;

    console.log('[Odara] slot change -> clearing ALL state', oldSlot, '→', stateKey);
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
    alternatesCacheRef.current.clear();
    queueFetchInFlightRef.current.clear();
  }, [stateKey]);

  useEffect(() => {
    committedSignedInSlotRef.current = stateKey;
  }, [stateKey]);

  // Effect 2: Hydrate card when oracle data arrives — hero-first contract
  // Full-screen loader disappears as soon as oracle resolves.
  // Queue is fetched in the BACKGROUND after hero is set.
  useEffect(() => {
    if (!oracle) {
      setActiveOracle(null);
      setVisibleCard(null);
      setLayerDebugSource('none');
      setQueue([]);
      setQueuePointer(0);
      setSignedInForcedLayerCarryCard(null);
      setSignedInResolvedDayDecisionSource('oracle');
      return;
    }

    const capturedSlot = stateKey;

    // ── FULL STATE RESET before applying new oracle payload ──
    const prevVisibleId = visibleCard?.fragrance_id ?? '(none)';
    const prevPromotedId = promotedAltId ?? '(none)';

    // ── Normalize raw payload ONCE — single source of truth ──
    const normalized = normalizeOracleHomePayload(oracle);

    const v6Peek: any = (oracle as any)?.__v6 ?? null;
    const balanceLayersPeek = Array.isArray(v6Peek?.layer_modes?.balance?.layers)
      ? v6Peek.layer_modes.balance.layers
      : [];
    console.info('[Odara] oracle apply', {
      selectedDate,
      selectedContext,
      backendHeroId: v6Peek?.hero?.fragrance_id ?? oracle.today_pick?.fragrance_id ?? '(none)',
      previousVisibleId: prevVisibleId,
      promotedAltIdBeforeReset: prevPromotedId,
      contract: v6Peek?.card_contract_version ?? (oracle as any)?.card_contract_version ?? normalized.rawModeContract,
      surfaceType: v6Peek?.surface_type ?? (oracle as any)?.surface_type ?? null,
      heroName: v6Peek?.hero?.name ?? oracle.today_pick?.name ?? null,
      seededBalanceLayerName: balanceLayersPeek[0]?.name ?? normalized.seededBalanceLayer?.name ?? '(null)',
      seededBalanceLayerId: balanceLayersPeek[0]?.fragrance_id ?? normalized.seededBalanceLayer?.fragranceId ?? '(null)',
    });

    // 1) Clear ALL stale state first
    // viewHistory is NOT cleared here — slot changes clear it in Effect 1 above
    setPromotedAltId(null);
    setLayerExpanded(false);
    setCurrentCardAlternates([]);
    setCurrentCardAlternatesOwnerId(null);
    setModeLoading({ balance: false, bold: false, smooth: false, wild: false });
    setModeErrors({ balance: null, bold: null, smooth: null, wild: null });

    // 2) Set oracle
    setActiveOracle(oracle);

    const dayStateMap = signedInDayStateMapRef.current;
    const hasCurrentDayState = Object.prototype.hasOwnProperty.call(dayStateMap, currentDateKey);
    const currentDayState = dayStateMap[currentDateKey] ?? createDefaultSignedInDayState();
    const previousDayState = dayStateMap[previousDateKey] ?? createDefaultSignedInDayState();

    // 3) Initialize from v6 contract: ui_default_mode + reset all mode indexes to 0
    const v6 = (oracle as any)?.__v6 ?? null;
    const v6DefaultMood: LayerMood = (() => {
      const def = v6?.ui_default_mode ?? normalized.defaultMode;
      return (def === 'balance' || def === 'bold' || def === 'smooth' || def === 'wild') ? def : normalized.defaultMode;
    })();
    const resolvedDayDecision = resolveSignedInDayDecision(
      currentDayState,
      hasCurrentDayState,
      previousDayState,
      oracle.today_pick,
      v6DefaultMood,
    );
    const initialVisibleCard = resolvedDayDecision.visibleCard;
    const initialForcedLayerCarryCard = resolvedDayDecision.forcedLayerCarryCard;
    const initialMood: LayerMood = resolvedDayDecision.selectedMood;
    setSelectedMood(initialMood);
    setSignedInLayerIdxByMood({ balance: 0, bold: 0, smooth: 0, wild: 0 });

    console.log('[Odara] oracle apply complete', {
      newVisibleId: oracle.today_pick?.fragrance_id ?? '(none)',
      promotedAltIdAfterReset: '(null)',
      initialMood,
    });

    if (oracle.today_pick) {
      setVisibleCard(initialVisibleCard);
      setSignedInForcedLayerCarryCard(initialForcedLayerCarryCard);
      setSignedInResolvedDayDecisionSource(resolvedDayDecision.source);
      setPromotedAltId(resolvedDayDecision.promotedAltId);
      console.log(
        '[Odara] applying oracle home for slot',
        capturedSlot,
        {
          hero: oracle.today_pick.fragrance_id,
          initialVisibleId: initialVisibleCard?.fragrance_id ?? null,
          dayDecisionSource: resolvedDayDecision.source,
          usedCarryover: resolveCarryoverSelectedCard(previousDayState)?.fragrance_id ?? null,
          carryoverRoleForCurrentDay: previousDayState?.carryoverNextDayRole ?? resolveCarryoverNextDayRole(previousDayState?.carryoverMode ?? 'off'),
          forcedLayerCarryId: initialForcedLayerCarryCard?.fragrance_id ?? null,
          restoredLockedCard: currentDayState.lockState === 'locked'
            ? (currentDayState.lockedCard?.fragrance_id ?? null)
            : null,
        }
      );

      // 4) Pre-seed mood cache from normalized payload for hero card
      const slotPfx = `${selectedDate}|${selectedContext}`;
      const heroId = oracle.today_pick.fragrance_id;

      // 4a) Seed every mode block from layer_modes when present
      if (normalized.layerModesRaw) {
        for (const mood of LAYER_MODE_ORDER) {
          const modeData = (normalized.layerModesRaw as any)?.[mood];
          if (modeData && (modeData.fragrance_id || modeData.layer_fragrance_id)) {
            const entry: BackendModeEntry = {
              mode: mood,
              layer_fragrance_id: modeData.layer_fragrance_id ?? modeData.fragrance_id ?? '',
              layer_name: modeData.layer_name ?? modeData.name ?? '',
              layer_brand: modeData.layer_brand ?? modeData.brand ?? '',
              layer_family: modeData.layer_family ?? modeData.family ?? '',
              layer_notes: Array.isArray(modeData.layer_notes) ? modeData.layer_notes : Array.isArray(modeData.notes) ? modeData.notes : [],
              layer_accords: Array.isArray(modeData.layer_accords) ? modeData.layer_accords : Array.isArray(modeData.accords) ? modeData.accords : [],
              layer_score: modeData.layer_score ?? 0,
              reason: modeData.reason ?? '',
              why_it_works: modeData.why_it_works ?? '',
              ratio_hint: modeData.ratio_hint ?? '',
              application_style: modeData.application_style ?? '',
              placement_hint: modeData.placement_hint ?? '',
              spray_guidance: modeData.spray_guidance ?? '',
              interaction_type: modeData.interaction_type ?? modeData.layer_mode ?? mood,
            };
            moodCacheRef.current.set(`${slotPfx}|${heroId}|${mood}`, entry);
            console.log('[Odara] pre-seeded mood cache from layer_modes', mood, entry.layer_name);
          }
        }
      }

      // 4b) GUARANTEE balance is seeded — fall back to normalized.seededBalanceLayer
      // (which already prefers payload.layer → oracle_layer → seeded_balance_mode → layer_modes.balance)
      const balanceCacheKey = `${slotPfx}|${heroId}|balance`;
      if (!moodCacheRef.current.has(balanceCacheKey) && normalized.seededBalanceLayer?.fragranceId) {
        const sb = normalized.seededBalanceLayer;
        const balanceEntry: BackendModeEntry = {
          mode: 'balance',
          layer_fragrance_id: sb.fragranceId!,
          layer_name: sb.name ?? '',
          layer_brand: sb.brand ?? '',
          layer_family: sb.family ?? '',
          layer_notes: sb.notes,
          layer_accords: sb.accords,
          layer_score: sb.layerScore ?? 0,
          reason: sb.reason ?? '',
          why_it_works: sb.whyItWorks ?? '',
          ratio_hint: sb.ratioHint ?? '',
          application_style: sb.applicationStyle ?? '',
          placement_hint: sb.placementHint ?? '',
          spray_guidance: sb.sprayGuidance ?? '',
          interaction_type: sb.interactionType ?? 'balance',
        };
        moodCacheRef.current.set(balanceCacheKey, balanceEntry);
        console.log('[Odara] pre-seeded balance from normalized.seededBalanceLayer', balanceEntry.layer_name);
      }

      console.log('[Odara] mode cache after init', {
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
        setQueue(seededQueue);
        setQueuePointer(0);
      } else {
        fetchQueueRef.current(initialVisibleCard?.fragrance_id ?? oracle.today_pick.fragrance_id).then(q => {
          if (activeSlotRef.current !== capturedSlot) return;
          setQueue(q);
          setQueuePointer(0);
        });
      }
    } else {
      setVisibleCard(null);
      setLayerDebugSource('none');
      setQueue([]);
      setQueuePointer(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oracle, stateKey, currentDateKey, previousDateKey, queueRowsToDisplay]);

  // No eager modes fetch — moods load lazily on user tap

  useEffect(() => {
    if (!visibleCard) {
      setCurrentCardAlternates([]);
      setCurrentCardAlternatesOwnerId(null);
      return;
    }

    if (!isGuestMode && signedInVisibleIsHeroCard) {
      setCurrentCardAlternates(signedInPayloadAlternates);
      setCurrentCardAlternatesOwnerId(visibleCard.fragrance_id);
      return;
    }

    const capturedSlot = stateKey;
    const capturedCardId = visibleCard.fragrance_id;
    let isActive = true;
    setCurrentCardAlternates([]);
    setCurrentCardAlternatesOwnerId(null);

    resolveAlternatesForCard(visibleCard).then((alternates) => {
      if (isActive && activeSlotRef.current === capturedSlot) {
        setCurrentCardAlternates(alternates);
        setCurrentCardAlternatesOwnerId(capturedCardId);
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

  const oracleHeroId = activeOracle?.today_pick?.fragrance_id ?? null;
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
  const familyColor = FAMILY_COLORS[familyKey] ?? '#888';
  const familyLabel = FAMILY_LABELS[familyKey] ?? familyKey.toUpperCase();
  const getPreviewTone = (dateStr: string) => {
    const lane = lockedSelections[`${dateStr}:${selectedContext}`] ?? null;
    return {
      accent: lane?.mainColor ?? familyColor,
      glow: lane?.layerColor ?? lane?.mainColor ?? familyColor,
    };
  };

  // Build layer modes from slot-scoped mood cache — lazy loaded
  // Cache is pre-seeded from oracle.layer_modes on hero load (Effect 2)
  // moodCacheVersion is used to trigger re-renders when cache updates
  void moodCacheVersion; // consumed for reactivity
  const cardId = visibleCard?.fragrance_id ?? '';
  const slotPrefix = `${selectedDate}|${selectedContext}`;

  // ────────────────────────────────────────────────────────────────────
  // SIGNED-IN CANONICAL VIEW MODEL — v6 contract (get_signed_in_card_contract_v6)
  // Single resolved source for the visible signed-in card. All signed-in JSX
  // MUST read hero/layer/tokens through this object.
  //
  // Resolution order for the visible layer:
  //   1) payload.layer_modes[selectedMood].layers[ activeIdx ]
  //   2) payload.layer_modes[selectedMood] (if backend used flat per-mode shape)
  //   3) payload.layer (top-level fallback for balance only)
  //
  // Tokens:
  //   hero  → payload.hero_tokens
  //   layer → visibleLayer.tokens ?? payload.layer_tokens (balance only) ?? []
  // ────────────────────────────────────────────────────────────────────
  const signedInVisibleAlternates = signedInVisibleIsHeroCard
    ? signedInPayloadAlternates
    : (currentCardAlternatesOwnerId === visibleCard?.fragrance_id ? currentCardAlternates : []);

  // First-paint mode results — derived directly from v6 layer_modes (preview
  // stack) instead of the slot-scoped mood cache. The cache is still used as
  // a fallback (legacy/promoted/queue cards).
  const modeResults: LayerModes = useMemo(() => {
    const lm: any = v6Payload?.layer_modes ?? (activeOracle as any)?.layer_modes ?? null;
    const fromV6 = (mood: LayerMood) => {
      if (!signedInVisibleIsHeroCard) return null;
      const block = lm?.[mood] ?? null;
      if (!block) return null;
      const idx = signedInLayerIdxByMood[mood] ?? 0;
      const stack: any[] = Array.isArray(block.layers) ? block.layers : [];
      const picked = stack.length > 0 ? stack[idx % stack.length] : block;
      return v6LayerToLayerMode(picked, mood);
    };
    const fallback = (mood: LayerMood) =>
      backendModeEntryToLayerMode(moodCacheRef.current.get(`${slotPrefix}|${cardId}|${mood}`)) ?? null;
    return {
      balance: fromV6('balance') ?? fallback('balance'),
      bold:    fromV6('bold')    ?? fallback('bold'),
      smooth:  fromV6('smooth')  ?? fallback('smooth'),
      wild:    fromV6('wild')    ?? fallback('wild'),
    };
    // moodCacheVersion read above keeps this fresh when cache changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v6Payload, activeOracle, signedInLayerIdxByMood, slotPrefix, cardId, moodCacheVersion, signedInVisibleIsHeroCard]);
  const visibleModeEntry = selectedMood ? modeResults[selectedMood] ?? null : null;
  useEffect(() => {
    if (isGuestMode || !visibleCard?.fragrance_id || signedInVisibleIsHeroCard) return;
    const mood = selectedMood ?? 'balance';
    const moodKey = `${slotPrefix}|${visibleCard.fragrance_id}|${mood}`;
    if (moodCacheRef.current.has(moodKey)) return;
    void fetchMoodForCard(visibleCard.fragrance_id, mood);
  }, [isGuestMode, visibleCard?.fragrance_id, signedInVisibleIsHeroCard, selectedMood, slotPrefix, fetchMoodForCard]);

  useEffect(() => {
    if (isGuestMode) return;

    const visibleHeroNeedsDetail = !!visibleCard?.fragrance_id
      && !fragranceDetailCacheRef.current.has(visibleCard.fragrance_id)
      && displayCardNeedsDetailHydration(visibleCard);
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
    if (visibleLayerNeedsDetail && layerModeNeedsDetailHydration(visibleModeEntry ?? (signedInForcedLayerCarryCard ? toLayerModeFromDisplayCard(signedInForcedLayerCarryCard, selectedMood) : null))) {
      void fetchFragranceDetail(visibleLayerId!);
    }
  }, [isGuestMode, visibleCard, visibleModeEntry, signedInForcedLayerCarryCard, fetchFragranceDetail, fragranceDetailVersion, commitSignedInQueuedHero]);

  // ── SINGLE-SOURCE RENDER for the signed-in main card — bound to v6. ──
  const activeMainCardRender = useMemo(() => {
    if (isGuestMode || !visibleCard) return null;
    // Prefer the v6 raw payload (carries hero_tokens / layer_tokens / per-mode
    // tokens). Fall back to legacy oracle prop for non-v6 paths.
    const v6: any = v6Payload;
    const o: any = activeOracle ?? oracle ?? {};
    const heroId = (v6?.hero?.fragrance_id ?? o?.today_pick?.fragrance_id) ?? null;
    const isHeroCard = !!heroId && visibleCard.fragrance_id === heroId;

    const heroDetail = fragranceDetailCacheRef.current.get(visibleCard.fragrance_id) ?? null;
    const queuedHeroSnapshot = !isHeroCard
      ? (queue.find((card) => card.fragrance_id === visibleCard.fragrance_id) ?? null)
      : null;
    const queuedHeroSettled = !isHeroCard
      ? (signedInQueuedHeroRef.current.get(visibleCard.fragrance_id) ?? null)
      : null;
    const queuedHeroSource = !isHeroCard
      ? (mergeQueuedHeroCardSources(
          queuedHeroSettled,
          visibleCard,
          queuedHeroSnapshot,
        ) ?? visibleCard)
      : visibleCard;
    const resolvedHero = isHeroCard
      ? resolveDisplayCardWithDetails(visibleCard, heroDetail)
      : resolveQueuedHeroDisplayWithDetails(queuedHeroSource, heroDetail);

    // Visible layer — resolved from the v6 mode stack (already in modeResults).
    const forcedLayerMode = signedInForcedLayerCarryCard
      ? toLayerModeFromDisplayCard(signedInForcedLayerCarryCard, selectedMood)
      : null;
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
          ? findFirstUniqueLayerModeCandidate((v6?.layer_modes ?? null)?.[selectedMood] ?? null, selectedMood, resolvedHero)
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
          family_key: layerSurfacesReady ? finalLayer.family_key : '',
          notes: layerSurfacesReady ? finalLayer.notes : [],
          accords: layerSurfacesReady ? finalLayer.accords : [],
        }
      : null;
    const finalAlternates = finalHero.fragrance_id === visibleCard.fragrance_id
      ? signedInVisibleAlternates
      : [];

    const resolvedCurrentCard = {
      fragrance_id: finalHero.fragrance_id,
      name: finalHero.name,
      brand: finalHero.brand,
      family: heroFamilyKey,
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
      layerModes: modeResults,
      alternates: finalAlternates,
      selectedMode: selectedMood,
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
      layerModes: modeResults,
      selectedMode: selectedMood,
      visibleCardId: finalHero.fragrance_id,
      isLocked: lockState === 'locked',
      activeAlternates: finalAlternates,
      reasonChipLabel: reasonChip?.label ?? null,
      reasonChipExplanation: reasonChip?.explanation ?? null,
      queuedSurfacesReady: layerSurfacesReady,
      duplicateResolution,
      resolvedCurrentCard,
    };
  }, [isGuestMode, visibleCard, queue, v6Payload, activeOracle, oracle, selectedMood, signedInLayerIdxByMood, visibleModeEntry, modeResults, lockState, moodCacheVersion, signedInVisibleAlternates, fragranceDetailVersion, signedInQueuedHeroVersion, signedInForcedLayerCarryCard]);

  useEffect(() => {
    if (isGuestMode || !activeMainCardRender || !visibleCard) return;

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
      const currentLayerIndex = signedInLayerIdxByMood[selectedMood] ?? 0;
      if (preferredLayerIndex !== null && preferredLayerIndex !== currentLayerIndex) {
        setSignedInLayerIdxByMood((prev) => ({ ...prev, [selectedMood]: preferredLayerIndex }));
      }
      return;
    }

    if (signedInForcedLayerCarryCard) {
      setSignedInForcedLayerCarryCard(null);
    }

    if (lockState === 'locked') {
      updateSignedInDayState(currentDateKey, (current) => (
        current.lockedLayerCard
          ? { ...current, lockedLayerCard: null }
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
  ]);

  // ── DEBUG PROOF — signed-in v7 contract ──
  useEffect(() => {
    if (isGuestMode) return;
    const contract: any = v6Payload ?? activeOracle ?? oracle ?? {};
    const lm: any = contract?.layer_modes ?? {};
    const heroTokensArr = Array.isArray(activeMainCardRender?.activeHeroTokens) ? activeMainCardRender!.activeHeroTokens : [];
    const layerTokensArr = Array.isArray(activeMainCardRender?.activeLayerTokens) ? activeMainCardRender!.activeLayerTokens : [];
    console.info('ODARA_SIGNED_IN_CONTRACT_PROOF', {
      contractVersion: contract?.card_contract_version ?? contract?.layer_mode_contract ?? null,
      surfaceType: contract?.surface_type ?? null,
      heroName: activeMainCardRender?.activeHero?.name ?? null,
      heroTokenObjects: heroTokensArr,
      heroTokenLabels: heroTokensArr.map((t: any) => t?.label ?? t?.token_label ?? t?.name ?? null),
      activeMode: activeMainCardRender?.selectedMode ?? null,
      activeLayerIndex: signedInLayerIdxByMood[selectedMood] ?? 0,
      layerName: activeMainCardRender?.activeLayer?.name ?? null,
      layerTokenObjects: layerTokensArr,
      layerTokenLabels: layerTokensArr.map((t: any) => t?.label ?? t?.token_label ?? t?.name ?? null),
      balanceNames: Array.isArray(lm?.balance?.layers) ? lm.balance.layers.map((l: any) => l?.name) : null,
      boldNames: Array.isArray(lm?.bold?.layers) ? lm.bold.layers.map((l: any) => l?.name) : null,
      smoothNames: Array.isArray(lm?.smooth?.layers) ? lm.smooth.layers.map((l: any) => l?.name) : null,
      wildNames: Array.isArray(lm?.wild?.layers) ? lm.wild.layers.map((l: any) => l?.name) : null,
    });
  }, [isGuestMode, v6Payload, activeMainCardRender, selectedMood, signedInLayerIdxByMood]);

  // ── DEBUG PROOF — token render ──
  useEffect(() => {
    const heroTokens = isGuestMode
      ? (activeGuestRender?.activeHeroTokens ?? [])
      : (activeMainCardRender?.activeHeroTokens ?? []);
    const layerTokens = isGuestMode
      ? (Array.isArray(activeGuestRender?.activeLayer?.tokens) ? activeGuestRender!.activeLayer!.tokens : [])
      : (activeMainCardRender?.activeLayerTokens ?? []);
    const heroName = isGuestMode
      ? (activeGuestRender?.activeHero?.name ?? null)
      : (activeMainCardRender?.activeHero?.name ?? null);
    const layerName = isGuestMode
      ? (activeGuestRender?.activeLayer?.name ?? null)
      : (activeMainCardRender?.activeLayer?.name ?? null);
    const heroTokensArrR = Array.isArray(heroTokens) ? heroTokens : [];
    const layerTokensArrR = Array.isArray(layerTokens) ? layerTokens : [];
    console.info('ODARA_TOKEN_RENDER_PROOF', {
      surfaceType: isGuestMode ? 'guest' : 'signed_in',
      heroName,
      heroTokenObjects: heroTokensArrR,
      heroTokenLabels: heroTokensArrR.map((t: any) => t?.label ?? t?.token_label ?? t?.name ?? null),
      layerName,
      layerTokenObjects: layerTokensArrR,
      layerTokenLabels: layerTokensArrR.map((t: any) => t?.label ?? t?.token_label ?? t?.name ?? null),
      activeMode: isGuestMode ? activeGuestRender?.selectedMode : activeMainCardRender?.selectedMode,
      activeLayerIndex: isGuestMode
        ? (activeGuestRender?.activeLayerIndex ?? 0)
        : (signedInLayerIdxByMood[selectedMood] ?? 0),
      selectedAlternateName: null,
      rawAccordsTextRendered: false,
      numericTokenRendered: false,
      frontendGeneratedTokensRendered: false,
    });
  }, [isGuestMode, activeMainCardRender, activeGuestRender, selectedMood, signedInLayerIdxByMood]);

  // ── UNIFIED ACTIVE-CARD VIEW MODEL ──
  // Single resolved shape that BOTH signed-in and guest renderers describe.
  // The JSX above already renders the same logical layout for each surface
  // (hero name/brand/family/tokens → layer name/brand/family/tokens → mode row
  // → alternates). This VM is the single source of truth that proves the
  // shared shell and exposes any guest payload incompleteness.
  const activeCardVM = useMemo(() => {
    if (isGuestMode) {
      const o: any = oracle ?? activeOracle ?? {};
      const main: any = o?.main_bundle ?? {};
      const altBundles: any[] = Array.isArray(o?.alternate_bundles) ? o.alternate_bundles : [];
      const inAlt = selectedAlternateIdx !== null && !!altBundles[selectedAlternateIdx];
      const inSkipRestore = guestSkipHistory.length === 0 && selectedAlternateIdx !== null && !!altBundles[selectedAlternateIdx];
      let source: 'guest_main' | 'guest_skip' | 'guest_alternate' | 'guest_back_restore' = 'guest_main';
      if (inAlt) source = guestSkipHistory.length > 0 ? 'guest_skip' : 'guest_alternate';
      const hero = activeGuestRender?.activeHero ?? null;
      const heroTokens = activeGuestRender?.activeHeroTokens ?? [];
      const layer = activeGuestRender?.activeLayer ?? null;
      const layerTokens = Array.isArray(layer?.tokens) ? layer!.tokens : [];
      const layerModesObj: Record<string, any> = main?.layer_modes ?? {};
      const modeKeys = Object.keys(layerModesObj);
      return {
        surfaceType: 'guest' as const,
        source,
        cardId: hero?.fragrance_id ?? hero?.id ?? null,
        isLocked: lockState === 'locked',
        hero: hero ? {
          id: hero.fragrance_id ?? hero.id ?? null,
          name: hero.name ?? null,
          brand: hero.brand ?? null,
          family: hero.family ?? null,
          tokens: heroTokens,
        } : null,
        layer: layer ? {
          id: layer.fragrance_id ?? layer.id ?? null,
          name: layer.name ?? null,
          brand: layer.brand ?? null,
          family: layer.family ?? null,
          tokens: layerTokens,
          visible: true,
        } : null,
        layerModes: {
          balance: !!layerModesObj.balance,
          bold: !!layerModesObj.bold,
          smooth: !!layerModesObj.smooth,
          wild: !!layerModesObj.wild,
        },
        selectedMode: activeGuestRender?.selectedMode ?? null,
        activeLayerIndex: activeGuestRender?.activeLayerIndex ?? 0,
        alternateCount: altBundles.length,
        modeKeys,
      };
    }
    // Signed-in
    const hero = activeMainCardRender?.activeHero ?? null;
    const heroTokens = activeMainCardRender?.activeHeroTokens ?? [];
    const layer = activeMainCardRender?.activeLayer ?? null;
    const layerTokens = activeMainCardRender?.activeLayerTokens ?? [];
    const heroAny: any = hero;
    const layerAny: any = layer;
    return {
      surfaceType: 'signed_in' as const,
      source: 'signed_in' as const,
      cardId: heroAny?.fragrance_id ?? heroAny?.id ?? null,
      isLocked: lockState === 'locked',
      hero: heroAny ? {
        id: heroAny.fragrance_id ?? heroAny.id ?? null,
        name: heroAny.name ?? null,
        brand: heroAny.brand ?? null,
        family: heroAny.family ?? null,
        tokens: heroTokens,
      } : null,
      layer: layerAny ? {
        id: layerAny.fragrance_id ?? layerAny.id ?? null,
        name: layerAny.name ?? null,
        brand: layerAny.brand ?? null,
        family: layerAny.family ?? null,
        tokens: layerTokens,
        visible: true,
      } : null,
      layerModes: {
        balance: !!modeResults.balance,
        bold: !!modeResults.bold,
        smooth: !!modeResults.smooth,
        wild: !!modeResults.wild,
      },
      selectedMode: activeMainCardRender?.selectedMode ?? selectedMood,
      activeLayerIndex: signedInLayerIdxByMood[selectedMood] ?? 0,
      alternateCount: signedInVisibleAlternates.length,
      modeKeys: ['balance', 'bold', 'smooth', 'wild'].filter(k => !!(modeResults as any)[k]),
    };
  }, [isGuestMode, oracle, activeOracle, activeGuestRender, activeMainCardRender, selectedAlternateIdx, guestSkipHistory, lockState, modeResults, selectedMood, signedInLayerIdxByMood, signedInVisibleAlternates.length]);

  useEffect(() => {
    const vm = activeCardVM;
    const heroTokensArr = Array.isArray(vm.hero?.tokens) ? vm.hero!.tokens : [];
    const layerTokensArr = Array.isArray(vm.layer?.tokens) ? vm.layer!.tokens : [];
    console.info('ODARA_ACTIVE_CARD_VM_PROOF', {
      surfaceType: vm.surfaceType,
      source: vm.source,
      heroName: vm.hero?.name ?? null,
      heroTokenCount: heroTokensArr.length,
      layerName: vm.layer?.name ?? null,
      layerTokenCount: layerTokensArr.length,
      hasLayer: !!vm.layer,
      modeKeys: vm.modeKeys,
      hasBalance: vm.layerModes.balance,
      hasBold: vm.layerModes.bold,
      hasSmooth: vm.layerModes.smooth,
      hasWild: vm.layerModes.wild,
      alternateCount: vm.alternateCount,
      renderedThroughSharedShell: true,
    });
    // Guest VM completeness gate — log missing fields when an alternate bundle
    // can't be resolved into a full card (no layer or no modes available).
    if (vm.surfaceType === 'guest' && (vm.source === 'guest_alternate' || vm.source === 'guest_skip')) {
      const missing: string[] = [];
      if (!vm.hero?.name) missing.push('hero.name');
      if (!vm.hero?.brand) missing.push('hero.brand');
      if (!vm.hero?.family) missing.push('hero.family');
      if (!heroTokensArr.length) missing.push('hero.tokens');
      if (!vm.layer?.name) missing.push('layer.name');
      if (!vm.layer?.brand) missing.push('layer.brand');
      if (!vm.layer?.family) missing.push('layer.family');
      if (!layerTokensArr.length) missing.push('layer.tokens');
      if (missing.length > 0) {
        console.warn('fail_guest_vm_incomplete', { source: vm.source, missing });
      }
    }
  }, [activeCardVM]);

  // (Skip gesture lifecycle reset effect lives just below swipeRef declaration.)

  useEffect(() => {
    console.log('[Odara] mode-results debug', {
      cardId,
      selectedMood,
      'modeResults.balance': modeResults.balance ? { id: modeResults.balance.id, name: modeResults.balance.name } : null,
      'modeResults.bold': modeResults.bold ? { id: modeResults.bold.id, name: modeResults.bold.name } : null,
      visibleModeEntry: visibleModeEntry ? { id: visibleModeEntry.id, name: visibleModeEntry.name } : null,
      cacheSize: moodCacheRef.current.size,
    });
  }, [cardId, selectedMood, modeResults.balance, modeResults.bold, visibleModeEntry]);

  // ── v6 mood tap handler ──
  // Different mood  → switch selectedMood; if no idx exists, start at 0.
  // Same mood again → cycle (idx + 1) % layer_modes[mood].layers.length.
  // Mood cycling source is ONLY payload.layer_modes[mood].layers[]. Never alternates.
  // Falls back to legacy lazy fetch (signed-in non-v6 cards: queue / promoted alts).
  const handleMoodSelect = useCallback((mood: LayerMood) => {
    if (lockState === 'locked') return;
    if (!visibleCard) return;
    const currentCardId = visibleCard.fragrance_id;
    const v6: any = (activeOracle as any)?.__v6 ?? (oracle as any)?.__v6 ?? null;
    const heroIdV6 = v6?.hero?.fragrance_id ?? null;
    const isHeroCard = !!heroIdV6 && currentCardId === heroIdV6;
    const stackArr: any[] = isHeroCard && Array.isArray(v6?.layer_modes?.[mood]?.layers)
      ? v6.layer_modes[mood].layers
      : [];

    if (mood !== selectedMood) {
      // DIFFERENT mood: switch and reset to current index for that mood (or 0 if first time).
      setSelectedMood(mood);
      console.log('[Odara][SignedIn][v6] mood switch', { mood, stackLen: stackArr.length, idx: signedInLayerIdxByMood[mood] ?? 0 });
    } else if (stackArr.length > 1) {
      // SAME mood: cycle through this mood's stack only.
      const cur = signedInLayerIdxByMood[mood] ?? 0;
      const next = (cur + 1) % stackArr.length;
      setSignedInLayerIdxByMood(prev => ({ ...prev, [mood]: next }));
      console.log('[Odara][SignedIn][v6] mood cycle', { mood, from: cur, to: next, stackLen: stackArr.length });
      return;
    } else {
      console.log('[Odara][SignedIn][v6] mood re-tap (no cycle, single layer)', { mood });
    }

    // Legacy fallback for non-v6 cards (promoted alternates / queue): lazy fetch.
    if (!isHeroCard || stackArr.length === 0) {
      const moodKey = `${selectedDate}|${selectedContext}|${currentCardId}|${mood}`;
      const cached = moodCacheRef.current.get(moodKey);
      if (cached === undefined) {
        void fetchMoodForCard(currentCardId, mood).then((entry) => {
          console.log('[Odara] mood click result (legacy)', { mood, fetchedForCard: currentCardId, layerName: entry?.layer_name ?? '(null)' });
        });
      }
    }
  }, [lockState, visibleCard, activeOracle, oracle, selectedMood, signedInLayerIdxByMood, fetchMoodForCard, selectedDate, selectedContext]);

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

  const clearLockedSelection = useCallback(() => {
    const key = `${selectedDate}:${selectedContext}`;
    setLockedSelections(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, [selectedDate, selectedContext]);

  // ── Skip = advance through queue cards ──
  const handleSkipLocal = useCallback(async () => {
    if (skipLoading || !visibleCard || lockState === 'locked') return;

    setSkipLoading(true);
    // Play red Tron flash on skip
    setSkipFlash(true);
    window.setTimeout(() => setSkipFlash(false), 700);

    // Fire-and-forget backend skip via canonical RPC
    void odaraSupabase.rpc('skip_oracle_selection_v1' as any, {
      p_user: userId,
      p_fragrance_id: visibleCard.fragrance_id,
      p_context: selectedContext,
      p_skip_date: selectedDate,
    }).then(
      () => console.log('[Odara] skip rpc success (fire-forget)', { userId, fragranceId: visibleCard.fragrance_id, context: selectedContext, skipDate: selectedDate, rpc: 'skip_oracle_selection_v1' }),
      (err: any) => console.error('[Odara] skip rpc fail (fire-forget)', { userId, fragranceId: visibleCard.fragrance_id, context: selectedContext, skipDate: selectedDate, rpc: 'skip_oracle_selection_v1', error: err?.message })
    );

    // Slide the card down
    setSkipAnimating(true);
    await new Promise(r => window.setTimeout(r, 350));
    setSkipAnimating(false);

    try {
      const currentMoodKey = selectedMood ?? 'balance';
      const currentCacheKey = `${selectedDate}|${selectedContext}|${visibleCard.fragrance_id}|${currentMoodKey}`;
      const currentResolvedEntry = moodCacheRef.current.get(currentCacheKey) ?? null;
      console.log('[Odara] history push (skip)', { id: visibleCard.fragrance_id, mood: currentMoodKey, resolved: currentResolvedEntry ? { id: currentResolvedEntry.layer_fragrance_id, name: currentResolvedEntry.layer_name } : null });
      setViewHistory(h => [
        ...h.slice(-(MAX_SESSION_HISTORY - 1)),
        {
          card: visibleCard,
          queuePointerBefore: queuePointer,
          promotedAltId,
          selectedMood,
          resolvedVisibleModeEntry: currentResolvedEntry,
        },
      ]);

      if (queuePointer < queue.length) {
        const nextCard = queue[queuePointer];
        setVisibleCard(nextCard);
        setQueuePointer(queuePointer + 1);
      } else {
        const newQueue = await fetchQueue(visibleCard.fragrance_id);
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
  }, [skipLoading, visibleCard, lockState, queue, queuePointer, fetchQueue, userId, selectedContext, selectedDate, selectedMood, promotedAltId, setLockState]);

  // ── Back button — restore exact history snapshot ──
  const handleBack = useCallback(() => {
    // Guest v5: unwind alternate state, then mode-layer depth, before normal back.
    if (handleGuestBack()) return;
    if (viewHistory.length === 0 || lockState === 'locked') return;
    const entry = viewHistory[viewHistory.length - 1];

    const restoredMood = entry.selectedMood ?? 'balance';
    console.log('[Odara] back restore', {
      restoredId: entry.card.fragrance_id,
      restoredMood,
      restoredPromotedAltId: entry.promotedAltId,
      resolvedEntry: entry.resolvedVisibleModeEntry ? { id: entry.resolvedVisibleModeEntry.layer_fragrance_id, name: entry.resolvedVisibleModeEntry.layer_name } : null,
      historyDepth: viewHistory.length,
    });

    // Seed the mood cache with the saved resolved entry so visibleModeEntry is immediately correct
    if (entry.resolvedVisibleModeEntry) {
      const restoreCacheKey = `${selectedDate}|${selectedContext}|${entry.card.fragrance_id}|${restoredMood}`;
      moodCacheRef.current.set(restoreCacheKey, entry.resolvedVisibleModeEntry);
    }

    setVisibleCard(entry.card);
    setQueuePointer(entry.queuePointerBefore);
    setPromotedAltId(entry.promotedAltId);
    setSelectedMood(restoredMood);
    setViewHistory(h => h.slice(0, -1));
    setLayerExpanded(false);
    setLockState('neutral');
  }, [viewHistory, handleGuestBack]);

  const pulseLock = useCallback(() => {
    setLockPulse(true);
    window.setTimeout(() => setLockPulse(false), 400);
  }, []);

  const unlockGuestCard = useCallback(() => {
    setGuestLocked(false);
    setLockedGuestSnapshot(null);
    clearLockedSelection();
    setGuestUnlockFlash(true);
    window.setTimeout(() => setGuestUnlockFlash(false), 700);
    pulseLock();
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

  useEffect(() => {
    setReasonChipExpanded(false);
  }, [visibleCard?.fragrance_id, selectedDate, selectedContext, isGuestMode, selectedAlternateIdx]);

  /* ──────────────────────────────────────────────────────────────
   * Card interaction contract:
   *   - guest: single tap on the main scent-card shell = lock
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

    if (isGuestMode) {
      const isTouchLikePointer =
        lastCardPointerTypeRef.current === 'touch' ||
        lastCardPointerTypeRef.current === 'pen';
      if (!isTouchLikePointer) return;
      if (guestLocked) return;
      engageGuestLock();
      return;
    }

    // Already locked → no-op (use the lock icon to unlock).
    if (lockState === 'locked') return;

    const now = Date.now();
    const last = lastTapRef.current;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    const within = (now - last.time) <= DOUBLE_TAP_MS &&
      Math.hypot(dx, dy) <= DOUBLE_TAP_DIST;

    if (!within) {
      lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };
      return;
    }

    // Second tap → like + lock together.
    lastTapRef.current = { time: 0, x: 0, y: 0 };
    clearUnlockTimeout();
    setLockState('locked');
    recordLockedSelection();
    haptic('medium');

    // Visual confirmation: like pulse + lock burst.
    setLikeFlash(true);
    window.setTimeout(() => setLikeFlash(false), 600);
    setLockFlash(true);
    window.setTimeout(() => setLockFlash(false), 700);
    pulseLock();

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
    lockState,
    clearUnlockTimeout,
    setLockState,
    recordLockedSelection,
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
   * Swipe-DOWN two-step contract (state-aware):
   *   - lockState === 'locked'  → swipe down UNLOCKS the card
   *   - lockState === 'neutral' → swipe down SKIPS to next card
   * Swipe-UP is intentionally a no-op (lock is double-tap only).
   * Same contract applies to signed-in AND guest/fallback profiles.
   * ────────────────────────────────────────────────────────────── */
  const swipeRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    direction: 'none' | 'vertical' | 'horizontal';
    fired: boolean;
    pointerId: number | null;
  }>({ active: false, startX: 0, startY: 0, direction: 'none', fired: false, pointerId: null });
  const lastCardPointerTypeRef = useRef<string>('');

  // ── SKIP GESTURE LIFECYCLE RESET ──
  // Any pending pointer/gesture state from the prior visible card MUST be
  // cleared the instant a new visible card mounts. Without this, a leaked
  // `fired:true` flag (e.g. from an aborted pointer or rapid card swap) can
  // block subsequent swipes from firing on later cards.
  useEffect(() => {
    swipeRef.current = {
      active: false,
      startX: 0,
      startY: 0,
      direction: 'none',
      fired: false,
      pointerId: null,
    };
    lastCardPointerTypeRef.current = '';
    setDaySwipeOffset(0);
    setDaySwipeDragging(false);
    suppressCardClickRef.current = false;
  }, [visibleCard?.fragrance_id, lockState, queuePointer, viewHistory.length, skipAnimating]);

  // Swipe-down must work when the gesture STARTS on the visible card body,
  // including the layer card area. Only true interactive controls block it.
  const isInteractiveSwipeTarget = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    if (!el || !el.closest) return false;
    return !!(
      el.closest('[data-action-stack]') ||
      el.closest('[data-debug-controls]') ||
      el.closest('[data-mode-chip]') ||
      el.closest('[data-alternate-chip]') ||
      el.closest('[data-no-card-swipe]') ||
      el.closest('button, a, input, textarea, select, [role="button"]')
    );
  };

  const handleCardPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!visibleCard) return;
    if (isInteractiveSwipeTarget(e.target)) return;
    lastCardPointerTypeRef.current = e.pointerType;
    // Capture the pointer so the gesture stays attached to the card shell
    // until pointer up/cancel — prevents the browser/scroll container from
    // stealing vertical motion mid-swipe.
    try {
      if (e.currentTarget.setPointerCapture) {
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    } catch {
      /* setPointerCapture can throw if pointer is already captured elsewhere */
    }
    swipeRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      direction: 'none',
      fired: false,
      pointerId: e.pointerId,
    };
  }, [visibleCard]);

  const handleCardPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = swipeRef.current;
    if (!s.active || s.pointerId !== e.pointerId || s.fired) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (s.direction === 'none') {
      if (Math.abs(dx) < SWIPE_DIRECTION_LOCK && Math.abs(dy) < SWIPE_DIRECTION_LOCK) return;
      s.direction = Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal';
    }
    const surfaceType = isGuestMode ? 'guest' : 'signed_in';
    const dominantAxis = Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal';
    const downwardOk = dy >= SWIPE_DOWN_DISTANCE && Math.abs(dy) >= Math.abs(dx) * SWIPE_HORIZONTAL_TOLERANCE;

    const activeCardNameBefore = visibleCard?.name ?? null;
    const activeCardIdBefore = visibleCard?.fragrance_id ?? null;
    const activeMode = selectedMood;
    const activeLayerIndex = isGuestMode ? guestActiveLayerIdx : (signedInLayerIdxByMood[selectedMood] ?? 0);

    const baseProof = {
      surfaceType,
      isLockedBefore: lockState === 'locked',
      deltaX: dx,
      deltaY: dy,
      velocityX: 0,
      velocityY: 0,
      dominantAxis,
      thresholdPassed: downwardOk,
      activeCardNameBefore,
      activeCardIdBefore,
      activeMode,
      activeLayerIndex,
    };
    if (s.direction === 'horizontal') {
      const hasPrevDay = !!prevForecastDay;
      const hasNextDay = !!nextForecastDay;
      let clampedDx = Math.max(-DAY_SWIPE_MAX_OFFSET, Math.min(DAY_SWIPE_MAX_OFFSET, dx));
      if (dx > 0 && !hasPrevDay) clampedDx = Math.min(dx, DAY_SWIPE_MAX_OFFSET * 0.28);
      if (dx < 0 && !hasNextDay) clampedDx = Math.max(dx, -DAY_SWIPE_MAX_OFFSET * 0.28);
      setDaySwipeDragging(true);
      setDaySwipeOffset(clampedDx);
      if (Math.abs(dx) > 10) suppressCardClickRef.current = true;
      return;
    }
    // vertical
    if (dy < 0) return; // upward — ignored silently
    if (!downwardOk) return; // not far enough yet

    // Threshold reached: fire the state-aware swipe-down action ONCE.
    s.fired = true;
    let actionTaken: string;
    let activeCardNameAfter: string | null = activeCardNameBefore;
    let activeCardIdAfter: string | null = activeCardIdBefore;

    if (isGuestMode && isGuestLocked) {
      actionTaken = 'unlock_guest';
      unlockGuestCard();
    } else if (lockState === 'locked') {
      actionTaken = 'unlock';
      setLockState('neutral');
      clearLockedSelection();
      setUnlockFlash(true);
      window.setTimeout(() => setUnlockFlash(false), 700);
      pulseLock();
    } else if (isGuestMode) {
      // GUEST SKIP — read-only cycle through alternate_bundles. No backend writes.
      const o: any = (oracle ?? activeOracle ?? {});
      const altBundles: any[] = Array.isArray(o?.alternate_bundles) ? o.alternate_bundles : [];
      if (altBundles.length === 0) {
        actionTaken = 'fail_guest_no_skip_source';
      } else {
        actionTaken = 'skip_guest';
        // Premium downward-dismiss animation (same `cardSlideDown` keyframe
        // used by signed-in skip) so the user clearly sees the card advance.
        setSkipFlash(true);
        window.setTimeout(() => setSkipFlash(false), 500);
        setSkipAnimating(true);
        window.setTimeout(() => setSkipAnimating(false), 350);

        // Advance to next bundle (or wrap to 0). null treated as "main" → go to 0.
        const current = selectedAlternateIdx;
        const nextIdx = current === null ? 0 : (current + 1) % altBundles.length;
        const previousCardName =
          current === null
            ? (o?.main_bundle?.hero?.name ?? activeCardNameBefore)
            : (altBundles[current]?.hero?.name ?? activeCardNameBefore);
        const nextHero = altBundles[nextIdx]?.hero ?? null;

        // Push the previously visible guest card onto the multi-step history
        // BEFORE advancing, so back can rewind step-by-step through every skip.
        const lengthBefore = guestSkipHistory.length;
        setGuestSkipHistory((h) => [...h, current]);
        guestRenderSourceRef.current = 'guest_skip_target';
        setSelectedAlternateIdx(nextIdx);
        haptic('selection');
        // Clear alternate-tap snapshot — skip flow owns the stack now.
        guestPrevMainStateRef.current = null;

        activeCardNameAfter = nextHero?.name ?? activeCardNameBefore;
        activeCardIdAfter = nextHero?.fragrance_id ?? nextHero?.id ?? activeCardIdBefore;

        console.info('ODARA_GUEST_SKIP_PROOF', {
          actionTaken,
          previousCardName,
          nextCardName: nextHero?.name ?? null,
          guestHistoryLengthBefore: lengthBefore,
          guestHistoryLengthAfter: lengthBefore + 1,
          selectedAlternateIdxBefore: current,
          selectedAlternateIdxAfter: nextIdx,
        });
      }
    } else {
      actionTaken = 'skip_signed_in';
      setSkipFlash(true);
      window.setTimeout(() => setSkipFlash(false), 500);
      void handleSkipLocal();
    }
    console.info('ODARA_SWIPE_DOWN_PROOF', {
      ...baseProof,
      thresholdPassed: true,
      actionTaken,
      activeCardNameAfter,
      activeCardIdAfter,
    });
  }, [
    lockState,
    setLockState,
    clearLockedSelection,
    pulseLock,
    unlockGuestCard,
    handleSkipLocal,
    isGuestMode,
    visibleCard,
    selectedMood,
    guestActiveLayerIdx,
    signedInLayerIdxByMood,
    oracle,
    activeOracle,
    selectedAlternateIdx,
    setSelectedAlternateIdx,
    guestSkipHistory,
    isGuestLocked,
    activeGuestRender,
    prevForecastDay,
    nextForecastDay,
  ]);

  const handleCardPointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = swipeRef.current;
    if (s.pointerId !== e.pointerId) return;
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
      const targetDate =
        didCancel
          ? null
          : dx <= -DAY_SWIPE_THRESHOLD
          ? (nextForecastDay?.dateStr ?? null)
          : dx >= DAY_SWIPE_THRESHOLD
            ? (prevForecastDay?.dateStr ?? null)
            : null;
      setDaySwipeDragging(false);
      setDaySwipeOffset(0);
      if (targetDate && targetDate !== selectedDate) {
        suppressCardClickRef.current = true;
        haptic('selection');
        onDateChange(targetDate);
      }
      swipeRef.current = { active: false, startX: 0, startY: 0, direction: 'none', fired: false, pointerId: null };
      return;
    }
    swipeRef.current = { active: false, startX: 0, startY: 0, direction: 'none', fired: false, pointerId: null };
  }, [nextForecastDay, onDateChange, prevForecastDay, selectedDate]);

  const handlePromoteAlternate = useCallback((alt: OracleAlternate) => {
    if (lockState === 'locked') return;

    const prevHeroId = visibleCard?.fragrance_id ?? '(none)';
    console.log('[Odara] alternate promotion', {
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
    const currentMoodKey2 = selectedMood ?? 'balance';
    const currentCacheKey2 = `${selectedDate}|${selectedContext}|${visibleCard!.fragrance_id}|${currentMoodKey2}`;
    const currentResolvedEntry2 = moodCacheRef.current.get(currentCacheKey2) ?? null;
    console.log('[Odara] history push (promote)', { id: visibleCard!.fragrance_id, mood: currentMoodKey2, resolved: currentResolvedEntry2 ? { id: currentResolvedEntry2.layer_fragrance_id, name: currentResolvedEntry2.layer_name } : null });
    setViewHistory(h => [
      ...h.slice(-(MAX_SESSION_HISTORY - 1)),
      { card: visibleCard!, queuePointerBefore: queuePointer, promotedAltId, selectedMood, resolvedVisibleModeEntry: currentResolvedEntry2 },
    ]);

    // 2. Clear stale state completely
    setLayerExpanded(false);
    setLockState('neutral');
    setModeLoading({ balance: false, bold: false, smooth: false, wild: false });
    setModeErrors({ balance: null, bold: null, smooth: null, wild: null });

    // 3. Set new card state BEFORE fetch
    setVisibleCard(promoted);
    setPromotedAltId(alt.fragrance_id);
    setSelectedMood('balance');
    setSignedInLayerIdxByMood({ balance: 0, bold: 0, smooth: 0, wild: 0 });

    // 4. Immediately trigger BALANCE layer fetch for the promoted scent
    const capturedAltId = alt.fragrance_id;
    console.log('[Odara] alternate promotion: fetching balance for', capturedAltId);
    void fetchMoodForCard(capturedAltId, 'balance').then((entry) => {
      console.log('[Odara] alternate promotion: balance result', {
        promotedId: capturedAltId,
        balanceLayerName: entry?.layer_name ?? '(null)',
        balanceLayerId: entry?.layer_fragrance_id ?? '(null)',
      });
    });
  }, [lockState, visibleCard, queuePointer, promotedAltId, fetchMoodForCard, selectedDate, selectedContext]);

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
  const signedInResolvedLockActive = !isGuestMode && (
    signedInDayState.lockState === 'locked'
    || signedInResolvedDayDecisionSource === 'locked'
    || activeMainCardRender?.isLocked === true
  );
  const isCardLocked = isGuestMode
    ? guestLockedForCurrentCard
    : signedInResolvedLockActive;

  // (3) Normalized action-rail state.
  const guestStarredForCurrentCard =
    isGuestMode && !!guestStarredByKey[guestStarKey];
  const guestHasRealHistory =
    isGuestMode && (selectedAlternateIdx !== null || guestSkipHistory.length > 0);
  const actionRailState = {
    locked: isCardLocked,
    starred: isGuestMode ? guestStarredForCurrentCard : isFavorited,
    showBack: isGuestMode ? guestHasRealHistory : hasHistory,
  };

  if (isGuestMode) {
    console.info('[ODARA_LOCK_DEBUG] render state', {
      guestLocked,
      guestStarKey,
      starMapValue: guestStarredByKey?.[guestStarKey],
      guestLockedForCurrentCard,
      isCardLocked,
      actionRailLocked: actionRailState?.locked,
      activeHeroName: activeGuestRender?.activeHero?.name,
      selectedAlternateIdx,
      guestSelectedMood,
      selectedDate,
      selectedContext,
    });
  }

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
          // Guest lock is an engage-only latch from the icon. Unlocking is
          // swipe-down only so the guest card stays read-only and predictable.
          if (guestLocked) {
            console.info('[ODARA_LOCK_DEBUG] guest lock click ignored_already_locked', {
              guestLocked,
              isCardLocked,
              selectedAlternateIdx,
              guestSelectedMood,
              activeHeroName: visibleGuestRender?.activeHero?.name,
            });
            return;
          }
          if (!activeGuestRender) {
            console.warn('[ODARA_LOCK_DEBUG] guest lock ignored_no_active_guest_render');
            return;
          }
          engageGuestLock();
          return;
        }
        // Signed-in: only the unlock half is exposed via tap (lock is engaged
        // by gestures). Preserve existing behavior.
        if (lockState === 'locked') {
          setLockState('neutral');
          clearLockedSelection();
          setUnlockFlash(true);
          window.setTimeout(() => setUnlockFlash(false), 700);
          pulseLock();
          haptic('success');
        }
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
        if (!visibleCard) return;
        const combo: FavoriteCombo = {
          mainId: activeMainCardRender?.resolvedCurrentCard?.fragrance_id ?? visibleCard.fragrance_id,
          layerId: activeMainCardRender?.activeLayer?.id ?? null,
          mood: selectedMood ?? 'balance',
          ratio: selectedRatio,
        };
        if (isFavorited) {
          setFavoriteMap(prev => {
            const next = { ...prev };
            delete next[stateKey];
            return next;
          });
        } else {
          setFavoriteMap(prev => ({ ...prev, [stateKey]: combo }));
        }
        haptic(isFavorited ? 'light' : 'success');
      },
      selectMood: (mood: any) => {
        if (isGuestMode) {
          console.info('[ODARA_LOCK_DEBUG] mood click', {
            mood,
            isCardLocked,
            guestLocked,
            guestStarKey,
            guestLockedForCurrentCard,
            actionRailLocked: actionRailState?.locked,
            activeHeroName: activeGuestRender?.activeHero?.name,
            guestSelectedMood,
          });
        }
        if (isCardLocked) return;
        if (isGuestMode) {
          handleGuestModeTap(mood as GuestModeKey);
        } else {
          handleMoodSelect(mood as LayerMood);
        }
      },
      promoteAlternate: (alt: any, idx?: number) => {
        if (isGuestMode) {
          console.info('[ODARA_LOCK_DEBUG] alternate click', {
            altName: alt?.hero?.name ?? alt?.name ?? null,
            isCardLocked,
            guestLocked,
            guestStarKey,
            guestLockedForCurrentCard,
            actionRailLocked: actionRailState?.locked,
            selectedAlternateIdx,
          });
        }
        if (isCardLocked) return;
        if (isGuestMode) {
          if (typeof idx === 'number') handleGuestAlternateTap(idx);
        } else {
          handlePromoteAlternate(alt);
        }
      },
      back: () => {
        // Back never modifies the locked decision — the locked card stays
        // visible. We still allow back to be a no-op while locked.
        if (isCardLocked) return;
        handleBack();
      },
      skipOrSwipe: () => {
        // Locked cards cannot be skipped. Signed-in unlock-via-swipe remains
        // handled by the existing pointer handler (which still inspects
        // lockState directly inside its own internals).
        if (isCardLocked) return;
        // No direct external invocation here — the pointer handler owns it.
      },
    },
  };

  if (isGuestMode) {
    const o: any = oracle ?? {};
    console.log('[Odara][Guest] render summary', {
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
    const layerTokens = (Array.isArray(visibleGuestRender.activeLayer?.tokens) ? visibleGuestRender.activeLayer.tokens : [])
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

    return {
      fragrance_id: hero?.fragrance_id ?? hero?.id ?? null,
      name: hero?.name ?? '',
      brand: hero?.brand ?? '',
      family: heroFamilyKey,
      familyLabel: heroFamilyLabel,
      familyColor: heroFamilyColor,
      notes: heroNotes,
      accords: heroAccords,
      layer,
      layerFamilyKey,
      layerFamilyLabel,
      layerTokens,
      layerModes: guestLayerModesToModeSelector(visibleGuestRender.layerModes),
      alternates: guestAlternates,
      selectedMode: visibleGuestRender.selectedMode,
      resolvedHeroRail: {
        familyLabel: heroFamilyLabel,
        familyColor: heroFamilyColor,
        reasonChip,
        tokens: heroTokens,
      },
    };
  }, [isGuestMode, visibleGuestRender, selectedAlternateIdx]);

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
    const resolvedHeroRailReasonChip = current.isHeroCard
      ? (
          resolveReasonChip(current.reason_chip_label, current.reason_chip_explanation)
          ?? current.reasonChip
          ?? null
        )
      : resolveReasonChip(current.reason_chip_label, current.reason_chip_explanation);
    const resolvedHeroRailTokenSource = Array.isArray(current.heroTokens) && current.heroTokens.length > 0
      ? current.heroTokens
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
  const signedInResolvedSequelState = useMemo(() => {
    if (isGuestMode) {
      return {
        mode: 'off' as SignedInCarryoverTarget,
        origin: null as SignedInDayState['carryoverOrigin'],
        selectedCard: null as DisplayCard | null,
        visualTarget: 'off' as SignedInCarryoverTarget,
      };
    }

    const mode = signedInDayState.carryoverMode;
    const origin = signedInDayState.carryoverOrigin;
    const selectedCard = mode === 'hero'
      ? (
          signedInCurrentHeroCarryCard
          ?? signedInDayState.carryoverHeroCard
          ?? signedInDayState.carryoverSelectedCard
          ?? null
        )
      : mode === 'layer'
        ? (
            signedInCurrentLayerCarryCard
            ?? signedInDayState.carryoverLayerCard
            ?? signedInDayState.carryoverSelectedCard
            ?? null
          )
        : null;

    return {
      mode,
      origin,
      selectedCard,
      visualTarget: mode !== 'off' && selectedCard ? mode : 'off',
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

    return (signedInResolvedCurrentCard?.alternates ?? []).map((alt, index) => ({
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
  const activeReasonChip = visibleResolvedHeroRail?.reasonChip ?? null;
  const heroRailTokens: Array<any> = Array.isArray(visibleResolvedHeroRail?.tokens)
    ? visibleResolvedHeroRail.tokens
    : [];
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
  const signedInHeroCarryActive = !isGuestMode
    && signedInCarryoverVisualTarget === 'hero'
    && !!signedInCurrentHeroCarryCard?.fragrance_id
    && signedInCurrentHeroCarryCard.fragrance_id === signedInCarryoverSelectedCard?.fragrance_id;
  const signedInLayerCarryActive = !isGuestMode
    && signedInCarryoverVisualTarget === 'layer'
    && !!signedInCurrentLayerCarryCard?.fragrance_id
    && signedInCurrentLayerCarryCard.fragrance_id === signedInCarryoverSelectedCard?.fragrance_id;
  const signedInHeroCarryPulsing = signedInCarryoverPulseTarget === 'hero';
  const signedInLayerCarryPulsing = signedInCarryoverPulseTarget === 'layer';
  const signedInHeroCarrySurfaceStyle = !isGuestMode && (signedInHeroCarryActive || signedInHeroCarryPulsing)
    ? {
        background: `${signedInHeroCarryColor}${signedInHeroCarryPulsing ? '14' : '0F'}`,
        boxShadow: signedInHeroCarryPulsing
          ? `inset 0 0 0 1px ${signedInHeroCarryColor}30, 0 16px 36px ${signedInHeroCarryColor}22`
          : `inset 0 0 0 1px ${signedInHeroCarryColor}22, 0 10px 24px ${signedInHeroCarryColor}14`,
      }
    : undefined;
  const signedInLayerCarrySurfaceStyle = !isGuestMode && (signedInLayerCarryActive || signedInLayerCarryPulsing)
    ? {
        background: `${signedInLayerCarryColor}${signedInLayerCarryPulsing ? '14' : '0E'}`,
        boxShadow: signedInLayerCarryPulsing
          ? `inset 0 0 0 1px ${signedInLayerCarryColor}30, 0 18px 40px ${signedInLayerCarryColor}20`
          : `inset 0 0 0 1px ${signedInLayerCarryColor}22, 0 10px 26px ${signedInLayerCarryColor}14`,
      }
    : undefined;
  const signedInCarryoverButtonStyle = signedInCarryoverCloseFlash
    ? {
        color: '#ef4444',
        background: 'rgba(239,68,68,0.14)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 12px 26px rgba(239,68,68,0.20)',
      }
    : signedInCarryoverColor
    ? {
        color: signedInCarryoverColor,
        background: `${signedInCarryoverColor}16`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05), 0 12px 26px ${signedInCarryoverColor}18`,
      }
    : {
        color: 'rgba(255,255,255,0.62)',
        background: 'rgba(255,255,255,0.035)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
      };
  const bottomStarActive = actionRailState.starred;
  const sharedBottomActionButtonStyle = {
    border: '1px solid rgba(255,255,255,0.06)',
    backdropFilter: 'blur(12px)',
  } as const;
  const bottomCarryoverButtonStyle = signedInCarryoverButtonStyle;
  useEffect(() => {
    if (isGuestMode) return;
    if (slotChangedSinceLastCommit) return;
    if (lockState === 'locked') return;
    if (hasStoredSignedInDayState && signedInCarryoverOrigin !== 'inherited') return;

    let inheritedSource: SignedInCarryoverTarget = 'off';
    let inheritedSelectedCard: DisplayCard | null = null;

    if (signedInResolvedDayDecisionSource === 'carryover-main') {
      inheritedSource = 'layer';
      inheritedSelectedCard = signedInCurrentLayerCarryCard;
    } else if (signedInResolvedDayDecisionSource === 'carryover-layer') {
      inheritedSource = 'hero';
      inheritedSelectedCard = signedInCurrentHeroCarryCard;
    } else {
      if (signedInCarryoverOrigin === 'inherited') {
        updateSignedInDayState(currentDateKey, (current) => ({
          ...current,
          carryoverMode: 'off',
          carryoverOrigin: null,
          carryoverNextDayRole: null,
          carryoverSelectedCard: null,
        }));
      }
      return;
    }

    if (!inheritedSelectedCard) return;

    updateSignedInDayState(currentDateKey, (current) => ({
      ...current,
      carryoverMode: inheritedSource,
      carryoverOrigin: 'inherited',
      carryoverNextDayRole: resolveCarryoverNextDayRole(inheritedSource),
      carryoverSelectedCard: inheritedSelectedCard,
      carryoverHeroCard: inheritedSource === 'hero'
        ? (signedInCurrentHeroCarryCard ?? current.carryoverHeroCard)
        : current.carryoverHeroCard,
      carryoverLayerCard: inheritedSource === 'layer'
        ? (signedInCurrentLayerCarryCard ?? current.carryoverLayerCard)
        : current.carryoverLayerCard,
    }));
  }, [
    isGuestMode,
    slotChangedSinceLastCommit,
    lockState,
    hasStoredSignedInDayState,
    signedInCarryoverOrigin,
    signedInResolvedDayDecisionSource,
    currentDateKey,
    signedInCurrentHeroCarryCard,
    signedInCurrentLayerCarryCard,
    updateSignedInDayState,
  ]);
  useEffect(() => {
    if (isGuestMode) return;
    if (slotChangedSinceLastCommit) return;
    updateSignedInDayState(currentDateKey, (current) => {
      let next = current;

      if (lockState === 'locked' && signedInCurrentHeroCarryCard) {
        next = {
          ...next,
          lockedCard: signedInCurrentHeroCarryCard,
          lockedLayerCard: signedInCurrentLayerCarryCard,
          lockedMood: selectedMood,
          lockedPromotedAltId: promotedAltId,
        };
      }

      if (current.carryoverMode === 'hero' && signedInCurrentHeroCarryCard) {
        next = {
          ...next,
          carryoverSelectedCard: signedInCurrentHeroCarryCard,
          carryoverHeroCard: signedInCurrentHeroCarryCard,
        };
      }

      if (current.carryoverMode === 'layer' && signedInCurrentLayerCarryCard) {
        next = {
          ...next,
          carryoverSelectedCard: signedInCurrentLayerCarryCard,
          carryoverLayerCard: signedInCurrentLayerCarryCard,
        };
      }

      return next;
    });
  }, [
    isGuestMode,
    currentDateKey,
    slotChangedSinceLastCommit,
    updateSignedInDayState,
    lockState,
    signedInCurrentHeroCarryCard,
    signedInCurrentLayerCarryCard,
    selectedMood,
    promotedAltId,
  ]);
  const handleSignedInCarryoverToggle = useCallback(() => {
    if (isGuestMode) return;
    const hasLayer = !!signedInCurrentLayerCarryCard;
    const nextTarget: SignedInCarryoverTarget = signedInResolvedSequelState.mode === 'off'
      ? 'hero'
      : signedInResolvedSequelState.origin === 'inherited'
        ? 'off'
        : signedInResolvedSequelState.mode === 'hero'
          ? (hasLayer ? 'layer' : 'off')
          : 'off';
    const nextSelectedCard = nextTarget === 'hero'
      ? signedInCurrentHeroCarryCard
      : nextTarget === 'layer'
        ? signedInCurrentLayerCarryCard
        : null;
    const nextDayRole = resolveCarryoverNextDayRole(nextTarget);
    const turningOff = signedInResolvedSequelState.mode !== 'off' && nextTarget === 'off';
    updateSignedInDayState(currentDateKey, (current) => ({
      ...current,
      carryoverMode: nextTarget,
      carryoverOrigin: nextTarget === 'off' ? null : 'manual',
      carryoverNextDayRole: nextDayRole,
      carryoverSelectedCard: nextSelectedCard,
      carryoverHeroCard: nextTarget === 'hero'
        ? (signedInCurrentHeroCarryCard ?? current.carryoverHeroCard)
        : current.carryoverHeroCard,
      carryoverLayerCard: nextTarget === 'layer'
        ? (signedInCurrentLayerCarryCard ?? current.carryoverLayerCard)
        : current.carryoverLayerCard,
    }));
    if (turningOff) {
      triggerSignedInCarryoverPulse(null);
      triggerSignedInCarryoverCloseFlash();
    } else {
      triggerSignedInCarryoverPulse(nextTarget === 'off' ? null : nextTarget);
    }
    haptic('selection');
  }, [
    isGuestMode,
    signedInCurrentHeroCarryCard,
    signedInCurrentLayerCarryCard,
    signedInResolvedSequelState,
    currentDateKey,
    triggerSignedInCarryoverPulse,
    triggerSignedInCarryoverCloseFlash,
    updateSignedInDayState,
  ]);
  const searchHasQuery = searchQuery.trim().length > 0;

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "'Geist Sans', system-ui, sans-serif" }}>
      <Sheet
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (open) setSearchOpen(false);
        }}
      >
        <SheetContent
          side="left"
          className="w-[86vw] border-white/10 bg-[#11100e] px-5 pt-12 pb-5 text-foreground sm:max-w-[360px]"
        >
          <SheetHeader className="space-y-1 text-left">
            <SheetTitle className="text-[12px] font-medium uppercase tracking-[0.24em] text-foreground/86">
              Odara
            </SheetTitle>
            <SheetDescription className="text-[12px] text-foreground/48">
              Quiet tools for the scent world.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 flex flex-col gap-1">
            {ODARA_MENU_ITEMS.map((item) => {
              const disabledForGuest = isGuestMode && item.guestRestricted;
              return (
                <button
                  key={item.label}
                  type="button"
                  disabled={disabledForGuest}
                  onClick={() => setMenuOpen(false)}
                  className={`flex items-center justify-between rounded-[16px] px-3.5 py-3 text-left text-[14px] transition-colors ${
                    disabledForGuest
                      ? 'cursor-not-allowed text-foreground/30'
                      : 'text-foreground/82 hover:bg-white/[0.04]'
                  }`}
                >
                  <span>{item.label}</span>
                  {disabledForGuest && (
                    <span className="text-[10px] uppercase tracking-[0.14em] text-foreground/28">
                      Sign-in required
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-6 border-t border-white/8 pt-4">
            <button
              type="button"
              onClick={onSignOut}
              className="flex w-full items-center justify-between rounded-[16px] px-3.5 py-3 text-left text-[14px] text-foreground/82 transition-colors hover:bg-white/[0.04]"
            >
              <span>Sign out</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={searchOpen}
        onOpenChange={(open) => {
          setSearchOpen(open);
          if (open) setMenuOpen(false);
          if (!open) setSearchQuery('');
        }}
      >
        <SheetContent
          side="right"
          className="w-full border-white/10 bg-[#11100e] px-5 pt-12 pb-5 text-foreground sm:max-w-md"
        >
          <SheetHeader className="space-y-1 text-left">
            <SheetTitle className="text-[12px] font-medium uppercase tracking-[0.24em] text-foreground/86">
              Search
            </SheetTitle>
            <SheetDescription className="text-[12px] text-foreground/48">
              Search across fragrances, notes, accords, brands, and families.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-5">
            <Input
              autoFocus
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search fragrances, notes, accords, brands…"
              className="h-11 rounded-[16px] border-white/10 bg-white/[0.03] px-4 text-[14px] text-foreground placeholder:text-foreground/34 focus-visible:ring-white/15"
            />
          </div>

          <div
            className="mt-4 rounded-[20px] border border-white/8 bg-white/[0.02] px-4 py-5"
            style={{ minHeight: '220px' }}
          >
            {/* TODO: wire the search sheet to a real Odara search contract when a backend search RPC/query exists. */}
            {!searchHasQuery ? (
              <p className="text-[14px] text-foreground/62">
                Search your scent world.
              </p>
            ) : (
              <p className="text-[14px] text-foreground/52">
                Nothing found yet. Try a fragrance, brand, note, accord, or family.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <div className="max-w-md mx-auto px-4 pt-3 pb-6 flex flex-col gap-0">
        <div className="relative mb-3 flex items-center justify-between">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => {
              setSearchOpen(false);
              setMenuOpen(true);
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-foreground/80 transition-colors hover:bg-white/[0.06]"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M4 7h16" />
              <path d="M4 12h16" />
              <path d="M4 17h16" />
            </svg>
          </button>

          <div
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-center text-[13px] font-semibold uppercase tracking-[0.42em] text-foreground/90"
            style={{ fontFamily: "'Geist Sans', system-ui, sans-serif" }}
          >
            ODARA
          </div>

          <button
            type="button"
            aria-label="Open search"
            onClick={() => {
              setMenuOpen(false);
              setSearchOpen(true);
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-foreground/80 transition-colors hover:bg-white/[0.06]"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4 4" />
            </svg>
          </button>
        </div>

        {/* Context chips — centered under the top bar */}
        <div className="flex gap-1.5 mb-3 justify-center">
          {CONTEXTS.map(ctx => (
            <button
              key={ctx}
              onClick={() => onContextChange(ctx)}
              className={`text-[11px] uppercase tracking-[0.1em] px-3.5 py-1.5 rounded-full transition-all duration-200 ${
                selectedContext === ctx
                  ? 'bg-foreground/10 text-foreground border border-foreground/20'
                  : 'text-muted-foreground/50 hover:text-foreground/70 border border-transparent'
              }`}
            >
              {ctx}
            </button>
          ))}
        </div>

        {/* Loading / Error */}
        {oracleLoading && (
          <div className="flex flex-col gap-3 items-center py-16">
            <div className="w-8 h-8 border-2 border-foreground/20 border-t-foreground/60 rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Reading your collection…</span>
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

        {/* ── Unified main card with gestures ── */}
        {!oracleLoading && !oracleError && visibleCard && (
          <div className="relative mt-1 pb-8 overflow-visible" style={{ perspective: '1600px' }}>
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
                className={`rounded-[24px] px-[22px] pt-[14px] pb-[18px] flex flex-col relative z-10 overflow-hidden transition-transform duration-150 ${skipAnimating ? '' : ''}`}
                style={{
                  background: `linear-gradient(165deg, ${tint.bg} 0%, rgba(15,12,8,0.97) 70%)`,
                  border: `1px solid ${tint.border}`,
                  boxShadow: `0 24px 60px rgba(0,0,0,0.6), inset 0 1px 1px rgba(255,255,255,0.06)`,
                  touchAction: 'none',
                  ...(skipAnimating ? { animation: 'cardSlideDown 0.35s ease-in forwards' } : {}),
                }}
                onClickCapture={handleCardClickCapture}
                onClick={handleCardClick}
                onPointerDown={handleCardPointerDown}
                onPointerMove={handleCardPointerMove}
                onPointerUp={handleCardPointerEnd}
                onPointerCancel={handleCardPointerEnd}
              >
            {/* Glow orb */}
            <div
              className="absolute -top-16 -right-16 w-52 h-52 rounded-full blur-3xl pointer-events-none"
              style={{ background: tint.glow, opacity: 0.35 }}
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
            {/* Top row: temp left · centered date · action stack right */}
            <div className="flex items-start justify-between mb-1.5 relative z-10">
              {/* Left: temperature */}
              <div className="flex flex-col items-start pt-1 min-w-[52px]">
                 <span className="text-[11px] tracking-[0.06em] font-medium text-foreground/70" style={{ fontFamily: "'Geist Mono', monospace" }}>
                  {resolvedTemperature}°
                 </span>
              </div>

              {/* Center: date */}
              <span className="text-[11px] tracking-[0.06em] font-medium text-foreground/70 pt-1" style={{ fontFamily: "'Geist Mono', monospace" }}>
                {getDateLabel(selectedDate)}
              </span>

              {/* Right: SHARED action stack (lock → back).
                  Single rail used by BOTH signed-in and guest modes.
                  - Lock: interactive when signed-in; visually disabled no-op for guest.
                  - Back: rendered only when there is promotion/history (signed-in OR guest). */}
              {(() => {
                // Action rail consumes the normalized cardController state —
                // single source of truth for both signed-in and guest.
                const showBack = actionRailState.showBack;
                const lockActive = actionRailState.locked;
                const lockColor = lockActive ? '#22c55e' : 'currentColor';

                return (
                <div className="flex flex-col items-center gap-1.5 min-w-[52px]" data-action-stack>
                {/* Lock button — interactive for both signed-in and guest.
                    Guest writes only to local guestLocked boolean (no Supabase). */}
                <button
                  type="button"
                  aria-label="Lock"
                  onClick={() => cardController.actions.toggleLock()}
                  className="relative flex items-center justify-center w-11 h-11 -m-[15px] touch-manipulation"
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke={lockColor} strokeWidth="1.5"
                    className="transition-colors duration-300 relative z-[1]"
                    style={lockPulse ? { filter: `drop-shadow(0 0 6px ${lockColor})` } : undefined}
                  >
                    {lockActive ? (
                      <>
                        <rect x="3" y="11" width="18" height="11" rx="2" />
                        <path d="M7 11V7a5 5 0 0110 0v4" />
                      </>
                    ) : (
                      <>
                        <rect x="3" y="11" width="18" height="11" rx="2" />
                        <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                      </>
                    )}
                  </svg>

                  {/* GREEN Tron lock-engagement animation (signed-in OR guest local) */}
                  {(lockFlash || guestLockFlash) && (
                    <span className="absolute inset-[-6px] pointer-events-none z-[2]" style={{ overflow: 'visible' }}>
                      <span className="absolute top-1/2 left-[-4px] h-[2px] rounded-full"
                        style={{
                          width: '130%',
                          background: 'linear-gradient(90deg, transparent 0%, #22c55e 30%, #4ade80 50%, #22c55e 70%, transparent 100%)',
                          boxShadow: '0 0 6px #22c55e, 0 0 12px #22c55e88',
                          animation: 'tronTraceH 0.5s ease-out forwards',
                        }}
                      />
                      <span className="absolute left-1/2 top-[-4px] w-[2px] rounded-full"
                        style={{
                          height: '130%',
                          background: 'linear-gradient(180deg, transparent 0%, #22c55e 30%, #4ade80 50%, #22c55e 70%, transparent 100%)',
                          boxShadow: '0 0 6px #22c55e, 0 0 12px #22c55e88',
                          animation: 'tronTraceV 0.5s ease-out forwards',
                          animationDelay: '0.08s',
                        }}
                      />
                      <span className="absolute inset-0 rounded-full"
                        style={{
                          background: 'radial-gradient(circle, rgba(34,197,94,0.4) 0%, transparent 70%)',
                          animation: 'tronBurst 0.6s ease-out forwards',
                        }}
                      />
                    </span>
                  )}

                  {/* YELLOW Tron unlock animation (signed-in OR guest local) */}
                  {(unlockFlash || guestUnlockFlash) && (
                    <span className="absolute inset-[-6px] pointer-events-none z-[2]" style={{ overflow: 'visible' }}>
                      <span className="absolute top-1/2 left-[-4px] h-[2px] rounded-full"
                        style={{
                          width: '130%',
                          background: 'linear-gradient(90deg, transparent 0%, #eab308 30%, #facc15 50%, #eab308 70%, transparent 100%)',
                          boxShadow: '0 0 6px #eab308, 0 0 12px #eab30888',
                          animation: 'tronTraceH 0.5s ease-out forwards',
                        }}
                      />
                      <span className="absolute left-1/2 top-[-4px] w-[2px] rounded-full"
                        style={{
                          height: '130%',
                          background: 'linear-gradient(180deg, transparent 0%, #eab308 30%, #facc15 50%, #eab308 70%, transparent 100%)',
                          boxShadow: '0 0 6px #eab308, 0 0 12px #eab30888',
                          animation: 'tronTraceV 0.5s ease-out forwards',
                          animationDelay: '0.08s',
                        }}
                      />
                      <span className="absolute inset-0 rounded-full"
                        style={{
                          background: 'radial-gradient(circle, rgba(234,179,8,0.4) 0%, transparent 70%)',
                          animation: 'tronBurst 0.6s ease-out forwards',
                        }}
                      />
                    </span>
                  )}

                  {/* RED Tron skip animation (signed-in only) */}
                  {!isGuestMode && skipFlash && (
                    <span className="absolute inset-[-6px] pointer-events-none z-[2]" style={{ overflow: 'visible' }}>
                      <span className="absolute top-1/2 left-[-4px] h-[2px] rounded-full"
                        style={{
                          width: '130%',
                          background: 'linear-gradient(90deg, transparent 0%, #ef4444 30%, #ff6b6b 50%, #ef4444 70%, transparent 100%)',
                          boxShadow: '0 0 6px #ef4444, 0 0 12px #ef444488',
                          animation: 'tronTraceH 0.5s ease-out forwards',
                        }}
                      />
                      <span className="absolute left-1/2 top-[-4px] w-[2px] rounded-full"
                        style={{
                          height: '130%',
                          background: 'linear-gradient(180deg, transparent 0%, #ef4444 30%, #ff6b6b 50%, #ef4444 70%, transparent 100%)',
                          boxShadow: '0 0 6px #ef4444, 0 0 12px #ef444488',
                          animation: 'tronTraceV 0.5s ease-out forwards',
                          animationDelay: '0.08s',
                        }}
                      />
                      <span className="absolute inset-0 rounded-full"
                        style={{
                          background: 'radial-gradient(circle, rgba(239,68,68,0.4) 0%, transparent 70%)',
                          animation: 'tronBurst 0.6s ease-out forwards',
                        }}
                      />
                    </span>
                  )}
                </button>
                {/* Back arrow — history-gated for both signed-in and guest */}
                {showBack && (
                  <button onClick={() => cardController.actions.back()} className="p-0.5" aria-label="Back">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground/50">
                      <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                </div>
                );
              })()}
            </div>

            <div
              className={isGuestMode
                ? "relative flex w-full flex-col items-center"
                : "relative flex w-full flex-col items-center rounded-[20px] px-3 pt-1 pb-1 transition-all duration-300"}
              style={signedInHeroCarrySurfaceStyle}
            >
              {/* Source badge for queue cards */}
              {!isHeroStyle && (
                <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground/40 text-center mb-0.5">
                  from queue
                </span>
              )}

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
                    className="text-center mt-1 mb-1 text-[12px] uppercase tracking-[0.22em] font-medium"
                    style={color ? { color } : undefined}
                    data-recipe-header
                  >
                    {rh.text}
                  </div>
                );
              })()}

              {/* Fragrance name */}
              <h2
                className="text-[32px] leading-[1.1] font-normal text-foreground mt-0.5 mb-0.5 text-center"
                style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
                data-guest-profile-reserved
              >
                {getDisplayName(visibleResolvedCurrentCard?.name ?? '', visibleResolvedCurrentCard?.brand ?? null)}
              </h2>

              {/* Brand */}
              <span className="text-[13px] text-muted-foreground/60 text-center mb-1.5">
                {visibleResolvedCurrentCard?.brand ?? ''}
              </span>

              {/* Family label */}
              {visibleHeroFamilyLabel ? (
                <span
                  className="text-[12px] uppercase tracking-[0.15em] font-medium text-center mb-1.5"
                  style={{ color: visibleHeroFamilyColor }}
                >
                  {visibleHeroFamilyLabel}
                </span>
              ) : null}

              {(activeReasonChip || heroRailTokens.length > 0) && (
                <div className="mt-0.5 mb-3 w-full">
                  <div
                    className="flex flex-nowrap items-center gap-1.5 px-3 overflow-x-auto justify-start w-full"
                    style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
                  >
                    {activeReasonChip && (
                      <button
                        type="button"
                        data-no-card-swipe
                        aria-expanded={reasonChipExpanded}
                        onClick={(e) => {
                          e.stopPropagation();
                          setReasonChipExpanded((expanded) => !expanded);
                        }}
                        className="flex-shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] uppercase tracking-[0.12em] text-foreground/88 transition-colors duration-200"
                        style={{
                          background: 'rgba(9,9,11,0.82)',
                          border: '1px solid rgba(255,255,255,0.10)',
                          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
                        }}
                      >
                        {activeReasonChip.label}
                      </button>
                    )}

                    {heroRailTokens.map((t, i) => {
                      const tokenLabel = t?.token_label ?? t?.label ?? t?.name ?? null;
                      if (!tokenLabel) return null;
                      const tokenColor = t?.color_hex || '#888';
                      const isSharedToken = !!t?.is_shared;
                      return (
                        <span
                          key={`hero-tok-${t?.token_key ?? 'tok'}-${i}`}
                          className="flex-shrink-0 whitespace-nowrap text-[10px] uppercase tracking-[0.12em] px-2.5 py-1 rounded-full"
                          style={{
                            color: tokenColor,
                            border: `1px solid ${tokenColor}${isSharedToken ? '88' : '55'}`,
                            background: `${tokenColor}${isSharedToken ? '18' : '10'}`,
                            boxShadow: isSharedToken ? `inset 0 0 0 1px ${tokenColor}22` : undefined,
                          }}
                        >
                          {tokenLabel}
                        </span>
                      );
                    })}
                  </div>

                  {activeReasonChip && reasonChipExpanded && activeReasonChip.explanation && (
                    <div className="px-3 pt-2">
                      <p className="text-[12px] leading-[1.5] text-foreground/72">
                        {activeReasonChip.explanation}
                      </p>
                    </div>
                  )}
                </div>
              )}
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
                  mainFamily={visibleResolvedCurrentCard?.family ?? null}
                  mainProjection={isGuestMode
                    ? (typeof visibleGuestRender?.activeHero?.projection === 'number' ? visibleGuestRender.activeHero.projection : null)
                    : null}
                  layerModes={visibleResolvedLayerModes}
                  visibleLayerMode={visibleResolvedLayer}
                  selectedMood={(visibleResolvedCurrentCard?.selectedMode ?? selectedMood) as LayerMood}
                  onSelectMood={(mood) => cardController.actions.selectMood(mood)}
                  selectedRatio={selectedRatio}
                  onSelectRatio={setSelectedRatio}
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
                  onRetryMood={!isGuestMode ? ((mood) => {
                    const currentCardId = signedInResolvedCurrentCard?.fragrance_id;
                    if (!currentCardId) return;
                    void fetchMoodForCard(currentCardId, mood, true);
                  }) : undefined}
                  layerTokens={visibleResolvedCurrentCard?.layerTokens ?? null}
                  showLegacyAccordsText={false}
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
                  <div className="flex gap-2 overflow-x-auto w-full pb-1 px-1" style={{ scrollbarWidth: 'none' }}>
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
              )}

              <div
                className="flex min-h-10 w-full items-center justify-center gap-5"
                data-shared-bottom-action-row
                role="group"
                aria-label="Card actions"
              >
              <button
                type="button"
                aria-label="Favorite"
                aria-pressed={bottomStarActive}
                onClick={() => cardController.actions.toggleStar()}
                className="flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300 active:scale-95"
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
              </button>

              <button
                type="button"
                aria-label="Carry to next day"
                aria-pressed={!isGuestMode && signedInCarryoverVisualTarget !== 'off'}
                aria-disabled={isGuestMode || undefined}
                onClick={isGuestMode ? undefined : handleSignedInCarryoverToggle}
                className={`flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300 ${isGuestMode ? '' : 'active:scale-95'}`}
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
              </button>
            </div>
            </div>


              </div>
            </div>
          </div>
        )}
        {/* ── Weekly navigator + lane tracker ── */}
        <div
          className="rounded-[16px] px-4 py-3 mt-2.5"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div className="flex w-full justify-between">
            {forecastDays.map((fd, i) => {
              const LANE_CONTEXTS = ['daily', 'work', 'hangout', 'date'] as const;
              const dayLanes = LANE_CONTEXTS.map(ctx => {
                const key = `${fd.dateStr}:${ctx}`;
                return lockedSelections[key] ?? null;
              });
              const hasAnyLane = dayLanes.some(Boolean);

              return (
                <button
                  key={i}
                  onClick={() => onDateChange(fd.dateStr)}
                  className="flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-lg transition-all duration-200"
                  style={fd.isSelected ? {
                    background: 'rgba(255,255,255,0.08)',
                  } : undefined}
                >
                  <span className={`text-[10px] tracking-[0.04em] transition-colors ${
                    fd.isSelected ? 'text-foreground font-semibold' : fd.isToday ? 'text-foreground/60' : 'text-muted-foreground/40'
                  }`}>
                    {fd.label}
                  </span>
                  <span className={`text-[14px] font-medium transition-colors ${
                    fd.isSelected ? 'text-foreground' : fd.isToday ? 'text-foreground/60' : 'text-muted-foreground/30'
                  }`}>
                    {fd.day}
                  </span>

                  {/* 4 fixed occasion lane slots — always render all 4 positions */}
                  <div className="flex flex-col gap-[3px] mt-1 w-full items-center" style={{ minHeight: hasAnyLane ? 'auto' : '0px' }}>
                    {dayLanes.map((lane, li) => {
                      if (!lane) {
                        // Empty lane: invisible but preserves positional space only when siblings exist
                        return hasAnyLane ? (
                          <div key={li} style={{ width: '18px', height: '3px' }} />
                        ) : null;
                      }
                      return (
                        <div
                          key={li}
                          className="rounded-full"
                          style={{
                            width: '18px',
                            height: '3px',
                            background: lane.mainColor,
                            boxShadow: lane.layerColor
                              ? `0 0 4px ${lane.layerColor}, 0 0 8px ${lane.layerColor}44`
                              : `0 0 3px ${lane.mainColor}66`,
                          }}
                        />
                      );
                    })}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        {/* Sign out */}
        <button
          onClick={onSignOut}
          className="text-[10px] text-muted-foreground/30 mt-3 self-center hover:text-muted-foreground/60 transition-colors"
        >
          Sign out
        </button>

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
