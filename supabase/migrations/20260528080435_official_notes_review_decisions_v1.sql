begin;

create table if not exists public.fragrance_official_notes_reviews_v1 (
  id uuid primary key default gen_random_uuid(),
  fragrance_id uuid not null references public.fragrances(id) on delete cascade,
  review_status text not null,
  actor_label text not null,
  decision_reason text not null,
  recommended_next_action text not null,
  queue_state text null,
  queue_lane text null,
  blocker_reason text null,
  evidence_quality_state text null,
  product_priority_score numeric null,
  product_priority_reason text null,
  source_confidence numeric null,
  source_evidence_type text null,
  source_limitation_reason text null,
  notes_count integer null,
  top_notes_count integer null,
  heart_notes_count integer null,
  base_notes_count integer null,
  performance_refresh_satisfied boolean null,
  has_final_facets boolean null,
  has_final_roles boolean null,
  has_taxonomy_review boolean null,
  has_taxonomy_proposal boolean null,
  selected_official_source_backfill_audit_id uuid null references public.fragrance_source_backfill_audit_v1(id),
  refresh_run_id uuid null,
  source_queue_model_version text null,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  queue_snapshot jsonb not null default '{}'::jsonb,
  source_snapshot jsonb null,
  review_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  superseded_at timestamptz null,
  supersedes_review_id uuid null references public.fragrance_official_notes_reviews_v1(id),
  constraint fragrance_official_notes_reviews_v1_status_check check (
    review_status in (
      'official_notes_pending_review',
      'official_notes_accepted_for_classifier_review',
      'official_notes_needs_manual_review',
      'official_notes_rejected_identity_or_payload',
      'official_notes_too_thin',
      'official_notes_superseded'
    )
  )
);

create index if not exists fragrance_official_notes_reviews_v1_fragrance_idx
  on public.fragrance_official_notes_reviews_v1 (fragrance_id);

create index if not exists fragrance_official_notes_reviews_v1_status_idx
  on public.fragrance_official_notes_reviews_v1 (review_status);

create index if not exists fragrance_official_notes_reviews_v1_created_idx
  on public.fragrance_official_notes_reviews_v1 (created_at desc);

create unique index if not exists fragrance_official_notes_reviews_v1_one_active_idx
  on public.fragrance_official_notes_reviews_v1 (fragrance_id)
  where superseded_at is null and review_status <> 'official_notes_superseded';

drop trigger if exists fragrance_official_notes_reviews_v1_touch_updated_at
  on public.fragrance_official_notes_reviews_v1;

create trigger fragrance_official_notes_reviews_v1_touch_updated_at
before update on public.fragrance_official_notes_reviews_v1
for each row
execute function public.set_updated_at_v1();

alter table public.fragrance_official_notes_reviews_v1 enable row level security;

revoke all on public.fragrance_official_notes_reviews_v1 from public, anon, authenticated;
grant select, insert, update on public.fragrance_official_notes_reviews_v1 to service_role;

comment on table public.fragrance_official_notes_reviews_v1 is
  'Operational review decisions for exact official_brand notes-only rows. These reviews do not invent top/heart/base pyramids, do not write final taxonomy, do not create classifier proposals automatically, and only determine whether a notes-only row may advance into a controlled classifier-review lane later.';

comment on column public.fragrance_official_notes_reviews_v1.review_status is
  'Explicit official-notes review workflow state only. It is weaker than official-pyramid routing and does not itself create proposals or final taxonomy.';

comment on column public.fragrance_official_notes_reviews_v1.review_snapshot is
  'Compact decision-memory snapshot. It records explicit reviewer rationale and operational notes-only limits without mutating public.fragrances or asserting final taxonomy truth.';

create or replace view public.fragrance_official_notes_review_latest_v1
with (security_invoker = true)
as
select
  ranked.fragrance_id,
  ranked.id as latest_review_id,
  ranked.review_status,
  ranked.actor_label,
  ranked.decision_reason,
  ranked.recommended_next_action,
  ranked.queue_state,
  ranked.queue_lane,
  ranked.blocker_reason,
  ranked.evidence_quality_state,
  ranked.product_priority_score,
  ranked.product_priority_reason,
  ranked.source_confidence,
  ranked.source_evidence_type,
  ranked.source_limitation_reason,
  ranked.notes_count,
  ranked.top_notes_count,
  ranked.heart_notes_count,
  ranked.base_notes_count,
  ranked.performance_refresh_satisfied,
  ranked.has_final_facets,
  ranked.has_final_roles,
  ranked.has_taxonomy_review,
  ranked.has_taxonomy_proposal,
  ranked.selected_official_source_backfill_audit_id,
  ranked.refresh_run_id,
  ranked.source_queue_model_version,
  ranked.evidence_snapshot,
  ranked.queue_snapshot,
  ranked.source_snapshot,
  ranked.review_snapshot,
  ranked.created_at,
  ranked.updated_at
from (
  select
    r.*,
    row_number() over (
      partition by r.fragrance_id
      order by r.updated_at desc nulls last, r.created_at desc nulls last, r.id desc
    ) as rn
  from public.fragrance_official_notes_reviews_v1 r
  where r.superseded_at is null
    and r.review_status <> 'official_notes_superseded'
) ranked
where ranked.rn = 1;

comment on view public.fragrance_official_notes_review_latest_v1 is
  'Latest active official-notes review per fragrance. Operational decision memory only: not source truth, not classifier output, and not final taxonomy.';

create or replace function public.decide_fragrance_official_notes_reviews_v1(
  p_decisions jsonb,
  p_actor_label text default 'codex_official_notes_review_decisions_v1',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_actor_label text := coalesce(nullif(btrim(p_actor_label), ''), 'codex_official_notes_review_decisions_v1');
  v_requested_count integer := 0;
  v_picked_count integer := 0;
  v_would_decide_count integer := 0;
  v_decided_count integer := 0;
  v_skipped_count integer := 0;
  v_rejected_count integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_decision record;
  v_new_review_id uuid;
  v_result_status text;
  v_blocker_reason text;
begin
  if p_decisions is null or jsonb_typeof(p_decisions) <> 'array' then
    raise exception 'decide_fragrance_official_notes_reviews_v1 requires a non-empty jsonb array of explicit decisions';
  end if;

  v_requested_count := jsonb_array_length(p_decisions);

  if v_requested_count = 0 then
    raise exception 'decide_fragrance_official_notes_reviews_v1 requires a non-empty jsonb array of explicit decisions';
  end if;

  if v_requested_count > 25 then
    raise exception 'decide_fragrance_official_notes_reviews_v1 accepts at most 25 explicit decisions per call';
  end if;

  for v_decision in
    with raw_decisions as (
      select
        ordinality as decision_ordinal,
        value as decision_payload
      from jsonb_array_elements(p_decisions) with ordinality
    ),
    parsed_decisions as (
      select
        r.decision_ordinal,
        r.decision_payload,
        nullif(btrim(r.decision_payload ->> 'fragrance_id'), '') as fragrance_id_text,
        case
          when nullif(btrim(r.decision_payload ->> 'fragrance_id'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (r.decision_payload ->> 'fragrance_id')::uuid
          else null
        end as fragrance_id,
        nullif(btrim(r.decision_payload ->> 'review_status'), '') as requested_review_status,
        nullif(btrim(r.decision_payload ->> 'decision_reason'), '') as decision_reason,
        nullif(btrim(r.decision_payload ->> 'recommended_next_action'), '') as requested_next_action
      from raw_decisions r
    ),
    duplicate_decisions as (
      select
        fragrance_id_text,
        count(*)::int as duplicate_count
      from parsed_decisions
      where fragrance_id_text is not null
      group by fragrance_id_text
    )
    select
      p.decision_ordinal,
      p.decision_payload,
      p.fragrance_id_text,
      p.fragrance_id,
      p.requested_review_status,
      p.decision_reason,
      p.requested_next_action,
      coalesce(d.duplicate_count, 0) as duplicate_count,
      latest.latest_review_id as current_review_id,
      latest.review_status as current_review_status,
      latest.decision_reason as current_decision_reason,
      latest.recommended_next_action as current_recommended_next_action,
      f.name,
      f.brand,
      f.family_key,
      q.queue_state as live_queue_state,
      q.queue_lane as live_queue_lane,
      q.blocker_reason as live_blocker_reason,
      q.recommended_next_action as live_recommended_next_action,
      q.evidence_quality_state,
      q.product_priority_score,
      q.product_priority_reason,
      q.evidence_summary,
      q.resolver_evidence_summary,
      q.alias_policy_summary,
      f.source_url,
      case
        when nullif(btrim(f.source_confidence), '') ~ '^[0-9]+([.][0-9]+)?$'
          then f.source_confidence::numeric
      end as source_confidence_numeric,
      cardinality(f.notes) as notes_count,
      cardinality(f.top_notes) as top_notes_count,
      cardinality(f.heart_notes) as heart_notes_count,
      cardinality(f.base_notes) as base_notes_count,
      exists(select 1 from public.fragrance_facets_v1 ff where ff.fragrance_id = f.id) as has_final_facets,
      exists(select 1 from public.fragrance_wardrobe_roles_v1 wr where wr.fragrance_id = f.id) as has_final_roles,
      exists(select 1 from public.fragrance_taxonomy_review_v1 tr where tr.fragrance_id = f.id) as has_taxonomy_review,
      coalesce((select count(*) from public.fragrance_taxonomy_proposals_v1 tp where tp.fragrance_id = f.id), 0)::int as proposal_count,
      nullif(q.evidence_summary -> 'official_source' ->> 'source_evidence_type', '') as official_source_evidence_type,
      nullif(q.evidence_summary -> 'official_source' ->> 'source_limitation_reason', '') as official_source_limitation_reason,
      case
        when nullif(q.evidence_summary -> 'official_source' ->> 'selected_official_source_backfill_audit_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (q.evidence_summary -> 'official_source' ->> 'selected_official_source_backfill_audit_id')::uuid
      end as selected_official_source_backfill_audit_id,
      coalesce((q.evidence_summary -> 'official_source' ->> 'performance_refresh_satisfied')::boolean, false) as performance_refresh_satisfied
    from parsed_decisions p
    left join duplicate_decisions d
      on d.fragrance_id_text = p.fragrance_id_text
    left join public.fragrance_official_notes_review_latest_v1 latest
      on latest.fragrance_id = p.fragrance_id
    left join public.fragrances f
      on f.id = p.fragrance_id
    left join public.taxonomy_operationalization_queue_current_v1 q
      on q.fragrance_id = p.fragrance_id
    order by p.decision_ordinal
  loop
    v_new_review_id := null;
    v_result_status := null;
    v_blocker_reason := null;

    if v_decision.fragrance_id is not null and v_decision.name is not null then
      v_picked_count := v_picked_count + 1;
    end if;

    if v_decision.fragrance_id_text is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_fragrance_id';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.fragrance_id is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'invalid_fragrance_id';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.duplicate_count > 1 then
      v_result_status := 'rejected';
      v_blocker_reason := 'duplicate_decision_for_fragrance_id';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.name is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'fragrance_row_not_found';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_review_status is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_requested_review_status';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_review_status not in (
      'official_notes_accepted_for_classifier_review',
      'official_notes_needs_manual_review',
      'official_notes_rejected_identity_or_payload',
      'official_notes_too_thin'
    ) then
      v_result_status := 'rejected';
      v_blocker_reason := 'invalid_requested_review_status';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.decision_reason is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_decision_reason';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_next_action is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_recommended_next_action';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.current_review_id is not null
      and v_decision.current_review_status = v_decision.requested_review_status
      and v_decision.current_decision_reason = v_decision.decision_reason
      and v_decision.current_recommended_next_action = v_decision.requested_next_action then
      v_result_status := 'skipped';
      v_blocker_reason := 'decision_already_active';
      v_skipped_count := v_skipped_count + 1;
    elseif v_decision.live_queue_state is null or v_decision.live_queue_lane is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_current_queue_row';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.live_queue_state in (
      'already_complete',
      'blocked_rejected_match',
      'resolver_identity_conflict',
      'provider_duplicate_reuse',
      'canonical_alias_policy_blocked',
      'provenance_payload_inconsistent',
      'provenance_identity_review_needed',
      'canonical_selection_deferred',
      'canonical_name_conflict',
      'canonical_do_not_merge',
      'canonical_separate_identity',
      'unknown'
    ) then
      v_result_status := 'rejected';
      v_blocker_reason := 'live_queue_state_blocked';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.live_queue_lane in (
      'complete_no_action',
      'canonical_alias_policy',
      'product_critical_blocker',
      'resolver_conflict_review',
      'identity_review',
      'manual_payload_review',
      'canonical_identity_resolved',
      'unknown'
    ) then
      v_result_status := 'rejected';
      v_blocker_reason := 'live_queue_lane_blocked';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.live_queue_state not in (
      'official_notes_pending_review',
      'official_notes_accepted_pending_classifier_review'
    ) and v_decision.current_review_id is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'queue_state_not_notes_reviewable';
      v_rejected_count := v_rejected_count + 1;
    elseif coalesce((v_decision.alias_policy_summary ->> 'is_alias_row')::boolean, false)
      or coalesce((v_decision.alias_policy_summary ->> 'has_active_alias_mapping')::boolean, false) then
      v_result_status := 'rejected';
      v_blocker_reason := 'alias_policy_blocked';
      v_rejected_count := v_rejected_count + 1;
    elseif coalesce((v_decision.resolver_evidence_summary ->> 'has_resolver_attempt')::boolean, false)
      and v_decision.live_queue_lane = 'resolver_conflict_review' then
      v_result_status := 'rejected';
      v_blocker_reason := 'resolver_conflict_review';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.official_source_evidence_type is distinct from 'official_notes_only' then
      v_result_status := 'rejected';
      v_blocker_reason := 'official_source_evidence_type_not_notes_only';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.performance_refresh_satisfied is distinct from true then
      v_result_status := 'rejected';
      v_blocker_reason := 'performance_refresh_not_satisfied';
      v_rejected_count := v_rejected_count + 1;
    elseif coalesce(v_decision.notes_count, 0) <= 0 then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_official_notes';
      v_rejected_count := v_rejected_count + 1;
    elseif coalesce(v_decision.top_notes_count, 0) > 0
      or coalesce(v_decision.heart_notes_count, 0) > 0
      or coalesce(v_decision.base_notes_count, 0) > 0 then
      v_result_status := 'rejected';
      v_blocker_reason := 'unexpected_note_pyramid_present';
      v_rejected_count := v_rejected_count + 1;
    elseif coalesce(v_decision.has_final_facets, false)
      or coalesce(v_decision.has_final_roles, false)
      or coalesce(v_decision.has_taxonomy_review, false) then
      v_result_status := 'rejected';
      v_blocker_reason := 'existing_final_taxonomy_present';
      v_rejected_count := v_rejected_count + 1;
    elseif coalesce(v_decision.proposal_count, 0) > 0 then
      v_result_status := 'rejected';
      v_blocker_reason := 'taxonomy_proposal_already_exists';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_review_status = 'official_notes_accepted_for_classifier_review'
      and v_decision.requested_next_action <> 'controlled_classifier_review_candidate_notes_only' then
      v_result_status := 'rejected';
      v_blocker_reason := 'accepted_status_requires_notes_only_classifier_next_action';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_review_status = 'official_notes_accepted_for_classifier_review'
      and coalesce(v_decision.notes_count, 0) < 4 then
      v_result_status := 'rejected';
      v_blocker_reason := 'accepted_status_requires_at_least_four_notes';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_review_status = 'official_notes_accepted_for_classifier_review'
      and coalesce(v_decision.source_confidence_numeric, 0) < 0.95 then
      v_result_status := 'rejected';
      v_blocker_reason := 'accepted_status_requires_high_source_confidence';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_review_status = 'official_notes_needs_manual_review'
      and v_decision.requested_next_action <> 'manual_notes_review' then
      v_result_status := 'rejected';
      v_blocker_reason := 'manual_review_status_requires_manual_notes_review_action';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_review_status = 'official_notes_too_thin'
      and v_decision.requested_next_action <> 'keep_held' then
      v_result_status := 'rejected';
      v_blocker_reason := 'too_thin_status_requires_keep_held_action';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_review_status = 'official_notes_rejected_identity_or_payload'
      and v_decision.requested_next_action not in ('identity_review', 'payload_review', 'keep_held') then
      v_result_status := 'rejected';
      v_blocker_reason := 'rejected_identity_or_payload_requires_identity_or_payload_action';
      v_rejected_count := v_rejected_count + 1;
    else
      if p_dry_run then
        v_would_decide_count := v_would_decide_count + 1;
        v_result_status := 'would_decide';
      else
        if v_decision.current_review_id is not null then
          update public.fragrance_official_notes_reviews_v1
          set
            review_status = 'official_notes_superseded',
            superseded_at = statement_timestamp()
          where id = v_decision.current_review_id
            and superseded_at is null
            and review_status <> 'official_notes_superseded';
        end if;

        insert into public.fragrance_official_notes_reviews_v1 (
          fragrance_id,
          review_status,
          actor_label,
          decision_reason,
          recommended_next_action,
          queue_state,
          queue_lane,
          blocker_reason,
          evidence_quality_state,
          product_priority_score,
          product_priority_reason,
          source_confidence,
          source_evidence_type,
          source_limitation_reason,
          notes_count,
          top_notes_count,
          heart_notes_count,
          base_notes_count,
          performance_refresh_satisfied,
          has_final_facets,
          has_final_roles,
          has_taxonomy_review,
          has_taxonomy_proposal,
          selected_official_source_backfill_audit_id,
          refresh_run_id,
          source_queue_model_version,
          evidence_snapshot,
          queue_snapshot,
          source_snapshot,
          review_snapshot,
          supersedes_review_id
        )
        values (
          v_decision.fragrance_id,
          v_decision.requested_review_status,
          v_actor_label,
          v_decision.decision_reason,
          v_decision.requested_next_action,
          v_decision.live_queue_state,
          v_decision.live_queue_lane,
          v_decision.live_blocker_reason,
          v_decision.evidence_quality_state,
          v_decision.product_priority_score,
          v_decision.product_priority_reason,
          v_decision.source_confidence_numeric,
          v_decision.official_source_evidence_type,
          v_decision.official_source_limitation_reason,
          v_decision.notes_count,
          v_decision.top_notes_count,
          v_decision.heart_notes_count,
          v_decision.base_notes_count,
          v_decision.performance_refresh_satisfied,
          v_decision.has_final_facets,
          v_decision.has_final_roles,
          v_decision.has_taxonomy_review,
          (coalesce(v_decision.proposal_count, 0) > 0),
          v_decision.selected_official_source_backfill_audit_id,
          null,
          'taxonomy_operationalization_queue_v2_6_official_notes_2026_05_27',
          coalesce(v_decision.evidence_summary, '{}'::jsonb),
          jsonb_strip_nulls(jsonb_build_object(
            'queue_state', v_decision.live_queue_state,
            'queue_lane', v_decision.live_queue_lane,
            'blocker_reason', v_decision.live_blocker_reason,
            'recommended_next_action', v_decision.live_recommended_next_action
          )),
          jsonb_strip_nulls(jsonb_build_object(
            'name', v_decision.name,
            'brand', v_decision.brand,
            'family_key', v_decision.family_key,
            'source_url', v_decision.source_url,
            'source_confidence', v_decision.source_confidence_numeric,
            'source_evidence_type', v_decision.official_source_evidence_type,
            'source_limitation_reason', v_decision.official_source_limitation_reason,
            'notes_count', v_decision.notes_count,
            'top_notes_count', v_decision.top_notes_count,
            'heart_notes_count', v_decision.heart_notes_count,
            'base_notes_count', v_decision.base_notes_count
          )),
          jsonb_strip_nulls(jsonb_build_object(
            'requested_review_status', v_decision.requested_review_status,
            'decision_reason', v_decision.decision_reason,
            'recommended_next_action', v_decision.requested_next_action,
            'review_scope', 'official_notes_only_review_gate_v1'
          )),
          v_decision.current_review_id
        )
        returning id into v_new_review_id;

        v_decided_count := v_decided_count + 1;
        v_result_status := 'decided';
      end if;
    end if;

    v_results := v_results || jsonb_build_array(
      jsonb_strip_nulls(
        jsonb_build_object(
          'fragrance_id', coalesce(v_decision.fragrance_id, null),
          'name', v_decision.name,
          'brand', v_decision.brand,
          'old_review_id', v_decision.current_review_id,
          'new_review_id', v_new_review_id,
          'old_review_status', v_decision.current_review_status,
          'new_review_status', case
            when v_result_status in ('would_decide', 'decided') then v_decision.requested_review_status
            else null
          end,
          'decision_reason', v_decision.decision_reason,
          'recommended_next_action', v_decision.requested_next_action,
          'result_status', v_result_status,
          'blocker_reason', v_blocker_reason,
          'notes_count', v_decision.notes_count,
          'source_confidence', v_decision.source_confidence_numeric
        )
      )
    );
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

comment on function public.decide_fragrance_official_notes_reviews_v1(jsonb, text, boolean) is
  'Creates or previews explicit review decisions for official notes-only rows only. It supersedes prior active notes-review decisions when needed and inserts auditable decision memory without mutating public.fragrances, writing taxonomy, creating proposals, accepting proposals, refreshing performance, or refreshing the queue.';

revoke all on function public.decide_fragrance_official_notes_reviews_v1(jsonb, text, boolean)
  from public, anon, authenticated;
grant execute on function public.decide_fragrance_official_notes_reviews_v1(jsonb, text, boolean)
  to service_role;

create or replace view public.taxonomy_operationalization_queue_v2_7
with (security_invoker = true)
as
with joined as (
  select
    q.*,
    r.latest_review_id,
    r.review_status as official_notes_review_status,
    r.actor_label as official_notes_review_actor_label,
    r.decision_reason as official_notes_review_reason,
    r.recommended_next_action as official_notes_review_next_action,
    r.created_at as official_notes_review_created_at,
    r.review_snapshot as official_notes_review_snapshot
  from public.taxonomy_operationalization_queue_v2_6 q
  left join public.fragrance_official_notes_review_latest_v1 r
    on r.fragrance_id = q.fragrance_id
)
select
  j.fragrance_id,
  j.name,
  j.brand,
  j.family_key,
  j.legacy_family_key,
  j.universal_family_key,
  j.evidence_quality_state,
  case
    when j.queue_state = 'official_notes_pending_review'
      and j.queue_lane = 'official_notes_review'
      and j.official_notes_review_status = 'official_notes_accepted_for_classifier_review'
    then 'official_notes_accepted_pending_classifier_review'
    else j.queue_state
  end as queue_state,
  case
    when j.queue_state = 'official_notes_pending_review'
      and j.queue_lane = 'official_notes_review'
      and j.official_notes_review_status = 'official_notes_accepted_for_classifier_review'
    then nullif(concat_ws(
      ';',
      'official_notes_review_accepted',
      case
        when j.latest_review_id is not null
          then 'official_notes_review_id=' || j.latest_review_id::text
      end,
      case
        when j.official_notes_review_status is not null
          then 'review_status=' || j.official_notes_review_status
      end,
      case
        when j.official_notes_review_created_at is not null
          then 'review_created_at=' || j.official_notes_review_created_at::text
      end
    ), '')
    when j.queue_state = 'official_notes_pending_review'
      and j.queue_lane = 'official_notes_review'
      and j.official_notes_review_status in (
        'official_notes_needs_manual_review',
        'official_notes_too_thin',
        'official_notes_rejected_identity_or_payload'
      )
    then nullif(concat_ws(
      ';',
      j.blocker_reason,
      case
        when j.latest_review_id is not null
          then 'official_notes_review_id=' || j.latest_review_id::text
      end,
      case
        when j.official_notes_review_status is not null
          then 'review_status=' || j.official_notes_review_status
      end
    ), '')
    else j.blocker_reason
  end as blocker_reason,
  case
    when j.queue_state = 'official_notes_pending_review'
      and j.queue_lane = 'official_notes_review'
      and j.official_notes_review_status = 'official_notes_accepted_for_classifier_review'
    then 'controlled_classifier_review_candidate_notes_only'
    when j.queue_state = 'official_notes_pending_review'
      and j.queue_lane = 'official_notes_review'
      and j.official_notes_review_status in (
        'official_notes_needs_manual_review',
        'official_notes_too_thin',
        'official_notes_rejected_identity_or_payload'
      )
    then coalesce(j.official_notes_review_next_action, j.recommended_next_action)
    else j.recommended_next_action
  end as recommended_next_action,
  case
    when j.queue_state = 'official_notes_pending_review'
      and j.queue_lane = 'official_notes_review'
      and j.official_notes_review_status = 'official_notes_accepted_for_classifier_review'
    then 'controlled_classifier_review'
    else j.queue_lane
  end as queue_lane,
  coalesce(j.product_priority_score, 0)::integer as product_priority_score,
  nullif(concat_ws(
    ', ',
    j.product_priority_reason,
    case
      when j.official_notes_review_status = 'official_notes_accepted_for_classifier_review'
        then 'official_notes_review_accepted_for_classifier'
      when j.official_notes_review_status = 'official_notes_needs_manual_review'
        then 'official_notes_review_hold'
      when j.official_notes_review_status = 'official_notes_too_thin'
        then 'official_notes_review_too_thin'
      when j.official_notes_review_status = 'official_notes_rejected_identity_or_payload'
        then 'official_notes_review_rejected'
    end
  ), '') as product_priority_reason,
  j.taxonomy_missing_summary,
  jsonb_strip_nulls(
    coalesce(j.evidence_summary, '{}'::jsonb)
    || jsonb_build_object(
      'official_notes_review',
      jsonb_strip_nulls(
        jsonb_build_object(
          'has_official_notes_review', j.latest_review_id is not null,
          'official_notes_review_id', j.latest_review_id,
          'review_status', j.official_notes_review_status,
          'decision_reason', j.official_notes_review_reason,
          'recommended_next_action', j.official_notes_review_next_action,
          'actor_label', j.official_notes_review_actor_label,
          'created_at', j.official_notes_review_created_at,
          'review_snapshot', j.official_notes_review_snapshot
        )
      )
    )
  ) as evidence_summary,
  j.resolver_evidence_summary,
  j.canonical_identity_evidence_summary,
  j.canonical_identity_decision_summary,
  j.alias_policy_summary,
  'taxonomy_operationalization_queue_v2_7_official_notes_review_2026_05_28'::text as queue_model_version,
  statement_timestamp() as generated_at
from joined j;

comment on view public.taxonomy_operationalization_queue_v2_7 is
  'Official-notes-aware operational queue v2.7. It preserves Queue v2.6 hard blockers and notes-only review routing, then allows explicit accepted official-notes review decisions to move rows into a controlled classifier-review lane marked as notes-only. It does not treat notes-only evidence as equivalent to official pyramids and does not write taxonomy or proposals.';

create or replace function public.refresh_taxonomy_operationalization_queue_current_v1(
  p_actor_label text default 'codex_queue_current_refresh_v1',
  p_reason text default 'manual_refresh',
  p_refresh_scope text default 'full',
  p_fragrance_ids uuid[] default null
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_actor_label text := coalesce(nullif(btrim(p_actor_label), ''), 'codex_queue_current_refresh_v1');
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'manual_refresh');
  v_refresh_scope text := coalesce(nullif(btrim(p_refresh_scope), ''), 'full');
  v_requested_ids uuid[] := p_fragrance_ids;
  v_refresh_run_id uuid;
  v_expected_count integer := 0;
  v_staged_count integer := 0;
  v_affected_count integer := 0;
  v_warning_count integer := 0;
  v_error_count integer := 0;
  v_warnings jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_source_queue_model_version text := null;
  v_refreshed_at timestamptz := statement_timestamp();
begin
  insert into public.taxonomy_queue_refresh_runs_v1 (
    actor_label,
    refresh_reason,
    refresh_scope,
    requested_ids,
    status,
    source_view_name,
    metadata
  )
  values (
    v_actor_label,
    v_reason,
    v_refresh_scope,
    v_requested_ids,
    'started',
    'taxonomy_operationalization_queue_v2_7',
    jsonb_build_object(
      'requested_ids_count', coalesce(cardinality(v_requested_ids), 0),
      'partial_refresh_supported', false
    )
  )
  returning id into v_refresh_run_id;

  if v_refresh_scope <> 'full' then
    v_error_count := 1;
    v_errors := jsonb_build_array(
      jsonb_build_object(
        'code', 'unsupported_refresh_scope',
        'message', 'Hybrid Queue Snapshot v1 supports full refresh only.',
        'requested_scope', v_refresh_scope
      )
    );

    update public.taxonomy_queue_refresh_runs_v1
    set
      status = 'failed',
      completed_at = statement_timestamp(),
      warning_count = v_warning_count,
      error_count = v_error_count,
      warnings = v_warnings,
      errors = v_errors,
      metadata = metadata || jsonb_build_object(
        'final_status', 'failed',
        'source_queue_model_version', v_source_queue_model_version
      )
    where id = v_refresh_run_id;

    return jsonb_build_object(
      'refresh_run_id', v_refresh_run_id,
      'status', 'failed',
      'refresh_scope', v_refresh_scope,
      'affected_count', 0,
      'source_queue_model_version', v_source_queue_model_version,
      'warnings', v_warnings,
      'errors', v_errors
    );
  end if;

  begin
    drop table if exists pg_temp.tmp_taxonomy_operationalization_queue_current_v1;

    create temporary table tmp_taxonomy_operationalization_queue_current_v1
    on commit drop
    as
    select
      q.fragrance_id,
      q.name,
      q.brand,
      q.family_key,
      q.legacy_family_key,
      q.universal_family_key,
      q.evidence_quality_state,
      q.queue_state,
      q.queue_lane,
      q.blocker_reason,
      q.recommended_next_action,
      coalesce(q.product_priority_score, 0)::integer as product_priority_score,
      q.product_priority_reason,
      coalesce(q.taxonomy_missing_summary, '{}'::jsonb) as taxonomy_missing_summary,
      coalesce(q.evidence_summary, '{}'::jsonb) as evidence_summary,
      coalesce(q.resolver_evidence_summary, '{}'::jsonb) as resolver_evidence_summary,
      coalesce(q.canonical_identity_evidence_summary, '{}'::jsonb) as canonical_identity_evidence_summary,
      coalesce(q.canonical_identity_decision_summary, '{}'::jsonb) as canonical_identity_decision_summary,
      coalesce(q.alias_policy_summary, '{}'::jsonb) as alias_policy_summary,
      'taxonomy_operationalization_queue_current_v1_snapshot_2026_05_24'::text as queue_model_version,
      q.queue_model_version as source_queue_model_version,
      'taxonomy_operationalization_queue_v2_7'::text as source_view_name,
      jsonb_build_object(
        'source_generated_at', q.generated_at,
        'source_queue_state', q.queue_state,
        'source_queue_lane', q.queue_lane,
        'has_taxonomy_missing_summary', q.taxonomy_missing_summary is not null,
        'has_evidence_summary', q.evidence_summary is not null,
        'has_resolver_evidence_summary', q.resolver_evidence_summary is not null,
        'has_canonical_identity_evidence_summary', q.canonical_identity_evidence_summary is not null,
        'has_canonical_identity_decision_summary', q.canonical_identity_decision_summary is not null,
        'has_alias_policy_summary', q.alias_policy_summary is not null,
        'has_provenance_summary', coalesce(q.evidence_summary ? 'provenance', false),
        'provenance_summary', coalesce(
          q.evidence_summary -> 'provenance',
          jsonb_build_object('has_provenance_review', false)
        ),
        'has_official_source_summary', coalesce(q.evidence_summary ? 'official_source', false),
        'official_source_summary', coalesce(
          q.evidence_summary -> 'official_source',
          jsonb_build_object('has_official_source_backfill', false)
        ),
        'has_official_notes_review_summary', coalesce(q.evidence_summary ? 'official_notes_review', false),
        'official_notes_review_summary', coalesce(
          q.evidence_summary -> 'official_notes_review',
          jsonb_build_object('has_official_notes_review', false)
        )
      ) as source_snapshot_summary,
      v_refresh_run_id as refresh_run_id,
      v_refreshed_at as refreshed_at,
      v_refreshed_at as created_at,
      v_refreshed_at as updated_at
    from public.taxonomy_operationalization_queue_v2_7 q;

    select count(*)::integer
    into v_expected_count
    from public.fragrances;

    select count(*)::integer
    into v_staged_count
    from tmp_taxonomy_operationalization_queue_current_v1;

    if v_staged_count = 0 then
      raise exception 'queue_current_refresh_empty_source';
    end if;

    if v_staged_count <> v_expected_count then
      raise exception 'queue_current_refresh_count_mismatch: expected %, staged %', v_expected_count, v_staged_count;
    end if;

    select min(source_queue_model_version)
    into v_source_queue_model_version
    from tmp_taxonomy_operationalization_queue_current_v1;

    if exists (
      select 1
      from tmp_taxonomy_operationalization_queue_current_v1
      group by source_queue_model_version
      having count(*) > 0
      offset 1
    ) then
      v_warning_count := 1;
      v_warnings := jsonb_build_array(
        jsonb_build_object(
          'code', 'multiple_source_queue_model_versions',
          'message', 'Queue v2.7 returned more than one source queue model version during refresh.'
        )
      );
    end if;

    delete from public.taxonomy_operationalization_queue_current_v1
    where true;

    insert into public.taxonomy_operationalization_queue_current_v1 (
      fragrance_id,
      name,
      brand,
      family_key,
      legacy_family_key,
      universal_family_key,
      evidence_quality_state,
      queue_state,
      queue_lane,
      blocker_reason,
      recommended_next_action,
      product_priority_score,
      product_priority_reason,
      taxonomy_missing_summary,
      evidence_summary,
      resolver_evidence_summary,
      canonical_identity_evidence_summary,
      canonical_identity_decision_summary,
      alias_policy_summary,
      queue_model_version,
      source_queue_model_version,
      source_view_name,
      source_snapshot_summary,
      refresh_run_id,
      refreshed_at,
      created_at,
      updated_at
    )
    select
      fragrance_id,
      name,
      brand,
      family_key,
      legacy_family_key,
      universal_family_key,
      evidence_quality_state,
      queue_state,
      queue_lane,
      blocker_reason,
      recommended_next_action,
      product_priority_score,
      product_priority_reason,
      taxonomy_missing_summary,
      evidence_summary,
      resolver_evidence_summary,
      canonical_identity_evidence_summary,
      canonical_identity_decision_summary,
      alias_policy_summary,
      queue_model_version,
      source_queue_model_version,
      source_view_name,
      source_snapshot_summary,
      refresh_run_id,
      refreshed_at,
      created_at,
      updated_at
    from tmp_taxonomy_operationalization_queue_current_v1;

    get diagnostics v_affected_count = row_count;

    update public.taxonomy_queue_refresh_runs_v1
    set
      status = case
        when v_warning_count > 0 then 'completed_with_warnings'
        else 'completed'
      end,
      completed_at = statement_timestamp(),
      affected_count = v_affected_count,
      source_queue_model_version = v_source_queue_model_version,
      source_view_name = 'taxonomy_operationalization_queue_v2_7',
      warning_count = v_warning_count,
      error_count = v_error_count,
      warnings = v_warnings,
      errors = v_errors,
      metadata = metadata || jsonb_build_object(
        'expected_count', v_expected_count,
        'staged_count', v_staged_count,
        'final_status', case
          when v_warning_count > 0 then 'completed_with_warnings'
          else 'completed'
        end,
        'queue_model_version', 'taxonomy_operationalization_queue_current_v1_snapshot_2026_05_24',
        'source_view_name', 'taxonomy_operationalization_queue_v2_7'
      )
    where id = v_refresh_run_id;
  exception
    when others then
      v_error_count := greatest(v_error_count, 1);
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object(
          'code', 'refresh_failed',
          'message', sqlerrm,
          'sqlstate', sqlstate
        )
      );

      update public.taxonomy_queue_refresh_runs_v1
      set
        status = 'failed',
        completed_at = statement_timestamp(),
        affected_count = 0,
        source_queue_model_version = v_source_queue_model_version,
        source_view_name = 'taxonomy_operationalization_queue_v2_7',
        warning_count = v_warning_count,
        error_count = v_error_count,
        warnings = v_warnings,
        errors = v_errors,
        metadata = metadata || jsonb_build_object(
          'expected_count', v_expected_count,
          'staged_count', v_staged_count,
          'final_status', 'failed',
          'queue_model_version', 'taxonomy_operationalization_queue_current_v1_snapshot_2026_05_24',
          'source_view_name', 'taxonomy_operationalization_queue_v2_7'
        )
      where id = v_refresh_run_id;

      return jsonb_build_object(
        'refresh_run_id', v_refresh_run_id,
        'status', 'failed',
        'refresh_scope', v_refresh_scope,
        'affected_count', 0,
        'source_queue_model_version', v_source_queue_model_version,
        'warnings', v_warnings,
        'errors', v_errors
      );
  end;

  return jsonb_build_object(
    'refresh_run_id', v_refresh_run_id,
    'status', case
      when v_warning_count > 0 then 'completed_with_warnings'
      else 'completed'
    end,
    'refresh_scope', v_refresh_scope,
    'affected_count', v_affected_count,
    'source_queue_model_version', v_source_queue_model_version,
    'warnings', v_warnings,
    'errors', v_errors
  );
end;
$function$;

comment on function public.refresh_taxonomy_operationalization_queue_current_v1(text, text, text, uuid[]) is
  'Refreshes the fast taxonomy operationalization queue snapshot from Queue v2.7, preserving hard blockers, official pyramid routing, official notes-only review routing, and explicit official-notes review decisions while recording a rebuild audit row.';

commit;
