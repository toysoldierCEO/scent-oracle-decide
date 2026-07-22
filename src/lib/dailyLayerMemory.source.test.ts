import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260721123000_daily_layer_memory_v1.sql',
  'utf8',
);
const odaraScreenSource = readFileSync('src/pages/OdaraScreen.tsx', 'utf8');
const indexSource = readFileSync('src/pages/Index.tsx', 'utf8');
const feedbackMigration = readFileSync(
  'supabase/migrations/20260713102934_layer_feedback_memory_v1.sql',
  'utf8',
);

describe('daily layer wear memory schema and RLS', () => {
  it('stores only factual positive layered wear confirmations', () => {
    expect(migration).toContain('create table if not exists public.daily_layer_wear_memory_v1');
    expect(migration).toContain('wear_date date not null');
    expect(migration).toContain('anchor_fragrance_id uuid not null references public.fragrances(id) on delete restrict');
    expect(migration).toContain('companion_fragrance_id uuid not null references public.fragrances(id) on delete restrict');
    expect(migration).toContain('lead_fragrance_id uuid not null references public.fragrances(id) on delete restrict');
    expect(migration).toContain('accent_fragrance_id uuid not null references public.fragrances(id) on delete restrict');
    expect(migration).toContain('ratio_label text');
    expect(migration).toContain('anchor_sprays integer');
    expect(migration).toContain('companion_sprays integer');
    expect(migration).toContain('placement jsonb not null');
    expect(migration).toContain('context_key text');
    expect(migration).toContain('temperature numeric');
    expect(migration).toContain('recommendation_identity text');
    expect(migration).toContain('presentation_payload jsonb not null');
    expect(migration).toContain('acceptance_source text not null');
    expect(migration).toContain('idempotency_key uuid not null');
    expect(migration).toContain('created_at timestamptz not null default now()');
    expect(migration).toContain('stores observations only; it must not infer durable preference beliefs');
    expect(migration).not.toContain('user_collection');
    expect(migration).not.toContain('set_user_fragrance_preference');
    expect(migration).not.toContain('oracle_dislikes');
    expect(migration).not.toContain('wear_events');
  });

  it('keeps positive memory writes RPC-only with user-scoped reads', () => {
    expect(migration).toContain('alter table public.daily_layer_wear_memory_v1 enable row level security');
    expect(migration).toContain('revoke all on table public.daily_layer_wear_memory_v1 from public');
    expect(migration).toContain('revoke all on table public.daily_layer_wear_memory_v1 from anon');
    expect(migration).toContain('revoke all on table public.daily_layer_wear_memory_v1 from authenticated');
    expect(migration).toContain('grant select on table public.daily_layer_wear_memory_v1 to authenticated');
    expect(migration).not.toContain('grant select, insert on table public.daily_layer_wear_memory_v1 to authenticated');
    expect(migration).not.toContain('for insert');
    expect(migration).toContain('(select auth.uid()) = user_id');
  });

  it('uses an authenticated idempotent RPC that rejects cross-user and malformed writes', () => {
    expect(migration).toContain('create or replace function public.submit_daily_layer_wear_memory_v1');
    expect(migration).toContain('security definer');
    expect(migration).toContain('set search_path to');
    expect(migration).toContain('or (v_auth_user is not null and p_user = v_auth_user)');
    expect(migration).toContain("raise exception 'Access denied: p_user must match auth.uid() for daily layer memory.'");
    expect(migration).toContain("raise exception 'Daily layer memory requires an ISO wear date.'");
    expect(migration).toContain("raise exception 'Daily layer memory placement must be a JSON object.'");
    expect(migration).toContain("raise exception 'Daily layer memory presentation payload must be a JSON object.'");
    expect(migration).toContain('constraint daily_layer_memory_idempotency_unique_v1 unique (user_id, idempotency_key)');
    expect(migration).toContain('on conflict (user_id, idempotency_key) do nothing');
    expect(migration).toContain('grant execute on function public.submit_daily_layer_wear_memory_v1');
    expect(migration).toContain('to authenticated, service_role');
  });

  it('keeps positive memory separate from negative feedback memory', () => {
    expect(feedbackMigration).toContain('create table if not exists public.layer_recommendation_feedback_v1');
    expect(feedbackMigration).not.toContain('daily_layer_wear_memory_v1');
    expect(migration).not.toContain('layer_recommendation_feedback_v1');
    expect(migration).not.toContain('feedback_type');
  });
});

describe('daily layer wear memory UI plumbing', () => {
  it('writes positive memory only after signed-in layered wear confirmation succeeds', () => {
    const submitIndex = odaraScreenSource.indexOf('submit_daily_layer_wear_memory_v1');
    const acceptIndex = odaraScreenSource.indexOf('await onAccept(visibleHeroId, visibleLayerId);');
    const acceptFlagIndex = odaraScreenSource.indexOf('acceptPersisted = true;', acceptIndex);
    const persistIndex = odaraScreenSource.indexOf('persistDailyLayerWearMemoryRef.current(dailyLayerMemoryInput)', acceptFlagIndex);

    expect(indexSource).toContain('accept_oracle_selection_v1');
    expect(submitIndex).toBeGreaterThan(-1);
    expect(acceptIndex).toBeGreaterThan(-1);
    expect(acceptFlagIndex).toBeGreaterThan(acceptIndex);
    expect(persistIndex).toBeGreaterThan(acceptFlagIndex);
    expect(odaraScreenSource).toContain('acceptPersisted && dailyLayerMemoryInput');
    expect(odaraScreenSource).toContain('buildCurrentDailyLayerMemoryInputRef.current = buildCurrentDailyLayerMemoryInput');
    expect(odaraScreenSource).toContain('persistDailyLayerWearMemoryRef.current = persistDailyLayerWearMemory');
  });

  it('gates positive layer memory out of Solo, guest, read-only, and locked-under-threshold states', () => {
    const builderIndex = odaraScreenSource.indexOf('const buildCurrentDailyLayerMemoryInput = useCallback');
    const builderSnippet = odaraScreenSource.slice(builderIndex, odaraScreenSource.indexOf('const persistDailyLayerWearMemory', builderIndex));

    expect(builderSnippet).toContain('isGuestMode');
    expect(builderSnippet).toContain('signedInIsReadOnlyHistoryCard');
    expect(builderSnippet).toContain('!isWearModeLayeringUnlocked');
    expect(builderSnippet).toContain("effectiveWearMode !== 'layered'");
    expect(builderSnippet).toContain('!visibleResolvedLayer');
    expect(builderSnippet).toContain("acceptanceSource: 'layered_double_tap_lock'");
  });

  it('initializes visible hero detail before the daily layer memory callback reads it', () => {
    const visibleHeroDetailIndex = odaraScreenSource.indexOf('const visibleHeroDetail = useMemo');
    const builderIndex = odaraScreenSource.indexOf('const buildCurrentDailyLayerMemoryInput = useCallback');

    expect(visibleHeroDetailIndex).toBeGreaterThan(-1);
    expect(builderIndex).toBeGreaterThan(visibleHeroDetailIndex);
  });

  it('does not write positive memory from view, skip, or negative feedback paths', () => {
    expect(odaraScreenSource.match(/submit_daily_layer_wear_memory_v1/g) ?? []).toHaveLength(1);

    const skipStart = odaraScreenSource.indexOf('const handleSkipLocal = useCallback');
    const skipSnippet = odaraScreenSource.slice(skipStart, odaraScreenSource.indexOf('// ── Back button', skipStart));
    expect(skipSnippet).not.toContain('submit_daily_layer_wear_memory_v1');
    expect(skipSnippet).not.toContain('persistDailyLayerWearMemory');

    const feedbackStart = odaraScreenSource.indexOf('const handleLayerFeedback = useCallback');
    const feedbackSnippet = odaraScreenSource.slice(feedbackStart, odaraScreenSource.indexOf('const openVisibleHeroDetail', feedbackStart));
    expect(feedbackSnippet).toContain('submit_layer_recommendation_feedback_v1');
    expect(feedbackSnippet).not.toContain('submit_daily_layer_wear_memory_v1');
    expect(feedbackSnippet).not.toContain('persistDailyLayerWearMemory');
  });
});
