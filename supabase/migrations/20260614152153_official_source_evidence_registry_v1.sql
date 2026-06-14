begin;

create table public.fragrance_official_source_evidence_registry_v1 (
  id uuid primary key default gen_random_uuid(),
  fragrance_id uuid not null references public.fragrances(id),
  name_snapshot text not null,
  brand_snapshot text not null,

  source_type text not null,
  source_url text not null,
  source_url_normalized text not null,
  source_domain text not null,
  source_confidence numeric not null,
  source_retrieved_at timestamptz not null default now(),
  source_evidence_type text not null,

  official_notes text[] not null default '{}',
  official_top_notes text[] not null default '{}',
  official_heart_notes text[] not null default '{}',
  official_base_notes text[] not null default '{}',
  evidence_payload jsonb not null default '{}',
  extraction_method text not null,
  source_verification_summary text not null,

  current_notes_snapshot text[] not null default '{}',
  current_top_notes_snapshot text[] not null default '{}',
  current_heart_notes_snapshot text[] not null default '{}',
  current_base_notes_snapshot text[] not null default '{}',
  current_source_url_snapshot text,
  current_source_confidence_snapshot text,

  normalized_official_notes text[] not null default '{}',
  normalized_current_notes text[] not null default '{}',
  comparison_status text not null,
  identity_match_status text not null,
  duplicate_risk text not null,
  concentration_ambiguity text not null,

  recommended_lane text not null,
  recommended_helper text,
  recommended_action text not null,
  reason text not null,

  evidence_status text not null default 'active',
  review_status text not null default 'proposed',
  supersedes_evidence_id uuid references public.fragrance_official_source_evidence_registry_v1(id),
  related_patch_audit_id uuid references public.fragrance_completed_source_patch_audit_v1(id),
  related_notes_only_audit_id uuid references public.fragrance_completed_notes_only_patch_audit_v1(id),
  actor_label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  evidence_hash text not null,
  payload_hash text not null,

  constraint fragrance_official_source_evidence_registry_v1_source_type_check
    check (source_type = 'official_brand'),
  constraint fragrance_official_source_evidence_registry_v1_source_confidence_check
    check (source_confidence >= 0 and source_confidence <= 1),
  constraint fragrance_official_source_evidence_registry_v1_source_url_check
    check (length(btrim(source_url)) > 0),
  constraint fragrance_official_source_evidence_registry_v1_source_url_normalized_check
    check (length(btrim(source_url_normalized)) > 0),
  constraint fragrance_official_source_evidence_registry_v1_source_domain_check
    check (length(btrim(source_domain)) > 0),
  constraint fragrance_official_source_evidence_registry_v1_source_evidence_type_check
    check (source_evidence_type in (
      'official_pyramid',
      'official_notes_only',
      'official_key_notes',
      'official_prose_only',
      'ambiguous',
      'identity_mismatch',
      'duplicate_or_flanker_risk'
    )),
  constraint fragrance_official_source_evidence_registry_v1_comparison_status_check
    check (comparison_status in (
      'exact_match',
      'official_subset_of_current',
      'current_subset_of_official',
      'overlaps_but_not_subset',
      'mismatch',
      'current_empty',
      'current_weak',
      'not_comparable',
      'not_checked'
    )),
  constraint fragrance_official_source_evidence_registry_v1_recommended_lane_check
    check (recommended_lane in (
      'completed_official_pyramid_patch',
      'completed_official_notes_exact_lineage',
      'completed_official_notes_audit_only',
      'pre_complete_official_pyramid_backfill',
      'pre_complete_official_notes_backfill',
      'performance_follow_through',
      'duplicate_collision_review',
      'weak_source_manual_review',
      'skip_no_action'
    )),
  constraint fragrance_official_source_evidence_registry_v1_recommended_action_check
    check (recommended_action in (
      'ready_for_dry_run',
      'audit_only',
      'already_patched',
      'already_audit_recorded',
      'skip_weaker_existing',
      'skip_prose_only',
      'skip_ambiguous',
      'skip_identity_risk',
      'needs_human_review'
    )),
  constraint fragrance_official_source_evidence_registry_v1_review_status_check
    check (review_status in (
      'proposed',
      'reviewed',
      'approved_for_dry_run',
      'dry_run_passed',
      'patched',
      'audit_recorded',
      'rejected',
      'superseded'
    )),
  constraint fragrance_official_source_evidence_registry_v1_evidence_status_check
    check (evidence_status in ('active', 'superseded', 'rejected', 'stale')),
  constraint fragrance_official_source_evidence_registry_v1_identity_match_status_check
    check (identity_match_status in (
      'exact',
      'brand_only_match',
      'name_only_match',
      'concentration_ambiguous',
      'flanker_risk',
      'mismatch',
      'not_checked'
    )),
  constraint fragrance_official_source_evidence_registry_v1_duplicate_risk_check
    check (duplicate_risk in (
      'none',
      'possible_duplicate',
      'possible_flanker',
      'known_collision',
      'not_checked'
    )),
  constraint fragrance_official_source_evidence_registry_v1_concentration_ambiguity_check
    check (concentration_ambiguity in (
      'none',
      'concentration_missing',
      'concentration_differs',
      'size_or_format_only',
      'not_checked'
    ))
);

create unique index fragrance_official_source_evidence_registry_v1_evidence_hash_uidx
  on public.fragrance_official_source_evidence_registry_v1 (evidence_hash);

create unique index fragrance_official_source_evidence_registry_v1_fragrance_source_payload_uidx
  on public.fragrance_official_source_evidence_registry_v1 (
    fragrance_id,
    source_url_normalized,
    payload_hash
  );

create unique index fragrance_official_source_evidence_registry_v1_active_source_uidx
  on public.fragrance_official_source_evidence_registry_v1 (
    fragrance_id,
    source_url_normalized
  )
  where evidence_status = 'active'
    and review_status not in ('rejected', 'superseded');

create index fragrance_official_source_evidence_registry_v1_fragrance_idx
  on public.fragrance_official_source_evidence_registry_v1 (fragrance_id);

create index fragrance_official_source_evidence_registry_v1_source_evidence_type_idx
  on public.fragrance_official_source_evidence_registry_v1 (source_evidence_type);

create index fragrance_official_source_evidence_registry_v1_lane_action_idx
  on public.fragrance_official_source_evidence_registry_v1 (recommended_lane, recommended_action);

create index fragrance_official_source_evidence_registry_v1_review_evidence_idx
  on public.fragrance_official_source_evidence_registry_v1 (review_status, evidence_status);

create index fragrance_official_source_evidence_registry_v1_created_at_idx
  on public.fragrance_official_source_evidence_registry_v1 (created_at desc);

create index fragrance_official_source_evidence_registry_v1_evidence_hash_idx
  on public.fragrance_official_source_evidence_registry_v1 (evidence_hash);

create index fragrance_official_source_evidence_registry_v1_source_url_normalized_idx
  on public.fragrance_official_source_evidence_registry_v1 (source_url_normalized);

create index fragrance_official_source_evidence_registry_v1_source_domain_idx
  on public.fragrance_official_source_evidence_registry_v1 (source_domain);

alter table public.fragrance_official_source_evidence_registry_v1 enable row level security;

revoke all on table public.fragrance_official_source_evidence_registry_v1
  from public, anon, authenticated;

revoke all on table public.fragrance_official_source_evidence_registry_v1
  from service_role;

grant select, insert, update on table public.fragrance_official_source_evidence_registry_v1
  to service_role;

create function public.record_fragrance_official_source_evidence_v1(
  p_evidence_payloads jsonb,
  p_actor_label text default 'codex_official_source_evidence_registry_v1',
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
  v_expected_name text;
  v_expected_brand text;
  v_source_type text;
  v_source_url text;
  v_source_url_normalized text;
  v_source_domain text;
  v_source_confidence numeric;
  v_source_evidence_type text;
  v_official_notes text[];
  v_official_top_notes text[];
  v_official_heart_notes text[];
  v_official_base_notes text[];
  v_evidence_payload jsonb;
  v_extraction_method text;
  v_source_verification_summary text;
  v_comparison_status text;
  v_identity_match_status text;
  v_duplicate_risk text;
  v_concentration_ambiguity text;
  v_recommended_lane text;
  v_recommended_helper text;
  v_recommended_action text;
  v_reason text;

  v_name_snapshot text;
  v_brand_snapshot text;
  v_current_notes text[];
  v_current_top_notes text[];
  v_current_heart_notes text[];
  v_current_base_notes text[];
  v_current_source_url text;
  v_current_source_confidence text;
  v_normalized_official_notes text[];
  v_normalized_current_notes text[];
  v_normalized_official_top_notes text[];
  v_normalized_official_heart_notes text[];
  v_normalized_official_base_notes text[];
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
  if p_evidence_payloads is null or jsonb_typeof(p_evidence_payloads) <> 'array' then
    raise exception 'p_evidence_payloads must be a JSON array';
  end if;

  v_requested_count := jsonb_array_length(p_evidence_payloads);

  if v_requested_count = 0 then
    raise exception 'p_evidence_payloads must not be empty';
  end if;

  if v_requested_count > 50 then
    raise exception 'p_evidence_payloads batch size % exceeds max 50', v_requested_count;
  end if;

  if p_actor_label is null or length(btrim(p_actor_label)) = 0 then
    raise exception 'p_actor_label must not be empty';
  end if;

  for v_payload in
    select value
    from jsonb_array_elements(p_evidence_payloads)
  loop
    v_errors := array[]::text[];
    v_existing_id := null;
    v_existing_active_id := null;
    v_inserted_id := null;

    if jsonb_typeof(v_payload) <> 'object' then
      v_errors := v_errors || 'payload must be an object';
    end if;

    if v_payload ? 'review_status' or v_payload ? 'evidence_status' then
      v_errors := v_errors || 'payload-supplied review_status/evidence_status are forbidden in V1';
    end if;

    if not (
      v_payload ? 'fragrance_id'
      and v_payload ? 'expected_name'
      and v_payload ? 'expected_brand'
      and v_payload ? 'source_type'
      and v_payload ? 'source_url'
      and v_payload ? 'source_confidence'
      and v_payload ? 'source_evidence_type'
      and v_payload ? 'official_notes'
      and v_payload ? 'official_top_notes'
      and v_payload ? 'official_heart_notes'
      and v_payload ? 'official_base_notes'
      and v_payload ? 'evidence_payload'
      and v_payload ? 'extraction_method'
      and v_payload ? 'source_verification_summary'
      and v_payload ? 'comparison_status'
      and v_payload ? 'identity_match_status'
      and v_payload ? 'duplicate_risk'
      and v_payload ? 'concentration_ambiguity'
      and v_payload ? 'recommended_lane'
      and v_payload ? 'recommended_helper'
      and v_payload ? 'recommended_action'
      and v_payload ? 'reason'
    ) then
      v_errors := v_errors || 'payload missing one or more required fields';
    end if;

    if not (v_payload ? 'official_notes') or jsonb_typeof(v_payload->'official_notes') <> 'array' then
      v_errors := v_errors || 'official_notes must be an array';
    end if;

    if not (v_payload ? 'official_top_notes') or jsonb_typeof(v_payload->'official_top_notes') <> 'array' then
      v_errors := v_errors || 'official_top_notes must be an array';
    end if;

    if not (v_payload ? 'official_heart_notes') or jsonb_typeof(v_payload->'official_heart_notes') <> 'array' then
      v_errors := v_errors || 'official_heart_notes must be an array';
    end if;

    if not (v_payload ? 'official_base_notes') or jsonb_typeof(v_payload->'official_base_notes') <> 'array' then
      v_errors := v_errors || 'official_base_notes must be an array';
    end if;

    if v_errors = array[]::text[] then
      begin
        v_fragrance_id := (v_payload->>'fragrance_id')::uuid;
      exception when others then
        v_fragrance_id := null;
        v_errors := v_errors || 'fragrance_id must be a UUID';
      end;

      begin
        v_source_confidence := (v_payload->>'source_confidence')::numeric;
      exception when others then
        v_source_confidence := null;
        v_errors := v_errors || 'source_confidence must be numeric';
      end;

      v_expected_name := nullif(btrim(coalesce(v_payload->>'expected_name', '')), '');
      v_expected_brand := nullif(btrim(coalesce(v_payload->>'expected_brand', '')), '');
      v_source_type := nullif(btrim(coalesce(v_payload->>'source_type', '')), '');
      v_source_url := nullif(btrim(coalesce(v_payload->>'source_url', '')), '');
      v_source_evidence_type := nullif(btrim(coalesce(v_payload->>'source_evidence_type', '')), '');
      v_evidence_payload := coalesce(v_payload->'evidence_payload', '{}'::jsonb);
      v_extraction_method := nullif(btrim(coalesce(v_payload->>'extraction_method', '')), '');
      v_source_verification_summary := nullif(btrim(coalesce(v_payload->>'source_verification_summary', '')), '');
      v_comparison_status := nullif(btrim(coalesce(v_payload->>'comparison_status', '')), '');
      v_identity_match_status := nullif(btrim(coalesce(v_payload->>'identity_match_status', '')), '');
      v_duplicate_risk := nullif(btrim(coalesce(v_payload->>'duplicate_risk', '')), '');
      v_concentration_ambiguity := nullif(btrim(coalesce(v_payload->>'concentration_ambiguity', '')), '');
      v_recommended_lane := nullif(btrim(coalesce(v_payload->>'recommended_lane', '')), '');
      v_recommended_helper := nullif(btrim(coalesce(v_payload->>'recommended_helper', '')), '');
      v_recommended_action := nullif(btrim(coalesce(v_payload->>'recommended_action', '')), '');
      v_reason := nullif(btrim(coalesce(v_payload->>'reason', '')), '');

      select coalesce(array_agg(value), '{}'::text[])
      into v_official_notes
      from jsonb_array_elements_text(v_payload->'official_notes') as value
      where length(btrim(value)) > 0;

      select coalesce(array_agg(value), '{}'::text[])
      into v_official_top_notes
      from jsonb_array_elements_text(v_payload->'official_top_notes') as value
      where length(btrim(value)) > 0;

      select coalesce(array_agg(value), '{}'::text[])
      into v_official_heart_notes
      from jsonb_array_elements_text(v_payload->'official_heart_notes') as value
      where length(btrim(value)) > 0;

      select coalesce(array_agg(value), '{}'::text[])
      into v_official_base_notes
      from jsonb_array_elements_text(v_payload->'official_base_notes') as value
      where length(btrim(value)) > 0;

      if v_source_type is distinct from 'official_brand' then
        v_errors := v_errors || 'source_type must be official_brand';
      end if;

      if v_source_evidence_type is null or v_source_evidence_type not in (
        'official_pyramid',
        'official_notes_only',
        'official_key_notes',
        'official_prose_only',
        'ambiguous',
        'identity_mismatch',
        'duplicate_or_flanker_risk'
      ) then
        v_errors := v_errors || 'source_evidence_type is not allowed in V1';
      end if;

      if v_source_evidence_type = 'unavailable' then
        v_errors := v_errors || 'unavailable evidence is not stored in V1';
      end if;

      if v_comparison_status is null or v_comparison_status not in (
        'exact_match',
        'official_subset_of_current',
        'current_subset_of_official',
        'overlaps_but_not_subset',
        'mismatch',
        'current_empty',
        'current_weak',
        'not_comparable',
        'not_checked'
      ) then
        v_errors := v_errors || 'comparison_status is not allowed';
      end if;

      if v_identity_match_status is null or v_identity_match_status not in (
        'exact',
        'brand_only_match',
        'name_only_match',
        'concentration_ambiguous',
        'flanker_risk',
        'mismatch',
        'not_checked'
      ) then
        v_errors := v_errors || 'identity_match_status is not allowed';
      end if;

      if v_duplicate_risk is null or v_duplicate_risk not in (
        'none',
        'possible_duplicate',
        'possible_flanker',
        'known_collision',
        'not_checked'
      ) then
        v_errors := v_errors || 'duplicate_risk is not allowed';
      end if;

      if v_concentration_ambiguity is null or v_concentration_ambiguity not in (
        'none',
        'concentration_missing',
        'concentration_differs',
        'size_or_format_only',
        'not_checked'
      ) then
        v_errors := v_errors || 'concentration_ambiguity is not allowed';
      end if;

      if v_recommended_lane is null or v_recommended_lane not in (
        'completed_official_pyramid_patch',
        'completed_official_notes_exact_lineage',
        'completed_official_notes_audit_only',
        'pre_complete_official_pyramid_backfill',
        'pre_complete_official_notes_backfill',
        'performance_follow_through',
        'duplicate_collision_review',
        'weak_source_manual_review',
        'skip_no_action'
      ) then
        v_errors := v_errors || 'recommended_lane is not allowed';
      end if;

      if v_recommended_action is null or v_recommended_action not in (
        'ready_for_dry_run',
        'audit_only',
        'already_patched',
        'already_audit_recorded',
        'skip_weaker_existing',
        'skip_prose_only',
        'skip_ambiguous',
        'skip_identity_risk',
        'needs_human_review'
      ) then
        v_errors := v_errors || 'recommended_action is not allowed';
      end if;

      if v_source_confidence is null or v_source_confidence < 0 or v_source_confidence > 1 then
        v_errors := v_errors || 'source_confidence must be between 0 and 1';
      end if;

      if v_expected_name is null then
        v_errors := v_errors || 'expected_name must not be empty';
      end if;

      if v_expected_brand is null then
        v_errors := v_errors || 'expected_brand must not be empty';
      end if;

      if v_source_url is null or v_source_url !~* '^https?://' then
        v_errors := v_errors || 'source_url must be a non-empty http(s) URL';
      end if;

      if v_extraction_method is null then
        v_errors := v_errors || 'extraction_method must not be empty';
      end if;

      if v_source_verification_summary is null then
        v_errors := v_errors || 'source_verification_summary must not be empty';
      end if;

      if v_reason is null then
        v_errors := v_errors || 'reason must not be empty';
      end if;

      if v_source_evidence_type = 'official_pyramid'
        and coalesce(cardinality(v_official_top_notes), 0)
          + coalesce(cardinality(v_official_heart_notes), 0)
          + coalesce(cardinality(v_official_base_notes), 0) = 0
      then
        v_errors := v_errors || 'official_pyramid requires at least one positional notes array';
      end if;

      if v_source_evidence_type in ('official_notes_only', 'official_key_notes')
        and coalesce(cardinality(v_official_notes), 0) = 0
      then
        v_errors := v_errors || 'official_notes_only/official_key_notes require official_notes';
      end if;

      if v_source_evidence_type in ('official_prose_only', 'ambiguous')
        and v_source_verification_summary is null
      then
        v_errors := v_errors || 'official_prose_only/ambiguous require source_verification_summary';
      end if;

      if v_source_evidence_type = 'identity_mismatch'
        and (v_reason is null or length(v_reason) < 20)
      then
        v_errors := v_errors || 'identity_mismatch requires a clear reason';
      end if;

      if v_source_evidence_type = 'duplicate_or_flanker_risk'
        and (v_reason is null or length(v_reason) < 20)
      then
        v_errors := v_errors || 'duplicate_or_flanker_risk requires a clear reason';
      end if;

      if v_errors = array[]::text[] then
        select
          f.name,
          f.brand,
          coalesce(f.notes, '{}'::text[]),
          coalesce(f.top_notes, '{}'::text[]),
          coalesce(f.heart_notes, '{}'::text[]),
          coalesce(f.base_notes, '{}'::text[]),
          f.source_url,
          f.source_confidence
        into
          v_name_snapshot,
          v_brand_snapshot,
          v_current_notes,
          v_current_top_notes,
          v_current_heart_notes,
          v_current_base_notes,
          v_current_source_url,
          v_current_source_confidence
        from public.fragrances f
        where f.id = v_fragrance_id;

        if not found then
          v_errors := v_errors || 'fragrance_id does not exist';
        elsif v_name_snapshot <> v_expected_name or v_brand_snapshot <> v_expected_brand then
          v_errors := v_errors || 'expected_name/expected_brand do not match fragrance_id exactly';
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
            and split_part(lower(param), '=', 1) not in ('fbclid', 'gclid');

          v_source_url_normalized := v_scheme || v_host || v_path
            || case when v_clean_query <> '' then '?' || v_clean_query else '' end;
          v_source_domain := split_part(v_host, ':', 1);
        end if;
      end if;

      if v_errors = array[]::text[] then
        select coalesce(array_agg(distinct normalized_note order by normalized_note), '{}'::text[])
        into v_normalized_official_notes
        from (
          select lower(regexp_replace(btrim(note), '\s+', ' ', 'g')) as normalized_note
          from unnest(
            v_official_notes
              || v_official_top_notes
              || v_official_heart_notes
              || v_official_base_notes
          ) as note
          where length(btrim(note)) > 0
        ) normalized;

        select coalesce(array_agg(distinct normalized_note order by normalized_note), '{}'::text[])
        into v_normalized_current_notes
        from (
          select lower(regexp_replace(btrim(note), '\s+', ' ', 'g')) as normalized_note
          from unnest(
            v_current_notes
              || v_current_top_notes
              || v_current_heart_notes
              || v_current_base_notes
          ) as note
          where length(btrim(note)) > 0
        ) normalized;

        select coalesce(array_agg(distinct normalized_note order by normalized_note), '{}'::text[])
        into v_normalized_official_top_notes
        from (
          select lower(regexp_replace(btrim(note), '\s+', ' ', 'g')) as normalized_note
          from unnest(v_official_top_notes) as note
          where length(btrim(note)) > 0
        ) normalized;

        select coalesce(array_agg(distinct normalized_note order by normalized_note), '{}'::text[])
        into v_normalized_official_heart_notes
        from (
          select lower(regexp_replace(btrim(note), '\s+', ' ', 'g')) as normalized_note
          from unnest(v_official_heart_notes) as note
          where length(btrim(note)) > 0
        ) normalized;

        select coalesce(array_agg(distinct normalized_note order by normalized_note), '{}'::text[])
        into v_normalized_official_base_notes
        from (
          select lower(regexp_replace(btrim(note), '\s+', ' ', 'g')) as normalized_note
          from unnest(v_official_base_notes) as note
          where length(btrim(note)) > 0
        ) normalized;

        v_payload_hash := md5(jsonb_build_object(
          'source_evidence_type', v_source_evidence_type,
          'official_notes', v_normalized_official_notes,
          'official_top_notes', v_normalized_official_top_notes,
          'official_heart_notes', v_normalized_official_heart_notes,
          'official_base_notes', v_normalized_official_base_notes,
          'comparison_status', v_comparison_status,
          'recommended_lane', v_recommended_lane,
          'recommended_action', v_recommended_action
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
        from public.fragrance_official_source_evidence_registry_v1 r
        where r.evidence_hash = v_evidence_hash
        limit 1;

        if p_dry_run then
          select r.id
          into v_existing_active_id
          from public.fragrance_official_source_evidence_registry_v1 r
          where r.fragrance_id = v_fragrance_id
            and r.source_url_normalized = v_source_url_normalized
            and r.evidence_status = 'active'
            and r.review_status not in ('rejected', 'superseded')
          limit 1;
        else
          select r.id
          into v_existing_active_id
          from public.fragrance_official_source_evidence_registry_v1 r
          where r.fragrance_id = v_fragrance_id
            and r.source_url_normalized = v_source_url_normalized
            and r.evidence_status = 'active'
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
          'supersedes_evidence_id', v_existing_active_id,
          'source_url_normalized', v_source_url_normalized,
          'payload_hash', v_payload_hash,
          'evidence_hash', v_evidence_hash
        ));
      else
        if v_existing_active_id is not null then
          update public.fragrance_official_source_evidence_registry_v1
          set
            evidence_status = 'superseded',
            review_status = 'superseded',
            updated_at = now()
          where id = v_existing_active_id;

          v_superseded_count := v_superseded_count + 1;
        end if;

        insert into public.fragrance_official_source_evidence_registry_v1 (
          fragrance_id,
          name_snapshot,
          brand_snapshot,
          source_type,
          source_url,
          source_url_normalized,
          source_domain,
          source_confidence,
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
          actor_label,
          evidence_hash,
          payload_hash
        )
        values (
          v_fragrance_id,
          v_name_snapshot,
          v_brand_snapshot,
          v_source_type,
          v_source_url,
          v_source_url_normalized,
          v_source_domain,
          v_source_confidence,
          v_source_evidence_type,
          v_official_notes,
          v_official_top_notes,
          v_official_heart_notes,
          v_official_base_notes,
          v_evidence_payload,
          v_extraction_method,
          v_source_verification_summary,
          v_current_notes,
          v_current_top_notes,
          v_current_heart_notes,
          v_current_base_notes,
          v_current_source_url,
          v_current_source_confidence,
          v_normalized_official_notes,
          v_normalized_current_notes,
          v_comparison_status,
          v_identity_match_status,
          v_duplicate_risk,
          v_concentration_ambiguity,
          v_recommended_lane,
          v_recommended_helper,
          v_recommended_action,
          v_reason,
          'active',
          'proposed',
          v_existing_active_id,
          p_actor_label,
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
          'supersedes_evidence_id', v_existing_active_id,
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

revoke all on function public.record_fragrance_official_source_evidence_v1(jsonb, text, boolean)
  from public, anon, authenticated;

grant execute on function public.record_fragrance_official_source_evidence_v1(jsonb, text, boolean)
  to service_role;

comment on table public.fragrance_official_source_evidence_registry_v1
  is 'Evidence memory for official source findings. This table does not mutate fragrance facts, taxonomy, performance, proposals, or queues.';

comment on function public.record_fragrance_official_source_evidence_v1(jsonb, text, boolean)
  is 'Validates and records official source evidence into the registry only. Supports dry-run, duplicate detection, and active evidence superseding.';

commit;
