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
  diagnostic?: {
    oracleKey?: string | null;
    requestGeneration?: number;
    timeoutMs?: number;
  };
}

export interface FetchHomeOracleResult {
  data: any;
  rpcUsed:
  | 'get_todays_oracle_home_v1'
    | 'get_guest_oracle_home_v1'
    | 'get_guest_oracle_home_v5'
    | 'get_guest_oracle_home_v6'
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
    // Propagate the REAL backend contract version (v7 today). Never hardcode v6.
    layer_mode_contract: v6.card_contract_version ?? v6.layer_mode_contract ?? null,
    card_contract_version: v6.card_contract_version ?? null,
    surface_type: v6.surface_type ?? null,
    requested_context: v6.requested_context ?? v6.context_key ?? null,
    context_key: v6.context_key ?? v6.requested_context ?? null,
    wear_date: v6.wear_date ?? null,
    hero_source: v6.hero_source ?? null,
    queue_fallback_used: v6.queue_fallback_used ?? null,
    primary_resolver_produced_hero: v6.primary_resolver_produced_hero ?? null,
    queue_count: typeof v6.queue_count === 'number' ? v6.queue_count : null,
    card_unavailable: v6.card_unavailable ?? null,
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
    try {
      const { data, error } = await odaraSupabase.rpc('get_guest_oracle_home_v6' as any, args);
      if (error) {
        throw error;
      }
      return { data, rpcUsed: 'get_guest_oracle_home_v6' };
    } catch (error: any) {
      throw error;
    }
  }

  if (!access.isSignedIn || !access.signedInUserId) {
    throw new Error('Cannot fetch oracle: no access mode resolved');
  }

  // CANONICAL SIGNED-IN CONTRACT: get_signed_in_card_contract_v7 is the
  // single backend source of truth for the signed-in Odara card. Returns
  // hero, hero_tokens, layer, layer_tokens, layer_modes (with per-mood
  // layers[] preview stack — preview_depth=3), layer_mode_order,
  // ui_default_mode, alternates, queue, card_contract_version, surface_type.
  // The v6/v7 payload shapes are field-compatible for the fields we read,
  // so the existing adapter remains valid; v7 additionally guarantees the
  // hard_primary_soft_preview_fallback overlap policy on the backend.
  const args = {
    p_user_id: access.signedInUserId,
    p_temperature: temperature,
    p_context: context,
    p_brand: brand,
    p_wear_date: wearDate,
  };

  try {
    const { data, error } = await odaraSupabase.rpc(
      'get_signed_in_card_contract_v7' as any,
      args,
    );
    if (error) throw error;
    const adapted = adaptSignedInV6ToOracleResult(data);
    return { data: adapted, rpcUsed: 'get_signed_in_card_contract_v7' };
  } catch (error: any) {
    throw error;
  }
}
