begin;

create table if not exists public.fragrance_taxonomy_proposal_acceptance_audit_v1 (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid references public.fragrance_taxonomy_proposals_v1 (id) on delete set null,
  fragrance_id uuid not null references public.fragrances (id) on delete cascade,
  action text not null,
  result_status text not null,
  actor_label text not null,
  classifier_model_version text not null,
  proposal_snapshot jsonb not null default '{}'::jsonb,
  final_facets_written jsonb not null default '[]'::jsonb,
  final_roles_written jsonb not null default '[]'::jsonb,
  final_review_snapshot jsonb not null default '{}'::jsonb,
  before_taxonomy_snapshot jsonb not null default '{}'::jsonb,
  after_taxonomy_snapshot jsonb not null default '{}'::jsonb,
  blocker_reason text,
  created_at timestamptz not null default now(),
  constraint fragrance_taxonomy_proposal_acceptance_audit_v1_action_check check (
    action = any (array['preview'::text, 'accept'::text, 'reject'::text, 'blocked'::text])
  ),
  constraint fragrance_taxonomy_proposal_acceptance_audit_v1_result_check check (
    result_status = any (array['preview'::text, 'accepted'::text, 'rejected'::text, 'blocked'::text, 'failed'::text])
  )
);

comment on table public.fragrance_taxonomy_proposal_acceptance_audit_v1 is
  'Backend-only audit surface for explicit classifier proposal acceptance. It records preview/acceptance outcomes without exposing a public mutation path.';

comment on column public.fragrance_taxonomy_proposal_acceptance_audit_v1.proposal_snapshot is
  'Immutable snapshot of the classifier proposal and evidence summaries used by the acceptance gate.';

comment on column public.fragrance_taxonomy_proposal_acceptance_audit_v1.before_taxonomy_snapshot is
  'Final taxonomy state before acceptance. Used to prove this gate does not overwrite existing taxonomy truth.';

comment on column public.fragrance_taxonomy_proposal_acceptance_audit_v1.after_taxonomy_snapshot is
  'Final taxonomy state after acceptance. Used to prove exactly which final taxonomy rows were written.';

create index if not exists fragrance_taxonomy_proposal_acceptance_audit_v1_fragrance_idx
  on public.fragrance_taxonomy_proposal_acceptance_audit_v1 (fragrance_id, created_at desc);

create index if not exists fragrance_taxonomy_proposal_acceptance_audit_v1_proposal_idx
  on public.fragrance_taxonomy_proposal_acceptance_audit_v1 (proposal_id, created_at desc);

alter table public.fragrance_taxonomy_proposal_acceptance_audit_v1 enable row level security;

revoke all on public.fragrance_taxonomy_proposal_acceptance_audit_v1 from public, anon, authenticated;
grant select, insert, update, delete on public.fragrance_taxonomy_proposal_acceptance_audit_v1 to service_role;

create or replace function public.accept_fragrance_taxonomy_proposals_v1(
  p_fragrance_ids uuid[],
  p_actor_label text default 'codex_accept_three_classifier_proposals',
  p_dry_run boolean default true,
  p_min_confidence numeric default 0.70,
  p_model_version text default 'taxonomy_classifier_proposal_v1_rule_based_2026_05_23'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_distinct_ids uuid[];
  v_missing_ids uuid[];
  v_requested_count integer := coalesce(array_length(p_fragrance_ids, 1), 0);
  v_distinct_requested_count integer := 0;
  v_picked_count integer := 0;
  v_eligible_count integer := 0;
  v_would_accept_count integer := 0;
  v_accepted_count integer := 0;
  v_rejected_count integer := 0;
  v_max_ids constant integer := 10;
  v_actor_label text := coalesce(nullif(trim(p_actor_label), ''), 'codex_accept_three_classifier_proposals');
  v_results jsonb := '[]'::jsonb;
  v_result_status text;
  v_blocker_reason text;
  v_missing_facet_keys text[];
  v_missing_role_keys text[];
  v_facet_payload_count integer;
  v_role_payload_count integer;
  v_before_taxonomy_snapshot jsonb;
  v_after_taxonomy_snapshot jsonb;
  v_proposal_snapshot jsonb;
  v_final_facets_written jsonb;
  v_final_roles_written jsonb;
  v_final_review_snapshot jsonb;
  v_audit_id uuid;
  r record;
begin
  if p_fragrance_ids is null or v_requested_count = 0 then
    raise exception 'p_fragrance_ids must be a non-empty explicit uuid[]';
  end if;

  select coalesce(array_agg(distinct x order by x), array[]::uuid[])
  into v_distinct_ids
  from unnest(p_fragrance_ids) as x
  where x is not null;

  v_distinct_requested_count := coalesce(array_length(v_distinct_ids, 1), 0);

  if v_distinct_requested_count = 0 then
    raise exception 'p_fragrance_ids must contain at least one non-null uuid';
  end if;

  if v_distinct_requested_count > v_max_ids then
    raise exception 'p_fragrance_ids exceeded max batch size of %', v_max_ids;
  end if;

  if p_min_confidence is null or p_min_confidence < 0 or p_min_confidence > 1 then
    raise exception 'p_min_confidence must be between 0 and 1';
  end if;

  if p_model_version is null or trim(p_model_version) = '' then
    raise exception 'p_model_version must be provided';
  end if;

  select coalesce(array_agg(id order by id), array[]::uuid[])
  into v_missing_ids
  from unnest(v_distinct_ids) as id
  where not exists (
    select 1
    from public.fragrances f
    where f.id = id
  );

  for r in
    select
      ids.id as input_id,
      f.id as fragrance_id,
      f.name,
      f.brand,
      f.family_key,
      coalesce(array_length(f.notes, 1), 0) as canonical_notes_count,
      coalesce(array_length(f.accords, 1), 0) as canonical_accords_count,
      f.notes,
      f.accords,
      f.source_url as fragrance_source_url,
      f.source_confidence as fragrance_source_confidence,
      f.updated_at as fragrance_updated_at,
      p.id as proposal_id,
      p.proposal_status,
      p.proposed_universal_family_key,
      p.proposed_facets,
      p.proposed_wardrobe_roles,
      p.proposed_confidence,
      p.proposed_review_status,
      p.blocker_reason as proposal_blocker_reason,
      p.evidence_summary,
      p.source_summary,
      p.performance_summary,
      p.classifier_model_version,
      p.source_model_version,
      p.queue_model_version,
      p.created_by as proposal_created_by,
      p.created_at as proposal_created_at,
      p.updated_at as proposal_updated_at,
      coalesce(tes.evidence_quality_state, '') as evidence_quality_state,
      coalesce(tes.has_promoted_text_evidence, false) as has_promoted_text_evidence,
      coalesce(tes.has_rejected_match, false) as has_rejected_match,
      coalesce(tes.has_revert_history, false) as has_revert_history,
      coalesce(tes.notes_count, 0) as evidence_notes_count,
      coalesce(tes.accords_count, 0) as evidence_accords_count,
      coalesce(tes.facet_count, 0) as evidence_facet_count,
      coalesce(tes.role_count, 0) as evidence_role_count,
      coalesce(tes.has_taxonomy_review, false) as evidence_has_taxonomy_review,
      coalesce(toq.queue_state, '') as queue_state,
      coalesce(toq.queue_lane, '') as queue_lane,
      coalesce((select count(*) from public.fragrance_facets_v1 ff where ff.fragrance_id = f.id), 0) as final_facet_count,
      coalesce((select count(*) from public.fragrance_wardrobe_roles_v1 wr where wr.fragrance_id = f.id), 0) as final_role_count,
      coalesce((select count(*) from public.fragrance_taxonomy_review_v1 tr where tr.fragrance_id = f.id), 0) as final_review_count
    from unnest(v_distinct_ids) ids(id)
    join public.fragrances f
      on f.id = ids.id
    left join public.fragrance_taxonomy_proposals_v1 p
      on p.fragrance_id = f.id
     and p.classifier_model_version = p_model_version
    left join public.taxonomy_evidence_status_v1 tes
      on tes.fragrance_id = f.id
    left join public.taxonomy_operationalization_queue_v1 toq
      on toq.fragrance_id = f.id
    order by f.name
  loop
    v_picked_count := v_picked_count + 1;
    v_result_status := null;
    v_blocker_reason := null;
    v_missing_facet_keys := array[]::text[];
    v_missing_role_keys := array[]::text[];
    v_facet_payload_count := 0;
    v_role_payload_count := 0;
    v_final_facets_written := '[]'::jsonb;
    v_final_roles_written := '[]'::jsonb;
    v_final_review_snapshot := '{}'::jsonb;
    v_audit_id := null;

    select jsonb_build_object(
      'facet_count', count(*),
      'facets', coalesce(
        jsonb_agg(
          jsonb_build_object(
            'facet_key', ff.facet_key,
            'confidence', ff.confidence,
            'evidence_source', ff.evidence_source
          )
          order by ff.facet_key
        ) filter (where ff.facet_key is not null),
        '[]'::jsonb
      )
    )
    into v_before_taxonomy_snapshot
    from public.fragrance_facets_v1 ff
    where ff.fragrance_id = r.fragrance_id;

    v_before_taxonomy_snapshot := v_before_taxonomy_snapshot
      || jsonb_build_object(
        'role_count',
        (select count(*) from public.fragrance_wardrobe_roles_v1 wr where wr.fragrance_id = r.fragrance_id),
        'roles',
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'role_key', wr.role_key,
                'role_priority', wr.role_priority,
                'confidence', wr.confidence,
                'evidence_source', wr.evidence_source
              )
              order by wr.role_priority, wr.role_key
            )
            from public.fragrance_wardrobe_roles_v1 wr
            where wr.fragrance_id = r.fragrance_id
          ),
          '[]'::jsonb
        ),
        'has_review',
        exists (
          select 1
          from public.fragrance_taxonomy_review_v1 tr
          where tr.fragrance_id = r.fragrance_id
        ),
        'review',
        coalesce(
          (
            select to_jsonb(tr)
            from public.fragrance_taxonomy_review_v1 tr
            where tr.fragrance_id = r.fragrance_id
          ),
          '{}'::jsonb
        )
      );

    v_proposal_snapshot := jsonb_build_object(
      'proposal_id', r.proposal_id,
      'fragrance_id', r.fragrance_id,
      'name', r.name,
      'brand', r.brand,
      'proposal_status', r.proposal_status,
      'proposed_universal_family_key', r.proposed_universal_family_key,
      'proposed_facets', coalesce(r.proposed_facets, '[]'::jsonb),
      'proposed_wardrobe_roles', coalesce(r.proposed_wardrobe_roles, '[]'::jsonb),
      'proposed_confidence', r.proposed_confidence,
      'proposed_review_status', r.proposed_review_status,
      'classifier_model_version', r.classifier_model_version,
      'source_model_version', r.source_model_version,
      'queue_model_version', r.queue_model_version,
      'evidence_summary', coalesce(r.evidence_summary, '{}'::jsonb),
      'source_summary', coalesce(r.source_summary, '{}'::jsonb),
      'performance_summary', coalesce(r.performance_summary, '{}'::jsonb)
    );

    if r.proposal_id is null then
      v_result_status := 'blocked';
      v_blocker_reason := 'missing_proposal';
    elsif r.proposal_status = 'accepted_later' then
      v_result_status := 'blocked';
      v_blocker_reason := 'already_accepted';
    elsif r.proposal_status <> 'proposed' then
      v_result_status := 'blocked';
      v_blocker_reason := 'proposal_status_not_proposed';
    elsif r.proposed_confidence is null or r.proposed_confidence < p_min_confidence then
      v_result_status := 'blocked';
      v_blocker_reason := 'proposal_confidence_below_threshold';
    elsif jsonb_typeof(coalesce(r.proposed_facets, '[]'::jsonb)) <> 'array'
       or jsonb_typeof(coalesce(r.proposed_wardrobe_roles, '[]'::jsonb)) <> 'array' then
      v_result_status := 'blocked';
      v_blocker_reason := 'proposal_payload_not_array';
    end if;

    if v_result_status is null then
      select count(*)::integer
      into v_facet_payload_count
      from jsonb_array_elements(coalesce(r.proposed_facets, '[]'::jsonb)) facet;

      select count(*)::integer
      into v_role_payload_count
      from jsonb_array_elements(coalesce(r.proposed_wardrobe_roles, '[]'::jsonb)) role;

      if v_facet_payload_count = 0 then
        v_result_status := 'blocked';
        v_blocker_reason := 'proposal_missing_facets';
      elsif v_role_payload_count = 0 then
        v_result_status := 'blocked';
        v_blocker_reason := 'proposal_missing_roles';
      end if;
    end if;

    if v_result_status is null then
      select coalesce(array_agg(missing_key order by missing_key), array[]::text[])
      into v_missing_facet_keys
      from (
        select distinct coalesce(nullif(facet ->> 'facet_key', ''), '__missing_facet_key__') as missing_key
        from jsonb_array_elements(coalesce(r.proposed_facets, '[]'::jsonb)) facet
      ) proposed
      left join public.facet_key_reference_v1 ref
        on ref.facet_key = proposed.missing_key
       and ref.active is true
      where ref.facet_key is null;

      select coalesce(array_agg(missing_key order by missing_key), array[]::text[])
      into v_missing_role_keys
      from (
        select distinct coalesce(nullif(role ->> 'role_key', ''), '__missing_role_key__') as missing_key
        from jsonb_array_elements(coalesce(r.proposed_wardrobe_roles, '[]'::jsonb)) role
      ) proposed
      left join public.wardrobe_role_reference_v1 ref
        on ref.role_key = proposed.missing_key
       and ref.active is true
      where ref.role_key is null;

      if coalesce(array_length(v_missing_facet_keys, 1), 0) > 0 then
        v_result_status := 'blocked';
        v_blocker_reason := 'unsupported_facet_reference_keys';
      elsif coalesce(array_length(v_missing_role_keys, 1), 0) > 0 then
        v_result_status := 'blocked';
        v_blocker_reason := 'unsupported_role_reference_keys';
      elsif r.proposed_universal_family_key is not null
        and not exists (
          select 1
          from public.family_key_reference_v1 fkr
          where fkr.active is true
            and (
              fkr.family_key = r.proposed_universal_family_key
              or fkr.universal_equivalent = r.proposed_universal_family_key
            )
        ) then
        v_result_status := 'blocked';
        v_blocker_reason := 'unsupported_universal_family_reference';
      end if;
    end if;

    if v_result_status is null then
      if r.final_facet_count > 0 or r.final_role_count > 0 or r.final_review_count > 0 then
        v_result_status := 'blocked';
        v_blocker_reason := 'blocked_existing_taxonomy';
      elsif r.evidence_quality_state <> 'promoted_enrichment_evidence' then
        v_result_status := 'blocked';
        v_blocker_reason := 'evidence_not_promoted';
      elsif not r.has_promoted_text_evidence then
        v_result_status := 'blocked';
        v_blocker_reason := 'missing_promoted_text_evidence';
      elsif r.queue_state <> 'ready_existing_evidence' or r.queue_lane <> 'safe_classifier_candidate' then
        v_result_status := 'blocked';
        v_blocker_reason := 'not_safe_classifier_candidate';
      elsif r.canonical_notes_count = 0 or r.canonical_accords_count = 0 then
        v_result_status := 'blocked';
        v_blocker_reason := 'missing_canonical_notes_or_accords';
      elsif r.has_rejected_match or r.has_revert_history then
        v_result_status := 'blocked';
        v_blocker_reason := 'rejected_or_reverted_source_history';
      end if;
    end if;

    if v_result_status is null then
      v_result_status := case when p_dry_run then 'eligible_preview' else 'accepted' end;
      v_eligible_count := v_eligible_count + 1;

      if p_dry_run then
        v_would_accept_count := v_would_accept_count + 1;
      else
        with inserted_facets as (
          insert into public.fragrance_facets_v1 (
            fragrance_id,
            facet_key,
            confidence,
            evidence_source,
            evidence_json,
            created_at,
            updated_at
          )
          select
            r.fragrance_id,
            facet ->> 'facet_key',
            coalesce((facet ->> 'confidence')::numeric, r.proposed_confidence),
            'taxonomy_proposal_acceptance_v1',
            jsonb_build_object(
              'accepted_from_proposal_id', r.proposal_id,
              'actor_label', v_actor_label,
              'classifier_model_version', r.classifier_model_version,
              'source_model_version', r.source_model_version,
              'queue_model_version', r.queue_model_version,
              'proposed_universal_family_key', r.proposed_universal_family_key,
              'matched_terms', coalesce(facet -> 'matched_terms', '[]'::jsonb),
              'proposal_confidence', r.proposed_confidence,
              'evidence_summary', coalesce(r.evidence_summary, '{}'::jsonb),
              'source_summary', coalesce(r.source_summary, '{}'::jsonb),
              'performance_summary', coalesce(r.performance_summary, '{}'::jsonb)
            ),
            now(),
            now()
          from jsonb_array_elements(coalesce(r.proposed_facets, '[]'::jsonb)) facet
          on conflict (fragrance_id, facet_key) do nothing
          returning facet_key, confidence, evidence_source
        )
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'facet_key', facet_key,
              'confidence', confidence,
              'evidence_source', evidence_source
            )
            order by facet_key
          ),
          '[]'::jsonb
        )
        into v_final_facets_written
        from inserted_facets;

        with inserted_roles as (
          insert into public.fragrance_wardrobe_roles_v1 (
            fragrance_id,
            role_key,
            role_priority,
            confidence,
            evidence_source,
            evidence_json,
            created_at,
            updated_at
          )
          select
            r.fragrance_id,
            role ->> 'role_key',
            coalesce((role ->> 'role_priority')::integer, row_number() over (order by role ->> 'role_key')),
            coalesce((role ->> 'confidence')::numeric, r.proposed_confidence),
            'taxonomy_proposal_acceptance_v1',
            jsonb_build_object(
              'accepted_from_proposal_id', r.proposal_id,
              'actor_label', v_actor_label,
              'classifier_model_version', r.classifier_model_version,
              'source_model_version', r.source_model_version,
              'queue_model_version', r.queue_model_version,
              'proposed_universal_family_key', r.proposed_universal_family_key,
              'role_rationale', coalesce(role -> 'rationale', '[]'::jsonb),
              'proposal_confidence', r.proposed_confidence,
              'evidence_summary', coalesce(r.evidence_summary, '{}'::jsonb),
              'source_summary', coalesce(r.source_summary, '{}'::jsonb),
              'performance_summary', coalesce(r.performance_summary, '{}'::jsonb)
            ),
            now(),
            now()
          from jsonb_array_elements(coalesce(r.proposed_wardrobe_roles, '[]'::jsonb)) role
          on conflict (fragrance_id, role_key) do nothing
          returning role_key, role_priority, confidence, evidence_source
        )
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'role_key', role_key,
              'role_priority', role_priority,
              'confidence', confidence,
              'evidence_source', evidence_source
            )
            order by role_priority, role_key
          ),
          '[]'::jsonb
        )
        into v_final_roles_written
        from inserted_roles;

        insert into public.fragrance_taxonomy_review_v1 (
          fragrance_id,
          legacy_family_key,
          universal_equivalent,
          confidence,
          review_status,
          evidence_source,
          evidence_json,
          reviewed_by,
          created_at,
          updated_at
        )
        values (
          r.fragrance_id,
          r.family_key,
          r.proposed_universal_family_key,
          r.proposed_confidence,
          coalesce(r.proposed_review_status, case when r.proposed_confidence >= 0.82 then 'confirmed' else 'medium_confidence' end),
          'taxonomy_proposal_acceptance_v1',
          jsonb_build_object(
            'accepted_from_proposal_id', r.proposal_id,
            'actor_label', v_actor_label,
            'classifier_model_version', r.classifier_model_version,
            'source_model_version', r.source_model_version,
            'queue_model_version', r.queue_model_version,
            'proposal_confidence', r.proposed_confidence,
            'proposed_universal_family_key', r.proposed_universal_family_key,
            'proposed_facets', coalesce(r.proposed_facets, '[]'::jsonb),
            'proposed_wardrobe_roles', coalesce(r.proposed_wardrobe_roles, '[]'::jsonb),
            'evidence_summary', coalesce(r.evidence_summary, '{}'::jsonb),
            'source_summary', coalesce(r.source_summary, '{}'::jsonb),
            'performance_summary', coalesce(r.performance_summary, '{}'::jsonb)
          ),
          v_actor_label,
          now(),
          now()
        )
        on conflict (fragrance_id) do nothing
        returning jsonb_build_object(
          'fragrance_id', fragrance_id,
          'legacy_family_key', legacy_family_key,
          'universal_equivalent', universal_equivalent,
          'confidence', confidence,
          'review_status', review_status,
          'evidence_source', evidence_source,
          'reviewed_by', reviewed_by
        )
        into v_final_review_snapshot;

        v_final_review_snapshot := coalesce(v_final_review_snapshot, '{}'::jsonb);

        update public.fragrance_taxonomy_proposals_v1
        set
          proposal_status = 'accepted_later',
          updated_at = now()
        where id = r.proposal_id
          and proposal_status = 'proposed';

        select jsonb_build_object(
          'facet_count',
          (select count(*) from public.fragrance_facets_v1 ff where ff.fragrance_id = r.fragrance_id),
          'facets',
          coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'facet_key', ff.facet_key,
                  'confidence', ff.confidence,
                  'evidence_source', ff.evidence_source
                )
                order by ff.facet_key
              )
              from public.fragrance_facets_v1 ff
              where ff.fragrance_id = r.fragrance_id
            ),
            '[]'::jsonb
          ),
          'role_count',
          (select count(*) from public.fragrance_wardrobe_roles_v1 wr where wr.fragrance_id = r.fragrance_id),
          'roles',
          coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'role_key', wr.role_key,
                  'role_priority', wr.role_priority,
                  'confidence', wr.confidence,
                  'evidence_source', wr.evidence_source
                )
                order by wr.role_priority, wr.role_key
              )
              from public.fragrance_wardrobe_roles_v1 wr
              where wr.fragrance_id = r.fragrance_id
            ),
            '[]'::jsonb
          ),
          'review',
          coalesce(
            (
              select to_jsonb(tr)
              from public.fragrance_taxonomy_review_v1 tr
              where tr.fragrance_id = r.fragrance_id
            ),
            '{}'::jsonb
          )
        )
        into v_after_taxonomy_snapshot;

        insert into public.fragrance_taxonomy_proposal_acceptance_audit_v1 (
          proposal_id,
          fragrance_id,
          action,
          result_status,
          actor_label,
          classifier_model_version,
          proposal_snapshot,
          final_facets_written,
          final_roles_written,
          final_review_snapshot,
          before_taxonomy_snapshot,
          after_taxonomy_snapshot,
          blocker_reason,
          created_at
        )
        values (
          r.proposal_id,
          r.fragrance_id,
          'accept',
          'accepted',
          v_actor_label,
          r.classifier_model_version,
          v_proposal_snapshot,
          v_final_facets_written,
          v_final_roles_written,
          v_final_review_snapshot,
          v_before_taxonomy_snapshot,
          v_after_taxonomy_snapshot,
          null,
          now()
        )
        returning id into v_audit_id;

        v_accepted_count := v_accepted_count + 1;
      end if;
    else
      v_rejected_count := v_rejected_count + 1;
      v_after_taxonomy_snapshot := v_before_taxonomy_snapshot;
    end if;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'fragrance_id', r.fragrance_id,
        'name', r.name,
        'brand', r.brand,
        'proposal_id', r.proposal_id,
        'result_status', v_result_status,
        'blocker_reason', v_blocker_reason,
        'classifier_model_version', r.classifier_model_version,
        'proposed_universal_family_key', r.proposed_universal_family_key,
        'proposed_facets', coalesce(r.proposed_facets, '[]'::jsonb),
        'proposed_wardrobe_roles', coalesce(r.proposed_wardrobe_roles, '[]'::jsonb),
        'proposed_confidence', r.proposed_confidence,
        'proposed_review_status', r.proposed_review_status,
        'missing_facet_keys', to_jsonb(coalesce(v_missing_facet_keys, array[]::text[])),
        'missing_role_keys', to_jsonb(coalesce(v_missing_role_keys, array[]::text[])),
        'before_taxonomy_snapshot', v_before_taxonomy_snapshot,
        'final_facets_written', v_final_facets_written,
        'final_roles_written', v_final_roles_written,
        'final_review_snapshot', v_final_review_snapshot,
        'after_taxonomy_snapshot', coalesce(v_after_taxonomy_snapshot, v_before_taxonomy_snapshot),
        'audit_id', v_audit_id
      )
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'function_version', 'taxonomy_proposal_acceptance_gate_v1',
    'dry_run', p_dry_run,
    'actor_label', v_actor_label,
    'model_version', p_model_version,
    'min_confidence', p_min_confidence,
    'requested_count', v_requested_count,
    'distinct_requested_count', v_distinct_requested_count,
    'missing_ids', to_jsonb(coalesce(v_missing_ids, array[]::uuid[])),
    'picked_count', v_picked_count,
    'eligible_count', v_eligible_count,
    'would_accept_count', v_would_accept_count,
    'accepted_count', v_accepted_count,
    'rejected_count', v_rejected_count,
    'results', v_results
  );
end;
$$;

comment on function public.accept_fragrance_taxonomy_proposals_v1(uuid[], text, boolean, numeric, text) is
  'Explicit-ID backend acceptance gate for classifier proposals. Dry-run previews write nothing. Live acceptance writes final facets, roles, review rows, and audit only; it never updates public.fragrances or refreshes performance.';

revoke all on function public.accept_fragrance_taxonomy_proposals_v1(uuid[], text, boolean, numeric, text) from public, anon, authenticated;
grant execute on function public.accept_fragrance_taxonomy_proposals_v1(uuid[], text, boolean, numeric, text) to service_role;

commit;
