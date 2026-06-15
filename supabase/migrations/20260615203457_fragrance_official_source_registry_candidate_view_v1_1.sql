begin;

create or replace view public.fragrance_official_source_registry_candidate_view_v1
with (security_invoker = true)
as
with registry_base as (
  select
    r.id as registry_id,
    r.fragrance_id,
    r.name_snapshot as fragrance_name,
    r.brand_snapshot as brand_name,
    r.source_type,
    r.source_url,
    r.source_url_normalized,
    r.source_domain,
    r.source_confidence,
    r.source_retrieved_at,
    r.source_evidence_type,
    r.official_notes,
    r.official_top_notes,
    r.official_heart_notes,
    r.official_base_notes,
    r.evidence_payload,
    r.extraction_method,
    r.source_verification_summary,
    r.current_notes_snapshot,
    r.current_top_notes_snapshot,
    r.current_heart_notes_snapshot,
    r.current_base_notes_snapshot,
    r.current_source_url_snapshot,
    r.current_source_confidence_snapshot,
    r.normalized_official_notes,
    r.normalized_current_notes,
    r.comparison_status,
    r.identity_match_status,
    r.duplicate_risk,
    r.concentration_ambiguity,
    r.recommended_lane,
    r.recommended_helper,
    r.recommended_action,
    r.reason,
    r.evidence_status,
    r.review_status,
    r.supersedes_evidence_id,
    r.related_patch_audit_id,
    r.related_notes_only_audit_id,
    r.actor_label,
    r.evidence_hash,
    r.payload_hash,
    r.created_at,
    r.updated_at,
    (r.evidence_status = 'active') as active_capture_guard
  from public.fragrance_official_source_evidence_registry_v1 r
),
candidate_rows as (
  select
    rb.*,
    case
      when rb.related_patch_audit_id is not null
        or rb.related_notes_only_audit_id is not null
        or rb.review_status in ('patched', 'audit_recorded')
        or rb.recommended_action in ('already_patched', 'already_audit_recorded')
        or rb.recommended_lane = 'skip_no_action'
        then 'already_actioned_history_rows'
      when rb.duplicate_risk <> 'none'
        or rb.concentration_ambiguity <> 'none'
        or rb.identity_match_status in ('concentration_ambiguous', 'flanker_risk', 'mismatch')
        or rb.source_evidence_type in ('identity_mismatch', 'duplicate_or_flanker_risk')
        then 'duplicate_flanker_concentration_risk'
      when rb.source_evidence_type = 'official_pyramid'
        and rb.recommended_lane = 'completed_official_pyramid_patch'
        and rb.recommended_action = 'ready_for_dry_run'
        then 'ready_completed_pyramid_helper_review'
      when rb.source_evidence_type = 'official_notes_only'
        and rb.comparison_status = 'exact_match'
        and rb.recommended_lane = 'completed_official_notes_exact_lineage'
        and rb.recommended_action = 'ready_for_dry_run'
        then 'exact_match_notes_lineage_candidates'
      when rb.active_capture_guard
        and rb.recommended_action = 'ready_for_dry_run'
        and rb.recommended_helper is not null
        and rb.recommended_lane in (
          'pre_complete_official_pyramid_backfill',
          'pre_complete_official_notes_backfill',
          'completed_official_pyramid_patch',
          'completed_official_notes_exact_lineage'
        )
        and rb.duplicate_risk = 'none'
        and rb.concentration_ambiguity = 'none'
        and rb.identity_match_status not in ('concentration_ambiguous', 'flanker_risk', 'mismatch')
        and rb.evidence_status not in ('rejected', 'stale', 'superseded')
        and rb.review_status not in ('patched', 'audit_recorded', 'rejected')
        and not (
          (
            rb.source_evidence_type = 'official_pyramid'
            and rb.recommended_lane = 'completed_official_pyramid_patch'
          )
          or (
            rb.source_evidence_type = 'official_notes_only'
            and rb.comparison_status = 'exact_match'
            and rb.recommended_lane = 'completed_official_notes_exact_lineage'
          )
        )
        then 'helper_review_candidate_later_rows'
      when rb.source_evidence_type in ('official_notes_only', 'official_key_notes')
        and (
          rb.recommended_lane = 'completed_official_notes_audit_only'
          or rb.recommended_action = 'audit_only'
        )
        then 'audit_only_notes_evidence'
      when rb.source_evidence_type = 'official_prose_only'
        then 'official_prose_only_rows'
      when rb.source_evidence_type = 'ambiguous'
        then 'ambiguous_official_wording_rows'
      when rb.recommended_action in (
          'skip_weaker_existing',
          'skip_prose_only',
          'skip_ambiguous',
          'skip_identity_risk',
          'needs_human_review'
        )
        or rb.evidence_status in ('rejected', 'stale', 'superseded')
        or rb.review_status = 'rejected'
        then 'other_unsafe_or_terminal_rows'
      else 'manual_review_rows'
    end as next_action_bucket,
    case
      when rb.related_patch_audit_id is not null
        or rb.related_notes_only_audit_id is not null
        or rb.review_status in ('patched', 'audit_recorded')
        or rb.recommended_action in ('already_patched', 'already_audit_recorded')
        or rb.recommended_lane = 'skip_no_action'
        then 10
      when rb.duplicate_risk <> 'none'
        or rb.concentration_ambiguity <> 'none'
        or rb.identity_match_status in ('concentration_ambiguous', 'flanker_risk', 'mismatch')
        or rb.source_evidence_type in ('identity_mismatch', 'duplicate_or_flanker_risk')
        then 20
      when rb.source_evidence_type = 'official_pyramid'
        and rb.recommended_lane = 'completed_official_pyramid_patch'
        and rb.recommended_action = 'ready_for_dry_run'
        then 30
      when rb.source_evidence_type = 'official_notes_only'
        and rb.comparison_status = 'exact_match'
        and rb.recommended_lane = 'completed_official_notes_exact_lineage'
        and rb.recommended_action = 'ready_for_dry_run'
        then 40
      when rb.active_capture_guard
        and rb.recommended_action = 'ready_for_dry_run'
        and rb.recommended_helper is not null
        and rb.recommended_lane in (
          'pre_complete_official_pyramid_backfill',
          'pre_complete_official_notes_backfill',
          'completed_official_pyramid_patch',
          'completed_official_notes_exact_lineage'
        )
        and rb.duplicate_risk = 'none'
        and rb.concentration_ambiguity = 'none'
        and rb.identity_match_status not in ('concentration_ambiguous', 'flanker_risk', 'mismatch')
        and rb.evidence_status not in ('rejected', 'stale', 'superseded')
        and rb.review_status not in ('patched', 'audit_recorded', 'rejected')
        and not (
          (
            rb.source_evidence_type = 'official_pyramid'
            and rb.recommended_lane = 'completed_official_pyramid_patch'
          )
          or (
            rb.source_evidence_type = 'official_notes_only'
            and rb.comparison_status = 'exact_match'
            and rb.recommended_lane = 'completed_official_notes_exact_lineage'
          )
        )
        then 45
      when rb.source_evidence_type in ('official_notes_only', 'official_key_notes')
        and (
          rb.recommended_lane = 'completed_official_notes_audit_only'
          or rb.recommended_action = 'audit_only'
        )
        then 50
      when rb.source_evidence_type = 'official_prose_only' then 60
      when rb.source_evidence_type = 'ambiguous' then 70
      when rb.recommended_action in (
          'skip_weaker_existing',
          'skip_prose_only',
          'skip_ambiguous',
          'skip_identity_risk',
          'needs_human_review'
        )
        or rb.evidence_status in ('rejected', 'stale', 'superseded')
        or rb.review_status = 'rejected'
        then 80
      else 90
    end as next_action_priority,
    case
      when rb.active_capture_guard
        then 'active_already_captured_do_not_recapture'
      when rb.evidence_status in ('superseded', 'stale')
        then 'superseded_registry_evidence'
      when rb.related_patch_audit_id is not null
        or rb.related_notes_only_audit_id is not null
        or rb.review_status in ('patched', 'audit_recorded', 'rejected')
        or rb.recommended_action in ('already_patched', 'already_audit_recorded')
        or rb.recommended_lane = 'skip_no_action'
        or rb.evidence_status = 'rejected'
        then 'terminal_or_actioned_history'
      else 'capture_candidate_or_unknown'
    end as recapture_status,
    case
      when rb.active_capture_guard then 10
      when rb.evidence_status in ('superseded', 'stale') then 20
      when rb.related_patch_audit_id is not null
        or rb.related_notes_only_audit_id is not null
        or rb.review_status in ('patched', 'audit_recorded', 'rejected')
        or rb.recommended_action in ('already_patched', 'already_audit_recorded')
        or rb.recommended_lane = 'skip_no_action'
        or rb.evidence_status = 'rejected'
        then 30
      else 40
    end as recapture_priority,
    case
      when rb.active_capture_guard then false
      when rb.evidence_status in ('superseded', 'stale') then true
      when rb.related_patch_audit_id is not null
        or rb.related_notes_only_audit_id is not null
        or rb.review_status in ('patched', 'audit_recorded', 'rejected')
        or rb.recommended_action in ('already_patched', 'already_audit_recorded')
        or rb.recommended_lane = 'skip_no_action'
        or rb.evidence_status = 'rejected'
        then false
      else true
    end as batch_1c_capture_candidate,
    case
      when rb.recommended_action = 'ready_for_dry_run'
        and rb.duplicate_risk = 'none'
        and rb.concentration_ambiguity = 'none'
        and rb.identity_match_status not in ('concentration_ambiguous', 'flanker_risk', 'mismatch')
        and rb.evidence_status not in ('rejected', 'stale', 'superseded')
        and rb.review_status not in ('patched', 'audit_recorded', 'rejected')
        and (
          (
            rb.source_evidence_type = 'official_pyramid'
            and rb.recommended_lane = 'completed_official_pyramid_patch'
          )
          or (
            rb.source_evidence_type = 'official_notes_only'
            and rb.comparison_status = 'exact_match'
            and rb.recommended_lane = 'completed_official_notes_exact_lineage'
          )
        )
        then true
      else false
    end as patch_safe
  from registry_base rb
)
select
  registry_id,
  fragrance_id,
  fragrance_name,
  brand_name,
  source_type,
  source_url,
  source_url_normalized,
  source_domain,
  source_confidence,
  source_retrieved_at,
  source_evidence_type,
  official_notes,
  official_top_notes,
  official_heart_notes,
  official_base_notes,
  evidence_payload,
  extraction_method,
  source_verification_summary,
  current_notes_snapshot,
  current_top_notes_snapshot,
  current_heart_notes_snapshot,
  current_base_notes_snapshot,
  current_source_url_snapshot,
  current_source_confidence_snapshot,
  normalized_official_notes,
  normalized_current_notes,
  comparison_status,
  identity_match_status,
  duplicate_risk,
  concentration_ambiguity,
  recommended_lane,
  recommended_helper,
  recommended_action,
  reason,
  evidence_status,
  review_status,
  supersedes_evidence_id,
  related_patch_audit_id,
  related_notes_only_audit_id,
  actor_label,
  evidence_hash,
  payload_hash,
  active_capture_guard,
  next_action_bucket,
  next_action_priority,
  recapture_status,
  recapture_priority,
  batch_1c_capture_candidate,
  patch_safe,
  created_at,
  updated_at
from candidate_rows;

comment on view public.fragrance_official_source_registry_candidate_view_v1 is
  'Read-only registry review view for official source evidence. V1.1 adds helper_review_candidate_later_rows so active captured evidence that is helper-review-worthy later does not disappear into generic manual_review_rows, while patch_safe remains governed by stricter helper-ready criteria.';

comment on column public.fragrance_official_source_registry_candidate_view_v1.next_action_bucket is
  'Primary evidence-use classification for review and downstream helper planning. V1.1 adds helper_review_candidate_later_rows for active captured evidence that is not patch-safe yet but is legitimately worth future helper review.';

comment on column public.fragrance_official_source_registry_candidate_view_v1.recapture_status is
  'Separate capture-guard classification used to fence Batch 1C evidence recapture from helper-review planning.';

comment on column public.fragrance_official_source_registry_candidate_view_v1.batch_1c_capture_candidate is
  'True only when a row is legitimately eligible for new evidence capture; false for active captured rows and terminal/actioned history.';

comment on column public.fragrance_official_source_registry_candidate_view_v1.patch_safe is
  'True only when underlying registry evidence is helper-compatible, ready_for_dry_run, and free of duplicate, ambiguity, rejection, or stale-state blockers. helper_review_candidate_later_rows does not imply patch approval.';

comment on column public.fragrance_official_source_registry_candidate_view_v1.active_capture_guard is
  'True when the underlying registry evidence row is active and should not be blindly recaptured.';

revoke all on public.fragrance_official_source_registry_candidate_view_v1
  from public, anon, authenticated;

revoke all on public.fragrance_official_source_registry_candidate_view_v1
  from service_role;

grant select on public.fragrance_official_source_registry_candidate_view_v1
  to service_role;

commit;
