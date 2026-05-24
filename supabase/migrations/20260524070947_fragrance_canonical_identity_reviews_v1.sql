begin;

create table if not exists public.fragrance_canonical_identity_reviews_v1 (
  id uuid primary key default gen_random_uuid(),
  canonical_identity_key text not null,
  decision_status text not null,
  reviewed_fragrance_ids uuid[] not null,
  canonical_fragrance_id uuid null references public.fragrances(id),
  alias_fragrance_ids uuid[] null,
  separate_fragrance_ids uuid[] null,
  decision_reason text null,
  recommended_next_action text null,
  actor_label text not null,
  source_queue_model_version text null,
  source_conflict_view text null,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  cluster_snapshot jsonb not null default '{}'::jsonb,
  before_decision_snapshot jsonb null,
  after_decision_snapshot jsonb null,
  supersedes_review_id uuid null references public.fragrance_canonical_identity_reviews_v1(id),
  superseded_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fragrance_canonical_identity_reviews_v1_status_check check (
    decision_status in (
      'needs_review',
      'same_identity',
      'separate_identity',
      'canonical_selected',
      'alias_confirmed',
      'do_not_merge',
      'needs_manual_source_review',
      'superseded'
    )
  ),
  constraint fragrance_canonical_identity_reviews_v1_reviewed_ids_check check (
    cardinality(reviewed_fragrance_ids) > 0
  )
);

create index if not exists fragrance_canonical_identity_reviews_v1_key_idx
  on public.fragrance_canonical_identity_reviews_v1 (canonical_identity_key);

create index if not exists fragrance_canonical_identity_reviews_v1_status_idx
  on public.fragrance_canonical_identity_reviews_v1 (decision_status);

create index if not exists fragrance_canonical_identity_reviews_v1_created_idx
  on public.fragrance_canonical_identity_reviews_v1 (created_at desc);

create index if not exists fragrance_canonical_identity_reviews_v1_canonical_idx
  on public.fragrance_canonical_identity_reviews_v1 (canonical_fragrance_id)
  where canonical_fragrance_id is not null;

create index if not exists fragrance_canonical_identity_reviews_v1_reviewed_gin_idx
  on public.fragrance_canonical_identity_reviews_v1 using gin (reviewed_fragrance_ids);

create unique index if not exists fragrance_canonical_identity_reviews_v1_one_active_key_idx
  on public.fragrance_canonical_identity_reviews_v1 (canonical_identity_key)
  where superseded_at is null and decision_status <> 'superseded';

drop trigger if exists fragrance_canonical_identity_reviews_v1_touch_updated_at
  on public.fragrance_canonical_identity_reviews_v1;

create trigger fragrance_canonical_identity_reviews_v1_touch_updated_at
before update on public.fragrance_canonical_identity_reviews_v1
for each row
execute function public.set_updated_at_v1();

alter table public.fragrance_canonical_identity_reviews_v1 enable row level security;

comment on table public.fragrance_canonical_identity_reviews_v1 is
  'Operational canonical identity review decisions. This is not a merge table, source truth, enrichment truth, taxonomy truth, or frontend payload; it records review memory without mutating fragrance rows or copying evidence.';

comment on column public.fragrance_canonical_identity_reviews_v1.canonical_identity_key is
  'Normalized cluster key from taxonomy_canonical_identity_conflicts_v1. It identifies the reviewed operational conflict cluster, not a canonical merge target.';

comment on column public.fragrance_canonical_identity_reviews_v1.decision_status is
  'Review decision state. This migration only seeds needs_review; same_identity, canonical_selected, alias_confirmed, do_not_merge, and related statuses are future explicit operator decisions.';

comment on column public.fragrance_canonical_identity_reviews_v1.evidence_snapshot is
  'Snapshot of Queue v2.1 operational evidence at review-record creation time. It must not be treated as source, notes, accords, taxonomy, or recommendation truth.';

comment on column public.fragrance_canonical_identity_reviews_v1.cluster_snapshot is
  'Snapshot of canonical identity cluster members and conflict reasons at review-record creation time. It does not merge, delete, mutate, or copy data between rows.';

create or replace view public.fragrance_canonical_identity_review_latest_v1
with (security_invoker = true)
as
select
  ranked.canonical_identity_key,
  ranked.id as latest_review_id,
  ranked.decision_status,
  ranked.reviewed_fragrance_ids,
  ranked.canonical_fragrance_id,
  ranked.alias_fragrance_ids,
  ranked.separate_fragrance_ids,
  ranked.decision_reason,
  ranked.recommended_next_action,
  ranked.actor_label,
  ranked.evidence_snapshot,
  ranked.cluster_snapshot,
  ranked.created_at,
  ranked.updated_at
from (
  select
    r.*,
    row_number() over (
      partition by r.canonical_identity_key
      order by r.updated_at desc nulls last, r.created_at desc nulls last, r.id desc
    ) as rn
  from public.fragrance_canonical_identity_reviews_v1 r
  where r.superseded_at is null
    and r.decision_status <> 'superseded'
) ranked
where ranked.rn = 1;

comment on view public.fragrance_canonical_identity_review_latest_v1 is
  'Latest active canonical identity review per cluster key. Operational review memory only; not a merge, alias application, source truth, taxonomy truth, or frontend product payload.';

create or replace function public.create_canonical_identity_review_records_v1(
  p_canonical_identity_keys text[],
  p_actor_label text default 'codex_canonical_identity_review_v1',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_keys text[];
  v_actor_label text := coalesce(nullif(btrim(p_actor_label), ''), 'codex_canonical_identity_review_v1');
  v_requested_count integer := 0;
  v_picked_count integer := 0;
  v_created_count integer := 0;
  v_skipped_count integer := 0;
  v_rejected_count integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_cluster record;
  v_review_id uuid;
begin
  select array_agg(distinct clean_key order by clean_key)
  into v_keys
  from (
    select nullif(btrim(k), '') as clean_key
    from unnest(coalesce(p_canonical_identity_keys, array[]::text[])) as k
  ) cleaned
  where clean_key is not null;

  v_requested_count := coalesce(cardinality(v_keys), 0);

  if v_requested_count = 0 then
    raise exception 'create_canonical_identity_review_records_v1 requires explicit non-empty canonical identity keys';
  end if;

  if v_requested_count > 10 then
    raise exception 'create_canonical_identity_review_records_v1 accepts at most 10 canonical identity keys per call';
  end if;

  for v_cluster in
    with requested as (
      select unnest(v_keys) as canonical_identity_key
    ),
    clusters as (
      select
        c.canonical_identity_key,
        array_agg(c.fragrance_id order by c.name, c.brand, c.fragrance_id) as reviewed_fragrance_ids,
        bool_or(c.canonical_identity_action_required) as has_action_required_member,
        max(q.queue_model_version) as source_queue_model_version,
        jsonb_agg(jsonb_build_object(
          'fragrance_id', c.fragrance_id,
          'name', c.name,
          'brand', c.brand,
          'queue_state', q.queue_state,
          'queue_lane', q.queue_lane,
          'blocker_reason', q.blocker_reason,
          'recommended_next_action', q.recommended_next_action,
          'canonical_identity_action_required', c.canonical_identity_action_required
        ) order by c.name, c.brand, c.fragrance_id) as evidence_members,
        jsonb_build_object(
          'canonical_identity_key', c.canonical_identity_key,
          'normalized_name_key', max(c.normalized_name_key),
          'compatible_brand_key', max(c.compatible_brand_key),
          'cluster_member_count', max(c.cluster_member_count),
          'member_fragrance_ids', max(c.member_fragrance_ids::text)::jsonb,
          'member_names', max(c.member_names::text)::jsonb,
          'member_brands', max(c.member_brands::text)::jsonb,
          'member_family_keys', max(c.member_family_keys::text)::jsonb,
          'member_universal_family_keys', max(c.member_universal_family_keys::text)::jsonb,
          'member_notes_counts', max(c.member_notes_counts::text)::jsonb,
          'member_accords_counts', max(c.member_accords_counts::text)::jsonb,
          'member_queue_states', max(c.member_queue_states::text)::jsonb,
          'evidenceful_member_count', max(c.evidenceful_member_count),
          'zero_evidence_member_count', max(c.zero_evidence_member_count),
          'complete_member_count', max(c.complete_member_count),
          'incomplete_member_count', max(c.incomplete_member_count),
          'has_evidence_asymmetry', bool_or(c.has_evidence_asymmetry),
          'has_brand_variant_conflict', bool_or(c.has_brand_variant_conflict),
          'has_spelling_or_punctuation_variant', bool_or(c.has_spelling_or_punctuation_variant),
          'has_family_universal_compatibility', bool_and(c.has_family_universal_compatibility),
          'conflict_reason', max(c.conflict_reason),
          'recommended_next_action', max(c.recommended_next_action)
        ) as cluster_snapshot,
        jsonb_build_object(
          'source_queue_view', 'public.taxonomy_operationalization_queue_v2_1',
          'source_conflict_view', 'public.taxonomy_canonical_identity_conflicts_v1',
          'source_queue_model_version', max(q.queue_model_version),
          'captured_at', statement_timestamp(),
          'members', jsonb_agg(jsonb_build_object(
            'fragrance_id', c.fragrance_id,
            'name', c.name,
            'brand', c.brand,
            'queue_state', q.queue_state,
            'queue_lane', q.queue_lane,
            'blocker_reason', q.blocker_reason,
            'recommended_next_action', q.recommended_next_action,
            'product_priority_score', q.product_priority_score,
            'product_priority_reason', q.product_priority_reason,
            'taxonomy_missing_summary', q.taxonomy_missing_summary,
            'evidence_summary', q.evidence_summary,
            'resolver_evidence_summary', q.resolver_evidence_summary,
            'canonical_identity_evidence_summary', q.canonical_identity_evidence_summary
          ) order by c.name, c.brand, c.fragrance_id)
        ) as evidence_snapshot
      from public.taxonomy_canonical_identity_conflicts_v1 c
      join public.taxonomy_operationalization_queue_v2_1 q
        on q.fragrance_id = c.fragrance_id
      group by c.canonical_identity_key
    ),
    active_reviews as (
      select
        r.canonical_identity_key,
        r.id,
        r.decision_status
      from public.fragrance_canonical_identity_reviews_v1 r
      where r.superseded_at is null
        and r.decision_status <> 'superseded'
    )
    select
      req.canonical_identity_key,
      c.reviewed_fragrance_ids,
      c.has_action_required_member,
      c.source_queue_model_version,
      c.cluster_snapshot,
      c.evidence_snapshot,
      ar.id as active_review_id,
      ar.decision_status as active_decision_status,
      (c.canonical_identity_key is not null) as cluster_exists
    from requested req
    left join clusters c
      on c.canonical_identity_key = req.canonical_identity_key
    left join active_reviews ar
      on ar.canonical_identity_key = req.canonical_identity_key
    order by req.canonical_identity_key
  loop
    v_review_id := null;

    if not v_cluster.cluster_exists then
      v_rejected_count := v_rejected_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'canonical_identity_key', v_cluster.canonical_identity_key,
        'result_status', 'rejected_missing_current_cluster',
        'decision_status', null,
        'would_create', false,
        'review_id', null
      ));
    elsif not coalesce(v_cluster.has_action_required_member, false) then
      v_rejected_count := v_rejected_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'canonical_identity_key', v_cluster.canonical_identity_key,
        'result_status', 'rejected_no_action_required_member',
        'decision_status', null,
        'would_create', false,
        'review_id', null
      ));
    elsif v_cluster.active_review_id is not null then
      v_picked_count := v_picked_count + 1;
      v_skipped_count := v_skipped_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'canonical_identity_key', v_cluster.canonical_identity_key,
        'result_status', 'already_exists',
        'decision_status', v_cluster.active_decision_status,
        'would_create', false,
        'review_id', v_cluster.active_review_id,
        'reviewed_fragrance_ids', to_jsonb(v_cluster.reviewed_fragrance_ids)
      ));
    elsif p_dry_run then
      v_picked_count := v_picked_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'canonical_identity_key', v_cluster.canonical_identity_key,
        'result_status', 'would_create',
        'decision_status', 'needs_review',
        'would_create', true,
        'review_id', null,
        'reviewed_fragrance_ids', to_jsonb(v_cluster.reviewed_fragrance_ids),
        'cluster_snapshot', v_cluster.cluster_snapshot
      ));
    else
      insert into public.fragrance_canonical_identity_reviews_v1 (
        canonical_identity_key,
        decision_status,
        reviewed_fragrance_ids,
        canonical_fragrance_id,
        alias_fragrance_ids,
        separate_fragrance_ids,
        decision_reason,
        recommended_next_action,
        actor_label,
        source_queue_model_version,
        source_conflict_view,
        evidence_snapshot,
        cluster_snapshot
      )
      values (
        v_cluster.canonical_identity_key,
        'needs_review',
        v_cluster.reviewed_fragrance_ids,
        null,
        null,
        null,
        'Seeded from Queue v2.1 canonical identity review routing.',
        'review_canonical_identity_cluster',
        v_actor_label,
        v_cluster.source_queue_model_version,
        'public.taxonomy_canonical_identity_conflicts_v1',
        v_cluster.evidence_snapshot,
        v_cluster.cluster_snapshot
      )
      returning id into v_review_id;

      v_picked_count := v_picked_count + 1;
      v_created_count := v_created_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'canonical_identity_key', v_cluster.canonical_identity_key,
        'result_status', 'created',
        'decision_status', 'needs_review',
        'would_create', false,
        'review_id', v_review_id,
        'reviewed_fragrance_ids', to_jsonb(v_cluster.reviewed_fragrance_ids)
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'requested_count', v_requested_count,
    'picked_count', v_picked_count,
    'created_count', v_created_count,
    'skipped_count', v_skipped_count,
    'rejected_count', v_rejected_count,
    'dry_run', p_dry_run,
    'actor_label', v_actor_label,
    'results', v_results
  );
end;
$function$;

comment on function public.create_canonical_identity_review_records_v1(text[], text, boolean) is
  'Creates or previews needs_review records for explicit canonical identity cluster keys only. It never merges rows, selects canonical rows, copies evidence, mutates public.fragrances, stages enrichment, writes taxonomy, or refreshes performance.';

revoke all on public.fragrance_canonical_identity_reviews_v1 from public, anon, authenticated;
grant select, insert, update, delete, references, trigger, truncate
  on public.fragrance_canonical_identity_reviews_v1 to service_role;

revoke all on public.fragrance_canonical_identity_review_latest_v1 from public, anon, authenticated;
grant select on public.fragrance_canonical_identity_review_latest_v1 to service_role;

revoke all on function public.create_canonical_identity_review_records_v1(text[], text, boolean)
  from public, anon, authenticated;
grant execute on function public.create_canonical_identity_review_records_v1(text[], text, boolean)
  to service_role;

commit;
