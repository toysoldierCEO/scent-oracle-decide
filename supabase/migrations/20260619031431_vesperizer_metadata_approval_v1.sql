begin;

create or replace function public.approve_fragrance_identity_metadata_evidence_v1(
  p_evidence_ids uuid[],
  p_actor_label text default 'codex_identity_metadata_approval_v1',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_requested_count integer := coalesce(array_length(p_evidence_ids, 1), 0);
  v_valid_count integer := 0;
  v_would_approve_count integer := 0;
  v_approved_count integer := 0;
  v_rejected_count integer := 0;
  v_skipped_already_approved_count integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_approved_ids jsonb := '[]'::jsonb;

  v_evidence_id uuid;
  v_duplicate_ids uuid[] := array[]::uuid[];
  v_errors text[];
  v_row record;
  v_has_metadata_value boolean;
  v_concentration_clean text;
begin
  if p_evidence_ids is null then
    raise exception 'p_evidence_ids must not be null';
  end if;

  if v_requested_count > 50 then
    raise exception 'p_evidence_ids batch size % exceeds max 50', v_requested_count;
  end if;

  if p_actor_label is null or length(btrim(p_actor_label)) = 0 then
    raise exception 'p_actor_label must not be empty';
  end if;

  if v_requested_count = 0 then
    return jsonb_build_object(
      'dry_run', p_dry_run,
      'requested_count', 0,
      'valid_count', 0,
      'rejected_count', 0,
      'would_approve_count', 0,
      'approved_count', 0,
      'skipped_already_approved_count', 0,
      'results', '[]'::jsonb,
      'approved_ids', '[]'::jsonb
    );
  end if;

  select coalesce(array_agg(id), array[]::uuid[])
  into v_duplicate_ids
  from (
    select evidence_id as id
    from unnest(p_evidence_ids) as evidence_id
    where evidence_id is not null
    group by evidence_id
    having count(*) > 1
  ) duplicates;

  foreach v_evidence_id in array p_evidence_ids
  loop
    v_errors := array[]::text[];
    v_has_metadata_value := false;
    v_concentration_clean := null;

    if v_evidence_id is null then
      v_errors := v_errors || 'evidence_id must not be null';
    elsif v_evidence_id = any(v_duplicate_ids) then
      v_errors := v_errors || 'duplicate evidence_id in request';
    else
      select *
      into v_row
      from public.fragrance_identity_metadata_evidence_registry_v1 r
      where r.id = v_evidence_id;

      if not found then
        v_errors := v_errors || 'metadata evidence row not found';
      end if;
    end if;

    if v_errors = array[]::text[] and v_row.review_status = 'approved_for_internal_use' then
      v_skipped_already_approved_count := v_skipped_already_approved_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'metadata_evidence_id', v_evidence_id,
        'fragrance_id', v_row.fragrance_id,
        'fragrance_name', v_row.fragrance_name_snapshot,
        'brand', v_row.brand_snapshot,
        'source_type', v_row.source_type,
        'source_tier', v_row.source_tier,
        'status', 'skipped_already_approved'
      ));
      continue;
    end if;

    if v_errors = array[]::text[] then
      if v_row.review_status = 'approved_for_patch_review' then
        v_errors := v_errors || 'approved_for_patch_review is not allowed in V1';
      elsif v_row.review_status <> 'proposed' then
        v_errors := v_errors || 'review_status must be proposed';
      end if;

      if v_row.evidence_status <> 'active' then
        v_errors := v_errors || 'evidence_status must be active';
      end if;

      if v_row.superseded_at is not null
        or v_row.evidence_status = 'superseded'
        or v_row.review_status = 'superseded'
      then
        v_errors := v_errors || 'superseded rows cannot be approved';
      end if;

      if v_row.patch_safe_now is true then
        v_errors := v_errors || 'patch_safe_now must be false';
      end if;

      if v_row.official_registry_eligible is true then
        v_errors := v_errors || 'official_registry_eligible must be false';
      end if;

      if v_row.source_type not in ('official_brand', 'retailer', 'professional_provider', 'community_provider') then
        v_errors := v_errors || 'source_type is not allowed in V1';
      end if;

      if v_row.source_tier not in (
        'official_brand_metadata',
        'official_brand_product_page',
        'retailer_structured_metadata',
        'professional_provider_metadata',
        'community_provider_metadata'
      ) then
        v_errors := v_errors || 'source_tier is not allowed in V1';
      end if;

      if not (
        (v_row.source_type = 'official_brand' and v_row.source_tier in ('official_brand_metadata', 'official_brand_product_page'))
        or (v_row.source_type = 'retailer' and v_row.source_tier = 'retailer_structured_metadata')
        or (v_row.source_type = 'professional_provider' and v_row.source_tier = 'professional_provider_metadata')
        or (v_row.source_type = 'community_provider' and v_row.source_tier = 'community_provider_metadata')
      ) then
        v_errors := v_errors || 'source_type/source_tier combination is not allowed';
      end if;

      if v_row.release_year is not null and (v_row.release_year < 1700 or v_row.release_year > 2100) then
        v_errors := v_errors || 'release_year must be between 1700 and 2100';
      end if;

      if jsonb_typeof(v_row.perfumer_names) <> 'array' then
        v_errors := v_errors || 'perfumer_names must be an array';
      elsif exists (
        select 1
        from jsonb_array_elements_text(v_row.perfumer_names) as value
        where length(btrim(value)) = 0
          or length(value) > 120
          or value ~* 'https?://'
          or value ~ '[.!?]$'
          or value ~* '\m(unknown|n/a|none|null)\M'
      ) then
        v_errors := v_errors || 'perfumer_names contain invalid values';
      end if;

      v_concentration_clean := nullif(btrim(coalesce(v_row.concentration, '')), '');

      if v_concentration_clean is not null
        and upper(v_concentration_clean) in ('UNKNOWN', 'N/A', 'NA', 'NONE', 'NULL')
      then
        v_errors := v_errors || 'concentration must not be unknown or empty';
      end if;

      v_has_metadata_value := (
        v_row.release_year is not null
        or (
          jsonb_typeof(v_row.perfumer_names) = 'array'
          and jsonb_array_length(v_row.perfumer_names) > 0
        )
        or v_concentration_clean is not null
      );

      if not v_has_metadata_value then
        v_errors := v_errors || 'at least one usable metadata value is required';
      end if;

      if exists (
        select 1
        from jsonb_array_elements_text(v_row.extraction_warnings) as warning
        where warning ilike '%conflict%'
          or warning ilike '%current public.fragrances%'
      ) then
        v_errors := v_errors || 'conflict-warning rows must remain held for manual review in V1';
      end if;
    end if;

    if v_errors = array[]::text[] then
      v_valid_count := v_valid_count + 1;

      if p_dry_run then
        v_would_approve_count := v_would_approve_count + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'metadata_evidence_id', v_evidence_id,
          'fragrance_id', v_row.fragrance_id,
          'fragrance_name', v_row.fragrance_name_snapshot,
          'brand', v_row.brand_snapshot,
          'source_type', v_row.source_type,
          'source_tier', v_row.source_tier,
          'status', 'would_approve'
        ));
      else
        update public.fragrance_identity_metadata_evidence_registry_v1
        set
          review_status = 'approved_for_internal_use',
          updated_at = now()
        where id = v_evidence_id;

        v_approved_count := v_approved_count + 1;
        v_approved_ids := v_approved_ids || jsonb_build_array(v_evidence_id);
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'metadata_evidence_id', v_evidence_id,
          'fragrance_id', v_row.fragrance_id,
          'fragrance_name', v_row.fragrance_name_snapshot,
          'brand', v_row.brand_snapshot,
          'source_type', v_row.source_type,
          'source_tier', v_row.source_tier,
          'status', 'approved'
        ));
      end if;
    else
      v_rejected_count := v_rejected_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'metadata_evidence_id', v_evidence_id,
        'status', 'rejected',
        'errors', to_jsonb(v_errors)
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'requested_count', v_requested_count,
    'valid_count', v_valid_count,
    'rejected_count', v_rejected_count,
    'would_approve_count', v_would_approve_count,
    'approved_count', v_approved_count,
    'skipped_already_approved_count', v_skipped_already_approved_count,
    'results', v_results,
    'approved_ids', v_approved_ids
  );
end;
$$;

revoke all on function public.approve_fragrance_identity_metadata_evidence_v1(uuid[], text, boolean)
  from public, anon, authenticated;

revoke all on function public.approve_fragrance_identity_metadata_evidence_v1(uuid[], text, boolean)
  from service_role;

grant execute on function public.approve_fragrance_identity_metadata_evidence_v1(uuid[], text, boolean)
  to service_role;

comment on function public.approve_fragrance_identity_metadata_evidence_v1(uuid[], text, boolean)
  is 'Service-role-only helper for dry-run/live approval of review-gated fragrance identity metadata evidence for internal Vesper use. Live mode updates only review_status and updated_at on the metadata evidence registry and never mutates public.fragrances or registry/provider lanes.';

commit;
