-- Vesperizer Patch-Safe Official Concentration Promotion V1 Revision
-- Proposal only until reviewed and applied.
--
-- Fixes:
--   - Map official display concentration labels to canonical catalog values.
--   - Write only canonical values into public.fragrances.concentration.
--   - Verify final persisted value before reporting updated_count.
--   - Keep concentration_key, release_year, perfumer, notes, accords, family,
--     performance, registry/provider/metadata rows, queue, and performance untouched.

create or replace function public.promote_fragrance_official_concentration_v1(
  p_payloads jsonb,
  p_actor_label text,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb;
  v_results jsonb := '[]'::jsonb;
  v_requested_count integer := 0;
  v_valid_count integer := 0;
  v_would_update_count integer := 0;
  v_updated_count integer := 0;
  v_rejected_count integer := 0;
  v_manual_review_conflict_count integer := 0;
  v_skipped_already_matching_count integer := 0;
  v_duplicate_count integer := 0;
  v_final_value_mismatch_count integer := 0;
  v_seen_ids uuid[] := array[]::uuid[];
  v_id uuid;
  v_name text;
  v_brand text;
  v_current_concentration text;
  v_payload_current text;
  v_proposed_label text;
  v_proposed_canonical text;
  v_derived_canonical text;
  v_patch_field text;
  v_source_type text;
  v_source_tier text;
  v_source_name text;
  v_patch_safe_review boolean;
  v_payload_conflict_hold boolean;
  v_catalog record;
  v_resolver record;
  v_status text;
  v_reason text;
  v_final_concentration text;
begin
  if p_payloads is null or jsonb_typeof(p_payloads) <> 'array' then
    raise exception 'p_payloads must be a JSON array';
  end if;

  if coalesce(nullif(trim(p_actor_label), ''), '') = '' then
    raise exception 'p_actor_label is required';
  end if;

  v_requested_count := jsonb_array_length(p_payloads);

  if v_requested_count > 25 then
    raise exception 'maximum payload count is 25 for concentration promotion v1';
  end if;

  for v_payload in select value from jsonb_array_elements(p_payloads)
  loop
    v_status := 'rejected';
    v_reason := null;
    v_id := null;
    v_name := null;
    v_brand := null;
    v_current_concentration := null;
    v_payload_current := null;
    v_proposed_label := null;
    v_proposed_canonical := null;
    v_derived_canonical := null;
    v_patch_field := null;
    v_source_type := null;
    v_source_tier := null;
    v_source_name := null;
    v_patch_safe_review := false;
    v_payload_conflict_hold := false;
    v_catalog := null;
    v_resolver := null;
    v_final_concentration := null;

    begin
      v_id := nullif(v_payload->>'fragrance_id', '')::uuid;
      v_name := nullif(trim(v_payload->>'fragrance_name'), '');
      v_brand := nullif(trim(v_payload->>'brand'), '');
      v_payload_current := nullif(trim(v_payload->>'current_concentration'), '');
      v_proposed_label := nullif(trim(coalesce(v_payload->>'proposed_concentration_label', v_payload->>'proposed_concentration')), '');
      v_proposed_canonical := nullif(upper(trim(v_payload->>'proposed_concentration_canonical')), '');
      v_patch_field := nullif(trim(v_payload->>'patch_field'), '');
      v_source_type := nullif(trim(v_payload->>'source_type'), '');
      v_source_tier := nullif(trim(v_payload->>'source_tier'), '');
      v_source_name := nullif(trim(v_payload->>'source_name'), '');
      v_patch_safe_review := coalesce((v_payload->>'patch_safe_review')::boolean, false);
      v_payload_conflict_hold := coalesce((v_payload->>'has_conflict_hold')::boolean, false);
    exception
      when others then
        v_rejected_count := v_rejected_count + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'status', 'rejected',
          'reason', 'payload parse failed',
          'payload', v_payload
        ));
        continue;
    end;

    v_derived_canonical := case
      when v_proposed_label is null then null
      when lower(regexp_replace(v_proposed_label, '\s+', ' ', 'g')) = 'eau de toilette' then 'EDT'
      when upper(v_proposed_label) = 'EDT' then 'EDT'
      when lower(regexp_replace(v_proposed_label, '\s+', ' ', 'g')) = 'eau de parfum' then 'EDP'
      when upper(v_proposed_label) = 'EDP' then 'EDP'
      when lower(regexp_replace(v_proposed_label, '\s+', ' ', 'g')) in ('parfum', 'pure parfum') then 'PARFUM'
      when lower(regexp_replace(v_proposed_label, '\s+', ' ', 'g')) in ('extrait', 'extrait de parfum') then 'EXTRAIT'
      when lower(regexp_replace(v_proposed_label, '\s+', ' ', 'g')) in ('eau de cologne', 'cologne') then 'COLOGNE'
      else null
    end;

    if v_id is null then
      v_reason := 'missing fragrance_id';
    elsif v_id = any(v_seen_ids) then
      v_duplicate_count := v_duplicate_count + 1;
      v_reason := 'duplicate fragrance_id in request';
    elsif v_name is null or v_brand is null then
      v_reason := 'missing fragrance name or brand';
    elsif v_patch_field is distinct from 'concentration' then
      v_reason := 'patch_field must be concentration';
    elsif not v_patch_safe_review then
      v_reason := 'patch_safe_review must be true for this reviewed promotion lane';
    elsif v_source_type is distinct from 'official_brand' then
      v_reason := 'source_type must be official_brand';
    elsif v_source_tier not in ('official_brand_product_page', 'official_brand_metadata') then
      v_reason := 'source_tier must be official_brand_product_page or official_brand_metadata';
    elsif v_source_name is null then
      v_reason := 'source_name is required';
    elsif v_proposed_label is null then
      v_reason := 'proposed_concentration_label is required';
    elsif v_derived_canonical is null then
      v_reason := 'proposed concentration label is unsupported for catalog promotion';
    elsif v_proposed_canonical is null then
      v_reason := 'proposed_concentration_canonical is required';
    elsif v_proposed_canonical not in ('EDT', 'EDP', 'PARFUM', 'EXTRAIT', 'COLOGNE') then
      v_reason := 'proposed_concentration_canonical must be a supported stored catalog value';
    elsif v_proposed_canonical is distinct from v_derived_canonical then
      v_reason := 'proposed_concentration_canonical does not match derived canonical value';
    elsif v_payload_conflict_hold then
      v_reason := 'payload reports conflict hold';
    end if;

    if v_reason is not null then
      v_rejected_count := v_rejected_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'fragrance_id', v_payload->>'fragrance_id',
        'fragrance_name', v_name,
        'brand', v_brand,
        'status', 'rejected',
        'reason', v_reason,
        'proposed_concentration_label', v_proposed_label,
        'proposed_concentration_canonical', v_proposed_canonical
      ));
      continue;
    end if;

    v_seen_ids := array_append(v_seen_ids, v_id);

    select f.id, f.name, f.brand, f.concentration
      into v_catalog
    from public.fragrances f
    where f.id = v_id;

    if v_catalog.id is null then
      v_rejected_count := v_rejected_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'fragrance_id', v_id,
        'fragrance_name', v_name,
        'brand', v_brand,
        'status', 'rejected',
        'reason', 'fragrance_id not found in public.fragrances'
      ));
      continue;
    end if;

    if v_catalog.name is distinct from v_name or v_catalog.brand is distinct from v_brand then
      v_rejected_count := v_rejected_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'fragrance_id', v_id,
        'fragrance_name', v_name,
        'brand', v_brand,
        'catalog_name', v_catalog.name,
        'catalog_brand', v_catalog.brand,
        'status', 'rejected',
        'reason', 'payload name/brand does not match public.fragrances exactly'
      ));
      continue;
    end if;

    v_current_concentration := coalesce(nullif(trim(v_catalog.concentration), ''), 'UNKNOWN');

    if v_payload_current is not null and v_payload_current is distinct from v_current_concentration then
      v_rejected_count := v_rejected_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'fragrance_id', v_id,
        'fragrance_name', v_name,
        'brand', v_brand,
        'status', 'rejected',
        'reason', 'payload current_concentration does not match catalog snapshot',
        'payload_current_concentration', v_payload_current,
        'catalog_current_concentration', v_current_concentration
      ));
      continue;
    end if;

    select r.fragrance_id,
           r.fragrance_name,
           r.brand,
           r.resolved_concentration,
           r.concentration_source_type,
           r.concentration_source_tier,
           r.concentration_source_name,
           r.has_conflict_hold,
           r.patch_safe_now,
           r.catalog_patch_ready
      into v_resolver
    from public.fragrance_identity_metadata_resolver_v1 r
    where r.fragrance_id = v_id;

    if v_resolver.fragrance_id is null then
      v_rejected_count := v_rejected_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'fragrance_id', v_id,
        'fragrance_name', v_name,
        'brand', v_brand,
        'status', 'rejected',
        'reason', 'metadata resolver row not found'
      ));
      continue;
    end if;

    if v_resolver.resolved_concentration is distinct from v_proposed_label
       or v_resolver.concentration_source_type is distinct from 'official_brand'
       or v_resolver.concentration_source_tier not in ('official_brand_product_page', 'official_brand_metadata')
       or v_resolver.patch_safe_now is distinct from false
       or v_resolver.catalog_patch_ready is distinct from false then
      v_rejected_count := v_rejected_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'fragrance_id', v_id,
        'fragrance_name', v_name,
        'brand', v_brand,
        'status', 'rejected',
        'reason', 'metadata resolver no longer supports official concentration promotion',
        'resolver_concentration', v_resolver.resolved_concentration,
        'resolver_source_type', v_resolver.concentration_source_type,
        'resolver_source_tier', v_resolver.concentration_source_tier
      ));
      continue;
    end if;

    if coalesce(v_resolver.has_conflict_hold, false) then
      v_manual_review_conflict_count := v_manual_review_conflict_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'fragrance_id', v_id,
        'fragrance_name', v_name,
        'brand', v_brand,
        'status', 'manual_review_conflict',
        'reason', 'metadata resolver reports held conflict evidence'
      ));
      continue;
    end if;

    if upper(v_current_concentration) = v_proposed_canonical then
      v_valid_count := v_valid_count + 1;
      v_skipped_already_matching_count := v_skipped_already_matching_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'fragrance_id', v_id,
        'fragrance_name', v_name,
        'brand', v_brand,
        'status', 'already_matching',
        'current_concentration', v_current_concentration,
        'proposed_concentration_label', v_proposed_label,
        'proposed_concentration_canonical', v_proposed_canonical
      ));
      continue;
    end if;

    if upper(v_current_concentration) <> 'UNKNOWN' then
      v_manual_review_conflict_count := v_manual_review_conflict_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'fragrance_id', v_id,
        'fragrance_name', v_name,
        'brand', v_brand,
        'status', 'manual_review_conflict',
        'reason', 'catalog concentration is non-empty and differs from proposed canonical concentration',
        'current_concentration', v_current_concentration,
        'proposed_concentration_label', v_proposed_label,
        'proposed_concentration_canonical', v_proposed_canonical
      ));
      continue;
    end if;

    v_valid_count := v_valid_count + 1;

    if p_dry_run then
      v_would_update_count := v_would_update_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'fragrance_id', v_id,
        'fragrance_name', v_name,
        'brand', v_brand,
        'status', 'would_update',
        'patch_field', 'concentration',
        'current_concentration', v_current_concentration,
        'proposed_concentration_label', v_proposed_label,
        'proposed_concentration_canonical', v_proposed_canonical,
        'source_type', v_source_type,
        'source_tier', v_source_tier,
        'source_name', v_source_name
      ));
    else
      update public.fragrances
         set concentration = v_proposed_canonical
       where id = v_id
       returning concentration into v_final_concentration;

      if v_final_concentration = v_proposed_canonical then
        v_updated_count := v_updated_count + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'fragrance_id', v_id,
          'fragrance_name', v_name,
          'brand', v_brand,
          'status', 'updated',
          'patch_field', 'concentration',
          'current_concentration', v_current_concentration,
          'proposed_concentration_label', v_proposed_label,
          'proposed_concentration_canonical', v_proposed_canonical,
          'final_concentration', v_final_concentration,
          'source_type', v_source_type,
          'source_tier', v_source_tier,
          'source_name', v_source_name
        ));
      else
        v_final_value_mismatch_count := v_final_value_mismatch_count + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'fragrance_id', v_id,
          'fragrance_name', v_name,
          'brand', v_brand,
          'status', 'final_value_mismatch',
          'reason', 'post-update concentration did not match proposed canonical value',
          'patch_field', 'concentration',
          'current_concentration', v_current_concentration,
          'proposed_concentration_label', v_proposed_label,
          'proposed_concentration_canonical', v_proposed_canonical,
          'final_concentration', v_final_concentration
        ));
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'requested_count', v_requested_count,
    'valid_count', v_valid_count,
    'would_update_count', v_would_update_count,
    'updated_count', v_updated_count,
    'skipped_already_matching_count', v_skipped_already_matching_count,
    'manual_review_conflict_count', v_manual_review_conflict_count,
    'final_value_mismatch_count', v_final_value_mismatch_count,
    'rejected_count', v_rejected_count,
    'duplicate_request_count', v_duplicate_count,
    'results', v_results
  );
end;
$$;

revoke all on function public.promote_fragrance_official_concentration_v1(jsonb, text, boolean) from public;
revoke all on function public.promote_fragrance_official_concentration_v1(jsonb, text, boolean) from anon;
revoke all on function public.promote_fragrance_official_concentration_v1(jsonb, text, boolean) from authenticated;
grant execute on function public.promote_fragrance_official_concentration_v1(jsonb, text, boolean) to service_role;
