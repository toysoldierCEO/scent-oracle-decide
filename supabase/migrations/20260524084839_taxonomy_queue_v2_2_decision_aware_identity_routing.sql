begin;

create or replace view public.taxonomy_canonical_identity_decision_members_v1
with (security_invoker = true)
as
select
  member.fragrance_id,
  r.canonical_identity_key,
  r.latest_review_id,
  r.decision_status,
  r.canonical_fragrance_id,
  r.alias_fragrance_ids,
  r.separate_fragrance_ids,
  r.reviewed_fragrance_ids,
  case
    when r.canonical_fragrance_id is not null and member.fragrance_id = r.canonical_fragrance_id then 'canonical_row'
    when member.fragrance_id = any(coalesce(r.alias_fragrance_ids, array[]::uuid[])) then 'alias_row'
    when member.fragrance_id = any(coalesce(r.separate_fragrance_ids, array[]::uuid[])) then 'separate_row'
    when r.decision_status = 'same_identity' and r.canonical_fragrance_id is null then 'same_identity_member_canonical_deferred'
    when r.decision_status = 'needs_review' then 'needs_review_member'
    when r.decision_status = 'do_not_merge' then 'do_not_merge_member'
    else 'decision_member'
  end as member_decision_role,
  r.decision_reason,
  r.recommended_next_action,
  r.actor_label,
  r.evidence_snapshot,
  r.cluster_snapshot,
  r.created_at,
  r.updated_at
from public.fragrance_canonical_identity_review_latest_v1 r
cross join lateral unnest(r.reviewed_fragrance_ids) as member(fragrance_id);

comment on view public.taxonomy_canonical_identity_decision_members_v1 is
  'Decision-aware expansion of the latest canonical identity review, one row per reviewed fragrance. Operational routing evidence only: no alias application, no merge, no source/taxonomy copy, and no public.fragrances mutation.';

create or replace view public.taxonomy_evidence_status_v2_2
with (security_invoker = true)
as
select
  e.*,
  (d.fragrance_id is not null) as has_canonical_identity_decision,
  d.decision_status as canonical_identity_decision_status,
  d.member_decision_role as canonical_identity_member_role,
  d.latest_review_id as canonical_identity_latest_review_id,
  d.canonical_fragrance_id as canonical_identity_canonical_fragrance_id,
  d.alias_fragrance_ids as canonical_identity_alias_fragrance_ids,
  d.separate_fragrance_ids as canonical_identity_separate_fragrance_ids,
  d.decision_reason as canonical_identity_decision_reason,
  d.recommended_next_action as canonical_identity_decision_next_action,
  jsonb_strip_nulls(jsonb_build_object(
    'has_canonical_identity_decision', d.fragrance_id is not null,
    'canonical_identity_key', d.canonical_identity_key,
    'latest_review_id', d.latest_review_id,
    'decision_status', d.decision_status,
    'member_decision_role', d.member_decision_role,
    'canonical_fragrance_id', d.canonical_fragrance_id,
    'alias_fragrance_ids', to_jsonb(d.alias_fragrance_ids),
    'separate_fragrance_ids', to_jsonb(d.separate_fragrance_ids),
    'reviewed_fragrance_ids', to_jsonb(d.reviewed_fragrance_ids),
    'decision_reason', d.decision_reason,
    'recommended_next_action', d.recommended_next_action,
    'actor_label', d.actor_label,
    'has_evidence_snapshot', d.evidence_snapshot <> '{}'::jsonb,
    'has_cluster_snapshot', d.cluster_snapshot <> '{}'::jsonb,
    'created_at', d.created_at,
    'updated_at', d.updated_at
  )) as canonical_identity_decision_summary,
  'taxonomy_evidence_status_v2_2_decision_aware_2026_05_24'::text as canonical_identity_decision_model_version
from public.taxonomy_evidence_status_v2_1 e
left join public.taxonomy_canonical_identity_decision_members_v1 d
  on d.fragrance_id = e.fragrance_id;

comment on view public.taxonomy_evidence_status_v2_2 is
  'Decision-aware evidence read model. It preserves taxonomy_evidence_status_v2_1 and adds canonical identity decision routing evidence only; decisions do not create source truth, promoted evidence, taxonomy truth, or alias application.';

create or replace view public.taxonomy_operationalization_queue_v2_2
with (security_invoker = true)
as
with base as (
  select
    e.*,
    q.queue_state as v2_1_queue_state,
    q.queue_lane as v2_1_queue_lane,
    q.blocker_reason as v2_1_blocker_reason,
    q.recommended_next_action as v2_1_recommended_next_action,
    q.product_priority_score as v2_1_product_priority_score,
    q.product_priority_reason as v2_1_product_priority_reason,
    q.taxonomy_missing_summary as v2_1_taxonomy_missing_summary,
    q.evidence_summary as v2_1_evidence_summary,
    q.resolver_evidence_summary as v2_1_resolver_evidence_summary,
    q.canonical_identity_evidence_summary as v2_1_canonical_identity_evidence_summary
  from public.taxonomy_evidence_status_v2_2 e
  join public.taxonomy_operationalization_queue_v2_1 q
    on q.fragrance_id = e.fragrance_id
),
classified as (
  select
    b.*,
    case
      when b.v2_1_queue_state in ('blocked_rejected_match', 'contaminated_data') then b.v2_1_queue_state
      when b.has_canonical_identity_decision
        and (
          b.canonical_identity_member_role = 'alias_row'
          or (
            b.canonical_identity_decision_status in ('canonical_selected', 'alias_confirmed')
            and b.canonical_identity_canonical_fragrance_id is not null
            and b.canonical_identity_member_role = 'decision_member'
          )
        ) then 'canonical_alias_pending_policy'
      when b.v2_1_queue_state = 'already_complete' then 'already_complete'
      when b.has_canonical_identity_decision
        and b.canonical_identity_decision_status = 'same_identity'
        and b.canonical_identity_canonical_fragrance_id is null then 'canonical_selection_deferred'
      when b.has_canonical_identity_decision
        and b.canonical_identity_decision_status in ('canonical_selected', 'alias_confirmed')
        and b.canonical_identity_member_role = 'canonical_row' then 'canonical_identity_decided'
      when b.has_canonical_identity_decision
        and b.canonical_identity_decision_status = 'do_not_merge' then 'canonical_do_not_merge'
      when b.has_canonical_identity_decision
        and b.canonical_identity_decision_status = 'separate_identity' then 'canonical_separate_identity'
      when b.has_canonical_identity_decision
        and b.canonical_identity_decision_status = 'needs_manual_source_review' then 'manual_source_needed'
      when b.v2_1_queue_state = 'canonical_name_conflict'
        and not b.has_canonical_identity_decision then 'canonical_name_conflict'
      else b.v2_1_queue_state
    end as queue_state_v2_2
  from base b
)
select
  c.fragrance_id,
  c.name,
  c.brand,
  c.family_key,
  c.legacy_family_key,
  c.universal_family_key,
  c.evidence_quality_state,
  c.queue_state_v2_2 as queue_state,
  case
    when c.queue_state_v2_2 = 'canonical_alias_pending_policy' then nullif(concat_ws(
      ';',
      'canonical_alias_pending_policy',
      case when c.canonical_identity_key is not null then 'canonical_identity_key=' || c.canonical_identity_key end,
      case when c.canonical_identity_canonical_fragrance_id is not null then 'canonical_fragrance_id=' || c.canonical_identity_canonical_fragrance_id::text end,
      c.canonical_identity_decision_status
    ), '')
    when c.queue_state_v2_2 = 'canonical_selection_deferred' then nullif(concat_ws(
      ';',
      'same_identity_canonical_selection_deferred',
      case when c.canonical_identity_key is not null then 'canonical_identity_key=' || c.canonical_identity_key end
    ), '')
    when c.queue_state_v2_2 = 'canonical_identity_decided' then nullif(concat_ws(
      ';',
      'canonical_identity_decided',
      case when c.canonical_identity_key is not null then 'canonical_identity_key=' || c.canonical_identity_key end,
      case when c.canonical_identity_canonical_fragrance_id is not null then 'canonical_fragrance_id=' || c.canonical_identity_canonical_fragrance_id::text end,
      c.v2_1_blocker_reason
    ), '')
    when c.queue_state_v2_2 = 'canonical_do_not_merge' then nullif(concat_ws(
      ';',
      'canonical_do_not_merge',
      case when c.canonical_identity_key is not null then 'canonical_identity_key=' || c.canonical_identity_key end
    ), '')
    when c.queue_state_v2_2 = 'canonical_separate_identity' then nullif(concat_ws(
      ';',
      'canonical_separate_identity',
      case when c.canonical_identity_key is not null then 'canonical_identity_key=' || c.canonical_identity_key end
    ), '')
    when c.queue_state_v2_2 = 'manual_source_needed'
      and c.has_canonical_identity_decision
      and c.canonical_identity_decision_status = 'needs_manual_source_review' then coalesce(c.canonical_identity_decision_reason, 'needs_manual_source_review')
    else c.v2_1_blocker_reason
  end as blocker_reason,
  case
    when c.queue_state_v2_2 = 'canonical_alias_pending_policy' then coalesce(c.canonical_identity_decision_next_action, 'block_alias_from_enrichment_until_alias_policy')
    when c.queue_state_v2_2 = 'canonical_selection_deferred' then coalesce(c.canonical_identity_decision_next_action, 'select_canonical_row_or_manual_source_review')
    when c.queue_state_v2_2 = 'canonical_identity_decided' then coalesce(c.v2_1_recommended_next_action, 'work_selected_canonical_row_using_evidence_needs')
    when c.queue_state_v2_2 = 'canonical_do_not_merge' then coalesce(c.canonical_identity_decision_next_action, 'work_rows_independently_without_merge')
    when c.queue_state_v2_2 = 'canonical_separate_identity' then coalesce(c.canonical_identity_decision_next_action, 'work_rows_independently')
    when c.queue_state_v2_2 = 'manual_source_needed'
      and c.has_canonical_identity_decision
      and c.canonical_identity_decision_status = 'needs_manual_source_review' then coalesce(c.canonical_identity_decision_next_action, 'manual_source_acquisition')
    else c.v2_1_recommended_next_action
  end as recommended_next_action,
  case
    when c.queue_state_v2_2 = 'canonical_alias_pending_policy' then 'canonical_alias_policy'
    when c.queue_state_v2_2 = 'already_complete' then 'complete_no_action'
    when c.queue_state_v2_2 = 'canonical_selection_deferred' then 'canonical_selection_needed'
    when c.queue_state_v2_2 in ('canonical_identity_decided', 'canonical_do_not_merge', 'canonical_separate_identity') then 'canonical_identity_resolved'
    when c.queue_state_v2_2 = 'canonical_name_conflict' then 'canonical_identity_review'
    else c.v2_1_queue_lane
  end as queue_lane,
  least(
    100,
    coalesce(c.v2_1_product_priority_score, 0)
    + case
        when c.queue_state_v2_2 = 'canonical_alias_pending_policy' then 4
        when c.queue_state_v2_2 = 'canonical_selection_deferred' then 3
        when c.queue_state_v2_2 = 'canonical_identity_decided' then 2
        when c.queue_state_v2_2 in ('canonical_do_not_merge', 'canonical_separate_identity') then 1
        else 0
      end
  )::integer as product_priority_score,
  nullif(concat_ws(
    ', ',
    c.v2_1_product_priority_reason,
    case
      when c.queue_state_v2_2 = 'canonical_alias_pending_policy' then 'canonical_alias_pending_policy'
      when c.queue_state_v2_2 = 'canonical_selection_deferred' then 'canonical_selection_deferred'
      when c.queue_state_v2_2 = 'canonical_identity_decided' then 'canonical_identity_decided'
      when c.queue_state_v2_2 = 'canonical_do_not_merge' then 'canonical_do_not_merge'
      when c.queue_state_v2_2 = 'canonical_separate_identity' then 'canonical_separate_identity'
    end
  ), '') as product_priority_reason,
  c.v2_1_taxonomy_missing_summary as taxonomy_missing_summary,
  c.v2_1_evidence_summary as evidence_summary,
  c.v2_1_resolver_evidence_summary as resolver_evidence_summary,
  c.v2_1_canonical_identity_evidence_summary as canonical_identity_evidence_summary,
  c.canonical_identity_decision_summary,
  'taxonomy_operationalization_queue_v2_2_decision_aware_2026_05_24'::text as queue_model_version,
  statement_timestamp() as generated_at
from classified c;

comment on view public.taxonomy_operationalization_queue_v2_2 is
  'Decision-aware operational queue. Additive read model that preserves Queue v2.1 behavior while reading canonical identity decisions as routing evidence only. It does not apply aliases, merge rows, copy source/taxonomy/evidence, mutate public.fragrances, or replace earlier queue versions destructively.';

revoke all on public.taxonomy_canonical_identity_decision_members_v1 from public, anon, authenticated;
revoke all on public.taxonomy_evidence_status_v2_2 from public, anon, authenticated;
revoke all on public.taxonomy_operationalization_queue_v2_2 from public, anon, authenticated;

grant select on public.taxonomy_canonical_identity_decision_members_v1 to service_role;
grant select on public.taxonomy_evidence_status_v2_2 to service_role;
grant select on public.taxonomy_operationalization_queue_v2_2 to service_role;

commit;
