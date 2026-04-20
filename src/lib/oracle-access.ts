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
  rpcUsed: 'get_todays_oracle_home_v1' | 'get_guest_oracle_home_v1';
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
    console.log('[Odara][Guest] rpc start', { rpc: 'get_guest_oracle_home_v1', args });
    const { data, error } = await odaraSupabase.rpc('get_guest_oracle_home_v1' as any, args);
    logRawHomePayload('get_guest_oracle_home_v1', args, data, error);
    if (error) {
      console.error('[Odara][Guest] rpc fail', { error });
      throw error;
    }
    const d: any = data ?? {};
    const alts = Array.isArray(d.alternates) ? d.alternates : [];
    const tokens = Array.isArray(d.accord_tokens) ? d.accord_tokens : [];
    console.log('[Odara][Guest] rpc success');
    console.log('[Odara][Guest] payload summary', {
      style_key: d.style_key ?? null,
      style_name: d.style_name ?? null,
      weekday_slot: d.weekday_slot ?? null,
      context_key: d.context_key ?? null,
      hero_name: d.today_pick?.name ?? null,
      hero_bind_status: d.today_pick?.bind_status ?? null,
      layer_name: d.layer?.name ?? null,
      layer_bind_status: d.layer?.bind_status ?? null,
      alternates_count: alts.length,
      token_count: tokens.length,
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
