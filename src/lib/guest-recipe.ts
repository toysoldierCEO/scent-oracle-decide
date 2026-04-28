/**
 * Guest Recipe Mode — single source of truth.
 *
 * Calls exactly ONE backend RPC:
 *   public.get_guest_recipe_occasion_queue_v2(p_context text, p_limit integer)
 *
 * Adapts the recipe payload shape (payload.contexts[ctx].options[]) into the
 * existing guest oracle bundle shape so the OdaraScreen guest render path
 * (resolveGuestCardVM → activeGuestRender) keeps working unchanged.
 *
 * NO hardcoded recipe data. NO direct table queries. NO fallback demo cards.
 * Engine decides. UI renders.
 */
import { odaraSupabase } from '@/lib/odara-client';

export interface RecipeHeader {
  text: string;
  color_hex: string;
  style_world: string | null;
}

interface RawRecipeToken {
  token_key?: string;
  token_label?: string;
  color_hex?: string;
  phase_hint?: string;
}

interface RawRecipeAlternate {
  name?: string;
  brand?: string;
  family_label?: string;
  why_it_works?: string;
  bind_status?: string;
}

interface RawRecipeLayerMode {
  layer_name?: string;
  layer_brand?: string;
  family_label?: string;
  why_it_works?: string;
  bind_status?: string;
}

interface RawRecipeFragranceCard {
  hero?: {
    name?: string;
    brand?: string;
    family_label?: string;
    reason?: string;
    tokens?: RawRecipeToken[];
    bind_status?: string;
  } | null;
  layer_modes?: {
    balance?: RawRecipeLayerMode | null;
    bold?: RawRecipeLayerMode | null;
    smooth?: RawRecipeLayerMode | null;
    wild?: RawRecipeLayerMode | null;
  } | null;
  alternates?: RawRecipeAlternate[] | null;
}

interface RawRecipeOption {
  recipe_id: number | string;
  recipe_key: string;
  slot_label: string;
  option_rank: number;
  recipe_name: string;
  recipe_header: RecipeHeader;
  display_reason?: string | null;
  fragrance_card: RawRecipeFragranceCard | null;
  card_resolution_status?: string | null;
}

/** Adapt a single recipe layer_modes entry → flat layer object expected by
 *  guestLayerToModeEntry (name/brand/family/why_it_works), and also nest it
 *  inside `.layers[]` so resolveGuestCardVM's modeLayerStack[0] picks it up. */
function adaptRecipeLayerMode(raw: RawRecipeLayerMode | null | undefined) {
  if (!raw || !raw.layer_name) return null;
  const flat = {
    name: raw.layer_name,
    brand: raw.layer_brand ?? '',
    family: raw.family_label ?? '',
    family_key: raw.family_label ?? '',
    why_it_works: raw.why_it_works ?? '',
    reason: raw.why_it_works ?? '',
    tokens: [] as any[],
    bind_status: raw.bind_status ?? null,
    fragrance_id: null as string | null,
  };
  return {
    ...flat,
    layers: [flat],
  };
}

/** Adapt a single fragrance_card.alternate → guest alternate_bundle shape
 *  (must have hero.name/brand at minimum so the alternates row + tap flow
 *  works). The alternate's own layer_modes are not provided by the recipe
 *  RPC, so we mirror its row as a single balance layer fallback so the
 *  layer card still renders something sensible if an alternate is tapped. */
function adaptRecipeAlternateToBundle(
  alt: RawRecipeAlternate,
  recipeHeader: RecipeHeader,
) {
  const heroLike = {
    name: alt.name ?? '',
    brand: alt.brand ?? '',
    family: alt.family_label ?? '',
    family_label: alt.family_label ?? '',
    reason: alt.why_it_works ?? '',
    tokens: [] as any[],
    bind_status: alt.bind_status ?? null,
    recipe_header: recipeHeader,
  };
  const balanceLayer = {
    name: alt.name ?? '',
    brand: alt.brand ?? '',
    family: alt.family_label ?? '',
    family_key: alt.family_label ?? '',
    why_it_works: alt.why_it_works ?? '',
    reason: alt.why_it_works ?? '',
    tokens: [],
    bind_status: alt.bind_status ?? null,
    fragrance_id: null,
  };
  const layerModes = {
    balance: { ...balanceLayer, layers: [balanceLayer] },
    bold: null,
    smooth: null,
    wild: null,
  };
  return {
    hero: heroLike,
    hero_tokens: [],
    layer: balanceLayer,
    layer_tokens: [],
    layer_modes: layerModes,
    layer_mode_order: ['balance', 'bold', 'smooth', 'wild'],
    ui_default_mode: 'balance',
    alternates: [],
    recipe_header: recipeHeader,
  };
}

/** Adapt one recipe option → guest bundle (main_bundle shape). */
function adaptRecipeOptionToBundle(option: RawRecipeOption) {
  const card = option.fragrance_card;
  const header = option.recipe_header;

  // Unresolved option: render header only, no fragrance.
  if (!card?.hero) {
    return {
      hero: null,
      hero_tokens: [],
      layer: null,
      layer_tokens: [],
      layer_modes: { balance: null, bold: null, smooth: null, wild: null },
      layer_mode_order: ['balance', 'bold', 'smooth', 'wild'],
      ui_default_mode: 'balance',
      alternates: [],
      recipe_header: header,
      recipe_unresolved: true,
    };
  }

  const hero = {
    name: card.hero.name ?? '',
    brand: card.hero.brand ?? '',
    // resolveGuestCardVM/family rendering reads `family` (not family_label).
    family: card.hero.family_label ?? '',
    family_label: card.hero.family_label ?? '',
    reason: card.hero.reason ?? '',
    tokens: Array.isArray(card.hero.tokens) ? card.hero.tokens : [],
    bind_status: card.hero.bind_status ?? null,
    // Attach the recipe header to the hero so it follows alternate selection
    // (since selectedAlternateIdx swaps `bundle = main_bundle | altBundles[i]`).
    recipe_header: header,
  };

  const balance = adaptRecipeLayerMode(card.layer_modes?.balance);
  const bold = adaptRecipeLayerMode(card.layer_modes?.bold);
  const smooth = adaptRecipeLayerMode(card.layer_modes?.smooth);
  const wild = adaptRecipeLayerMode(card.layer_modes?.wild);

  // Pick a non-null layer for top-level fallback.
  const topLayer = balance ?? bold ?? smooth ?? wild ?? null;

  // The option-level `alternates[]` are inline (name/brand/family/why), not
  // alternate fragrance bundles to swap into. They render as alternate pills
  // beside the hero card. We adapt each into a slim bundle so the existing
  // alt-tap flow shows them as standalone secondary heroes.
  const inlineAlternates = Array.isArray(card.alternates) ? card.alternates : [];
  const altBundlesFromInline = inlineAlternates.map((a) =>
    adaptRecipeAlternateToBundle(a, header),
  );

  return {
    hero,
    hero_tokens: hero.tokens,
    layer: topLayer
      ? { name: topLayer.name, brand: topLayer.brand, family: topLayer.family, why_it_works: topLayer.why_it_works, tokens: [] }
      : null,
    layer_tokens: [],
    layer_modes: { balance, bold, smooth, wild },
    layer_mode_order: ['balance', 'bold', 'smooth', 'wild'],
    ui_default_mode: 'balance',
    alternates: altBundlesFromInline,
    recipe_header: header,
  };
}

export interface GuestRecipePayload {
  /** Mirrors the guest oracle shape so OdaraScreen's guest render path consumes it as-is. */
  main_bundle: any;
  alternate_bundles: any[];
  /** Marker — used by OdaraScreen to know the active source is recipe mode. */
  guest_mode_contract: 'guest_recipe_v2';
  /** Original RPC payload preserved for diagnostics. */
  __recipeRaw: any;
  /** Mirror of the v5 hero so existing today_pick consumers still see a name. */
  today_pick: {
    fragrance_id: string;
    name: string;
    brand: string;
    family: string;
    reason: string;
    notes: string[];
    accords: string[];
  } | null;
}

export async function fetchGuestRecipeQueue(
  context: string,
): Promise<GuestRecipePayload | null> {
  const args = { p_context: context, p_limit: 4 };
  console.log('[Odara][GuestRecipe] rpc start', { rpc: 'get_guest_recipe_occasion_queue_v2', args });
  const { data, error } = await odaraSupabase.rpc(
    'get_guest_recipe_occasion_queue_v2' as any,
    args,
  );
  if (error) {
    console.error('[Odara][GuestRecipe] rpc fail', { error });
    throw error;
  }
  const ctxBlock = (data as any)?.contexts?.[context];
  const options: RawRecipeOption[] = Array.isArray(ctxBlock?.options) ? ctxBlock.options : [];
  console.log('[Odara][GuestRecipe] payload summary', {
    context,
    optionCount: options.length,
    recipeNames: options.map((o) => o.recipe_name),
  });
  if (options.length === 0) return null;

  const sorted = [...options].sort((a, b) => (a.option_rank ?? 0) - (b.option_rank ?? 0));
  const featured = sorted[0];
  const rest = sorted.slice(1);

  const mainBundle = adaptRecipeOptionToBundle(featured);
  const altBundles = rest.map((o) => adaptRecipeOptionToBundle(o));

  const todayPick = mainBundle.hero
    ? {
        fragrance_id: '__guest_recipe_' + featured.recipe_key,
        name: mainBundle.hero.name,
        brand: mainBundle.hero.brand,
        family: mainBundle.hero.family,
        reason: mainBundle.hero.reason,
        notes: [],
        accords: [],
      }
    : null;

  return {
    main_bundle: mainBundle,
    alternate_bundles: altBundles,
    guest_mode_contract: 'guest_recipe_v2',
    __recipeRaw: data,
    today_pick: todayPick,
  };
}
