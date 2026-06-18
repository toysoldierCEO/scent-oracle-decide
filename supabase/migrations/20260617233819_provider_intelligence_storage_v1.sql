begin;

create table public.fragrance_provider_intelligence_registry_v1 (
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
  evidence_status text not null default 'usable_non_official_intelligence',
  review_status text not null default 'proposed',
  extraction_method text not null,
  extraction_confidence numeric not null,
  extraction_warnings jsonb not null default '[]'::jsonb,

  normalized_notes jsonb not null default '[]'::jsonb,
  normalized_pyramid jsonb not null default '{"top":[],"heart":[],"base":[]}'::jsonb,
  normalized_accords jsonb not null default '[]'::jsonb,

  raw_evidence jsonb not null default '{}'::jsonb,
  provider_payload jsonb not null default '{}'::jsonb,
  reason text not null,

  official_registry_eligible boolean not null default false,
  patch_safe_now boolean not null default false,

  actor_label text not null,
  batch_label text not null,
  supersedes_intelligence_id uuid references public.fragrance_provider_intelligence_registry_v1(id),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  evidence_hash text not null,
  payload_hash text not null,

  constraint fragrance_provider_intelligence_registry_v1_source_type_check
    check (source_type in ('retailer', 'professional_provider', 'community_provider')),
  constraint fragrance_provider_intelligence_registry_v1_source_type_non_official_check
    check (source_type <> 'official_brand'),
  constraint fragrance_provider_intelligence_registry_v1_source_tier_check
    check (source_tier in (
      'retailer_structured_notes',
      'retailer_pyramid_evidence',
      'professional_provider_pyramid',
      'community_provider_consensus'
    )),
  constraint fragrance_provider_intelligence_registry_v1_evidence_type_check
    check (evidence_type in (
      'structured_notes',
      'structured_pyramid',
      'consensus_notes',
      'consensus_pyramid'
    )),
  constraint fragrance_provider_intelligence_registry_v1_evidence_status_check
    check (evidence_status in (
      'usable_non_official_intelligence',
      'superseded',
      'rejected',
      'stale'
    )),
  constraint fragrance_provider_intelligence_registry_v1_review_status_check
    check (review_status in (
      'proposed',
      'reviewed',
      'approved_for_internal_use',
      'rejected',
      'superseded'
    )),
  constraint fragrance_provider_intelligence_registry_v1_extraction_confidence_check
    check (extraction_confidence >= 0 and extraction_confidence <= 1),
  constraint fragrance_provider_intelligence_registry_v1_source_url_check
    check (length(btrim(source_url)) > 0),
  constraint fragrance_provider_intelligence_registry_v1_source_url_normalized_check
    check (length(btrim(source_url_normalized)) > 0),
  constraint fragrance_provider_intelligence_registry_v1_source_domain_check
    check (length(btrim(source_domain)) > 0),
  constraint fragrance_provider_intelligence_registry_v1_source_name_check
    check (length(btrim(source_name)) > 0),
  constraint fragrance_provider_intelligence_registry_v1_actor_label_check
    check (length(btrim(actor_label)) > 0),
  constraint fragrance_provider_intelligence_registry_v1_batch_label_check
    check (length(btrim(batch_label)) > 0),
  constraint fragrance_provider_intelligence_registry_v1_non_official_defaults_check
    check (official_registry_eligible = false and patch_safe_now = false),
  constraint fragrance_provider_intelligence_registry_v1_extraction_warnings_json_check
    check (jsonb_typeof(extraction_warnings) = 'array'),
  constraint fragrance_provider_intelligence_registry_v1_normalized_notes_json_check
    check (jsonb_typeof(normalized_notes) = 'array'),
  constraint fragrance_provider_intelligence_registry_v1_normalized_pyramid_json_check
    check (
      jsonb_typeof(normalized_pyramid) = 'object'
      and jsonb_typeof(coalesce(normalized_pyramid->'top', '[]'::jsonb)) = 'array'
      and jsonb_typeof(coalesce(normalized_pyramid->'heart', '[]'::jsonb)) = 'array'
      and jsonb_typeof(coalesce(normalized_pyramid->'base', '[]'::jsonb)) = 'array'
    ),
  constraint fragrance_provider_intelligence_registry_v1_normalized_accords_json_check
    check (jsonb_typeof(normalized_accords) = 'array'),
  constraint fragrance_provider_intelligence_registry_v1_raw_evidence_json_check
    check (jsonb_typeof(raw_evidence) = 'object'),
  constraint fragrance_provider_intelligence_registry_v1_provider_payload_json_check
    check (jsonb_typeof(provider_payload) = 'object'),
  constraint fragrance_provider_intelligence_registry_v1_tier_evidence_compatibility_check
    check (
      (source_tier = 'retailer_structured_notes' and evidence_type = 'structured_notes')
      or (source_tier = 'retailer_pyramid_evidence' and evidence_type = 'structured_pyramid')
      or (source_tier = 'professional_provider_pyramid' and evidence_type = 'structured_pyramid')
      or (source_tier = 'community_provider_consensus' and evidence_type in ('consensus_notes', 'consensus_pyramid'))
    )
);

create unique index fragrance_provider_intelligence_registry_v1_evidence_hash_uidx
  on public.fragrance_provider_intelligence_registry_v1 (evidence_hash);

create unique index fragrance_provider_intelligence_registry_v1_fragrance_source_payload_uidx
  on public.fragrance_provider_intelligence_registry_v1 (
    fragrance_id,
    source_url_normalized,
    payload_hash
  );

create unique index fragrance_provider_intelligence_registry_v1_active_source_uidx
  on public.fragrance_provider_intelligence_registry_v1 (
    fragrance_id,
    source_url_normalized,
    source_tier,
    evidence_type
  )
  where evidence_status = 'usable_non_official_intelligence'
    and review_status not in ('rejected', 'superseded');

create index fragrance_provider_intelligence_registry_v1_fragrance_idx
  on public.fragrance_provider_intelligence_registry_v1 (fragrance_id);

create index fragrance_provider_intelligence_registry_v1_tier_evidence_idx
  on public.fragrance_provider_intelligence_registry_v1 (source_tier, evidence_type);

create index fragrance_provider_intelligence_registry_v1_review_evidence_idx
  on public.fragrance_provider_intelligence_registry_v1 (review_status, evidence_status);

create index fragrance_provider_intelligence_registry_v1_created_at_idx
  on public.fragrance_provider_intelligence_registry_v1 (created_at desc);

create index fragrance_provider_intelligence_registry_v1_source_url_normalized_idx
  on public.fragrance_provider_intelligence_registry_v1 (source_url_normalized);

alter table public.fragrance_provider_intelligence_registry_v1 enable row level security;

revoke all on table public.fragrance_provider_intelligence_registry_v1
  from public, anon, authenticated;

revoke all on table public.fragrance_provider_intelligence_registry_v1
  from service_role;

grant select, insert, update on table public.fragrance_provider_intelligence_registry_v1
  to service_role;

create function public.record_fragrance_provider_intelligence_v1(
  p_payloads jsonb,
  p_actor_label text default 'codex_provider_intelligence_v1',
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
  v_would_supersede_count integer := 0;
  v_inserted_count integer := 0;
  v_skipped_duplicate_count integer := 0;
  v_superseded_count integer := 0;
  v_rejected_count integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_inserted_ids jsonb := '[]'::jsonb;

  v_errors text[];
  v_fragrance_id uuid;
  v_fragrance_name text;
  v_brand text;
  v_source_type text;
  v_source_tier text;
  v_source_name text;
  v_source_url text;
  v_source_url_normalized text;
  v_source_domain text;
  v_evidence_type text;
  v_evidence_status text;
  v_review_status text;
  v_extraction_method text;
  v_extraction_confidence numeric;
  v_extraction_warnings jsonb;
  v_normalized_notes jsonb;
  v_normalized_pyramid jsonb;
  v_normalized_accords jsonb;
  v_raw_evidence jsonb;
  v_provider_payload jsonb;
  v_reason text;
  v_batch_label text;
  v_fragrance_name_snapshot text;
  v_brand_snapshot text;

  v_normalized_notes_arr text[];
  v_normalized_top_arr text[];
  v_normalized_heart_arr text[];
  v_normalized_base_arr text[];
  v_normalized_accords_arr text[];
  v_payload_hash text;
  v_evidence_hash text;
  v_existing_id uuid;
  v_existing_active_id uuid;
  v_inserted_id uuid;
  v_source_url_no_fragment text;
  v_url_parts text[];
  v_scheme text;
  v_host text;
  v_path text;
  v_query text;
  v_clean_query text;
begin
  if p_payloads is null or jsonb_typeof(p_payloads) <> 'array' then
    raise exception 'p_payloads must be a JSON array';
  end if;

  v_requested_count := jsonb_array_length(p_payloads);

  if v_requested_count = 0 then
    raise exception 'p_payloads must not be empty';
  end if;

  if v_requested_count > 50 then
    raise exception 'p_payloads batch size % exceeds max 50', v_requested_count;
  end if;

  if p_actor_label is null or length(btrim(p_actor_label)) = 0 then
    raise exception 'p_actor_label must not be empty';
  end if;

  for v_payload in
    select value
    from jsonb_array_elements(p_payloads)
  loop
    v_errors := array[]::text[];
    v_existing_id := null;
    v_existing_active_id := null;
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
      and v_payload ? 'normalized_notes'
      and v_payload ? 'normalized_pyramid'
      and v_payload ? 'normalized_accords'
      and v_payload ? 'raw_evidence'
      and v_payload ? 'provider_payload'
      and v_payload ? 'official_registry_eligible'
      and v_payload ? 'patch_safe_now'
      and v_payload ? 'batch_label'
      and v_payload ? 'reason'
    ) then
      v_errors := v_errors || 'payload missing one or more required fields';
    end if;

    if not (v_payload ? 'extraction_warnings') or jsonb_typeof(v_payload->'extraction_warnings') <> 'array' then
      v_errors := v_errors || 'extraction_warnings must be an array';
    end if;
    if not (v_payload ? 'normalized_notes') or jsonb_typeof(v_payload->'normalized_notes') <> 'array' then
      v_errors := v_errors || 'normalized_notes must be an array';
    end if;
    if not (v_payload ? 'normalized_pyramid') or jsonb_typeof(v_payload->'normalized_pyramid') <> 'object' then
      v_errors := v_errors || 'normalized_pyramid must be an object';
    end if;
    if not (v_payload ? 'normalized_accords') or jsonb_typeof(v_payload->'normalized_accords') <> 'array' then
      v_errors := v_errors || 'normalized_accords must be an array';
    end if;
    if not (v_payload ? 'raw_evidence') or jsonb_typeof(v_payload->'raw_evidence') <> 'object' then
      v_errors := v_errors || 'raw_evidence must be an object';
    end if;
    if not (v_payload ? 'provider_payload') or jsonb_typeof(v_payload->'provider_payload') <> 'object' then
      v_errors := v_errors || 'provider_payload must be an object';
    end if;

    if v_errors = array[]::text[] then
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

      v_fragrance_name := nullif(btrim(coalesce(v_payload->>'fragrance_name', '')), '');
      v_brand := nullif(btrim(coalesce(v_payload->>'brand', '')), '');
      v_source_type := nullif(btrim(coalesce(v_payload->>'source_type', '')), '');
      v_source_tier := nullif(btrim(coalesce(v_payload->>'source_tier', '')), '');
      v_source_name := nullif(btrim(coalesce(v_payload->>'source_name', '')), '');
      v_source_url := nullif(btrim(coalesce(v_payload->>'source_url', '')), '');
      v_evidence_type := nullif(btrim(coalesce(v_payload->>'evidence_type', '')), '');
      v_evidence_status := nullif(btrim(coalesce(v_payload->>'evidence_status', '')), '');
      v_review_status := 'proposed';
      v_extraction_method := nullif(btrim(coalesce(v_payload->>'extraction_method', '')), '');
      v_extraction_warnings := coalesce(v_payload->'extraction_warnings', '[]'::jsonb);
      v_normalized_notes := coalesce(v_payload->'normalized_notes', '[]'::jsonb);
      v_normalized_pyramid := coalesce(v_payload->'normalized_pyramid', '{"top":[],"heart":[],"base":[]}'::jsonb);
      v_normalized_accords := coalesce(v_payload->'normalized_accords', '[]'::jsonb);
      v_raw_evidence := coalesce(v_payload->'raw_evidence', '{}'::jsonb);
      v_provider_payload := coalesce(v_payload->'provider_payload', '{}'::jsonb);
      v_batch_label := nullif(btrim(coalesce(v_payload->>'batch_label', '')), '');
      v_reason := nullif(btrim(coalesce(v_payload->>'reason', '')), '');

      if coalesce(lower(v_payload->>'official_registry_eligible'), 'false') <> 'false' then
        v_errors := v_errors || 'official_registry_eligible must be false';
      end if;

      if coalesce(lower(v_payload->>'patch_safe_now'), 'false') <> 'false' then
        v_errors := v_errors || 'patch_safe_now must be false';
      end if;

      if v_source_type is null or v_source_type not in ('retailer', 'professional_provider', 'community_provider') then
        v_errors := v_errors || 'source_type must be retailer, professional_provider, or community_provider';
      end if;

      if v_source_tier is null or v_source_tier not in (
        'retailer_structured_notes',
        'retailer_pyramid_evidence',
        'professional_provider_pyramid',
        'community_provider_consensus'
      ) then
        v_errors := v_errors || 'source_tier is not allowed in V1';
      end if;

      if v_evidence_type is null or v_evidence_type not in (
        'structured_notes',
        'structured_pyramid',
        'consensus_notes',
        'consensus_pyramid'
      ) then
        v_errors := v_errors || 'evidence_type is not allowed in V1';
      end if;

      if v_evidence_status is null or v_evidence_status <> 'usable_non_official_intelligence' then
        v_errors := v_errors || 'evidence_status must be usable_non_official_intelligence';
      end if;

      if v_source_tier = 'retailer_structured_notes' and v_evidence_type <> 'structured_notes' then
        v_errors := v_errors || 'retailer_structured_notes requires evidence_type structured_notes';
      end if;
      if v_source_tier = 'retailer_pyramid_evidence' and v_evidence_type <> 'structured_pyramid' then
        v_errors := v_errors || 'retailer_pyramid_evidence requires evidence_type structured_pyramid';
      end if;
      if v_source_tier = 'professional_provider_pyramid' and v_evidence_type <> 'structured_pyramid' then
        v_errors := v_errors || 'professional_provider_pyramid requires evidence_type structured_pyramid';
      end if;
      if v_source_tier = 'community_provider_consensus' and v_evidence_type not in ('consensus_notes', 'consensus_pyramid') then
        v_errors := v_errors || 'community_provider_consensus requires consensus evidence_type';
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
      if v_extraction_confidence is null or v_extraction_confidence < 0 or v_extraction_confidence > 1 then
        v_errors := v_errors || 'extraction_confidence must be between 0 and 1';
      end if;
      if jsonb_typeof(coalesce(v_normalized_pyramid->'top', '[]'::jsonb)) <> 'array'
        or jsonb_typeof(coalesce(v_normalized_pyramid->'heart', '[]'::jsonb)) <> 'array'
        or jsonb_typeof(coalesce(v_normalized_pyramid->'base', '[]'::jsonb)) <> 'array'
      then
        v_errors := v_errors || 'normalized_pyramid.top/heart/base must each be arrays';
      end if;

      select coalesce(array_agg(value), '{}'::text[])
      into v_normalized_notes_arr
      from jsonb_array_elements_text(v_normalized_notes) as value
      where length(btrim(value)) > 0;

      select coalesce(array_agg(value), '{}'::text[])
      into v_normalized_top_arr
      from jsonb_array_elements_text(coalesce(v_normalized_pyramid->'top', '[]'::jsonb)) as value
      where length(btrim(value)) > 0;

      select coalesce(array_agg(value), '{}'::text[])
      into v_normalized_heart_arr
      from jsonb_array_elements_text(coalesce(v_normalized_pyramid->'heart', '[]'::jsonb)) as value
      where length(btrim(value)) > 0;

      select coalesce(array_agg(value), '{}'::text[])
      into v_normalized_base_arr
      from jsonb_array_elements_text(coalesce(v_normalized_pyramid->'base', '[]'::jsonb)) as value
      where length(btrim(value)) > 0;

      select coalesce(array_agg(value), '{}'::text[])
      into v_normalized_accords_arr
      from jsonb_array_elements_text(v_normalized_accords) as value
      where length(btrim(value)) > 0;

      if v_evidence_type in ('structured_notes', 'consensus_notes')
        and coalesce(cardinality(v_normalized_notes_arr), 0) = 0
      then
        v_errors := v_errors || 'structured_notes/consensus_notes require normalized_notes';
      end if;

      if v_evidence_type in ('structured_pyramid', 'consensus_pyramid')
        and coalesce(cardinality(v_normalized_top_arr), 0)
          + coalesce(cardinality(v_normalized_heart_arr), 0)
          + coalesce(cardinality(v_normalized_base_arr), 0) = 0
      then
        v_errors := v_errors || 'structured_pyramid/consensus_pyramid require at least one pyramid note';
      end if;

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

      if v_errors = array[]::text[] then
        select f.name, f.brand
        into v_fragrance_name_snapshot, v_brand_snapshot
        from public.fragrances f
        where f.id = v_fragrance_id;

        if not found then
          v_errors := v_errors || 'fragrance_id does not exist';
        elsif v_fragrance_name_snapshot <> v_fragrance_name or v_brand_snapshot <> v_brand then
          v_errors := v_errors || 'fragrance_name/brand do not match fragrance_id exactly';
        end if;
      end if;

      if v_errors = array[]::text[] then
        v_source_url_no_fragment := split_part(v_source_url, '#', 1);
        v_url_parts := regexp_match(
          v_source_url_no_fragment,
          '^([A-Za-z][A-Za-z0-9+.-]*://)([^/?#]+)([^?#]*)(\?.*)?$'
        );

        if v_url_parts is null then
          v_errors := v_errors || 'source_url could not be normalized';
        else
          v_scheme := lower(v_url_parts[1]);
          v_host := lower(v_url_parts[2]);
          v_path := coalesce(v_url_parts[3], '');
          v_query := ltrim(coalesce(v_url_parts[4], ''), '?');

          if v_path = '/' then
            v_path := '';
          elsif v_path <> '' then
            v_path := regexp_replace(v_path, '/+$', '');
          end if;

          select coalesce(string_agg(param, '&' order by ord), '')
          into v_clean_query
          from unnest(string_to_array(v_query, '&')) with ordinality as q(param, ord)
          where length(btrim(param)) > 0
            and split_part(lower(param), '=', 1) not like 'utm\_%' escape '\'
            and split_part(lower(param), '=', 1) not in ('fbclid', 'gclid', 'src');

          v_source_url_normalized := v_scheme || v_host || v_path
            || case when v_clean_query <> '' then '?' || v_clean_query else '' end;
          v_source_domain := split_part(v_host, ':', 1);
        end if;
      end if;

      if v_errors = array[]::text[] then
        v_payload_hash := md5(jsonb_build_object(
          'source_tier', v_source_tier,
          'evidence_type', v_evidence_type,
          'normalized_notes', to_jsonb(v_normalized_notes_arr),
          'normalized_pyramid', jsonb_build_object(
            'top', to_jsonb(v_normalized_top_arr),
            'heart', to_jsonb(v_normalized_heart_arr),
            'base', to_jsonb(v_normalized_base_arr)
          ),
          'normalized_accords', to_jsonb(v_normalized_accords_arr),
          'extraction_method', v_extraction_method
        )::text);

        v_evidence_hash := md5(
          v_fragrance_id::text
            || '|'
            || v_source_url_normalized
            || '|'
            || v_payload_hash
        );

        select r.id
        into v_existing_id
        from public.fragrance_provider_intelligence_registry_v1 r
        where r.evidence_hash = v_evidence_hash
        limit 1;

        if p_dry_run then
          select r.id
          into v_existing_active_id
          from public.fragrance_provider_intelligence_registry_v1 r
          where r.fragrance_id = v_fragrance_id
            and r.source_url_normalized = v_source_url_normalized
            and r.source_tier = v_source_tier
            and r.evidence_type = v_evidence_type
            and r.evidence_status = 'usable_non_official_intelligence'
            and r.review_status not in ('rejected', 'superseded')
          limit 1;
        else
          select r.id
          into v_existing_active_id
          from public.fragrance_provider_intelligence_registry_v1 r
          where r.fragrance_id = v_fragrance_id
            and r.source_url_normalized = v_source_url_normalized
            and r.source_tier = v_source_tier
            and r.evidence_type = v_evidence_type
            and r.evidence_status = 'usable_non_official_intelligence'
            and r.review_status not in ('rejected', 'superseded')
          limit 1
          for update;
        end if;
      end if;
    end if;

    if v_errors <> array[]::text[] then
      v_rejected_count := v_rejected_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'fragrance_id', coalesce(v_payload->>'fragrance_id', null),
        'status', 'rejected',
        'errors', v_errors
      ));
    else
      v_valid_count := v_valid_count + 1;

      if v_existing_id is not null then
        if p_dry_run then
          v_would_skip_duplicate_count := v_would_skip_duplicate_count + 1;
        else
          v_skipped_duplicate_count := v_skipped_duplicate_count + 1;
        end if;

        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'fragrance_id', v_fragrance_id,
          'status', 'skipped_duplicate',
          'existing_id', v_existing_id,
          'evidence_hash', v_evidence_hash
        ));
      elsif p_dry_run then
        if v_existing_active_id is not null then
          v_would_supersede_count := v_would_supersede_count + 1;
        end if;

        v_would_insert_count := v_would_insert_count + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'fragrance_id', v_fragrance_id,
          'status', case when v_existing_active_id is not null then 'would_supersede_and_insert' else 'would_insert' end,
          'supersedes_intelligence_id', v_existing_active_id,
          'source_url_normalized', v_source_url_normalized,
          'payload_hash', v_payload_hash,
          'evidence_hash', v_evidence_hash
        ));
      else
        if v_existing_active_id is not null then
          update public.fragrance_provider_intelligence_registry_v1
          set
            evidence_status = 'superseded',
            review_status = 'superseded',
            superseded_at = now(),
            updated_at = now()
          where id = v_existing_active_id;

          v_superseded_count := v_superseded_count + 1;
        end if;

        insert into public.fragrance_provider_intelligence_registry_v1 (
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
          extraction_method,
          extraction_confidence,
          extraction_warnings,
          normalized_notes,
          normalized_pyramid,
          normalized_accords,
          raw_evidence,
          provider_payload,
          reason,
          official_registry_eligible,
          patch_safe_now,
          actor_label,
          batch_label,
          supersedes_intelligence_id,
          evidence_hash,
          payload_hash
        )
        values (
          v_fragrance_id,
          v_fragrance_name_snapshot,
          v_brand_snapshot,
          v_source_type,
          v_source_tier,
          v_source_name,
          v_source_url,
          v_source_url_normalized,
          v_source_domain,
          v_evidence_type,
          'usable_non_official_intelligence',
          v_review_status,
          v_extraction_method,
          v_extraction_confidence,
          v_extraction_warnings,
          v_normalized_notes,
          jsonb_build_object(
            'top', to_jsonb(v_normalized_top_arr),
            'heart', to_jsonb(v_normalized_heart_arr),
            'base', to_jsonb(v_normalized_base_arr)
          ),
          to_jsonb(v_normalized_accords_arr),
          v_raw_evidence,
          v_provider_payload,
          v_reason,
          false,
          false,
          p_actor_label,
          v_batch_label,
          v_existing_active_id,
          v_evidence_hash,
          v_payload_hash
        )
        returning id into v_inserted_id;

        v_inserted_count := v_inserted_count + 1;
        v_inserted_ids := v_inserted_ids || jsonb_build_array(v_inserted_id);
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'fragrance_id', v_fragrance_id,
          'status', case when v_existing_active_id is not null then 'superseded_and_inserted' else 'inserted' end,
          'inserted_id', v_inserted_id,
          'supersedes_intelligence_id', v_existing_active_id,
          'source_url_normalized', v_source_url_normalized,
          'payload_hash', v_payload_hash,
          'evidence_hash', v_evidence_hash
        ));
      end if;
    end if;
  end loop;

  if p_dry_run then
    return jsonb_build_object(
      'dry_run', true,
      'requested_count', v_requested_count,
      'valid_count', v_valid_count,
      'would_insert_count', v_would_insert_count,
      'would_skip_duplicate_count', v_would_skip_duplicate_count,
      'would_supersede_count', v_would_supersede_count,
      'rejected_count', v_rejected_count,
      'results', v_results
    );
  end if;

  return jsonb_build_object(
    'dry_run', false,
    'requested_count', v_requested_count,
    'inserted_count', v_inserted_count,
    'skipped_duplicate_count', v_skipped_duplicate_count,
    'superseded_count', v_superseded_count,
    'rejected_count', v_rejected_count,
    'inserted_ids', v_inserted_ids,
    'results', v_results
  );
end;
$$;

revoke all on function public.record_fragrance_provider_intelligence_v1(jsonb, text, boolean)
  from public, anon, authenticated;

grant execute on function public.record_fragrance_provider_intelligence_v1(jsonb, text, boolean)
  to service_role;

create or replace view public.fragrance_provider_intelligence_candidate_view_v1
with (security_invoker = true)
as
select
  r.id as registry_id,
  r.fragrance_id,
  r.fragrance_name_snapshot as fragrance_name,
  r.brand_snapshot as brand_name,
  r.source_tier,
  r.evidence_type,
  r.evidence_status,
  r.review_status,
  r.extraction_confidence,
  false as patch_safe_now,
  false as official_registry_eligible,
  (
    r.evidence_status = 'usable_non_official_intelligence'
    and r.review_status = 'approved_for_internal_use'
    and r.official_registry_eligible = false
    and r.patch_safe_now = false
    and r.superseded_at is null
  ) as usable_for_vesper_intelligence,
  case
    when r.evidence_status in ('superseded', 'rejected', 'stale')
      or r.review_status in ('rejected', 'superseded')
      then 'terminal_history'
    when r.review_status = 'proposed'
      then 'proposed_needs_review'
    when r.review_status = 'reviewed'
      then 'reviewed_needs_internal_approval'
    when r.source_tier = 'retailer_pyramid_evidence'
      and r.review_status = 'approved_for_internal_use'
      and r.extraction_confidence >= 0.86
      then 'structured_pyramid_ready_for_internal_use'
    when r.source_tier = 'retailer_structured_notes'
      and r.review_status = 'approved_for_internal_use'
      and r.extraction_confidence >= 0.86
      then 'structured_notes_ready_for_internal_use'
    when r.source_tier = 'professional_provider_pyramid'
      and r.review_status = 'approved_for_internal_use'
      and r.extraction_confidence >= 0.86
      then 'professional_pyramid_ready_for_internal_use'
    when r.source_tier = 'community_provider_consensus'
      and r.review_status = 'approved_for_internal_use'
      then 'community_consensus_ready_for_internal_use'
    else 'manual_review'
  end as next_action_bucket,
  r.actor_label,
  r.batch_label,
  r.created_at,
  r.updated_at
from public.fragrance_provider_intelligence_registry_v1 r;

revoke all on public.fragrance_provider_intelligence_candidate_view_v1
  from public, anon, authenticated;

revoke all on public.fragrance_provider_intelligence_candidate_view_v1
  from service_role;

grant select on public.fragrance_provider_intelligence_candidate_view_v1
  to service_role;

comment on table public.fragrance_provider_intelligence_registry_v1
  is 'Review-only memory for non-official fragrance intelligence. This table must not be treated as official truth and does not mutate public.fragrances or the official source registry.';

comment on function public.record_fragrance_provider_intelligence_v1(jsonb, text, boolean)
  is 'Validates and records non-official provider intelligence only. Supports dry-run, duplicate detection, and active-row superseding without mutating public.fragrances or official registry helpers.';

comment on view public.fragrance_provider_intelligence_candidate_view_v1
  is 'Service-role-only review view over non-official provider intelligence. It exposes usable_for_vesper_intelligence and next_action_bucket without exposing raw provider payloads to clients.';

commit;
