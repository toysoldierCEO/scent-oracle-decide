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
  rpcUsed: 'get_todays_oracle_home_v1' | 'get_guest_oracle_home_v1' | 'get_guest_oracle_home_v5';
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
    return { data, rpcUsed: 'get_guest_oracle_home_v1' };
  }

  if (!access.isSignedIn || !access.resolvedUserId) {
    throw new Error('Cannot fetch oracle: no access mode resolved');
  }

  // VERIFIED BACKEND TRUTH: signed-in Home uses get_todays_oracle_home_v1.
  // Do NOT swap to v3 as a workaround — the frontend is connected to the
  // verified Odara project (yysmhqxmnhfugwnojfag) where this RPC exists.
  const args = {
    p_user_id: access.resolvedUserId,
    p_temperature: temperature,
    p_context: context,
    p_brand: brand,
    p_wear_date: wearDate,
  };
  console.log('[Odara] oracle access: SIGNED-IN → get_todays_oracle_home_v1');
  const { data, error } = await odaraSupabase.rpc('get_todays_oracle_home_v1' as any, args);
  logRawHomePayload('get_todays_oracle_home_v1', args, data, error);
  if (error) throw error;
  return { data, rpcUsed: 'get_todays_oracle_home_v1' };
}
