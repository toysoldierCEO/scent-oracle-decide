begin;

create table if not exists public.fragrance_taxonomy_correction_audit_v1 (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.fragrance_taxonomy_correction_plans_v1(id),
  fragrance_id uuid not null references public.fragrances(id) on delete cascade,
  action text not null,
  result_status text not null,
  actor_label text not null,
  correction_type text not null,
  source_lane text not null,
  plan_snapshot jsonb not null default '{}'::jsonb,
  before_taxonomy_snapshot jsonb not null default '{}'::jsonb,
  after_taxonomy_snapshot jsonb not null default '{}'::jsonb,
  final_facets_written jsonb not null default '[]'::jsonb,
  final_roles_written jsonb not null default '[]'::jsonb,
  blocker_reason text null,
  created_at timestamptz not null default now(),
  constraint fragrance_taxonomy_correction_audit_v1_action_check check (
    action in ('apply')
  ),
  constraint fragrance_taxonomy_correction_audit_v1_result_check check (
    result_status in ('applied')
  )
);

comment on table public.fragrance_taxonomy_correction_audit_v1 is
  'Backend-only audit surface for exact-id taxonomy correction execution. It records live correction outcomes without mutating public.fragrances or exposing a client mutation path.';

comment on column public.fragrance_taxonomy_correction_audit_v1.before_taxonomy_snapshot is
  'Final taxonomy state before correction execution. Used to prove that the correction helper only changed approved target rows.';

comment on column public.fragrance_taxonomy_correction_audit_v1.after_taxonomy_snapshot is
  'Final taxonomy state after correction execution. Used to prove exactly which final taxonomy fields were changed by the helper.';

create unique index if not exists fragrance_taxonomy_correction_audit_v1_plan_idx
  on public.fragrance_taxonomy_correction_audit_v1 (plan_id);

create index if not exists fragrance_taxonomy_correction_audit_v1_fragrance_idx
  on public.fragrance_taxonomy_correction_audit_v1 (fragrance_id, created_at desc);

alter table public.fragrance_taxonomy_correction_audit_v1 enable row level security;

revoke all on public.fragrance_taxonomy_correction_audit_v1 from public, anon, authenticated;
grant select, insert, update, delete on public.fragrance_taxonomy_correction_audit_v1 to service_role;

create or replace function public.apply_fragrance_taxonomy_corrections_v1(
  p_plan_ids uuid[],
  p_actor_label text default 'codex_taxonomy_correction_execution_v1',
  p_dry_run boolean default true,
  p_allow_full_taxonomy_review boolean default false
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_actor_label text := coalesce(nullif(btrim(p_actor_label), ''), 'codex_taxonomy_correction_execution_v1');
  v_distinct_plan_ids uuid[];
  v_requested_count integer := 0;
  v_picked_count integer := 0;
  v_eligible_count integer := 0;
  v_would_apply_count integer := 0;
  v_applied_count integer := 0;
  v_rejected_count integer := 0;
  v_skipped_count integer := 0;
  v_max_ids constant integer := 25;
  v_results jsonb := '[]'::jsonb;
  v_invalid_family_keys text[] := array[]::text[];
  v_invalid_facet_keys text[] := array[]::text[];
  v_invalid_role_keys text[] := array[]::text[];
  v_result_status text;
  v_blocker_reason text;
  v_plan_confidence_numeric numeric;
  v_missing_facet_keys text[];
  v_missing_role_keys text[];
  v_proposed_facet_keys text[];
  v_proposed_role_keys text[];
  v_proposed_roles jsonb;
  v_role_rows_count integer;
  v_role_rows_invalid_count integer;
  v_role_distinct_priority_count integer;
  v_role_distinct_key_count integer;
  v_before_taxonomy_snapshot jsonb;
  v_after_taxonomy_snapshot jsonb;
  v_after_review_snapshot jsonb;
  v_after_facets_snapshot jsonb;
  v_after_roles_snapshot jsonb;
  v_after_review_evidence_json jsonb;
  v_final_facets_written jsonb;
  v_final_roles_written jsonb;
  v_plan_snapshot jsonb;
  v_audit_id uuid;
  v_row record;
begin
  select coalesce(array_agg(distinct plan_id order by plan_id), array[]::uuid[])
  into v_distinct_plan_ids
  from unnest(coalesce(p_plan_ids, array[]::uuid[])) as plan_id
  where plan_id is not null;

  v_requested_count := coalesce(cardinality(v_distinct_plan_ids), 0);

  if v_requested_count = 0 then
    raise exception 'apply_fragrance_taxonomy_corrections_v1 requires explicit non-empty plan ids';
  end if;

  if v_requested_count > v_max_ids then
    raise exception 'apply_fragrance_taxonomy_corrections_v1 accepts at most % plan ids per call', v_max_ids;
  end if;

  for v_row in
    with requested as (
      select unnest(v_distinct_plan_ids) as requested_plan_id
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
        ) as current_facets
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
        ) as current_roles
      from public.fragrance_wardrobe_roles_v1 wr
      group by wr.fragrance_id
    )
    select
      req.requested_plan_id,
      cp.id as plan_id,
      cp.fragrance_id,
      cp.plan_status,
      cp.correction_type,
      cp.confidence as plan_confidence_label,
      cp.source_lane,
      cp.current_legacy_family_key,
      cp.current_universal_family_key,
      cp.current_taxonomy_snapshot as plan_current_taxonomy_snapshot,
      cp.proposed_universal_family_key,
      cp.proposed_facets,
      cp.proposed_roles,
      cp.correction_reason,
      cp.evidence_summary as plan_evidence_summary,
      cp.future_execution_recommendation,
      cp.actor_label as plan_actor_label,
      cp.created_at as plan_created_at,
      cp.updated_at as plan_updated_at,
      cp.applied_at as plan_applied_at,
      cp.superseded_at,
      latest.latest_plan_id,
      f.name,
      f.brand,
      f.family_key as fragrance_family_key,
      f.source_url,
      f.source_confidence,
      f.top_notes,
      f.heart_notes,
      f.base_notes,
      f.updated_at as fragrance_updated_at,
      tr.legacy_family_key as review_legacy_family_key,
      tr.universal_equivalent as review_universal_equivalent,
      tr.confidence as review_confidence,
      tr.review_status,
      tr.evidence_source as review_evidence_source,
      tr.evidence_json as review_evidence_json,
      tr.reviewed_by,
      coalesce(cf.current_facets, '[]'::jsonb) as current_facets,
      coalesce(cr.current_roles, '[]'::jsonb) as current_roles,
      q.queue_state,
      q.queue_lane,
      q.recommended_next_action,
      q.blocker_reason as queue_blocker_reason
    from requested req
    left join public.fragrance_taxonomy_correction_plans_v1 cp
      on cp.id = req.requested_plan_id
    left join public.fragrance_taxonomy_correction_plan_latest_v1 latest
      on latest.fragrance_id = cp.fragrance_id
    left join public.fragrances f
      on f.id = cp.fragrance_id
    left join public.fragrance_taxonomy_review_v1 tr
      on tr.fragrance_id = cp.fragrance_id
    left join current_facets cf
      on cf.fragrance_id = cp.fragrance_id
    left join current_roles cr
      on cr.fragrance_id = cp.fragrance_id
    left join public.taxonomy_operationalization_queue_current_v1 q
      on q.fragrance_id = cp.fragrance_id
    order by coalesce(f.name, cp.id::text), req.requested_plan_id
  loop
    v_picked_count := v_picked_count + 1;
    v_result_status := null;
    v_blocker_reason := null;
    v_missing_facet_keys := array[]::text[];
    v_missing_role_keys := array[]::text[];
    v_proposed_facet_keys := array[]::text[];
    v_proposed_role_keys := array[]::text[];
    v_proposed_roles := '[]'::jsonb;
    v_role_rows_count := 0;
    v_role_rows_invalid_count := 0;
    v_role_distinct_priority_count := 0;
    v_role_distinct_key_count := 0;
    v_before_taxonomy_snapshot := '{}'::jsonb;
    v_after_taxonomy_snapshot := '{}'::jsonb;
    v_after_review_snapshot := '{}'::jsonb;
    v_after_facets_snapshot := '[]'::jsonb;
    v_after_roles_snapshot := '[]'::jsonb;
    v_after_review_evidence_json := '{}'::jsonb;
    v_final_facets_written := '[]'::jsonb;
    v_final_roles_written := '[]'::jsonb;
    v_plan_snapshot := '{}'::jsonb;
    v_audit_id := null;
    v_plan_confidence_numeric := case v_row.plan_confidence_label
      when 'high' then 0.90
      when 'medium' then 0.80
      else 0.70
    end;

    if v_row.plan_id is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'plan_not_found';
    elsif v_row.latest_plan_id is distinct from v_row.plan_id
       or v_row.plan_status <> 'planned'
       or v_row.superseded_at is not null then
      v_result_status := 'rejected';
      v_blocker_reason := 'plan_not_active_latest';
    elsif v_row.review_universal_equivalent is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_current_final_taxonomy';
    else
      v_before_taxonomy_snapshot := jsonb_build_object(
        'review',
        jsonb_build_object(
          'legacy_family_key', v_row.review_legacy_family_key,
          'universal_equivalent', v_row.review_universal_equivalent,
          'confidence', v_row.review_confidence,
          'review_status', v_row.review_status,
          'evidence_source', v_row.review_evidence_source,
          'reviewed_by', v_row.reviewed_by,
          'evidence_json', coalesce(v_row.review_evidence_json, '{}'::jsonb)
        ),
        'facet_count', jsonb_array_length(v_row.current_facets),
        'facets', v_row.current_facets,
        'role_count', jsonb_array_length(v_row.current_roles),
        'roles', v_row.current_roles
      );

      v_plan_snapshot := jsonb_build_object(
        'plan_id', v_row.plan_id,
        'fragrance_id', v_row.fragrance_id,
        'correction_type', v_row.correction_type,
        'source_lane', v_row.source_lane,
        'confidence', v_row.plan_confidence_label,
        'current_universal_family_key', v_row.current_universal_family_key,
        'proposed_universal_family_key', v_row.proposed_universal_family_key,
        'proposed_facets', coalesce(v_row.proposed_facets, '[]'::jsonb),
        'proposed_roles', coalesce(v_row.proposed_roles, '[]'::jsonb),
        'correction_reason', v_row.correction_reason,
        'evidence_summary', coalesce(v_row.plan_evidence_summary, '{}'::jsonb),
        'future_execution_recommendation', v_row.future_execution_recommendation,
        'plan_actor_label', v_row.plan_actor_label,
        'plan_created_at', v_row.plan_created_at,
        'plan_updated_at', v_row.plan_updated_at
      );

      if v_before_taxonomy_snapshot <> coalesce(v_row.plan_current_taxonomy_snapshot, '{}'::jsonb) then
        v_result_status := 'rejected';
        v_blocker_reason := 'current_taxonomy_no_longer_matches_plan_snapshot';
      elsif v_row.correction_type = 'full_taxonomy_review' and not p_allow_full_taxonomy_review then
        v_result_status := 'rejected';
        v_blocker_reason := 'manual_review_required';
      elsif v_row.correction_type not in ('family_only', 'family_plus_facets', 'family_plus_roles') then
        v_result_status := 'rejected';
        v_blocker_reason := 'unsupported_correction_type';
      elsif not exists (
        select 1
        from public.family_key_reference_v1 fkr
        where fkr.active is true
          and fkr.universal_equivalent = v_row.proposed_universal_family_key
      ) then
        v_result_status := 'rejected';
        v_blocker_reason := 'invalid_proposed_family';
        if v_row.proposed_universal_family_key is not null
           and not (v_row.proposed_universal_family_key = any (v_invalid_family_keys)) then
          v_invalid_family_keys := array_append(v_invalid_family_keys, v_row.proposed_universal_family_key);
        end if;
      elsif v_row.review_universal_equivalent = v_row.proposed_universal_family_key then
        v_result_status := 'rejected';
        v_blocker_reason := 'proposed_family_matches_current_final_family';
      end if;
    end if;

    if v_result_status is null then
      select
        coalesce(array_agg(distinct input_facets.facet_key order by input_facets.facet_key), array[]::text[])
      into v_proposed_facet_keys
      from (
        select lower(nullif(btrim(value), '')) as facet_key
        from jsonb_array_elements_text(coalesce(v_row.proposed_facets, '[]'::jsonb))
      ) input_facets
      where input_facets.facet_key is not null;

      select
        coalesce(array_agg(input_facets.facet_key order by input_facets.facet_key), array[]::text[])
      into v_missing_facet_keys
      from (
        select facet_key
        from unnest(v_proposed_facet_keys) as facet_key
      ) input_facets
      left join public.facet_key_reference_v1 ref
        on ref.facet_key = input_facets.facet_key
       and ref.active is true
      where ref.facet_key is null;

      if coalesce(array_length(v_missing_facet_keys, 1), 0) > 0 then
        v_result_status := 'rejected';
        v_blocker_reason := 'invalid_proposed_facets';
        select array_agg(distinct merged.x order by merged.x)
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
        from jsonb_array_elements(coalesce(v_row.proposed_roles, '[]'::jsonb)) role_obj
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
              'role_key', normalized.role_key,
              'role_priority', normalized.role_priority
            )
            order by normalized.role_priority, normalized.role_key
          ),
          '[]'::jsonb
        ) as normalized_roles,
        coalesce(array_agg(normalized.role_key order by normalized.role_priority, normalized.role_key), array[]::text[]) as role_keys,
        count(*)::integer as role_rows_count,
        count(distinct normalized.role_priority)::integer as distinct_priority_count,
        count(distinct normalized.role_key)::integer as distinct_key_count,
        (
          select count(*)::integer
          from raw_roles
          where role_key is null
             or role_priority is null
             or role_priority <= 0
        ) as invalid_row_count
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
        from unnest(v_proposed_role_keys) as role_key
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
        select array_agg(distinct merged.x order by merged.x)
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
        and (
          coalesce(array_length(v_proposed_facet_keys, 1), 0) = 0
          or coalesce(jsonb_array_length(v_row.proposed_roles), 0) > 0
        ) then
        v_result_status := 'rejected';
        v_blocker_reason := 'family_plus_facets_requires_facets_only';
      elsif v_row.correction_type = 'family_plus_roles'
        and (
          v_role_rows_count = 0
          or coalesce(jsonb_array_length(v_row.proposed_facets), 0) > 0
        ) then
        v_result_status := 'rejected';
        v_blocker_reason := 'family_plus_roles_requires_roles_only';
      end if;
    end if;

    if v_result_status is null then
      v_after_review_evidence_json := coalesce(v_row.review_evidence_json, '{}'::jsonb) || jsonb_build_object(
        'correction_plan_id', v_row.plan_id,
        'correction_actor_label', v_actor_label,
        'correction_type', v_row.correction_type,
        'correction_source_lane', v_row.source_lane,
        'correction_reason', v_row.correction_reason,
        'correction_future_execution_recommendation', v_row.future_execution_recommendation,
        'correction_plan_evidence_summary', coalesce(v_row.plan_evidence_summary, '{}'::jsonb),
        'prior_review_snapshot', v_before_taxonomy_snapshot->'review'
      );

      v_after_review_snapshot := jsonb_build_object(
        'legacy_family_key', v_row.review_legacy_family_key,
        'universal_equivalent', v_row.proposed_universal_family_key,
        'confidence', v_row.review_confidence,
        'review_status', v_row.review_status,
        'evidence_source', 'taxonomy_correction_execution_v1',
        'reviewed_by', v_actor_label,
        'evidence_json', v_after_review_evidence_json
      );

      if v_row.correction_type = 'family_plus_facets' then
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'facet_key', proposed.target_key,
              'confidence', coalesce(proposed.existing_confidence, v_plan_confidence_numeric),
              'evidence_source', coalesce(proposed.existing_evidence_source, 'taxonomy_correction_execution_v1')
            )
            order by proposed.target_key
          ),
          '[]'::jsonb
        )
        into v_after_facets_snapshot
        from (
          select
            target_key,
            (
              select (existing_facet->>'confidence')::numeric
              from jsonb_array_elements(v_row.current_facets) existing_facet
              where existing_facet->>'facet_key' = target_key
              limit 1
            ) as existing_confidence,
            (
              select existing_facet->>'evidence_source'
              from jsonb_array_elements(v_row.current_facets) existing_facet
              where existing_facet->>'facet_key' = target_key
              limit 1
            ) as existing_evidence_source
          from unnest(v_proposed_facet_keys) as target_key
        ) proposed;

        v_final_facets_written := v_after_facets_snapshot;
      else
        v_after_facets_snapshot := v_row.current_facets;
        v_final_facets_written := '[]'::jsonb;
      end if;

      if v_row.correction_type = 'family_plus_roles' then
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'role_key', proposed.role_key,
              'role_priority', proposed.role_priority,
              'confidence', coalesce(proposed.existing_confidence, v_plan_confidence_numeric),
              'evidence_source', 'taxonomy_correction_execution_v1'
            )
            order by proposed.role_priority, proposed.role_key
          ),
          '[]'::jsonb
        )
        into v_after_roles_snapshot
        from (
          select
            role_obj->>'role_key' as role_key,
            (role_obj->>'role_priority')::integer as role_priority,
            (
              select (existing_role->>'confidence')::numeric
              from jsonb_array_elements(v_row.current_roles) existing_role
              where existing_role->>'role_key' = role_obj->>'role_key'
              limit 1
            ) as existing_confidence
          from jsonb_array_elements(v_proposed_roles) role_obj
        ) proposed;

        v_final_roles_written := v_after_roles_snapshot;
      else
        v_after_roles_snapshot := v_row.current_roles;
        v_final_roles_written := '[]'::jsonb;
      end if;

      v_after_taxonomy_snapshot := jsonb_build_object(
        'review',
        v_after_review_snapshot,
        'facet_count', jsonb_array_length(v_after_facets_snapshot),
        'facets', v_after_facets_snapshot,
        'role_count', jsonb_array_length(v_after_roles_snapshot),
        'roles', v_after_roles_snapshot
      );

      v_eligible_count := v_eligible_count + 1;

      if p_dry_run then
        v_result_status := 'would_apply';
        v_would_apply_count := v_would_apply_count + 1;
      else
        update public.fragrance_taxonomy_review_v1
        set universal_equivalent = v_row.proposed_universal_family_key,
            evidence_source = 'taxonomy_correction_execution_v1',
            evidence_json = v_after_review_evidence_json,
            reviewed_by = v_actor_label,
            updated_at = now()
        where fragrance_id = v_row.fragrance_id;

        if v_row.correction_type = 'family_plus_facets' then
          delete from public.fragrance_facets_v1
          where fragrance_id = v_row.fragrance_id
            and not (facet_key = any (v_proposed_facet_keys));

          insert into public.fragrance_facets_v1 (
            fragrance_id,
            facet_key,
            confidence,
            evidence_source,
            evidence_json,
            updated_at
          )
          select
            v_row.fragrance_id,
            proposed.target_key,
            v_plan_confidence_numeric,
            'taxonomy_correction_execution_v1',
            jsonb_build_object(
              'correction_plan_id', v_row.plan_id,
              'correction_actor_label', v_actor_label,
              'correction_type', v_row.correction_type,
              'correction_reason', v_row.correction_reason
            ),
            now()
          from unnest(v_proposed_facet_keys) as proposed(target_key)
          where not exists (
            select 1
            from public.fragrance_facets_v1 existing_ff
            where existing_ff.fragrance_id = v_row.fragrance_id
              and existing_ff.facet_key = proposed.target_key
          );
        elsif v_row.correction_type = 'family_plus_roles' then
          delete from public.fragrance_wardrobe_roles_v1
          where fragrance_id = v_row.fragrance_id
            and not (role_key = any (v_proposed_role_keys));

          insert into public.fragrance_wardrobe_roles_v1 (
            fragrance_id,
            role_key,
            role_priority,
            confidence,
            evidence_source,
            evidence_json,
            updated_at
          )
          select
            v_row.fragrance_id,
            role_obj->>'role_key',
            (role_obj->>'role_priority')::integer,
            coalesce(
              (
                select (existing_role->>'confidence')::numeric
                from jsonb_array_elements(v_row.current_roles) existing_role
                where existing_role->>'role_key' = role_obj->>'role_key'
                limit 1
              ),
              v_plan_confidence_numeric
            ),
            'taxonomy_correction_execution_v1',
            jsonb_build_object(
              'correction_plan_id', v_row.plan_id,
              'correction_actor_label', v_actor_label,
              'correction_type', v_row.correction_type,
              'correction_reason', v_row.correction_reason
            ),
            now()
          from jsonb_array_elements(v_proposed_roles) role_obj
          on conflict (fragrance_id, role_key) do update
          set role_priority = excluded.role_priority,
              confidence = excluded.confidence,
              evidence_source = excluded.evidence_source,
              evidence_json = excluded.evidence_json,
              updated_at = excluded.updated_at;
        end if;

        update public.fragrance_taxonomy_correction_plans_v1
        set plan_status = 'applied',
            applied_at = now()
        where id = v_row.plan_id;

        insert into public.fragrance_taxonomy_correction_audit_v1 (
          plan_id,
          fragrance_id,
          action,
          result_status,
          actor_label,
          correction_type,
          source_lane,
          plan_snapshot,
          before_taxonomy_snapshot,
          after_taxonomy_snapshot,
          final_facets_written,
          final_roles_written,
          blocker_reason
        )
        values (
          v_row.plan_id,
          v_row.fragrance_id,
          'apply',
          'applied',
          v_actor_label,
          v_row.correction_type,
          v_row.source_lane,
          v_plan_snapshot,
          v_before_taxonomy_snapshot,
          v_after_taxonomy_snapshot,
          v_final_facets_written,
          v_final_roles_written,
          null
        )
        returning id into v_audit_id;

        v_result_status := 'applied';
        v_applied_count := v_applied_count + 1;
      end if;
    end if;

    if v_result_status = 'rejected' then
      v_rejected_count := v_rejected_count + 1;
    elsif v_result_status = 'skipped' then
      v_skipped_count := v_skipped_count + 1;
    end if;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'requested_plan_id', v_row.requested_plan_id,
        'plan_id', v_row.plan_id,
        'fragrance_id', v_row.fragrance_id,
        'name', v_row.name,
        'brand', v_row.brand,
        'correction_type', v_row.correction_type,
        'source_lane', v_row.source_lane,
        'current_family', v_row.review_universal_equivalent,
        'proposed_family', v_row.proposed_universal_family_key,
        'current_facets', v_row.current_facets,
        'proposed_facets', coalesce(v_row.proposed_facets, '[]'::jsonb),
        'current_roles', v_row.current_roles,
        'proposed_roles', coalesce(v_row.proposed_roles, '[]'::jsonb),
        'status', v_result_status,
        'blocker_reason', v_blocker_reason,
        'audit_id', v_audit_id,
        'before_taxonomy_snapshot', v_before_taxonomy_snapshot,
        'after_taxonomy_snapshot', v_after_taxonomy_snapshot
      )
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'requested_count', v_requested_count,
    'picked_count', v_picked_count,
    'eligible_count', v_eligible_count,
    'would_apply_count', v_would_apply_count,
    'applied_count', v_applied_count,
    'rejected_count', v_rejected_count,
    'skipped_count', v_skipped_count,
    'invalid_family_keys', to_jsonb(coalesce(v_invalid_family_keys, array[]::text[])),
    'invalid_facet_keys', to_jsonb(coalesce(v_invalid_facet_keys, array[]::text[])),
    'invalid_role_keys', to_jsonb(coalesce(v_invalid_role_keys, array[]::text[])),
    'results', v_results
  );
end;
$function$;

revoke all on function public.apply_fragrance_taxonomy_corrections_v1(uuid[], text, boolean, boolean) from public;
revoke all on function public.apply_fragrance_taxonomy_corrections_v1(uuid[], text, boolean, boolean) from anon;
revoke all on function public.apply_fragrance_taxonomy_corrections_v1(uuid[], text, boolean, boolean) from authenticated;
grant execute on function public.apply_fragrance_taxonomy_corrections_v1(uuid[], text, boolean, boolean) to service_role;

comment on function public.apply_fragrance_taxonomy_corrections_v1(uuid[], text, boolean, boolean) is
  'Applies exact-id taxonomy correction plans with dry-run support and audit. The helper never mutates public.fragrances, never changes family_key, never refreshes queue or performance internally, and rejects manual-only full_taxonomy_review plans unless explicitly allowed.';

commit;
