begin;

create table if not exists public.fragrance_taxonomy_correction_plans_v1 (
  id uuid primary key default gen_random_uuid(),
  fragrance_id uuid not null references public.fragrances(id) on delete cascade,
  plan_status text not null default 'planned',
  correction_type text not null,
  actor_label text not null,
  confidence text not null,
  source_lane text not null,
  current_legacy_family_key text null,
  current_universal_family_key text null,
  current_facets jsonb not null default '[]'::jsonb,
  current_roles jsonb not null default '[]'::jsonb,
  current_taxonomy_snapshot jsonb not null default '{}'::jsonb,
  queue_snapshot jsonb not null default '{}'::jsonb,
  source_snapshot jsonb not null default '{}'::jsonb,
  proposed_universal_family_key text not null,
  proposed_facets jsonb not null default '[]'::jsonb,
  proposed_roles jsonb not null default '[]'::jsonb,
  correction_reason text not null,
  evidence_summary jsonb not null default '{}'::jsonb,
  future_execution_recommendation text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  superseded_at timestamptz null,
  supersedes_plan_id uuid null references public.fragrance_taxonomy_correction_plans_v1(id),
  applied_at timestamptz null,
  constraint fragrance_taxonomy_correction_plans_v1_status_check check (
    plan_status in ('planned', 'applied', 'cancelled', 'superseded')
  ),
  constraint fragrance_taxonomy_correction_plans_v1_type_check check (
    correction_type in (
      'family_only',
      'family_plus_facets',
      'family_plus_roles',
      'full_taxonomy_review'
    )
  ),
  constraint fragrance_taxonomy_correction_plans_v1_confidence_check check (
    confidence in ('high', 'medium', 'low')
  ),
  constraint fragrance_taxonomy_correction_plans_v1_future_execution_check check (
    future_execution_recommendation in (
      'future_family_only_update',
      'future_family_and_facets_update',
      'future_family_and_roles_update',
      'manual_full_taxonomy_review'
    )
  )
);

create index if not exists fragrance_taxonomy_correction_plans_v1_fragrance_idx
  on public.fragrance_taxonomy_correction_plans_v1 (fragrance_id);

create index if not exists fragrance_taxonomy_correction_plans_v1_status_idx
  on public.fragrance_taxonomy_correction_plans_v1 (plan_status);

create index if not exists fragrance_taxonomy_correction_plans_v1_lane_idx
  on public.fragrance_taxonomy_correction_plans_v1 (source_lane);

create index if not exists fragrance_taxonomy_correction_plans_v1_created_idx
  on public.fragrance_taxonomy_correction_plans_v1 (created_at desc);

create unique index if not exists fragrance_taxonomy_correction_plans_v1_one_active_idx
  on public.fragrance_taxonomy_correction_plans_v1 (fragrance_id)
  where superseded_at is null and plan_status = 'planned';

drop trigger if exists fragrance_taxonomy_correction_plans_v1_touch_updated_at
  on public.fragrance_taxonomy_correction_plans_v1;

create trigger fragrance_taxonomy_correction_plans_v1_touch_updated_at
before update on public.fragrance_taxonomy_correction_plans_v1
for each row
execute function public.set_updated_at_v1();

alter table public.fragrance_taxonomy_correction_plans_v1 enable row level security;

revoke all on public.fragrance_taxonomy_correction_plans_v1 from public, anon, authenticated;
grant select, insert, update on public.fragrance_taxonomy_correction_plans_v1 to service_role;

comment on table public.fragrance_taxonomy_correction_plans_v1 is
  'Auditable exact-id correction-plan records for final taxonomy cleanup. These rows are operational plans only: they do not mutate public.fragrances, do not update final taxonomy, do not accept proposals, and do not refresh the queue or performance state.';

comment on column public.fragrance_taxonomy_correction_plans_v1.current_taxonomy_snapshot is
  'Captured final-taxonomy snapshot at plan creation time. It preserves the current review, facets, roles, and counts for later operator comparison without overwriting the live final taxonomy.';

comment on column public.fragrance_taxonomy_correction_plans_v1.evidence_summary is
  'Compact operator-facing rationale for why the current taxonomy looks wrong and why the proposed correction is stronger. It is audit memory only, not source truth.';

create or replace view public.fragrance_taxonomy_correction_plan_latest_v1
with (security_invoker = true)
as
select
  ranked.fragrance_id,
  ranked.id as latest_plan_id,
  ranked.plan_status,
  ranked.correction_type,
  ranked.actor_label,
  ranked.confidence,
  ranked.source_lane,
  ranked.current_legacy_family_key,
  ranked.current_universal_family_key,
  ranked.current_facets,
  ranked.current_roles,
  ranked.current_taxonomy_snapshot,
  ranked.queue_snapshot,
  ranked.source_snapshot,
  ranked.proposed_universal_family_key,
  ranked.proposed_facets,
  ranked.proposed_roles,
  ranked.correction_reason,
  ranked.evidence_summary,
  ranked.future_execution_recommendation,
  ranked.created_at,
  ranked.updated_at,
  ranked.applied_at,
  ranked.superseded_at,
  ranked.supersedes_plan_id
from (
  select
    p.*,
    row_number() over (
      partition by p.fragrance_id
      order by p.created_at desc, p.id desc
    ) as rn
  from public.fragrance_taxonomy_correction_plans_v1 p
  where p.superseded_at is null
    and p.plan_status <> 'superseded'
) ranked
where ranked.rn = 1;

revoke all on public.fragrance_taxonomy_correction_plan_latest_v1 from public, anon, authenticated;
grant select on public.fragrance_taxonomy_correction_plan_latest_v1 to service_role;

comment on view public.fragrance_taxonomy_correction_plan_latest_v1 is
  'Latest active correction-plan record per fragrance. This view is internal-only and exposes planning state without applying corrections.';

create or replace function public.create_fragrance_taxonomy_correction_plans_v1(
  p_plans jsonb,
  p_actor_label text default 'codex_taxonomy_correction_plan_v1',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_actor_label text := coalesce(nullif(btrim(p_actor_label), ''), 'codex_taxonomy_correction_plan_v1');
  v_requested_count integer := 0;
  v_picked_count integer := 0;
  v_eligible_count integer := 0;
  v_would_create_count integer := 0;
  v_created_count integer := 0;
  v_rejected_count integer := 0;
  v_skipped_count integer := 0;
  v_max_ids constant integer := 25;
  v_results jsonb := '[]'::jsonb;
  v_invalid_family_keys text[] := array[]::text[];
  v_invalid_facet_keys text[] := array[]::text[];
  v_invalid_role_keys text[] := array[]::text[];
  v_result_status text;
  v_blocker_reason text;
  v_existing_plan_id uuid;
  v_created_plan_id uuid;
  v_proposed_family_key text;
  v_proposed_facet_keys text[];
  v_missing_facet_keys text[];
  v_proposed_roles jsonb;
  v_proposed_role_keys text[];
  v_missing_role_keys text[];
  v_role_rows_invalid_count integer;
  v_role_rows_count integer;
  v_role_distinct_priority_count integer;
  v_role_distinct_key_count integer;
  v_queue_snapshot jsonb;
  v_source_snapshot jsonb;
  v_current_taxonomy_snapshot jsonb;
  v_evidence_summary jsonb;
  v_future_execution_recommendation text;
  v_row record;
begin
  if p_plans is null or jsonb_typeof(p_plans) <> 'array' then
    raise exception 'create_fragrance_taxonomy_correction_plans_v1 requires a non-empty jsonb array of plan objects';
  end if;

  v_requested_count := jsonb_array_length(p_plans);

  if v_requested_count = 0 then
    raise exception 'create_fragrance_taxonomy_correction_plans_v1 requires at least one plan object';
  end if;

  if v_requested_count > v_max_ids then
    raise exception 'create_fragrance_taxonomy_correction_plans_v1 accepts at most % plan objects per call', v_max_ids;
  end if;

  for v_row in
    with requested_raw as (
      select
        value as plan_obj,
        ordinality::integer as input_ordinal
      from jsonb_array_elements(p_plans) with ordinality
    ),
    requested as (
      select
        rr.input_ordinal,
        rr.plan_obj,
        case
          when coalesce(rr.plan_obj->>'fragrance_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (rr.plan_obj->>'fragrance_id')::uuid
          else null
        end as fragrance_id,
        lower(coalesce(nullif(btrim(rr.plan_obj->>'correction_type'), ''), '')) as correction_type,
        lower(coalesce(nullif(btrim(rr.plan_obj->>'proposed_family'), ''), '')) as proposed_family,
        case
          when jsonb_typeof(rr.plan_obj->'proposed_facets') = 'array'
            then rr.plan_obj->'proposed_facets'
          else '[]'::jsonb
        end as proposed_facets,
        case
          when jsonb_typeof(rr.plan_obj->'proposed_roles') = 'array'
            then rr.plan_obj->'proposed_roles'
          else '[]'::jsonb
        end as proposed_roles,
        lower(coalesce(nullif(btrim(rr.plan_obj->>'confidence'), ''), '')) as confidence,
        coalesce(nullif(btrim(rr.plan_obj->>'correction_reason'), ''), '') as correction_reason,
        case
          when jsonb_typeof(rr.plan_obj->'evidence_summary') = 'object'
            then rr.plan_obj->'evidence_summary'
          else '{}'::jsonb
        end as evidence_summary,
        lower(coalesce(nullif(btrim(rr.plan_obj->>'future_execution_recommendation'), ''), '')) as future_execution_recommendation
      from requested_raw rr
    ),
    duplicate_counts as (
      select fragrance_id, count(*)::integer as request_count
      from requested
      where fragrance_id is not null
      group by fragrance_id
    ),
    current_facets as (
      select
        ff.fragrance_id,
        jsonb_agg(
          jsonb_build_object(
            'facet_key', ff.facet_key,
            'confidence', ff.confidence,
            'evidence_source', ff.evidence_source
          )
          order by ff.facet_key
        ) as current_facets,
        count(*)::integer as facet_count
      from public.fragrance_facets_v1 ff
      group by ff.fragrance_id
    ),
    current_roles as (
      select
        wr.fragrance_id,
        jsonb_agg(
          jsonb_build_object(
            'role_key', wr.role_key,
            'role_priority', wr.role_priority,
            'confidence', wr.confidence,
            'evidence_source', wr.evidence_source
          )
          order by wr.role_priority, wr.role_key
        ) as current_roles,
        count(*)::integer as role_count
      from public.fragrance_wardrobe_roles_v1 wr
      group by wr.fragrance_id
    ),
    review_rows as (
      select
        tr.fragrance_id,
        tr.legacy_family_key,
        tr.universal_equivalent,
        tr.confidence as review_confidence,
        tr.review_status,
        tr.evidence_source as review_evidence_source,
        tr.evidence_json,
        tr.reviewed_by,
        case
          when tr.evidence_source = 'taxonomy_proposal_acceptance_v1_provider_promoted'
            or coalesce(tr.evidence_json->>'classifier_model_version', '') = 'taxonomy_classifier_proposal_v1_provider_promoted_2026_05_28'
            or coalesce(tr.evidence_json->>'evidence_basis', '') = 'provider_promoted_notes_only_queue_routed'
            then 'provider_promoted'
          when tr.evidence_source = 'taxonomy_proposal_acceptance_v1_official_notes_only'
            or coalesce(tr.evidence_json->>'classifier_model_version', '') = 'taxonomy_classifier_proposal_v1_official_notes_only_2026_05_28'
            then 'official_notes_only'
          when tr.evidence_source = 'taxonomy_proposal_acceptance_v4_official_source_queue'
            or coalesce(tr.evidence_json->>'classifier_model_version', '') in (
              'taxonomy_classifier_proposal_v4_official_source_queue_2026_05_25',
              'taxonomy_classifier_proposal_v3_official_source_backfill_2026_05_25'
            )
            or tr.evidence_source = 'alexandria_official_source_enrichment + manual taxonomy compatibility review'
            then 'official_pyramid'
          when coalesce(tr.evidence_json->>'classifier_model_version', '') = 'taxonomy_classifier_proposal_v2_provenance_accepted_2026_05_24'
            or tr.evidence_source = 'taxonomy_proposal_acceptance_v2'
            then 'provenance'
          else 'older_or_generic'
        end as source_lane
      from public.fragrance_taxonomy_review_v1 tr
    ),
    active_plans as (
      select
        p.fragrance_id,
        p.id as active_plan_id
      from public.fragrance_taxonomy_correction_plans_v1 p
      where p.superseded_at is null
        and p.plan_status = 'planned'
    )
    select
      r.input_ordinal,
      r.plan_obj,
      r.fragrance_id,
      r.correction_type,
      r.proposed_family,
      r.proposed_facets,
      r.proposed_roles,
      r.confidence,
      r.correction_reason,
      r.evidence_summary,
      r.future_execution_recommendation,
      coalesce(dc.request_count, 0) as request_count,
      f.id as found_fragrance_id,
      f.name,
      f.brand,
      f.family_key as current_legacy_family_key,
      f.notes,
      f.accords,
      f.top_notes,
      f.heart_notes,
      f.base_notes,
      f.source_url,
      f.source_confidence,
      rr.legacy_family_key as review_legacy_family_key,
      rr.universal_equivalent as current_universal_family_key,
      rr.review_confidence,
      rr.review_status,
      rr.review_evidence_source,
      rr.evidence_json as review_evidence_json,
      rr.reviewed_by,
      rr.source_lane,
      q.queue_state,
      q.queue_lane,
      q.recommended_next_action,
      q.blocker_reason,
      q.evidence_quality_state,
      q.product_priority_score,
      q.product_priority_reason,
      q.queue_model_version,
      q.source_queue_model_version,
      q.evidence_summary as queue_evidence_summary,
      q.source_snapshot_summary,
      coalesce(cf.current_facets, '[]'::jsonb) as current_facets,
      coalesce(cf.facet_count, 0) as current_facet_count,
      coalesce(cr.current_roles, '[]'::jsonb) as current_roles,
      coalesce(cr.role_count, 0) as current_role_count,
      coalesce(ap.active_plan_id, null) as active_plan_id
    from requested r
    left join duplicate_counts dc
      on dc.fragrance_id = r.fragrance_id
    left join public.fragrances f
      on f.id = r.fragrance_id
    left join review_rows rr
      on rr.fragrance_id = r.fragrance_id
    left join public.taxonomy_operationalization_queue_current_v1 q
      on q.fragrance_id = r.fragrance_id
    left join current_facets cf
      on cf.fragrance_id = r.fragrance_id
    left join current_roles cr
      on cr.fragrance_id = r.fragrance_id
    left join active_plans ap
      on ap.fragrance_id = r.fragrance_id
    order by r.input_ordinal
  loop
    v_picked_count := v_picked_count + 1;
    v_result_status := null;
    v_blocker_reason := null;
    v_existing_plan_id := v_row.active_plan_id;
    v_created_plan_id := null;
    v_proposed_family_key := null;
    v_proposed_facet_keys := array[]::text[];
    v_missing_facet_keys := array[]::text[];
    v_proposed_roles := '[]'::jsonb;
    v_proposed_role_keys := array[]::text[];
    v_missing_role_keys := array[]::text[];
    v_role_rows_invalid_count := 0;
    v_role_rows_count := 0;
    v_role_distinct_priority_count := 0;
    v_role_distinct_key_count := 0;
    v_queue_snapshot := '{}'::jsonb;
    v_source_snapshot := '{}'::jsonb;
    v_current_taxonomy_snapshot := '{}'::jsonb;
    v_evidence_summary := coalesce(v_row.evidence_summary, '{}'::jsonb);
    v_future_execution_recommendation := v_row.future_execution_recommendation;

    if v_row.fragrance_id is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'invalid_or_missing_fragrance_id';
    elsif v_row.request_count > 1 then
      v_result_status := 'rejected';
      v_blocker_reason := 'duplicate_requested_fragrance_id';
    elsif v_row.found_fragrance_id is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'fragrance_not_found';
    elsif v_row.correction_type not in (
      'family_only',
      'family_plus_facets',
      'family_plus_roles',
      'full_taxonomy_review'
    ) then
      v_result_status := 'rejected';
      v_blocker_reason := 'invalid_correction_type';
    elsif v_row.confidence not in ('high', 'medium', 'low') then
      v_result_status := 'rejected';
      v_blocker_reason := 'invalid_confidence';
    elsif v_row.correction_reason = '' then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_correction_reason';
    elsif v_row.review_status is null or v_row.current_universal_family_key is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_current_final_taxonomy';
    else
      select fkr.universal_equivalent
      into v_proposed_family_key
      from public.family_key_reference_v1 fkr
      where fkr.active is true
        and fkr.universal_equivalent = v_row.proposed_family
      limit 1;

      if v_proposed_family_key is null then
        v_result_status := 'rejected';
        v_blocker_reason := 'invalid_proposed_family';
        if v_row.proposed_family <> '' and not (v_row.proposed_family = any (v_invalid_family_keys)) then
          v_invalid_family_keys := array_append(v_invalid_family_keys, v_row.proposed_family);
        end if;
      elsif v_proposed_family_key = v_row.current_universal_family_key then
        v_result_status := 'rejected';
        v_blocker_reason := 'proposed_family_matches_current_final_family';
      end if;
    end if;

    if v_result_status is null then
      select
        coalesce(array_agg(distinct facet_key order by facet_key), array[]::text[])
      into v_proposed_facet_keys
      from (
        select lower(nullif(btrim(value), '')) as facet_key
        from jsonb_array_elements_text(v_row.proposed_facets)
      ) facets
      where facet_key is not null;

      select
        coalesce(array_agg(input_facets.facet_key order by input_facets.facet_key), array[]::text[])
      into v_missing_facet_keys
      from (
        select facet_key
        from unnest(v_proposed_facet_keys) facet_key
      ) input_facets
      left join public.facet_key_reference_v1 ref
        on ref.facet_key = input_facets.facet_key
       and ref.active is true
      where ref.facet_key is null;

      if coalesce(array_length(v_missing_facet_keys, 1), 0) > 0 then
        v_result_status := 'rejected';
        v_blocker_reason := 'invalid_proposed_facets';
        select array_agg(distinct x order by x)
        into v_invalid_facet_keys
        from (
          select unnest(v_invalid_facet_keys || v_missing_facet_keys) as x
        ) merged;
      end if;
    end if;

    if v_result_status is null then
      with raw_roles as (
        select
          lower(nullif(btrim(role_obj->>'role_key'), '')) as role_key,
          case
            when coalesce(role_obj->>'role_priority', '') ~ '^[0-9]+$'
              then (role_obj->>'role_priority')::integer
            else null
          end as role_priority
        from jsonb_array_elements(v_row.proposed_roles) role_obj
      ),
      normalized as (
        select
          role_key,
          role_priority
        from raw_roles
        where role_key is not null
      )
      select
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'role_key', role_key,
              'role_priority', role_priority
            )
            order by role_priority, role_key
          ),
          '[]'::jsonb
        ) as normalized_roles,
        coalesce(array_agg(role_key order by role_priority, role_key), array[]::text[]) as role_keys,
        coalesce(count(*), 0)::integer as role_rows_count,
        coalesce(count(distinct role_priority), 0)::integer as distinct_priority_count,
        coalesce(count(distinct role_key), 0)::integer as distinct_key_count,
        (
          select count(*)
          from raw_roles
          where role_key is null
             or role_priority is null
             or role_priority <= 0
        )::integer as invalid_row_count
      into
        v_proposed_roles,
        v_proposed_role_keys,
        v_role_rows_count,
        v_role_distinct_priority_count,
        v_role_distinct_key_count,
        v_role_rows_invalid_count
      from normalized;

      select
        coalesce(array_agg(input_roles.role_key order by input_roles.role_key), array[]::text[])
      into v_missing_role_keys
      from (
        select role_key
        from unnest(v_proposed_role_keys) role_key
      ) input_roles
      left join public.wardrobe_role_reference_v1 ref
        on ref.role_key = input_roles.role_key
       and ref.active is true
      where ref.role_key is null;

      if v_role_rows_invalid_count > 0 then
        v_result_status := 'rejected';
        v_blocker_reason := 'invalid_proposed_roles';
      elsif coalesce(array_length(v_missing_role_keys, 1), 0) > 0 then
        v_result_status := 'rejected';
        v_blocker_reason := 'invalid_proposed_roles';
        select array_agg(distinct x order by x)
        into v_invalid_role_keys
        from (
          select unnest(v_invalid_role_keys || v_missing_role_keys) as x
        ) merged;
      elsif v_role_rows_count <> v_role_distinct_priority_count then
        v_result_status := 'rejected';
        v_blocker_reason := 'duplicate_role_priorities';
      elsif v_role_rows_count <> v_role_distinct_key_count then
        v_result_status := 'rejected';
        v_blocker_reason := 'duplicate_role_keys';
      end if;
    end if;

    if v_result_status is null then
      if v_row.correction_type = 'family_only'
         and (
           coalesce(jsonb_array_length(v_row.proposed_facets), 0) > 0
           or coalesce(jsonb_array_length(v_row.proposed_roles), 0) > 0
         ) then
        v_result_status := 'rejected';
        v_blocker_reason := 'family_only_plan_cannot_include_facets_or_roles';
      elsif v_row.correction_type = 'family_plus_facets'
            and coalesce(jsonb_array_length(v_row.proposed_facets), 0) = 0 then
        v_result_status := 'rejected';
        v_blocker_reason := 'family_plus_facets_requires_proposed_facets';
      elsif v_row.correction_type = 'family_plus_facets'
            and coalesce(jsonb_array_length(v_row.proposed_roles), 0) > 0 then
        v_result_status := 'rejected';
        v_blocker_reason := 'family_plus_facets_cannot_include_roles';
      elsif v_row.correction_type = 'family_plus_roles'
            and coalesce(jsonb_array_length(v_row.proposed_roles), 0) = 0 then
        v_result_status := 'rejected';
        v_blocker_reason := 'family_plus_roles_requires_proposed_roles';
      elsif v_row.correction_type = 'family_plus_roles'
            and coalesce(jsonb_array_length(v_row.proposed_facets), 0) > 0 then
        v_result_status := 'rejected';
        v_blocker_reason := 'family_plus_roles_cannot_include_facets';
      end if;
    end if;

    if v_result_status is null then
      v_future_execution_recommendation := coalesce(
        nullif(v_future_execution_recommendation, ''),
        case v_row.correction_type
          when 'family_only' then 'future_family_only_update'
          when 'family_plus_facets' then 'future_family_and_facets_update'
          when 'family_plus_roles' then 'future_family_and_roles_update'
          else 'manual_full_taxonomy_review'
        end
      );

      if v_future_execution_recommendation not in (
        'future_family_only_update',
        'future_family_and_facets_update',
        'future_family_and_roles_update',
        'manual_full_taxonomy_review'
      ) then
        v_result_status := 'rejected';
        v_blocker_reason := 'invalid_future_execution_recommendation';
      end if;
    end if;

    if v_result_status is null and v_existing_plan_id is not null then
      v_result_status := 'skipped';
      v_blocker_reason := 'existing_active_plan';
    end if;

    if v_result_status is null then
      v_queue_snapshot := jsonb_build_object(
        'queue_state', v_row.queue_state,
        'queue_lane', v_row.queue_lane,
        'recommended_next_action', v_row.recommended_next_action,
        'blocker_reason', v_row.blocker_reason,
        'evidence_quality_state', v_row.evidence_quality_state,
        'product_priority_score', v_row.product_priority_score,
        'product_priority_reason', v_row.product_priority_reason,
        'queue_model_version', v_row.queue_model_version,
        'source_queue_model_version', v_row.source_queue_model_version,
        'evidence_summary', coalesce(v_row.queue_evidence_summary, '{}'::jsonb),
        'source_snapshot_summary', coalesce(v_row.source_snapshot_summary, '{}'::jsonb)
      );

      v_source_snapshot := jsonb_build_object(
        'name', v_row.name,
        'brand', v_row.brand,
        'source_url', v_row.source_url,
        'source_confidence', v_row.source_confidence,
        'notes', coalesce(to_jsonb(v_row.notes), 'null'::jsonb),
        'accords', coalesce(to_jsonb(v_row.accords), 'null'::jsonb),
        'top_notes', coalesce(to_jsonb(v_row.top_notes), 'null'::jsonb),
        'heart_notes', coalesce(to_jsonb(v_row.heart_notes), 'null'::jsonb),
        'base_notes', coalesce(to_jsonb(v_row.base_notes), 'null'::jsonb)
      );

      v_current_taxonomy_snapshot := jsonb_build_object(
        'review',
        jsonb_build_object(
          'legacy_family_key', v_row.review_legacy_family_key,
          'universal_equivalent', v_row.current_universal_family_key,
          'confidence', v_row.review_confidence,
          'review_status', v_row.review_status,
          'evidence_source', v_row.review_evidence_source,
          'reviewed_by', v_row.reviewed_by,
          'evidence_json', coalesce(v_row.review_evidence_json, '{}'::jsonb)
        ),
        'facet_count', v_row.current_facet_count,
        'facets', coalesce(v_row.current_facets, '[]'::jsonb),
        'role_count', v_row.current_role_count,
        'roles', coalesce(v_row.current_roles, '[]'::jsonb)
      );

      v_evidence_summary := v_evidence_summary || jsonb_build_object(
        'current_review_confidence', v_row.review_confidence,
        'current_review_status', v_row.review_status,
        'current_family', v_row.current_universal_family_key,
        'proposed_family', v_proposed_family_key,
        'source_lane', v_row.source_lane,
        'queue_state', v_row.queue_state,
        'queue_lane', v_row.queue_lane
      );

      v_eligible_count := v_eligible_count + 1;

      if p_dry_run then
        v_result_status := 'would_create';
        v_would_create_count := v_would_create_count + 1;
      else
        insert into public.fragrance_taxonomy_correction_plans_v1 (
          fragrance_id,
          plan_status,
          correction_type,
          actor_label,
          confidence,
          source_lane,
          current_legacy_family_key,
          current_universal_family_key,
          current_facets,
          current_roles,
          current_taxonomy_snapshot,
          queue_snapshot,
          source_snapshot,
          proposed_universal_family_key,
          proposed_facets,
          proposed_roles,
          correction_reason,
          evidence_summary,
          future_execution_recommendation
        )
        values (
          v_row.fragrance_id,
          'planned',
          v_row.correction_type,
          v_actor_label,
          v_row.confidence,
          v_row.source_lane,
          coalesce(v_row.review_legacy_family_key, v_row.current_legacy_family_key),
          v_row.current_universal_family_key,
          coalesce(v_row.current_facets, '[]'::jsonb),
          coalesce(v_row.current_roles, '[]'::jsonb),
          v_current_taxonomy_snapshot,
          v_queue_snapshot,
          v_source_snapshot,
          v_proposed_family_key,
          to_jsonb(v_proposed_facet_keys),
          v_proposed_roles,
          v_row.correction_reason,
          v_evidence_summary,
          v_future_execution_recommendation
        )
        returning id into v_created_plan_id;

        v_result_status := 'created';
        v_created_count := v_created_count + 1;
      end if;
    end if;

    if v_result_status = 'rejected' then
      v_rejected_count := v_rejected_count + 1;
    elsif v_result_status = 'skipped' then
      v_skipped_count := v_skipped_count + 1;
    end if;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'input_ordinal', v_row.input_ordinal,
        'fragrance_id', v_row.fragrance_id,
        'name', v_row.name,
        'brand', v_row.brand,
        'source_lane', v_row.source_lane,
        'current_family', v_row.current_universal_family_key,
        'proposed_family', coalesce(v_proposed_family_key, v_row.proposed_family),
        'correction_type', v_row.correction_type,
        'confidence', v_row.confidence,
        'future_execution_recommendation', coalesce(v_future_execution_recommendation, v_row.future_execution_recommendation),
        'status', v_result_status,
        'blocker_reason', v_blocker_reason,
        'active_plan_id', v_existing_plan_id,
        'created_plan_id', v_created_plan_id,
        'current_facet_count', v_row.current_facet_count,
        'current_role_count', v_row.current_role_count,
        'proposed_facets', to_jsonb(v_proposed_facet_keys),
        'proposed_roles', v_proposed_roles
      )
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'requested_count', v_requested_count,
    'picked_count', v_picked_count,
    'eligible_count', v_eligible_count,
    'would_create_count', v_would_create_count,
    'created_count', v_created_count,
    'rejected_count', v_rejected_count,
    'skipped_count', v_skipped_count,
    'invalid_family_keys', to_jsonb(coalesce(v_invalid_family_keys, array[]::text[])),
    'invalid_facet_keys', to_jsonb(coalesce(v_invalid_facet_keys, array[]::text[])),
    'invalid_role_keys', to_jsonb(coalesce(v_invalid_role_keys, array[]::text[])),
    'results', v_results
  );
end;
$function$;

revoke all on function public.create_fragrance_taxonomy_correction_plans_v1(jsonb, text, boolean) from public;
revoke all on function public.create_fragrance_taxonomy_correction_plans_v1(jsonb, text, boolean) from anon;
revoke all on function public.create_fragrance_taxonomy_correction_plans_v1(jsonb, text, boolean) from authenticated;
grant execute on function public.create_fragrance_taxonomy_correction_plans_v1(jsonb, text, boolean) to service_role;

comment on function public.create_fragrance_taxonomy_correction_plans_v1(jsonb, text, boolean) is
  'Creates or dry-runs exact-id taxonomy correction-plan records only. The helper never mutates public.fragrances, never rewrites final taxonomy, never refreshes the queue, and exists solely to prepare auditable future correction work.';

commit;
