/**
 * Normalized Home oracle access layer — single source of truth for which RPC is called.
 *
 * Two explicit branches:
 *   - signed-in: get_todays_oracle_home_v1 (requires auth.uid())
 *   - guest:     get_guest_oracle_home_v1 (anon-callable, no user param)
 *
 * Do NOT call get_todays_oracle_home_v1 from guest mode — it is RLS-gated.
 */
import { odaraSupabase } from '@/lib/odara-client';
import type { AccessMode } from '@/lib/access-mode';

export interface FetchHomeOracleParams {
  access: AccessMode;
  temperature: number;
  context: string;
  brand: string;
  wearDate: string;
}

export interface FetchHomeOracleResult {
  data: any;
  rpcUsed:
  | 'get_todays_oracle_home_v1'
    | 'get_guest_oracle_home_v1'
    | 'get_guest_oracle_home_v5'
    | 'get_signed_in_card_contract_v6'
    | 'get_signed_in_card_contract_v7';
}

/** Adapt the canonical signed-in v6 contract into the existing OracleResult
 *  shape consumed by OdaraScreen (today_pick / layer / alternates / etc.).
 *  The full v6 payload is preserved at __v6 so the per-mode layer stack
 *  (payload.layer_modes[mood].layers[]) remains addressable for cycling. */
function adaptSignedInV6ToOracleResult(v6: any): any {
  if (!v6 || typeof v6 !== 'object') return v6;
  const hero = v6.hero ?? null;
  const layer = v6.layer ?? null;
  const today_pick = hero
    ? {
        fragrance_id: hero.fragrance_id ?? hero.id ?? '',
        name: hero.name ?? '',
        family: hero.family ?? hero.family_key ?? '',
        reason: hero.reason ?? '',
        brand: hero.brand ?? '',
        notes: Array.isArray(hero.notes) ? hero.notes : [],
        accords: Array.isArray(hero.accords) ? hero.accords : [],
      }
    : null;
  return {
    // Map to existing OracleResult shape
    today_pick,
    layer,
    oracle_layer: layer,
    alternates: Array.isArray(v6.alternates) ? v6.alternates : [],
    ui_default_mode: v6.ui_default_mode ?? 'balance',
    layer_mode_contract: v6.layer_mode_contract ?? 'signed_in_card_contract_v6',
    layer_modes: v6.layer_modes ?? null,
    hero_tokens: Array.isArray(v6.hero_tokens) ? v6.hero_tokens : [],
    layer_tokens: Array.isArray(v6.layer_tokens) ? v6.layer_tokens : [],
    layer_mode_order: Array.isArray(v6.layer_mode_order)
      ? v6.layer_mode_order
      : ['balance', 'bold', 'smooth', 'wild'],
    // Stash the raw v6 payload so the signed-in VM can address mode stacks
    __v6: v6,
  };
}

function logRawHomePayload(rpc: string, args: Record<string, unknown>, data: any, error: any) {
  const top = data && typeof data === 'object' ? Object.keys(data) : [];
  console.log('[Odara] RAW home payload', {
    rpc,
    args,
    error: error ?? null,
    topLevelKeys: top,
    hasTodayPick: !!data?.today_pick,
    todayPickFragranceId: data?.today_pick?.fragrance_id ?? '(none)',
    hasLayer: !!data?.layer,
    hasOracleLayer: !!data?.oracle_layer,
    hasSeededBalanceMode: !!data?.seeded_balance_mode,
    hasLayerModesBalance: !!data?.layer_modes?.balance,
    contract: data?.layer_mode_contract ?? null,
  });
}

export async function fetchHomeOracle(
  params: FetchHomeOracleParams,
): Promise<FetchHomeOracleResult> {
  const { access, temperature, context, brand, wearDate } = params;

  if (access.isGuestMode) {
    const args = {
      p_temperature: temperature,
      p_context: context,
      p_brand: brand,
      p_wear_date: wearDate,
    };
    console.log('[Odara][Guest] access mode', { isGuestMode: true });
    console.log('[Odara][Guest] rpc start', { rpc: 'get_guest_oracle_home_v5', args });
    const { data, error } = await odaraSupabase.rpc('get_guest_oracle_home_v5' as any, args);
    logRawHomePayload('get_guest_oracle_home_v5', args, data, error);
    if (error) {
      console.error('[Odara][Guest] rpc fail', { error });
      throw error;
    }
    const d: any = data ?? {};
    const main = d.main_bundle ?? {};
    const altBundles = Array.isArray(d.alternate_bundles) ? d.alternate_bundles : [];
    console.log('[Odara][Guest] rpc success');
    console.log('[Odara][Guest] payload summary', {
      contract: d.guest_mode_contract ?? null,
      style_key: d.style_key ?? null,
      hero_name: main.hero?.name ?? null,
      ui_default_mode: main.ui_default_mode ?? null,
      layer_mode_order: main.layer_mode_order ?? null,
      mode_layer_counts: main.layer_modes
        ? Object.fromEntries(
            Object.entries(main.layer_modes).map(([k, v]: any) => [
              k,
              Array.isArray(v?.layers) ? v.layers.length : 0,
            ]),
          )
        : null,
      alternate_bundles_count: altBundles.length,
    });
    return { data, rpcUsed: 'get_guest_oracle_home_v5' };
  }

  if (!access.isSignedIn || !access.resolvedUserId) {
    throw new Error('Cannot fetch oracle: no access mode resolved');
  }

  // CANONICAL SIGNED-IN CONTRACT: get_signed_in_card_contract_v6 is the
  // single backend source of truth for the signed-in Odara card. Returns
  // hero, hero_tokens, layer, layer_tokens, layer_modes (with per-mood
  // layers[] preview stack), layer_mode_order, ui_default_mode, alternates,
  // queue. Adapter below remaps to the legacy OracleResult shape so existing
  // wiring keeps working, and stashes the raw v6 payload at __v6 for the
  // mode-stack-aware view model in OdaraScreen.
  const args = {
    p_user_id: access.resolvedUserId,
    p_temperature: temperature,
    p_context: context,
    p_brand: brand,
    p_wear_date: wearDate,
  };
  console.log('[Odara] oracle access: SIGNED-IN → get_signed_in_card_contract_v6');
  const { data, error } = await odaraSupabase.rpc(
    'get_signed_in_card_contract_v6' as any,
    args,
  );
  logRawHomePayload('get_signed_in_card_contract_v6', args, data, error);
  if (error) throw error;
  const adapted = adaptSignedInV6ToOracleResult(data);
  console.log('[Odara][SignedIn][v6] adapted summary', {
    hero_id: adapted?.today_pick?.fragrance_id ?? null,
    hero_tokens_count: Array.isArray(adapted?.hero_tokens) ? adapted.hero_tokens.length : 0,
    layer_tokens_count: Array.isArray(adapted?.layer_tokens) ? adapted.layer_tokens.length : 0,
    layer_modes_keys: adapted?.layer_modes ? Object.keys(adapted.layer_modes) : [],
    mode_layer_counts: adapted?.layer_modes
      ? Object.fromEntries(
          Object.entries(adapted.layer_modes).map(([k, v]: any) => [
            k,
            Array.isArray(v?.layers) ? v.layers.length : 0,
          ]),
        )
      : null,
    ui_default_mode: adapted?.ui_default_mode ?? null,
  });
  return { data: adapted, rpcUsed: 'get_signed_in_card_contract_v6' };
}
