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
  data: unknown;
  rpcUsed: 'get_todays_oracle_home_v1' | 'get_guest_oracle_home_v1';
}

export async function fetchHomeOracle(
  params: FetchHomeOracleParams,
): Promise<FetchHomeOracleResult> {
  const { access, temperature, context, brand, wearDate } = params;

  if (access.isGuestMode) {
    console.log('[Odara] oracle access: GUEST → get_guest_oracle_home_v1');
    const { data, error } = await odaraSupabase.rpc('get_guest_oracle_home_v1' as any, {
      p_temperature: temperature,
      p_context: context,
      p_brand: brand,
      p_wear_date: wearDate,
    });
    if (error) throw error;
    return { data, rpcUsed: 'get_guest_oracle_home_v1' };
  }

  if (!access.isSignedIn || !access.resolvedUserId) {
    throw new Error('Cannot fetch oracle: no access mode resolved');
  }

  console.log('[Odara] oracle access: SIGNED-IN → get_todays_oracle_home_v1');
  const { data, error } = await odaraSupabase.rpc('get_todays_oracle_home_v1' as any, {
    p_user_id: access.resolvedUserId,
    p_temperature: temperature,
    p_context: context,
    p_brand: brand,
    p_wear_date: wearDate,
  });
  if (error) throw error;
  return { data, rpcUsed: 'get_todays_oracle_home_v1' };
}
