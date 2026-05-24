begin;

create or replace view public.taxonomy_alias_policy_latest_v1
with (security_invoker = true)
as
with active_aliases as (
  select
    a.id as alias_id,
    a.canonical_identity_key,
    a.decision_review_id,
    a.canonical_fragrance_id,
    a.alias_fragrance_id,
    a.alias_status,
    a.alias_reason,
    a.recommended_next_action,
    a.decision_snapshot,
    a.evidence_snapshot,
    a.cluster_snapshot,
    a.created_at,
    a.updated_at
  from public.fragrance_canonical_aliases_v1 a
  where a.alias_status = 'active'
    and a.superseded_at is null
)
select
  r.source_fragrance_id,
  r.source_name,
  r.source_brand,
  r.is_alias,
  r.alias_id,
  r.alias_status,
  coalesce(
    case
      when r.is_alias then 'alias_row'
      when r.resolution_status = 'canonical_target' then 'canonical_row'
      else 'self'
    end,
    'self'
  ) as alias_member_role,
  r.canonical_identity_key,
  r.decision_review_id,
  r.canonical_fragrance_id,
  r.canonical_name,
  r.canonical_brand,
  a.alias_reason,
  r.recommended_next_action,
  r.created_at as alias_created_at,
  r.updated_at as alias_updated_at,
  r.resolution_status,
  r.resolution_reason,
  coalesce(a.decision_snapshot <> '{}'::jsonb, false) as has_decision_snapshot,
  coalesce(a.evidence_snapshot <> '{}'::jsonb, false) as has_evidence_snapshot,
  coalesce(a.cluster_snapshot <> '{}'::jsonb, false) as has_cluster_snapshot
from public.fragrance_canonical_resolution_v1 r
left join active_aliases a
  on a.alias_id = r.alias_id;

comment on view public.taxonomy_alias_policy_latest_v1 is
  'Alias-policy-aware read model for backend routing. It resolves every fragrance row through the active alias mapping layer without hiding rows, applying aliases to app payloads, merging rows, copying evidence, or mutating public.fragrances.';

create or replace view public.taxonomy_evidence_status_v2_3
with (security_invoker = true)
as
select
  e.*,
  coalesce(a.is_alias and a.alias_status = 'active', false) as has_active_alias_mapping,
  coalesce(a.is_alias, false) as is_alias_row,
  a.alias_id,
  a.alias_status,
  a.alias_member_role,
  a.canonical_identity_key as alias_canonical_identity_key,
  a.canonical_fragrance_id as alias_canonical_fragrance_id,
  a.canonical_name as alias_canonical_name,
  a.canonical_brand as alias_canonical_brand,
  a.decision_review_id as alias_decision_review_id,
  a.resolution_status as alias_resolution_status,
  a.recommended_next_action as alias_recommended_next_action,
  jsonb_strip_nulls(jsonb_build_object(
    'has_active_alias_mapping', coalesce(a.is_alias and a.alias_status = 'active', false),
    'is_alias_row', coalesce(a.is_alias, false),
    'alias_id', a.alias_id,
    'alias_status', a.alias_status,
    'member_role', a.alias_member_role,
    'canonical_identity_key', a.canonical_identity_key,
    'decision_review_id', a.decision_review_id,
    'canonical_fragrance_id', a.canonical_fragrance_id,
    'canonical_name', a.canonical_name,
    'canonical_brand', a.canonical_brand,
    'alias_reason', a.alias_reason,
    'recommended_next_action', a.recommended_next_action,
    'resolution_status', a.resolution_status,
    'resolution_reason', a.resolution_reason,
    'has_decision_snapshot', a.has_decision_snapshot,
    'has_evidence_snapshot', a.has_evidence_snapshot,
    'has_cluster_snapshot', a.has_cluster_snapshot,
    'alias_created_at', a.alias_created_at,
    'alias_updated_at', a.alias_updated_at
  )) as alias_policy_summary,
  'taxonomy_evidence_status_v2_3_alias_policy_2026_05_24'::text as alias_policy_model_version
from public.taxonomy_evidence_status_v2_2 e
left join public.taxonomy_alias_policy_latest_v1 a
  on a.source_fragrance_id = e.fragrance_id;

comment on view public.taxonomy_evidence_status_v2_3 is
  'Alias-policy-aware evidence read model. It preserves taxonomy_evidence_status_v2_2 and adds alias mapping routing evidence only; alias fields do not create source truth, promoted evidence, taxonomy truth, or app-facing alias behavior.';

create or replace view public.taxonomy_operationalization_queue_v2_3
with (security_invoker = true)
as
with base as (
  select
    e.*,
    q.queue_state as v2_2_queue_state,
    q.queue_lane as v2_2_queue_lane,
    q.blocker_reason as v2_2_blocker_reason,
    q.recommended_next_action as v2_2_recommended_next_action,
    q.product_priority_score as v2_2_product_priority_score,
    q.product_priority_reason as v2_2_product_priority_reason,
    q.taxonomy_missing_summary as v2_2_taxonomy_missing_summary,
    q.evidence_summary as v2_2_evidence_summary,
    q.resolver_evidence_summary as v2_2_resolver_evidence_summary,
    q.canonical_identity_evidence_summary as v2_2_canonical_identity_evidence_summary,
    q.canonical_identity_decision_summary as v2_2_canonical_identity_decision_summary
  from public.taxonomy_evidence_status_v2_3 e
  join public.taxonomy_operationalization_queue_v2_2 q
    on q.fragrance_id = e.fragrance_id
),
classified as (
  select
    b.*,
    case
      when b.v2_2_queue_state in ('blocked_rejected_match', 'contaminated_data') then b.v2_2_queue_state
      when b.is_alias_row and b.alias_status = 'active' then 'canonical_alias_policy_blocked'
      when b.v2_2_queue_state = 'already_complete' then 'already_complete'
      when b.v2_2_queue_state = 'canonical_selection_deferred' then 'canonical_selection_deferred'
      when b.v2_2_queue_state = 'canonical_identity_decided' then 'canonical_identity_decided'
      when b.v2_2_queue_state in (
        'canonical_do_not_merge',
        'canonical_separate_identity',
        'canonical_name_conflict',
        'provider_duplicate_reuse',
        'resolver_identity_conflict',
        'source_resolver_tuning_needed',
        'manual_source_needed',
        'source_gap_unattempted',
        'source_gap',
        'insufficient_evidence',
        'ready_existing_evidence',
        'needs_wear_test',
        'manual_review',
        'unknown'
      ) then b.v2_2_queue_state
      else b.v2_2_queue_state
    end as queue_state_v2_3
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
  c.queue_state_v2_3 as queue_state,
  case
    when c.queue_state_v2_3 = 'canonical_alias_policy_blocked' then nullif(concat_ws(
      ';',
      'canonical_alias_policy_blocked',
      case when c.alias_id is not null then 'alias_id=' || c.alias_id::text end,
      case when c.alias_canonical_identity_key is not null then 'canonical_identity_key=' || c.alias_canonical_identity_key end,
      case when c.alias_canonical_fragrance_id is not null then 'canonical_fragrance_id=' || c.alias_canonical_fragrance_id::text end,
      case when c.alias_status is not null then 'alias_status=' || c.alias_status end
    ), '')
    else c.v2_2_blocker_reason
  end as blocker_reason,
  case
    when c.queue_state_v2_3 = 'canonical_alias_policy_blocked' then coalesce(
      c.alias_recommended_next_action,
      'route_future_work_to_canonical_fragrance'
    )
    else c.v2_2_recommended_next_action
  end as recommended_next_action,
  case
    when c.queue_state_v2_3 = 'canonical_alias_policy_blocked' then 'canonical_alias_policy'
    else c.v2_2_queue_lane
  end as queue_lane,
  coalesce(c.v2_2_product_priority_score, 0)::integer as product_priority_score,
  nullif(concat_ws(
    ', ',
    c.v2_2_product_priority_reason,
    case
      when c.queue_state_v2_3 = 'canonical_alias_policy_blocked' then 'active_alias_policy_block'
    end
  ), '') as product_priority_reason,
  c.v2_2_taxonomy_missing_summary as taxonomy_missing_summary,
  c.v2_2_evidence_summary as evidence_summary,
  c.v2_2_resolver_evidence_summary as resolver_evidence_summary,
  c.v2_2_canonical_identity_evidence_summary as canonical_identity_evidence_summary,
  c.v2_2_canonical_identity_decision_summary as canonical_identity_decision_summary,
  c.alias_policy_summary,
  'taxonomy_operationalization_queue_v2_3_alias_policy_2026_05_24'::text as queue_model_version,
  statement_timestamp() as generated_at
from classified c;

comment on view public.taxonomy_operationalization_queue_v2_3 is
  'Alias-policy-aware operational queue. Additive read model that preserves Queue v2.2 behavior while reading active alias mappings as routing evidence only. It does not apply aliases to app payloads, merge rows, copy source/taxonomy/evidence, rewrite user history, mutate public.fragrances, or replace earlier queue versions destructively.';

revoke all on public.taxonomy_alias_policy_latest_v1 from public, anon, authenticated;
revoke all on public.taxonomy_evidence_status_v2_3 from public, anon, authenticated;
revoke all on public.taxonomy_operationalization_queue_v2_3 from public, anon, authenticated;

grant select on public.taxonomy_alias_policy_latest_v1 to service_role;
grant select on public.taxonomy_evidence_status_v2_3 to service_role;
grant select on public.taxonomy_operationalization_queue_v2_3 to service_role;

commit;
