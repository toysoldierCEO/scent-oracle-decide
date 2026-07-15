import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260713102934_layer_feedback_memory_v1.sql',
  'utf8',
);
const odaraScreenSource = readFileSync('src/pages/OdaraScreen.tsx', 'utf8');
const layerCardSource = readFileSync('src/components/LayerCard.tsx', 'utf8');

describe('layer feedback memory schema and RLS', () => {
  it('stores factual pairing-scoped feedback without mutating fragrance preference tables', () => {
    expect(migration).toContain('create table if not exists public.layer_recommendation_feedback_v1');
    expect(migration).toContain("feedback_type text not null check (feedback_type in ('too_strong', 'too_weak', 'doesnt_work'))");
    expect(migration).toContain('anchor_fragrance_id uuid not null references public.fragrances(id) on delete restrict');
    expect(migration).toContain('companion_fragrance_id uuid not null references public.fragrances(id) on delete restrict');
    expect(migration).toContain('recommendation_identity text');
    expect(migration).toContain('layer_mode text');
    expect(migration).toContain('lead_role text');
    expect(migration).toContain('companion_role text');
    expect(migration).toContain('ratio_label text');
    expect(migration).toContain('context_key text');
    expect(migration).toContain('temperature numeric');
    expect(migration).toContain('wear_date date');
    expect(migration).toContain('presentation_payload jsonb not null');
    expect(migration).toContain('idempotency_key uuid not null');
    expect(migration).toContain("constraint layer_feedback_layer_mode_known_v1 check (layer_mode is null or layer_mode in ('balance', 'bold', 'smooth', 'wild'))");
    expect(migration).toContain("constraint layer_feedback_presentation_object_v1 check (jsonb_typeof(presentation_payload) = 'object')");
    expect(migration).toContain('constraint layer_feedback_idempotency_unique_v1 unique (user_id, idempotency_key)');
    expect(migration).toContain('stores observations only; it must not infer durable preference beliefs');
    expect(migration).not.toContain('user_collection');
    expect(migration).not.toContain('set_user_fragrance_preference');
    expect(migration).not.toContain('fragrance_dislike');
    expect(migration).not.toContain('wear_history');
  });

  it('keeps table writes RPC-only while preserving user-scoped reads', () => {
    expect(migration).toContain('alter table public.layer_recommendation_feedback_v1 enable row level security');
    expect(migration).toContain('revoke all on table public.layer_recommendation_feedback_v1 from public');
    expect(migration).toContain('revoke all on table public.layer_recommendation_feedback_v1 from anon');
    expect(migration).toContain('revoke all on table public.layer_recommendation_feedback_v1 from authenticated');
    expect(migration).toContain('grant select on table public.layer_recommendation_feedback_v1 to authenticated');
    expect(migration).not.toContain('grant select, insert on table public.layer_recommendation_feedback_v1 to authenticated');
    expect(migration).toContain('for select');
    expect(migration).not.toContain('for insert');
    expect(migration).toContain('(select auth.uid()) = user_id');
  });

  it('uses an authenticated RPC that fails closed for cross-user writes and duplicate taps', () => {
    expect(migration).toContain('create or replace function public.submit_layer_recommendation_feedback_v1');
    expect(migration).toContain('security definer');
    expect(migration).toContain('set search_path to');
    expect(migration).toContain('or (v_auth_user is not null and p_user = v_auth_user)');
    expect(migration).toContain("raise exception 'Access denied: p_user must match auth.uid() for layer feedback.'");
    expect(migration).toContain("raise exception 'Invalid layer mode: %', p_layer_mode");
    expect(migration).toContain("raise exception 'Layer feedback presentation payload must be a JSON object.'");
    expect(migration).toContain('on conflict (user_id, idempotency_key) do nothing');
    expect(migration).toContain('grant execute on function public.submit_layer_recommendation_feedback_v1');
    expect(migration).toContain('to authenticated, service_role');
  });
});

describe('layer feedback memory UI plumbing', () => {
  it('persists feedback before advancing and excludes the rejected pair immediately', () => {
    const submitIndex = odaraScreenSource.indexOf('submit_layer_recommendation_feedback_v1');
    const errorGuardIndex = odaraScreenSource.indexOf('if (error) throw error;', submitIndex);
    const exclusionIndex = odaraScreenSource.indexOf('layerFeedbackImmediateExclusionsRef.current = [');

    expect(submitIndex).toBeGreaterThan(-1);
    expect(errorGuardIndex).toBeGreaterThan(submitIndex);
    expect(exclusionIndex).toBeGreaterThan(errorGuardIndex);
    expect(odaraScreenSource).toContain('collectLayerFeedbackImmediateExclusionIds(anchorId)');
    expect(odaraScreenSource).toContain("event.feedbackType === 'doesnt_work' && event.companionId === anchorId");
    expect(odaraScreenSource).toContain('const replacementMoodOrder = [');
    expect(odaraScreenSource).toContain('...LAYER_MODE_ORDER.filter((candidateMood) => candidateMood !== mood)');
    expect(odaraScreenSource).toContain('const currentStack = readMoodLaneStack(targetMoodKey)');
    expect(odaraScreenSource).toContain('ensureMoodLaneDepth(anchorId, targetMood, currentStack.length, feedbackExcludedIds)');
    expect(odaraScreenSource).toContain('setSelectedMood(targetMood)');
    expect(odaraScreenSource).toContain("const showLayeredWearGuide = !!visibleResolvedCurrentCard && effectiveWearMode === 'layered' && isWearModeLayeringUnlocked");
    expect(odaraScreenSource).toContain("clearMoodLane(mood);");
    expect(odaraScreenSource).toContain("No other layer is ready right now.");
  });

  it('screens cached and payload-backed layer companions against current eligible ownership', () => {
    expect(odaraScreenSource).toContain('isLayerEligibleCollectionItem');
    expect(odaraScreenSource).toContain('const signedInLayerEligibleFragranceIds = useMemo');
    expect(odaraScreenSource).toContain('const isLayerCompanionInCurrentWardrobe = useCallback');
    expect(odaraScreenSource).toContain('isLayerCompanionInCurrentWardrobe(cached.layer_fragrance_id)');
    expect(odaraScreenSource).toContain('isLayerCompanionInCurrentWardrobe(entry.layer_fragrance_id)');
    expect(odaraScreenSource).toContain('isLayerCompanionInCurrentWardrobe(candidateId)');
    expect(odaraScreenSource).toContain('&& isLayerCompanionInCurrentWardrobe(entry.layer_fragrance_id)');
  });

  it('wires the existing three-option menu to the factual feedback payload', () => {
    expect(layerCardSource).toContain('[\'Too strong\', \'Too weak\', "Doesn’t work"].map');
    expect(layerCardSource).toContain("'Too strong'");
    expect(layerCardSource).toContain("'Too weak'");
    expect(layerCardSource).toContain('"Doesn’t work"');
    expect(layerCardSource).toContain('feedbackSubmittingRef.current');
    expect(layerCardSource).toContain('Saving…');
    expect(layerCardSource).toContain('Couldn’t save. Try again.');
    expect(layerCardSource).toContain('anchorFragranceId: mainFragranceId');
    expect(layerCardSource).toContain('companionFragranceId: activeModeEntry.id');
    expect(layerCardSource).toContain('ratioLabel: layerRatioGuide?.ratioLabel ?? ratioDisplayText ?? null');
    expect(layerCardSource).toContain('presentation: {');
  });
});
