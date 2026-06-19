begin;

create or replace function public.approve_fragrance_official_source_evidence_for_profile_v1(
  p_evidence_id uuid,
  p_actor_label text default 'codex_official_profile_evidence_approval_v1',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.fragrance_official_source_evidence_registry_v1%rowtype;
  v_errors text[] := array[]::text[];
  v_already_approved boolean := false;
begin
  if p_evidence_id is null then
    v_errors := v_errors || 'p_evidence_id is required';
  end if;

  if nullif(btrim(coalesce(p_actor_label, '')), '') is null then
    v_errors := v_errors || 'p_actor_label is required';
  end if;

  if v_errors = array[]::text[] then
    if p_dry_run then
      select *
      into v_row
      from public.fragrance_official_source_evidence_registry_v1
      where id = p_evidence_id;
    else
      select *
      into v_row
      from public.fragrance_official_source_evidence_registry_v1
      where id = p_evidence_id
      for update;
    end if;

    if not found then
      v_errors := v_errors || 'official source evidence row not found';
    end if;
  end if;

  if v_errors = array[]::text[] then
    if v_row.source_type <> 'official_brand' then
      v_errors := v_errors || 'source_type must be official_brand';
    end if;

    if v_row.source_evidence_type not in ('official_pyramid', 'official_key_notes', 'official_notes_only') then
      v_errors := v_errors || 'source_evidence_type is not profile-promotable';
    end if;

    if v_row.evidence_status <> 'active' then
      v_errors := v_errors || 'evidence_status must be active';
    end if;

    if v_row.review_status in ('rejected', 'superseded') then
      v_errors := v_errors || 'review_status is not approvable';
    elsif v_row.review_status in ('approved_for_dry_run', 'dry_run_passed', 'patched', 'audit_recorded') then
      v_already_approved := true;
    elsif v_row.review_status <> 'proposed' then
      v_errors := v_errors || 'review_status must be proposed';
    end if;

    if v_row.source_evidence_type = 'official_pyramid'
      and coalesce(cardinality(v_row.official_top_notes), 0)
        + coalesce(cardinality(v_row.official_heart_notes), 0)
        + coalesce(cardinality(v_row.official_base_notes), 0) = 0
    then
      v_errors := v_errors || 'official_pyramid requires positional notes';
    end if;

    if v_row.source_evidence_type in ('official_key_notes', 'official_notes_only')
      and coalesce(cardinality(v_row.official_notes), 0) = 0
    then
      v_errors := v_errors || 'official key/notes evidence requires official_notes';
    end if;
  end if;

  if v_errors <> array[]::text[] then
    return jsonb_build_object(
      'dry_run', p_dry_run,
      'requested_count', case when p_evidence_id is null then 0 else 1 end,
      'valid_count', 0,
      'would_approve_count', 0,
      'approved_count', 0,
      'skipped_already_approved_count', 0,
      'rejected_count', 1,
      'results', jsonb_build_array(jsonb_build_object(
        'evidence_id', p_evidence_id,
        'status', 'rejected',
        'errors', v_errors
      ))
    );
  end if;

  if p_dry_run then
    return jsonb_build_object(
      'dry_run', true,
      'requested_count', 1,
      'valid_count', 1,
      'would_approve_count', case when v_already_approved then 0 else 1 end,
      'approved_count', 0,
      'skipped_already_approved_count', case when v_already_approved then 1 else 0 end,
      'rejected_count', 0,
      'results', jsonb_build_array(jsonb_build_object(
        'evidence_id', p_evidence_id,
        'fragrance_id', v_row.fragrance_id,
        'source_evidence_type', v_row.source_evidence_type,
        'current_review_status', v_row.review_status,
        'would_set_review_status', case when v_already_approved then v_row.review_status else 'approved_for_dry_run' end,
        'status', case when v_already_approved then 'already_approved' else 'would_approve' end
      ))
    );
  end if;

  if not v_already_approved then
    update public.fragrance_official_source_evidence_registry_v1
    set
      review_status = 'approved_for_dry_run',
      updated_at = now()
    where id = p_evidence_id
      and review_status = 'proposed';

    if not found then
      return jsonb_build_object(
        'dry_run', false,
        'requested_count', 1,
        'valid_count', 0,
        'approved_count', 0,
        'skipped_already_approved_count', 0,
        'rejected_count', 1,
        'results', jsonb_build_array(jsonb_build_object(
          'evidence_id', p_evidence_id,
          'status', 'rejected',
          'errors', array['row was not updated because review_status changed before approval']
        ))
      );
    end if;
  end if;

  return jsonb_build_object(
    'dry_run', false,
    'requested_count', 1,
    'valid_count', 1,
    'approved_count', case when v_already_approved then 0 else 1 end,
    'skipped_already_approved_count', case when v_already_approved then 1 else 0 end,
    'rejected_count', 0,
    'results', jsonb_build_array(jsonb_build_object(
      'evidence_id', p_evidence_id,
      'fragrance_id', v_row.fragrance_id,
      'source_evidence_type', v_row.source_evidence_type,
      'review_status', case when v_already_approved then v_row.review_status else 'approved_for_dry_run' end,
      'status', case when v_already_approved then 'already_approved' else 'approved' end
    ))
  );
end;
$$;

revoke all on function public.approve_fragrance_official_source_evidence_for_profile_v1(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.approve_fragrance_official_source_evidence_for_profile_v1(uuid, text, boolean)
  to service_role;

create or replace function public.apply_approved_fragrance_profile_from_evidence_v1(
  p_fragrance_id uuid,
  p_evidence_id uuid,
  p_family_key text default null,
  p_actor_label text default 'codex_official_profile_promotion_v1',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_evidence public.fragrance_official_source_evidence_registry_v1%rowtype;
  v_fragrance public.fragrances%rowtype;
  v_after public.fragrances%rowtype;
  v_errors text[] := array[]::text[];
  v_target_family_key text := nullif(btrim(coalesce(p_family_key, '')), '');
  v_target_notes text[] := '{}'::text[];
  v_target_top_notes text[] := '{}'::text[];
  v_target_heart_notes text[] := '{}'::text[];
  v_target_base_notes text[] := '{}'::text[];
  v_changed_fields text[] := array[]::text[];
  v_source_confidence_text text;
begin
  if p_fragrance_id is null then
    v_errors := v_errors || 'p_fragrance_id is required';
  end if;

  if p_evidence_id is null then
    v_errors := v_errors || 'p_evidence_id is required';
  end if;

  if nullif(btrim(coalesce(p_actor_label, '')), '') is null then
    v_errors := v_errors || 'p_actor_label is required';
  end if;

  if v_target_family_key is not null
    and v_target_family_key not in (
      'fresh-blue',
      'sweet-gourmand',
      'oud-amber',
      'dark-leather',
      'woody-clean',
      'tobacco-boozy',
      'citrus-cologne'
    )
  then
    v_errors := v_errors || 'p_family_key is not an allowed catalog family_key';
  end if;

  if v_errors = array[]::text[] then
    if p_dry_run then
      select *
      into v_fragrance
      from public.fragrances
      where id = p_fragrance_id;
    else
      select *
      into v_fragrance
      from public.fragrances
      where id = p_fragrance_id
      for update;
    end if;

    if not found then
      v_errors := v_errors || 'fragrance_id does not exist';
    end if;
  end if;

  if v_errors = array[]::text[] then
    select *
    into v_evidence
    from public.fragrance_official_source_evidence_registry_v1
    where id = p_evidence_id;

    if not found then
      v_errors := v_errors || 'official source evidence row not found';
    end if;
  end if;

  if v_errors = array[]::text[] then
    if v_evidence.fragrance_id <> p_fragrance_id then
      v_errors := v_errors || 'evidence row does not belong to fragrance_id';
    end if;

    if v_evidence.name_snapshot <> v_fragrance.name or v_evidence.brand_snapshot <> v_fragrance.brand then
      v_errors := v_errors || 'evidence identity snapshot does not match current fragrance identity';
    end if;

    if v_evidence.source_type <> 'official_brand' then
      v_errors := v_errors || 'evidence source_type must be official_brand';
    end if;

    if v_evidence.evidence_status <> 'active' then
      v_errors := v_errors || 'evidence_status must be active';
    end if;

    if v_evidence.review_status not in ('approved_for_dry_run', 'dry_run_passed', 'patched', 'audit_recorded') then
      v_errors := v_errors || 'official evidence must be approved before profile promotion';
    end if;

    if v_evidence.source_evidence_type not in ('official_pyramid', 'official_key_notes', 'official_notes_only') then
      v_errors := v_errors || 'source_evidence_type is not profile-promotable';
    end if;
  end if;

  if v_errors = array[]::text[] then
    v_target_top_notes := coalesce(v_evidence.official_top_notes, '{}'::text[]);
    v_target_heart_notes := coalesce(v_evidence.official_heart_notes, '{}'::text[]);
    v_target_base_notes := coalesce(v_evidence.official_base_notes, '{}'::text[]);
    v_target_notes := coalesce(nullif(v_evidence.official_notes, '{}'::text[]), '{}'::text[]);

    if coalesce(cardinality(v_target_notes), 0) = 0 then
      v_target_notes := v_target_top_notes || v_target_heart_notes || v_target_base_notes;
    end if;

    if coalesce(cardinality(v_target_notes), 0) = 0 then
      v_errors := v_errors || 'approved evidence has no promotable notes';
    end if;

    if v_evidence.source_evidence_type = 'official_pyramid'
      and coalesce(cardinality(v_target_top_notes), 0)
        + coalesce(cardinality(v_target_heart_notes), 0)
        + coalesce(cardinality(v_target_base_notes), 0) = 0
    then
      v_errors := v_errors || 'official_pyramid evidence has no positional notes';
    end if;
  end if;

  if v_errors = array[]::text[] then
    if coalesce(cardinality(v_fragrance.notes), 0) = 0 then
      v_changed_fields := v_changed_fields || 'notes';
    elsif coalesce(v_fragrance.notes, '{}'::text[]) <> v_target_notes then
      v_errors := v_errors || 'current notes are non-empty and differ from approved official evidence';
    end if;

    if v_evidence.source_evidence_type = 'official_pyramid' then
      if coalesce(cardinality(v_fragrance.top_notes), 0) = 0 then
        v_changed_fields := v_changed_fields || 'top_notes';
      elsif coalesce(v_fragrance.top_notes, '{}'::text[]) <> v_target_top_notes then
        v_errors := v_errors || 'current top_notes are non-empty and differ from approved official evidence';
      end if;

      if coalesce(cardinality(v_fragrance.heart_notes), 0) = 0 then
        v_changed_fields := v_changed_fields || 'heart_notes';
      elsif coalesce(v_fragrance.heart_notes, '{}'::text[]) <> v_target_heart_notes then
        v_errors := v_errors || 'current heart_notes are non-empty and differ from approved official evidence';
      end if;

      if coalesce(cardinality(v_fragrance.base_notes), 0) = 0 then
        v_changed_fields := v_changed_fields || 'base_notes';
      elsif coalesce(v_fragrance.base_notes, '{}'::text[]) <> v_target_base_notes then
        v_errors := v_errors || 'current base_notes are non-empty and differ from approved official evidence';
      end if;
    end if;

    if v_target_family_key is not null then
      if nullif(btrim(coalesce(v_fragrance.family_key, '')), '') is null then
        v_changed_fields := v_changed_fields || 'family_key';
      elsif v_fragrance.family_key <> v_target_family_key then
        v_errors := v_errors || 'current family_key is non-empty and differs from requested family_key';
      end if;
    end if;

    if nullif(btrim(coalesce(v_fragrance.source_url, '')), '') is null then
      v_changed_fields := v_changed_fields || 'source_url';
    elsif v_fragrance.source_url <> v_evidence.source_url then
      v_errors := v_errors || 'current source_url is non-empty and differs from approved official evidence';
    end if;

    v_source_confidence_text := v_evidence.source_confidence::text;
    if nullif(btrim(coalesce(v_fragrance.source_confidence, '')), '') is null then
      v_changed_fields := v_changed_fields || 'source_confidence';
    elsif v_fragrance.source_confidence <> v_source_confidence_text then
      v_errors := v_errors || 'current source_confidence is non-empty and differs from approved official evidence';
    end if;
  end if;

  if v_errors <> array[]::text[] then
    return jsonb_build_object(
      'dry_run', p_dry_run,
      'requested_count', 1,
      'valid_count', 0,
      'would_update_count', 0,
      'updated_count', 0,
      'rejected_count', 1,
      'changed_fields', '[]'::jsonb,
      'results', jsonb_build_array(jsonb_build_object(
        'fragrance_id', p_fragrance_id,
        'evidence_id', p_evidence_id,
        'status', 'rejected',
        'errors', v_errors
      ))
    );
  end if;

  if p_dry_run then
    return jsonb_build_object(
      'dry_run', true,
      'requested_count', 1,
      'valid_count', 1,
      'would_update_count', case when cardinality(v_changed_fields) > 0 then 1 else 0 end,
      'updated_count', 0,
      'rejected_count', 0,
      'changed_fields', to_jsonb(v_changed_fields),
      'before', jsonb_build_object(
        'family_key', v_fragrance.family_key,
        'notes', coalesce(v_fragrance.notes, '{}'::text[]),
        'top_notes', coalesce(v_fragrance.top_notes, '{}'::text[]),
        'heart_notes', coalesce(v_fragrance.heart_notes, '{}'::text[]),
        'base_notes', coalesce(v_fragrance.base_notes, '{}'::text[]),
        'source_url', v_fragrance.source_url,
        'source_confidence', v_fragrance.source_confidence,
        'release_year', v_fragrance.release_year,
        'perfumer', v_fragrance.perfumer,
        'longevity_score', v_fragrance.longevity_score,
        'projection_score', v_fragrance.projection_score
      ),
      'proposed', jsonb_build_object(
        'family_key', coalesce(v_target_family_key, v_fragrance.family_key),
        'notes', v_target_notes,
        'top_notes', case when v_evidence.source_evidence_type = 'official_pyramid' then v_target_top_notes else coalesce(v_fragrance.top_notes, '{}'::text[]) end,
        'heart_notes', case when v_evidence.source_evidence_type = 'official_pyramid' then v_target_heart_notes else coalesce(v_fragrance.heart_notes, '{}'::text[]) end,
        'base_notes', case when v_evidence.source_evidence_type = 'official_pyramid' then v_target_base_notes else coalesce(v_fragrance.base_notes, '{}'::text[]) end,
        'source_url', coalesce(v_fragrance.source_url, v_evidence.source_url),
        'source_confidence', coalesce(v_fragrance.source_confidence, v_source_confidence_text),
        'release_year', v_fragrance.release_year,
        'perfumer', v_fragrance.perfumer,
        'longevity_score', v_fragrance.longevity_score,
        'projection_score', v_fragrance.projection_score
      ),
      'results', jsonb_build_array(jsonb_build_object(
        'fragrance_id', p_fragrance_id,
        'evidence_id', p_evidence_id,
        'status', case when cardinality(v_changed_fields) > 0 then 'would_update' else 'already_matching' end
      ))
    );
  end if;

  update public.fragrances
  set
    notes = case when 'notes' = any(v_changed_fields) then v_target_notes else notes end,
    top_notes = case when 'top_notes' = any(v_changed_fields) then v_target_top_notes else top_notes end,
    heart_notes = case when 'heart_notes' = any(v_changed_fields) then v_target_heart_notes else heart_notes end,
    base_notes = case when 'base_notes' = any(v_changed_fields) then v_target_base_notes else base_notes end,
    family_key = case when 'family_key' = any(v_changed_fields) then v_target_family_key else family_key end,
    source_url = case when 'source_url' = any(v_changed_fields) then v_evidence.source_url else source_url end,
    source_confidence = case when 'source_confidence' = any(v_changed_fields) then v_source_confidence_text else source_confidence end
  where id = p_fragrance_id
  returning * into v_after;

  if not found then
    return jsonb_build_object(
      'dry_run', false,
      'requested_count', 1,
      'valid_count', 0,
      'updated_count', 0,
      'rejected_count', 1,
      'changed_fields', to_jsonb(v_changed_fields),
      'results', jsonb_build_array(jsonb_build_object(
        'fragrance_id', p_fragrance_id,
        'evidence_id', p_evidence_id,
        'status', 'rejected',
        'errors', array['fragrance row disappeared before update']
      ))
    );
  end if;

  if coalesce(v_after.notes, '{}'::text[]) <> v_target_notes
    or (v_evidence.source_evidence_type = 'official_pyramid' and coalesce(v_after.top_notes, '{}'::text[]) <> v_target_top_notes)
    or (v_evidence.source_evidence_type = 'official_pyramid' and coalesce(v_after.heart_notes, '{}'::text[]) <> v_target_heart_notes)
    or (v_evidence.source_evidence_type = 'official_pyramid' and coalesce(v_after.base_notes, '{}'::text[]) <> v_target_base_notes)
    or (v_target_family_key is not null and v_after.family_key <> v_target_family_key)
    or v_after.source_url <> v_evidence.source_url
    or v_after.source_confidence <> v_source_confidence_text
  then
    return jsonb_build_object(
      'dry_run', false,
      'requested_count', 1,
      'valid_count', 0,
      'updated_count', 0,
      'rejected_count', 1,
      'changed_fields', to_jsonb(v_changed_fields),
      'results', jsonb_build_array(jsonb_build_object(
        'fragrance_id', p_fragrance_id,
        'evidence_id', p_evidence_id,
        'status', 'final_value_mismatch',
        'expected', jsonb_build_object(
          'family_key', v_target_family_key,
          'notes', v_target_notes,
          'top_notes', v_target_top_notes,
          'heart_notes', v_target_heart_notes,
          'base_notes', v_target_base_notes,
          'source_url', v_evidence.source_url,
          'source_confidence', v_source_confidence_text
        ),
        'actual', jsonb_build_object(
          'family_key', v_after.family_key,
          'notes', coalesce(v_after.notes, '{}'::text[]),
          'top_notes', coalesce(v_after.top_notes, '{}'::text[]),
          'heart_notes', coalesce(v_after.heart_notes, '{}'::text[]),
          'base_notes', coalesce(v_after.base_notes, '{}'::text[]),
          'source_url', v_after.source_url,
          'source_confidence', v_after.source_confidence
        )
      ))
    );
  end if;

  return jsonb_build_object(
    'dry_run', false,
    'requested_count', 1,
    'valid_count', 1,
    'updated_count', case when cardinality(v_changed_fields) > 0 then 1 else 0 end,
    'rejected_count', 0,
    'changed_fields', to_jsonb(v_changed_fields),
    'after', jsonb_build_object(
      'family_key', v_after.family_key,
      'notes', coalesce(v_after.notes, '{}'::text[]),
      'top_notes', coalesce(v_after.top_notes, '{}'::text[]),
      'heart_notes', coalesce(v_after.heart_notes, '{}'::text[]),
      'base_notes', coalesce(v_after.base_notes, '{}'::text[]),
      'source_url', v_after.source_url,
      'source_confidence', v_after.source_confidence,
      'release_year', v_after.release_year,
      'perfumer', v_after.perfumer,
      'longevity_score', v_after.longevity_score,
      'projection_score', v_after.projection_score
    ),
    'results', jsonb_build_array(jsonb_build_object(
      'fragrance_id', p_fragrance_id,
      'evidence_id', p_evidence_id,
      'status', case when cardinality(v_changed_fields) > 0 then 'updated' else 'already_matching' end
    ))
  );
end;
$$;

revoke all on function public.apply_approved_fragrance_profile_from_evidence_v1(uuid, uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.apply_approved_fragrance_profile_from_evidence_v1(uuid, uuid, text, text, boolean)
  to service_role;

comment on function public.approve_fragrance_official_source_evidence_for_profile_v1(uuid, text, boolean)
  is 'Service-role-only helper that approves active official source evidence for dry-run/profile promotion. Live mode updates only official registry review_status to approved_for_dry_run and updated_at.';

comment on function public.apply_approved_fragrance_profile_from_evidence_v1(uuid, uuid, text, text, boolean)
  is 'Service-role-only dry-run/live helper that applies approved official source evidence to limited catalog profile fields only: family_key, notes, top/heart/base notes, source_url, and source_confidence. It does not write release year, perfumer, performance, user collection, registry, provider, metadata, recommendations, or layer state.';

commit;
