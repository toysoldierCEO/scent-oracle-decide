begin;

create table public.fragrance_identity_metadata_evidence_registry_v1 (
  id uuid primary key default gen_random_uuid(),
  fragrance_id uuid not null references public.fragrances(id),
  fragrance_name_snapshot text not null,
  brand_snapshot text not null,

  source_type text not null,
  source_tier text not null,
  source_name text not null,
  source_url text not null,
  source_url_normalized text not null,
  source_domain text not null,

  evidence_type text not null,
  evidence_status text not null default 'active',
  review_status text not null default 'proposed',

  release_year integer,
  perfumer_names jsonb not null default '[]'::jsonb,
  concentration text,
  house_brand text,

  metadata_payload jsonb not null default '{}'::jsonb,
  extraction_method text not null,
  extraction_confidence numeric not null,
  extraction_warnings jsonb not null default '[]'::jsonb,
  reason text not null,

  official_registry_eligible boolean not null default false,
  patch_safe_now boolean not null default false,

  actor_label text not null,
  batch_label text not null,
  supersedes_metadata_id uuid references public.fragrance_identity_metadata_evidence_registry_v1(id),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  evidence_hash text not null,
  payload_hash text not null,

  constraint fragrance_identity_metadata_source_type_check
    check (source_type in ('official_brand', 'retailer', 'professional_provider', 'community_provider')),
  constraint fragrance_identity_metadata_source_tier_check
    check (source_tier in (
      'official_brand_metadata',
      'official_brand_product_page',
      'retailer_structured_metadata',
      'professional_provider_metadata',
      'community_provider_metadata'
    )),
  constraint fragrance_identity_metadata_source_tier_compatibility_check
    check (
      (source_type = 'official_brand' and source_tier in ('official_brand_metadata', 'official_brand_product_page'))
      or (source_type = 'retailer' and source_tier = 'retailer_structured_metadata')
      or (source_type = 'professional_provider' and source_tier = 'professional_provider_metadata')
      or (source_type = 'community_provider' and source_tier = 'community_provider_metadata')
    ),
  constraint fragrance_identity_metadata_evidence_type_check
    check (evidence_type in (
      'identity_metadata',
      'release_year_metadata',
      'perfumer_metadata',
      'concentration_metadata',
      'brand_identity_metadata',
      'mixed_identity_metadata'
    )),
  constraint fragrance_identity_metadata_evidence_status_check
    check (evidence_status in ('active', 'superseded', 'rejected', 'stale')),
  constraint fragrance_identity_metadata_review_status_check
    check (review_status in ('proposed', 'reviewed', 'approved_for_internal_use', 'rejected', 'superseded')),
  constraint fragrance_identity_metadata_release_year_check
    check (release_year is null or (release_year between 1700 and 2100)),
  constraint fragrance_identity_metadata_perfumer_names_json_check
    check (jsonb_typeof(perfumer_names) = 'array'),
  constraint fragrance_identity_metadata_payload_json_check
    check (jsonb_typeof(metadata_payload) = 'object'),
  constraint fragrance_identity_metadata_warnings_json_check
    check (jsonb_typeof(extraction_warnings) = 'array'),
  constraint fragrance_identity_metadata_confidence_check
    check (extraction_confidence >= 0 and extraction_confidence <= 1),
  constraint fragrance_identity_metadata_source_url_check
    check (length(btrim(source_url)) > 0 and source_url ~* '^https?://'),
  constraint fragrance_identity_metadata_source_url_normalized_check
    check (length(btrim(source_url_normalized)) > 0),
  constraint fragrance_identity_metadata_source_domain_check
    check (length(btrim(source_domain)) > 0),
  constraint fragrance_identity_metadata_source_name_check
    check (length(btrim(source_name)) > 0),
  constraint fragrance_identity_metadata_actor_label_check
    check (length(btrim(actor_label)) > 0),
  constraint fragrance_identity_metadata_batch_label_check
    check (length(btrim(batch_label)) > 0),
  constraint fragrance_identity_metadata_reason_check
    check (length(btrim(reason)) > 0),
  constraint fragrance_identity_metadata_no_patch_or_registry_check
    check (official_registry_eligible = false and patch_safe_now = false),
  constraint fragrance_identity_metadata_has_value_check
    check (
      release_year is not null
      or jsonb_array_length(perfumer_names) > 0
      or nullif(btrim(coalesce(concentration, '')), '') is not null
      or nullif(btrim(coalesce(house_brand, '')), '') is not null
    )
);

create unique index fragrance_identity_metadata_evidence_hash_uidx
  on public.fragrance_identity_metadata_evidence_registry_v1 (evidence_hash);

create unique index fragrance_identity_metadata_source_payload_uidx
  on public.fragrance_identity_metadata_evidence_registry_v1 (
    fragrance_id,
    source_url_normalized,
    payload_hash
  );

create index fragrance_identity_metadata_fragrance_idx
  on public.fragrance_identity_metadata_evidence_registry_v1 (fragrance_id);

create index fragrance_identity_metadata_review_idx
  on public.fragrance_identity_metadata_evidence_registry_v1 (review_status, evidence_status);

create index fragrance_identity_metadata_source_tier_idx
  on public.fragrance_identity_metadata_evidence_registry_v1 (source_type, source_tier);

create index fragrance_identity_metadata_created_at_idx
  on public.fragrance_identity_metadata_evidence_registry_v1 (created_at desc);

alter table public.fragrance_identity_metadata_evidence_registry_v1 enable row level security;

revoke all on table public.fragrance_identity_metadata_evidence_registry_v1
  from public, anon, authenticated;

revoke all on table public.fragrance_identity_metadata_evidence_registry_v1
  from service_role;

grant select, insert, update on table public.fragrance_identity_metadata_evidence_registry_v1
  to service_role;

create or replace function public.record_fragrance_identity_metadata_evidence_v1(
  p_payloads jsonb,
  p_actor_label text default 'codex_identity_metadata_capture_v1',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb;
  v_requested_count integer := 0;
  v_valid_count integer := 0;
  v_would_insert_count integer := 0;
  v_would_skip_duplicate_count integer := 0;
  v_inserted_count integer := 0;
  v_skipped_duplicate_count integer := 0;
  v_rejected_count integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_inserted_ids jsonb := '[]'::jsonb;

  v_errors text[];
  v_fragrance_id uuid;
  v_fragrance_name text;
  v_brand text;
  v_name_snapshot text;
  v_brand_snapshot text;
  v_source_type text;
  v_source_tier text;
  v_source_name text;
  v_source_url text;
  v_source_url_normalized text;
  v_source_domain text;
  v_evidence_type text;
  v_evidence_status text;
  v_release_year integer;
  v_perfumer_names jsonb;
  v_concentration text;
  v_house_brand text;
  v_metadata_payload jsonb;
  v_extraction_method text;
  v_extraction_confidence numeric;
  v_extraction_warnings jsonb;
  v_reason text;
  v_batch_label text;
  v_payload_hash text;
  v_evidence_hash text;
  v_existing_id uuid;
  v_inserted_id uuid;
  v_has_metadata_value boolean;
begin
  if p_payloads is null or jsonb_typeof(p_payloads) <> 'array' then
    raise exception 'p_payloads must be a JSON array';
  end if;

  v_requested_count := jsonb_array_length(p_payloads);

  if v_requested_count > 50 then
    raise exception 'p_payloads batch size % exceeds max 50', v_requested_count;
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
      'would_insert_count', 0,
      'would_skip_duplicate_count', 0,
      'inserted_count', 0,
      'skipped_duplicate_count', 0,
      'results', '[]'::jsonb,
      'inserted_ids', '[]'::jsonb
    );
  end if;

  for v_payload in
    select value
    from jsonb_array_elements(p_payloads)
  loop
    v_errors := array[]::text[];
    v_existing_id := null;
    v_inserted_id := null;

    if jsonb_typeof(v_payload) <> 'object' then
      v_errors := v_errors || 'payload must be an object';
    end if;

    if v_payload ? 'actor_label'
      or v_payload ? 'created_at'
      or v_payload ? 'updated_at'
      or v_payload ? 'superseded_at'
      or v_payload ? 'payload_hash'
      or v_payload ? 'evidence_hash'
    then
      v_errors := v_errors || 'payload-supplied actor/timestamp/hash fields are forbidden in V1';
    end if;

    if v_payload ? 'review_status'
      and coalesce(v_payload->>'review_status', 'proposed') <> 'proposed'
    then
      v_errors := v_errors || 'review_status cannot self-approve at ingest';
    end if;

    if not (
      v_payload ? 'fragrance_id'
      and v_payload ? 'fragrance_name'
      and v_payload ? 'brand'
      and v_payload ? 'source_type'
      and v_payload ? 'source_tier'
      and v_payload ? 'source_name'
      and v_payload ? 'source_url'
      and v_payload ? 'evidence_type'
      and v_payload ? 'evidence_status'
      and v_payload ? 'extraction_method'
      and v_payload ? 'extraction_confidence'
      and v_payload ? 'extraction_warnings'
      and v_payload ? 'metadata_payload'
      and v_payload ? 'batch_label'
      and v_payload ? 'reason'
    ) then
      v_errors := v_errors || 'payload missing one or more required fields';
    end if;

    begin
      v_fragrance_id := (v_payload->>'fragrance_id')::uuid;
    exception when others then
      v_fragrance_id := null;
      v_errors := v_errors || 'fragrance_id must be a UUID';
    end;

    begin
      v_extraction_confidence := (v_payload->>'extraction_confidence')::numeric;
    exception when others then
      v_extraction_confidence := null;
      v_errors := v_errors || 'extraction_confidence must be numeric';
    end;

    begin
      v_release_year := nullif(btrim(coalesce(v_payload->>'release_year', '')), '')::integer;
    exception when others then
      v_release_year := null;
      v_errors := v_errors || 'release_year must be an integer when present';
    end;

    v_fragrance_name := nullif(btrim(coalesce(v_payload->>'fragrance_name', '')), '');
    v_brand := nullif(btrim(coalesce(v_payload->>'brand', '')), '');
    v_source_type := nullif(btrim(coalesce(v_payload->>'source_type', '')), '');
    v_source_tier := nullif(btrim(coalesce(v_payload->>'source_tier', '')), '');
    v_source_name := nullif(btrim(coalesce(v_payload->>'source_name', '')), '');
    v_source_url := nullif(btrim(coalesce(v_payload->>'source_url', '')), '');
    v_evidence_type := nullif(btrim(coalesce(v_payload->>'evidence_type', '')), '');
    v_evidence_status := nullif(btrim(coalesce(v_payload->>'evidence_status', 'active')), '');
    v_perfumer_names := coalesce(v_payload->'perfumer_names', '[]'::jsonb);
    v_concentration := nullif(btrim(coalesce(v_payload->>'concentration', '')), '');
    v_house_brand := nullif(btrim(coalesce(v_payload->>'house_brand', '')), '');
    v_metadata_payload := coalesce(v_payload->'metadata_payload', '{}'::jsonb);
    v_extraction_method := nullif(btrim(coalesce(v_payload->>'extraction_method', '')), '');
    v_extraction_warnings := coalesce(v_payload->'extraction_warnings', '[]'::jsonb);
    v_batch_label := nullif(btrim(coalesce(v_payload->>'batch_label', '')), '');
    v_reason := nullif(btrim(coalesce(v_payload->>'reason', '')), '');

    if jsonb_typeof(v_perfumer_names) <> 'array' then
      v_errors := v_errors || 'perfumer_names must be an array';
    end if;
    if jsonb_typeof(v_metadata_payload) <> 'object' then
      v_errors := v_errors || 'metadata_payload must be an object';
    end if;
    if jsonb_typeof(v_extraction_warnings) <> 'array' then
      v_errors := v_errors || 'extraction_warnings must be an array';
    end if;

    if coalesce(lower(v_payload->>'official_registry_eligible'), 'false') <> 'false' then
      v_errors := v_errors || 'official_registry_eligible must be false';
    end if;

    if coalesce(lower(v_payload->>'patch_safe_now'), 'false') <> 'false' then
      v_errors := v_errors || 'patch_safe_now must be false';
    end if;

    if v_source_type is null or v_source_type not in ('official_brand', 'retailer', 'professional_provider', 'community_provider') then
      v_errors := v_errors || 'source_type is not allowed in V1';
    end if;

    if v_source_tier is null or v_source_tier not in (
      'official_brand_metadata',
      'official_brand_product_page',
      'retailer_structured_metadata',
      'professional_provider_metadata',
      'community_provider_metadata'
    ) then
      v_errors := v_errors || 'source_tier is not allowed in V1';
    end if;

    if not (
      (v_source_type = 'official_brand' and v_source_tier in ('official_brand_metadata', 'official_brand_product_page'))
      or (v_source_type = 'retailer' and v_source_tier = 'retailer_structured_metadata')
      or (v_source_type = 'professional_provider' and v_source_tier = 'professional_provider_metadata')
      or (v_source_type = 'community_provider' and v_source_tier = 'community_provider_metadata')
    ) then
      v_errors := v_errors || 'source_type/source_tier combination is not allowed';
    end if;

    if v_evidence_type is null or v_evidence_type not in (
      'identity_metadata',
      'release_year_metadata',
      'perfumer_metadata',
      'concentration_metadata',
      'brand_identity_metadata',
      'mixed_identity_metadata'
    ) then
      v_errors := v_errors || 'evidence_type is not allowed in V1';
    end if;

    if v_evidence_status is null or v_evidence_status <> 'active' then
      v_errors := v_errors || 'evidence_status must be active at ingest';
    end if;

    if v_release_year is not null and (v_release_year < 1700 or v_release_year > 2100) then
      v_errors := v_errors || 'release_year must be between 1700 and 2100';
    end if;

    if v_concentration is not null and length(v_concentration) > 80 then
      v_errors := v_errors || 'concentration is too long';
    end if;

    if v_house_brand is not null and v_brand is not null and v_house_brand <> v_brand then
      v_errors := v_errors || 'house_brand must match brand exactly in V1';
    end if;

    if v_extraction_confidence is null or v_extraction_confidence < 0 or v_extraction_confidence > 1 then
      v_errors := v_errors || 'extraction_confidence must be between 0 and 1';
    end if;

    if v_fragrance_name is null then
      v_errors := v_errors || 'fragrance_name must not be empty';
    end if;
    if v_brand is null then
      v_errors := v_errors || 'brand must not be empty';
    end if;
    if v_source_name is null then
      v_errors := v_errors || 'source_name must not be empty';
    end if;
    if v_source_url is null or v_source_url !~* '^https?://' then
      v_errors := v_errors || 'source_url must be a non-empty http(s) URL';
    end if;
    if v_extraction_method is null then
      v_errors := v_errors || 'extraction_method must not be empty';
    end if;
    if v_batch_label is null then
      v_errors := v_errors || 'batch_label must not be empty';
    end if;
    if v_reason is null then
      v_errors := v_errors || 'reason must not be empty';
    end if;

    v_has_metadata_value := (
      v_release_year is not null
      or (jsonb_typeof(v_perfumer_names) = 'array' and jsonb_array_length(v_perfumer_names) > 0)
      or v_concentration is not null
      or v_house_brand is not null
    );

    if not v_has_metadata_value then
      v_errors := v_errors || 'at least one metadata value is required';
    end if;

    if jsonb_typeof(v_perfumer_names) = 'array'
      and exists (
        select 1
        from jsonb_array_elements_text(v_perfumer_names) as value
        where length(btrim(value)) = 0
          or length(value) > 120
          or value ~* 'https?://'
          or value ~ '[.!?]$'
      )
    then
      v_errors := v_errors || 'perfumer_names contain invalid values';
    end if;

    if v_fragrance_id is not null then
      select f.name, f.brand
      into v_name_snapshot, v_brand_snapshot
      from public.fragrances f
      where f.id = v_fragrance_id;

      if not found then
        v_errors := v_errors || 'fragrance_id does not exist';
      elsif v_name_snapshot <> v_fragrance_name or v_brand_snapshot <> v_brand then
        v_errors := v_errors || 'fragrance_name/brand do not match fragrance_id exactly';
      end if;
    end if;

    if v_source_url is not null then
      v_source_url_normalized := regexp_replace(lower(split_part(v_source_url, '#', 1)), '/+$', '');
      v_source_domain := lower(regexp_replace(v_source_url_normalized, '^https?://([^/?#]+).*$' , '\1'));
    else
      v_source_url_normalized := null;
      v_source_domain := null;
    end if;

    if v_source_domain is null or v_source_domain !~ '^[a-z0-9.-]+(:[0-9]+)?$' then
      v_errors := v_errors || 'source_domain could not be normalized';
    end if;

    v_payload_hash := md5(v_payload::text);
    v_evidence_hash := md5(concat_ws(
      '|',
      coalesce(v_fragrance_id::text, ''),
      coalesce(v_source_url_normalized, ''),
      coalesce(v_source_type, ''),
      coalesce(v_source_tier, ''),
      coalesce(v_evidence_type, ''),
      coalesce(v_release_year::text, ''),
      coalesce(v_perfumer_names::text, '[]'),
      coalesce(v_concentration, ''),
      coalesce(v_house_brand, '')
    ));

    if v_errors = array[]::text[] then
      select r.id
      into v_existing_id
      from public.fragrance_identity_metadata_evidence_registry_v1 r
      where r.evidence_hash = v_evidence_hash
      limit 1;
    end if;

    if v_errors = array[]::text[] then
      v_valid_count := v_valid_count + 1;

      if v_existing_id is not null then
        if p_dry_run then
          v_would_skip_duplicate_count := v_would_skip_duplicate_count + 1;
        else
          v_skipped_duplicate_count := v_skipped_duplicate_count + 1;
        end if;

        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'fragrance_id', v_fragrance_id,
          'fragrance_name', v_fragrance_name,
          'brand', v_brand,
          'status', case when p_dry_run then 'would_skip_duplicate' else 'skipped_duplicate' end,
          'existing_id', v_existing_id,
          'evidence_hash', v_evidence_hash
        ));
      else
        if p_dry_run then
          v_would_insert_count := v_would_insert_count + 1;
          v_results := v_results || jsonb_build_array(jsonb_build_object(
            'fragrance_id', v_fragrance_id,
            'fragrance_name', v_fragrance_name,
            'brand', v_brand,
            'status', 'would_insert',
            'source_type', v_source_type,
            'source_tier', v_source_tier,
            'evidence_hash', v_evidence_hash
          ));
        else
          insert into public.fragrance_identity_metadata_evidence_registry_v1 (
            fragrance_id,
            fragrance_name_snapshot,
            brand_snapshot,
            source_type,
            source_tier,
            source_name,
            source_url,
            source_url_normalized,
            source_domain,
            evidence_type,
            evidence_status,
            review_status,
            release_year,
            perfumer_names,
            concentration,
            house_brand,
            metadata_payload,
            extraction_method,
            extraction_confidence,
            extraction_warnings,
            reason,
            official_registry_eligible,
            patch_safe_now,
            actor_label,
            batch_label,
            evidence_hash,
            payload_hash
          ) values (
            v_fragrance_id,
            v_name_snapshot,
            v_brand_snapshot,
            v_source_type,
            v_source_tier,
            v_source_name,
            v_source_url,
            v_source_url_normalized,
            v_source_domain,
            v_evidence_type,
            'active',
            'proposed',
            v_release_year,
            v_perfumer_names,
            v_concentration,
            v_house_brand,
            v_metadata_payload,
            v_extraction_method,
            v_extraction_confidence,
            v_extraction_warnings,
            v_reason,
            false,
            false,
            p_actor_label,
            v_batch_label,
            v_evidence_hash,
            v_payload_hash
          )
          returning id into v_inserted_id;

          v_inserted_count := v_inserted_count + 1;
          v_inserted_ids := v_inserted_ids || jsonb_build_array(v_inserted_id);
          v_results := v_results || jsonb_build_array(jsonb_build_object(
            'fragrance_id', v_fragrance_id,
            'fragrance_name', v_fragrance_name,
            'brand', v_brand,
            'status', 'inserted',
            'inserted_id', v_inserted_id,
            'evidence_hash', v_evidence_hash
          ));
        end if;
      end if;
    else
      v_rejected_count := v_rejected_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'fragrance_id', coalesce(v_payload->>'fragrance_id', null),
        'fragrance_name', coalesce(v_payload->>'fragrance_name', null),
        'brand', coalesce(v_payload->>'brand', null),
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
    'would_insert_count', v_would_insert_count,
    'would_skip_duplicate_count', v_would_skip_duplicate_count,
    'inserted_count', v_inserted_count,
    'skipped_duplicate_count', v_skipped_duplicate_count,
    'results', v_results,
    'inserted_ids', v_inserted_ids
  );
end;
$$;

revoke all on function public.record_fragrance_identity_metadata_evidence_v1(jsonb, text, boolean)
  from public, anon, authenticated;

grant execute on function public.record_fragrance_identity_metadata_evidence_v1(jsonb, text, boolean)
  to service_role;

create or replace view public.fragrance_identity_metadata_candidate_view_v1
with (security_invoker = true)
as
select
  r.id as metadata_evidence_id,
  r.fragrance_id,
  r.fragrance_name_snapshot as fragrance_name,
  r.brand_snapshot as brand,
  r.source_type,
  r.source_tier,
  r.source_name,
  r.source_url,
  r.source_domain,
  r.evidence_type,
  r.evidence_status,
  r.review_status,
  r.release_year,
  r.perfumer_names,
  r.concentration,
  r.house_brand,
  r.extraction_method,
  r.extraction_confidence,
  r.extraction_warnings,
  false as patch_safe_now,
  false as official_registry_eligible,
  case
    when r.review_status = 'proposed' then 'metadata_needs_human_review'
    when r.review_status = 'approved_for_internal_use' then 'metadata_approved_for_internal_use'
    when r.review_status = 'rejected' then 'metadata_rejected'
    when r.evidence_status = 'superseded' or r.review_status = 'superseded' then 'metadata_superseded'
    else 'metadata_reviewed'
  end as next_action_bucket,
  r.created_at,
  r.updated_at
from public.fragrance_identity_metadata_evidence_registry_v1 r
where r.superseded_at is null;

revoke all on public.fragrance_identity_metadata_candidate_view_v1
  from public, anon, authenticated;

revoke all on public.fragrance_identity_metadata_candidate_view_v1
  from service_role;

grant select on public.fragrance_identity_metadata_candidate_view_v1
  to service_role;

comment on table public.fragrance_identity_metadata_evidence_registry_v1
  is 'Review-gated source-backed identity metadata evidence for fragrances. It stores release year, perfumer, concentration, and brand/house confirmation without mutating public.fragrances.';

comment on function public.record_fragrance_identity_metadata_evidence_v1(jsonb, text, boolean)
  is 'Service-role-only helper for dry-run/live insertion of identity metadata evidence. Live mode inserts only into the metadata evidence registry and never mutates public.fragrances or official/provider intelligence registries.';

comment on view public.fragrance_identity_metadata_candidate_view_v1
  is 'Service-role-only review view for sanitized identity metadata evidence candidates. Raw metadata payloads are intentionally hidden from this view.';

commit;
