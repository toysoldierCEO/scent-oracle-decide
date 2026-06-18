begin;

create or replace function public.approve_fragrance_provider_intelligence_v1(
  p_intelligence_ids uuid[],
  p_actor_label text default 'codex_provider_intelligence_approval_v1',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_requested_count integer := 0;
  v_valid_count integer := 0;
  v_would_approve_count integer := 0;
  v_approved_count integer := 0;
  v_rejected_count integer := 0;
  v_skipped_already_approved_count integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_approved_ids jsonb := '[]'::jsonb;

  v_id uuid;
  v_row public.fragrance_provider_intelligence_registry_v1%rowtype;
  v_errors text[];
  v_request_occurrences integer := 0;
  v_updated_id uuid;

  v_normalized_notes_arr text[];
  v_normalized_top_arr text[];
  v_normalized_heart_arr text[];
  v_normalized_base_arr text[];
begin
  v_requested_count := coalesce(array_length(p_intelligence_ids, 1), 0);

  if p_intelligence_ids is null or v_requested_count = 0 then
    raise exception 'p_intelligence_ids must not be empty';
  end if;

  if v_requested_count > 50 then
    raise exception 'p_intelligence_ids batch size % exceeds max 50', v_requested_count;
  end if;

  if p_actor_label is null or length(btrim(p_actor_label)) = 0 then
    raise exception 'p_actor_label must not be empty';
  end if;

  for v_id in
    select unnest(p_intelligence_ids)
  loop
    v_errors := array[]::text[];
    v_request_occurrences := 0;
    v_updated_id := null;
    v_row := null;

    if v_id is null then
      v_errors := v_errors || 'intelligence_id must not be null';
    else
      select count(*)
      into v_request_occurrences
      from unnest(p_intelligence_ids) as request_id(id)
      where request_id.id is not distinct from v_id;

      if v_request_occurrences > 1 then
        v_errors := v_errors || 'duplicate intelligence_id in request';
      end if;
    end if;

    if v_errors = array[]::text[] then
      if p_dry_run then
        select r.*
        into v_row
        from public.fragrance_provider_intelligence_registry_v1 r
        where r.id = v_id;
      else
        select r.*
        into v_row
        from public.fragrance_provider_intelligence_registry_v1 r
        where r.id = v_id
        for update;
      end if;

      if not found then
        v_errors := v_errors || 'intelligence_id not found';
      end if;
    end if;

    if v_errors = array[]::text[]
      and v_row.review_status = 'approved_for_internal_use'
    then
      v_skipped_already_approved_count := v_skipped_already_approved_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'intelligence_id', v_id,
        'fragrance_id', v_row.fragrance_id,
        'status', 'skipped_already_approved',
        'review_status', v_row.review_status
      ));
      continue;
    end if;

    if v_errors = array[]::text[] then
      if v_row.review_status <> 'proposed' then
        v_errors := v_errors || 'only proposed rows may be approved in V1';
      end if;

      if v_row.review_status = 'approved_for_patch_review' then
        v_errors := v_errors || 'approved_for_patch_review is not allowed in V1';
      end if;

      if v_row.evidence_status <> 'usable_non_official_intelligence' then
        v_errors := v_errors || 'evidence_status must be usable_non_official_intelligence';
      end if;

      if v_row.superseded_at is not null
        or v_row.evidence_status = 'superseded'
        or v_row.review_status = 'superseded'
      then
        v_errors := v_errors || 'superseded rows may not be approved';
      end if;

      if v_row.source_type = 'official_brand'
        or v_row.source_type not in ('retailer', 'professional_provider', 'community_provider')
      then
        v_errors := v_errors || 'source_type must be non-official';
      end if;

      if v_row.official_registry_eligible <> false then
        v_errors := v_errors || 'official_registry_eligible must be false';
      end if;

      if v_row.patch_safe_now <> false then
        v_errors := v_errors || 'patch_safe_now must be false';
      end if;

      if v_row.source_tier not in (
        'retailer_structured_notes',
        'retailer_pyramid_evidence',
        'professional_provider_pyramid',
        'community_provider_consensus'
      ) then
        v_errors := v_errors || 'source_tier is not allowed for approval V1';
      end if;

      select coalesce(array_agg(value), '{}'::text[])
      into v_normalized_notes_arr
      from jsonb_array_elements_text(coalesce(v_row.normalized_notes, '[]'::jsonb)) as value
      where length(btrim(value)) > 0;

      select coalesce(array_agg(value), '{}'::text[])
      into v_normalized_top_arr
      from jsonb_array_elements_text(coalesce(v_row.normalized_pyramid->'top', '[]'::jsonb)) as value
      where length(btrim(value)) > 0;

      select coalesce(array_agg(value), '{}'::text[])
      into v_normalized_heart_arr
      from jsonb_array_elements_text(coalesce(v_row.normalized_pyramid->'heart', '[]'::jsonb)) as value
      where length(btrim(value)) > 0;

      select coalesce(array_agg(value), '{}'::text[])
      into v_normalized_base_arr
      from jsonb_array_elements_text(coalesce(v_row.normalized_pyramid->'base', '[]'::jsonb)) as value
      where length(btrim(value)) > 0;

      if exists (
        select 1
        from unnest(v_normalized_notes_arr || v_normalized_top_arr || v_normalized_heart_arr || v_normalized_base_arr) as note
        where note ~* '\m(top|heart|middle|mid|base)\M\s*:'
          or note ~ '^[^[:alnum:]]'
          or note ~ '[.!?]$'
          or note ~* '\m(take over|what you need|perfectly balanced|comforting embrace|experience|discover|designed|captures|evokes|luxurious|unforgettable)\M'
          or length(note) > 80
      ) then
        v_errors := v_errors || 'normalized note arrays contain dirty note values';
      end if;
    end if;

    if v_errors <> array[]::text[] then
      v_rejected_count := v_rejected_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'intelligence_id', v_id,
        'status', 'rejected',
        'errors', v_errors
      ));
    elsif p_dry_run then
      v_valid_count := v_valid_count + 1;
      v_would_approve_count := v_would_approve_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'intelligence_id', v_id,
        'fragrance_id', v_row.fragrance_id,
        'status', 'would_approve',
        'current_review_status', v_row.review_status,
        'would_set_review_status', 'approved_for_internal_use'
      ));
    else
      update public.fragrance_provider_intelligence_registry_v1
      set
        review_status = 'approved_for_internal_use',
        updated_at = now()
      where id = v_id
        and review_status = 'proposed'
      returning id into v_updated_id;

      if v_updated_id is null then
        v_rejected_count := v_rejected_count + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'intelligence_id', v_id,
          'status', 'rejected',
          'errors', array['row was not updated because review_status changed before approval']
        ));
      else
        v_valid_count := v_valid_count + 1;
        v_approved_count := v_approved_count + 1;
        v_approved_ids := v_approved_ids || jsonb_build_array(v_updated_id);
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'intelligence_id', v_id,
          'fragrance_id', v_row.fragrance_id,
          'status', 'approved',
          'review_status', 'approved_for_internal_use'
        ));
      end if;
    end if;
  end loop;

  if p_dry_run then
    return jsonb_build_object(
      'dry_run', true,
      'requested_count', v_requested_count,
      'valid_count', v_valid_count,
      'would_approve_count', v_would_approve_count,
      'skipped_already_approved_count', v_skipped_already_approved_count,
      'rejected_count', v_rejected_count,
      'results', v_results
    );
  end if;

  return jsonb_build_object(
    'dry_run', false,
    'requested_count', v_requested_count,
    'approved_count', v_approved_count,
    'approved_ids', v_approved_ids,
    'skipped_already_approved_count', v_skipped_already_approved_count,
    'rejected_count', v_rejected_count,
    'results', v_results
  );
end;
$$;

revoke all on function public.approve_fragrance_provider_intelligence_v1(uuid[], text, boolean)
  from public, anon, authenticated;

grant execute on function public.approve_fragrance_provider_intelligence_v1(uuid[], text, boolean)
  to service_role;

comment on function public.approve_fragrance_provider_intelligence_v1(uuid[], text, boolean)
  is 'Service-role-only approval helper for non-official provider intelligence. Dry-run validates exact row IDs; live mode updates only review_status and updated_at on provider intelligence rows.';

commit;
