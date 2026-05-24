begin;

create or replace function public.decide_canonical_identity_reviews_v1(
  p_decisions jsonb,
  p_actor_label text default 'codex_canonical_identity_decisions_v1',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_requested_count integer := 0;
  v_picked_count integer := 0;
  v_would_decide_count integer := 0;
  v_decided_count integer := 0;
  v_skipped_count integer := 0;
  v_rejected_count integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_actor_label text := coalesce(nullif(btrim(p_actor_label), ''), 'codex_canonical_identity_decisions_v1');
  v_decision record;
  v_latest public.fragrance_canonical_identity_reviews_v1%rowtype;
  v_alias_ids uuid[];
  v_separate_ids uuid[];
  v_new_review_id uuid;
  v_blocker_reason text;
begin
  if p_decisions is null or jsonb_typeof(p_decisions) <> 'array' then
    raise exception 'decide_canonical_identity_reviews_v1 requires an explicit non-empty decisions JSON array';
  end if;

  v_requested_count := jsonb_array_length(p_decisions);

  if v_requested_count = 0 then
    raise exception 'decide_canonical_identity_reviews_v1 requires an explicit non-empty decisions JSON array';
  end if;

  if v_requested_count > 10 then
    raise exception 'decide_canonical_identity_reviews_v1 accepts at most 10 decisions per call';
  end if;

  for v_decision in
    select
      item.ordinality,
      nullif(btrim(d.canonical_identity_key), '') as canonical_identity_key,
      nullif(btrim(d.decision_status), '') as decision_status,
      d.canonical_fragrance_id,
      coalesce(d.alias_fragrance_ids, '[]'::jsonb) as alias_fragrance_ids,
      coalesce(d.separate_fragrance_ids, '[]'::jsonb) as separate_fragrance_ids,
      nullif(btrim(d.decision_reason), '') as decision_reason,
      nullif(btrim(d.recommended_next_action), '') as recommended_next_action
    from jsonb_array_elements(p_decisions) with ordinality as item(decision_json, ordinality)
    cross join lateral jsonb_to_record(item.decision_json) as d(
      canonical_identity_key text,
      decision_status text,
      canonical_fragrance_id uuid,
      alias_fragrance_ids jsonb,
      separate_fragrance_ids jsonb,
      decision_reason text,
      recommended_next_action text
    )
    order by item.ordinality
  loop
    v_blocker_reason := null;
    v_new_review_id := null;
    v_alias_ids := array[]::uuid[];
    v_separate_ids := array[]::uuid[];

    if v_decision.alias_fragrance_ids is not null
      and jsonb_typeof(v_decision.alias_fragrance_ids) <> 'array' then
      v_blocker_reason := 'alias_fragrance_ids_must_be_array';
    elsif v_decision.separate_fragrance_ids is not null
      and jsonb_typeof(v_decision.separate_fragrance_ids) <> 'array' then
      v_blocker_reason := 'separate_fragrance_ids_must_be_array';
    else
      select coalesce(array_agg(value::uuid order by value), array[]::uuid[])
      into v_alias_ids
      from jsonb_array_elements_text(coalesce(v_decision.alias_fragrance_ids, '[]'::jsonb)) as ids(value);

      select coalesce(array_agg(value::uuid order by value), array[]::uuid[])
      into v_separate_ids
      from jsonb_array_elements_text(coalesce(v_decision.separate_fragrance_ids, '[]'::jsonb)) as ids(value);
    end if;

    if v_blocker_reason is null and v_decision.canonical_identity_key is null then
      v_blocker_reason := 'missing_canonical_identity_key';
    end if;

    if v_blocker_reason is null and v_decision.decision_status is null then
      v_blocker_reason := 'missing_decision_status';
    end if;

    if v_blocker_reason is null and v_decision.decision_status not in (
      'same_identity',
      'separate_identity',
      'canonical_selected',
      'alias_confirmed',
      'do_not_merge',
      'needs_manual_source_review'
    ) then
      v_blocker_reason := 'unsupported_decision_status';
    end if;

    if v_blocker_reason is null then
      select r.*
      into v_latest
      from public.fragrance_canonical_identity_reviews_v1 r
      where r.canonical_identity_key = v_decision.canonical_identity_key
        and r.superseded_at is null
        and r.decision_status <> 'superseded'
      order by r.updated_at desc nulls last, r.created_at desc nulls last, r.id desc
      limit 1;

      if not found then
        v_blocker_reason := 'missing_active_review';
      elsif v_latest.decision_status = 'needs_review' then
        null;
      elsif v_latest.decision_status = 'same_identity'
        and v_decision.decision_status = 'canonical_selected' then
        null;
      else
        v_blocker_reason := 'latest_review_status_not_transitionable_to_requested_decision';
      end if;
    end if;

    if v_blocker_reason is null
      and v_decision.canonical_fragrance_id is not null
      and not (v_decision.canonical_fragrance_id = any(v_latest.reviewed_fragrance_ids)) then
      v_blocker_reason := 'canonical_fragrance_id_not_in_reviewed_fragrance_ids';
    end if;

    if v_blocker_reason is null
      and exists (
        select 1
        from unnest(v_alias_ids) as a(alias_id)
        where not (a.alias_id = any(v_latest.reviewed_fragrance_ids))
      ) then
      v_blocker_reason := 'alias_fragrance_id_not_in_reviewed_fragrance_ids';
    end if;

    if v_blocker_reason is null
      and exists (
        select 1
        from unnest(v_separate_ids) as s(separate_id)
        where not (s.separate_id = any(v_latest.reviewed_fragrance_ids))
      ) then
      v_blocker_reason := 'separate_fragrance_id_not_in_reviewed_fragrance_ids';
    end if;

    if v_blocker_reason is null
      and v_decision.canonical_fragrance_id is not null
      and v_decision.canonical_fragrance_id = any(v_alias_ids) then
      v_blocker_reason := 'canonical_fragrance_id_cannot_be_alias';
    end if;

    if v_blocker_reason is null
      and v_decision.canonical_fragrance_id is not null
      and v_decision.canonical_fragrance_id = any(v_separate_ids) then
      v_blocker_reason := 'canonical_fragrance_id_cannot_be_separate';
    end if;

    if v_blocker_reason is null
      and exists (
        select 1
        from unnest(v_alias_ids) as a(alias_id)
        join unnest(v_separate_ids) as s(separate_id)
          on s.separate_id = a.alias_id
      ) then
      v_blocker_reason := 'alias_and_separate_ids_cannot_overlap';
    end if;

    if v_blocker_reason is null
      and v_decision.decision_status in ('canonical_selected', 'alias_confirmed')
      and v_decision.canonical_fragrance_id is null then
      v_blocker_reason := 'canonical_decision_requires_canonical_fragrance_id';
    end if;

    if v_blocker_reason is null
      and v_decision.decision_status = 'alias_confirmed'
      and cardinality(v_alias_ids) = 0 then
      v_blocker_reason := 'alias_confirmed_requires_alias_fragrance_ids';
    end if;

    if v_blocker_reason is null
      and v_decision.decision_status = 'separate_identity'
      and cardinality(v_separate_ids) = 0 then
      v_blocker_reason := 'separate_identity_requires_separate_fragrance_ids';
    end if;

    if v_blocker_reason is not null then
      v_rejected_count := v_rejected_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'canonical_identity_key', v_decision.canonical_identity_key,
        'decision_status', v_decision.decision_status,
        'result_status', 'rejected',
        'blocker_reason', v_blocker_reason,
        'review_id', case when v_latest.id is not null then v_latest.id else null end,
        'would_decide', false
      )));
    elsif p_dry_run then
      v_picked_count := v_picked_count + 1;
      v_would_decide_count := v_would_decide_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'canonical_identity_key', v_decision.canonical_identity_key,
        'old_review_id', v_latest.id,
        'decision_status', v_decision.decision_status,
        'canonical_fragrance_id', v_decision.canonical_fragrance_id,
        'alias_fragrance_ids', case when cardinality(v_alias_ids) > 0 then to_jsonb(v_alias_ids) else null end,
        'separate_fragrance_ids', case when cardinality(v_separate_ids) > 0 then to_jsonb(v_separate_ids) else null end,
        'decision_reason', v_decision.decision_reason,
        'recommended_next_action', v_decision.recommended_next_action,
        'result_status', 'would_decide',
        'would_decide', true
      )));
    else
      update public.fragrance_canonical_identity_reviews_v1
      set
        decision_status = 'superseded',
        superseded_at = now(),
        after_decision_snapshot = jsonb_strip_nulls(jsonb_build_object(
          'superseded_by_actor_label', v_actor_label,
          'superseded_by_decision_status', v_decision.decision_status,
          'superseded_at', now()
        ))
      where id = v_latest.id;

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
        cluster_snapshot,
        before_decision_snapshot,
        after_decision_snapshot,
        supersedes_review_id
      )
      values (
        v_latest.canonical_identity_key,
        v_decision.decision_status,
        v_latest.reviewed_fragrance_ids,
        v_decision.canonical_fragrance_id,
        case when cardinality(v_alias_ids) > 0 then v_alias_ids else null end,
        case when cardinality(v_separate_ids) > 0 then v_separate_ids else null end,
        v_decision.decision_reason,
        v_decision.recommended_next_action,
        v_actor_label,
        v_latest.source_queue_model_version,
        v_latest.source_conflict_view,
        v_latest.evidence_snapshot,
        v_latest.cluster_snapshot,
        to_jsonb(v_latest),
        jsonb_strip_nulls(jsonb_build_object(
          'canonical_identity_key', v_latest.canonical_identity_key,
          'decision_status', v_decision.decision_status,
          'canonical_fragrance_id', v_decision.canonical_fragrance_id,
          'alias_fragrance_ids', case when cardinality(v_alias_ids) > 0 then to_jsonb(v_alias_ids) else null end,
          'separate_fragrance_ids', case when cardinality(v_separate_ids) > 0 then to_jsonb(v_separate_ids) else null end,
          'decision_reason', v_decision.decision_reason,
          'recommended_next_action', v_decision.recommended_next_action,
          'actor_label', v_actor_label,
          'supersedes_review_id', v_latest.id,
          'created_at', now()
        )),
        v_latest.id
      )
      returning id into v_new_review_id;

      v_picked_count := v_picked_count + 1;
      v_decided_count := v_decided_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'canonical_identity_key', v_latest.canonical_identity_key,
        'old_review_id', v_latest.id,
        'new_review_id', v_new_review_id,
        'decision_status', v_decision.decision_status,
        'canonical_fragrance_id', v_decision.canonical_fragrance_id,
        'alias_fragrance_ids', case when cardinality(v_alias_ids) > 0 then to_jsonb(v_alias_ids) else null end,
        'separate_fragrance_ids', case when cardinality(v_separate_ids) > 0 then to_jsonb(v_separate_ids) else null end,
        'decision_reason', v_decision.decision_reason,
        'recommended_next_action', v_decision.recommended_next_action,
        'result_status', 'decided',
        'would_decide', false
      )));
    end if;
  end loop;

  return jsonb_build_object(
    'requested_count', v_requested_count,
    'picked_count', v_picked_count,
    'would_decide_count', v_would_decide_count,
    'decided_count', v_decided_count,
    'skipped_count', v_skipped_count,
    'rejected_count', v_rejected_count,
    'dry_run', p_dry_run,
    'actor_label', v_actor_label,
    'results', v_results
  );
end;
$function$;

comment on function public.decide_canonical_identity_reviews_v1(jsonb, text, boolean) is
  'Records explicit canonical identity review decisions only. It supersedes prior needs_review records and same_identity records when explicitly upgrading to canonical_selected, and inserts decision records in fragrance_canonical_identity_reviews_v1 without merging rows, applying aliases, copying evidence, mutating public.fragrances, staging/promoting enrichment, writing taxonomy, refreshing performance, or touching frontend payloads.';

commit;
