begin;

create table if not exists public.fragrance_completed_source_patch_audit_v1 (
  id uuid primary key default gen_random_uuid(),
  fragrance_id uuid not null,
  patch_status text not null,
  actor_label text not null,
  source_type text not null,
  source_evidence_type text not null,
  source_url text,
  source_confidence numeric,
  changed_fields text[] not null default '{}'::text[],
  blocked_fields text[] not null default '{}'::text[],
  before_snapshot jsonb not null default '{}'::jsonb,
  proposed_snapshot jsonb not null default '{}'::jsonb,
  applied_snapshot jsonb not null default '{}'::jsonb,
  source_payload jsonb not null default '{}'::jsonb,
  source_verification_summary text,
  reason text,
  created_at timestamptz not null default now(),
  constraint fragrance_completed_source_patch_audit_v1_source_type_check
    check (source_type = 'official_brand'),
  constraint fragrance_completed_source_patch_audit_v1_source_evidence_type_check
    check (source_evidence_type in ('official_pyramid', 'official_notes_only')),
  constraint fragrance_completed_source_patch_audit_v1_patch_status_check
    check (
      patch_status in (
        'accepted_patch',
        'skipped_no_change',
        'skipped_weaker_existing',
        'skipped_ambiguous_source',
        'rejected_missing_fragrance_row',
        'rejected_not_exact_scope',
        'rejected_provider_source',
        'rejected_would_mutate_disallowed_field',
        'rejected_not_completed_row',
        'rejected_duplicate_payload'
      )
    )
);

create index if not exists fragrance_completed_source_patch_audit_v1_fragrance_idx
  on public.fragrance_completed_source_patch_audit_v1 (fragrance_id, created_at desc);

create index if not exists fragrance_completed_source_patch_audit_v1_status_idx
  on public.fragrance_completed_source_patch_audit_v1 (patch_status, created_at desc);

alter table public.fragrance_completed_source_patch_audit_v1 enable row level security;

revoke all on public.fragrance_completed_source_patch_audit_v1 from public;
revoke all on public.fragrance_completed_source_patch_audit_v1 from anon;
revoke all on public.fragrance_completed_source_patch_audit_v1 from authenticated;
grant select, insert on public.fragrance_completed_source_patch_audit_v1 to service_role;

comment on table public.fragrance_completed_source_patch_audit_v1 is
  'Audit log for explicit official-source patches applied to already taxonomy-complete fragrance rows. It preserves taxonomy, performance, accords, provider evidence, and queue state while recording exact completed-row source/note patch attempts.';

comment on column public.fragrance_completed_source_patch_audit_v1.proposed_snapshot is
  'Dry-run or pre-write view of the allowed-field patch proposal for a completed fragrance row.';

comment on column public.fragrance_completed_source_patch_audit_v1.applied_snapshot is
  'Post-write snapshot for accepted patches. Rejected or skipped attempts may leave this empty.';

create or replace function public.apply_completed_fragrance_official_source_patch_v1(
  p_fragrance_ids uuid[],
  p_patch_payloads jsonb,
  p_actor_label text default 'codex_completed_official_source_patch_v1',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_actor_label text := coalesce(nullif(btrim(p_actor_label), ''), 'codex_completed_official_source_patch_v1');
  v_scope_ids uuid[];
  v_requested_count integer := 0;
  v_payload_count integer := 0;
  v_picked_count integer := 0;
  v_would_update_count integer := 0;
  v_updated_count integer := 0;
  v_audit_written_count integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_processed_ids uuid[] := array[]::uuid[];
  v_scope_id uuid;
  v_entry record;
  v_row record;
  v_result_status text;
  v_reason text;
  v_source_type text;
  v_source_evidence_type text;
  v_source_url text;
  v_source_confidence numeric;
  v_source_confidence_text text;
  v_notes text[];
  v_top_notes text[];
  v_heart_notes text[];
  v_base_notes text[];
  v_allowed_keys constant text[] := array[
    'fragrance_id',
    'source_type',
    'source_evidence_type',
    'source_url',
    'source_confidence',
    'notes',
    'top_notes',
    'heart_notes',
    'base_notes',
    'source_verification_summary',
    'reason'
  ];
  v_changed_fields text[] := '{}'::text[];
  v_blocked_fields text[] := '{}'::text[];
  v_before_snapshot jsonb := '{}'::jsonb;
  v_proposed_snapshot jsonb := '{}'::jsonb;
  v_applied_snapshot jsonb := '{}'::jsonb;
  v_source_payload jsonb := '{}'::jsonb;
  v_source_verification_summary text;
  v_completed_row boolean := false;
  v_notes_current text[];
  v_top_current text[];
  v_heart_current text[];
  v_base_current text[];
  v_target_notes text[];
  v_target_top text[];
  v_target_heart text[];
  v_target_base text[];
  v_target_source_url text;
  v_target_source_confidence text;
begin
  select array_agg(distinct fragrance_id order by fragrance_id)
  into v_scope_ids
  from unnest(coalesce(p_fragrance_ids, array[]::uuid[])) as fragrance_id
  where fragrance_id is not null;

  v_requested_count := coalesce(cardinality(v_scope_ids), 0);

  if v_requested_count = 0 then
    raise exception 'apply_completed_fragrance_official_source_patch_v1 requires explicit non-empty fragrance ids';
  end if;

  if v_requested_count > 25 then
    raise exception 'apply_completed_fragrance_official_source_patch_v1 accepts at most 25 fragrance ids per call';
  end if;

  if p_patch_payloads is null or jsonb_typeof(p_patch_payloads) <> 'array' then
    raise exception 'apply_completed_fragrance_official_source_patch_v1 requires a jsonb array payload';
  end if;

  v_payload_count := jsonb_array_length(p_patch_payloads);

  if v_payload_count = 0 then
    raise exception 'apply_completed_fragrance_official_source_patch_v1 requires a non-empty payload array';
  end if;

  if v_payload_count > 25 then
    raise exception 'apply_completed_fragrance_official_source_patch_v1 accepts at most 25 payload rows per call';
  end if;

  for v_entry in
    with raw_payloads as (
      select
        ordinality as payload_ordinal,
        value as payload
      from jsonb_array_elements(p_patch_payloads) with ordinality
    ),
    parsed_payloads as (
      select
        r.payload_ordinal,
        r.payload,
        nullif(btrim(r.payload ->> 'fragrance_id'), '') as fragrance_id_text,
        case
          when nullif(btrim(r.payload ->> 'fragrance_id'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (r.payload ->> 'fragrance_id')::uuid
          else null
        end as fragrance_id,
        coalesce((
          select array_agg(key order by key)
          from jsonb_object_keys(r.payload) as key
          where not (key = any(v_allowed_keys))
        ), '{}'::text[]) as unexpected_keys
      from raw_payloads r
    ),
    duplicate_payloads as (
      select
        fragrance_id_text,
        count(*)::int as duplicate_count
      from parsed_payloads
      where fragrance_id_text is not null
      group by fragrance_id_text
    )
    select
      p.payload_ordinal,
      p.payload,
      p.fragrance_id_text,
      p.fragrance_id,
      p.unexpected_keys,
      coalesce(d.duplicate_count, 0) as duplicate_count,
      case
        when p.fragrance_id is null then false
        else not (p.fragrance_id = any(v_scope_ids))
      end as out_of_scope
    from parsed_payloads p
    left join duplicate_payloads d
      on d.fragrance_id_text = p.fragrance_id_text
    order by p.payload_ordinal
  loop
    v_picked_count := v_picked_count + 1;
    v_result_status := null;
    v_reason := null;
    v_source_type := coalesce(nullif(btrim(v_entry.payload ->> 'source_type'), ''), 'official_brand');
    v_source_evidence_type := coalesce(nullif(btrim(v_entry.payload ->> 'source_evidence_type'), ''), 'official_notes_only');
    v_source_url := nullif(btrim(v_entry.payload ->> 'source_url'), '');
    v_source_confidence := null;
    v_source_confidence_text := null;
    v_notes := '{}'::text[];
    v_top_notes := '{}'::text[];
    v_heart_notes := '{}'::text[];
    v_base_notes := '{}'::text[];
    v_changed_fields := '{}'::text[];
    v_blocked_fields := coalesce(v_entry.unexpected_keys, '{}'::text[]);
    v_before_snapshot := '{}'::jsonb;
    v_proposed_snapshot := '{}'::jsonb;
    v_applied_snapshot := '{}'::jsonb;
    v_source_payload := coalesce(v_entry.payload, '{}'::jsonb);
    v_source_verification_summary := nullif(btrim(v_entry.payload ->> 'source_verification_summary'), '');
    v_completed_row := false;
    v_notes_current := '{}'::text[];
    v_top_current := '{}'::text[];
    v_heart_current := '{}'::text[];
    v_base_current := '{}'::text[];
    v_target_notes := '{}'::text[];
    v_target_top := '{}'::text[];
    v_target_heart := '{}'::text[];
    v_target_base := '{}'::text[];
    v_target_source_url := null;
    v_target_source_confidence := null;

    begin
      if nullif(btrim(v_entry.payload ->> 'source_confidence'), '') is not null then
        v_source_confidence := (v_entry.payload ->> 'source_confidence')::numeric;
        v_source_confidence_text := v_source_confidence::text;
      end if;
    exception
      when others then
        v_blocked_fields := array_append(v_blocked_fields, 'source_confidence');
        v_result_status := 'rejected_would_mutate_disallowed_field';
        v_reason := 'Invalid numeric source_confidence.';
    end;

    if coalesce(jsonb_typeof(v_entry.payload -> 'notes'), 'null') not in ('array', 'null') then
      v_blocked_fields := array_append(v_blocked_fields, 'notes');
      v_result_status := coalesce(v_result_status, 'rejected_would_mutate_disallowed_field');
      v_reason := coalesce(v_reason, 'Note payload fields must be arrays or null.');
    else
      select coalesce(array_agg(value order by ordinality), '{}'::text[])
      into v_notes
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(v_entry.payload -> 'notes') = 'array' then v_entry.payload -> 'notes'
          else '[]'::jsonb
        end
      ) with ordinality as t(value, ordinality);
    end if;

    if coalesce(jsonb_typeof(v_entry.payload -> 'top_notes'), 'null') not in ('array', 'null') then
      v_blocked_fields := array_append(v_blocked_fields, 'top_notes');
      v_result_status := coalesce(v_result_status, 'rejected_would_mutate_disallowed_field');
      v_reason := coalesce(v_reason, 'Positional note payload fields must be arrays or null.');
    else
      select coalesce(array_agg(value order by ordinality), '{}'::text[])
      into v_top_notes
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(v_entry.payload -> 'top_notes') = 'array' then v_entry.payload -> 'top_notes'
          else '[]'::jsonb
        end
      ) with ordinality as t(value, ordinality);
    end if;

    if coalesce(jsonb_typeof(v_entry.payload -> 'heart_notes'), 'null') not in ('array', 'null') then
      v_blocked_fields := array_append(v_blocked_fields, 'heart_notes');
      v_result_status := coalesce(v_result_status, 'rejected_would_mutate_disallowed_field');
      v_reason := coalesce(v_reason, 'Positional note payload fields must be arrays or null.');
    else
      select coalesce(array_agg(value order by ordinality), '{}'::text[])
      into v_heart_notes
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(v_entry.payload -> 'heart_notes') = 'array' then v_entry.payload -> 'heart_notes'
          else '[]'::jsonb
        end
      ) with ordinality as t(value, ordinality);
    end if;

    if coalesce(jsonb_typeof(v_entry.payload -> 'base_notes'), 'null') not in ('array', 'null') then
      v_blocked_fields := array_append(v_blocked_fields, 'base_notes');
      v_result_status := coalesce(v_result_status, 'rejected_would_mutate_disallowed_field');
      v_reason := coalesce(v_reason, 'Positional note payload fields must be arrays or null.');
    else
      select coalesce(array_agg(value order by ordinality), '{}'::text[])
      into v_base_notes
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(v_entry.payload -> 'base_notes') = 'array' then v_entry.payload -> 'base_notes'
          else '[]'::jsonb
        end
      ) with ordinality as t(value, ordinality);
    end if;

    if v_result_status is null then
      if v_entry.duplicate_count > 1 then
        v_result_status := 'rejected_duplicate_payload';
        v_reason := 'Duplicate payload rows for the same fragrance_id are not allowed.';
      elsif v_entry.fragrance_id is null then
        v_result_status := 'rejected_missing_fragrance_row';
        v_reason := 'Payload fragrance_id is missing or invalid.';
      elsif v_entry.out_of_scope then
        v_result_status := 'rejected_not_exact_scope';
        v_reason := 'Payload fragrance_id is outside the explicit scope ids.';
      elsif v_source_type is distinct from 'official_brand' then
        v_result_status := 'rejected_provider_source';
        v_reason := 'Only official_brand source patches are allowed in this lane.';
      elsif v_source_evidence_type not in ('official_pyramid', 'official_notes_only') then
        v_result_status := 'rejected_would_mutate_disallowed_field';
        v_blocked_fields := array_append(v_blocked_fields, 'source_evidence_type');
        v_reason := 'source_evidence_type must be official_pyramid or official_notes_only.';
      elsif v_source_url is null or v_source_confidence is null then
        v_result_status := 'skipped_ambiguous_source';
        v_reason := 'Official source URL and source_confidence are required.';
      elsif cardinality(v_blocked_fields) > 0 then
        v_result_status := 'rejected_would_mutate_disallowed_field';
        v_reason := 'Payload includes disallowed or unknown fields.';
      end if;
    end if;

    if v_result_status is null then
      select
        f.id,
        f.name,
        f.brand,
        f.family_key,
        f.notes,
        f.top_notes,
        f.heart_notes,
        f.base_notes,
        f.accords,
        f.longevity_score,
        f.projection_score,
        f.source_url,
        f.source_confidence,
        f.updated_at,
        exists(select 1 from public.fragrance_facets_v1 ff where ff.fragrance_id = f.id) as has_final_facets,
        exists(select 1 from public.fragrance_wardrobe_roles_v1 wr where wr.fragrance_id = f.id) as has_final_roles,
        exists(select 1 from public.fragrance_taxonomy_review_v1 tr where tr.fragrance_id = f.id) as has_taxonomy_review,
        q.queue_state,
        q.queue_lane
      into v_row
      from public.fragrances f
      left join public.taxonomy_operationalization_queue_current_v1 q
        on q.fragrance_id = f.id
      where f.id = v_entry.fragrance_id;

      if v_row.id is null then
        v_result_status := 'rejected_missing_fragrance_row';
        v_reason := 'No public.fragrances row exists for the requested fragrance_id.';
      else
        v_completed_row := coalesce(v_row.has_final_facets, false)
          or coalesce(v_row.has_final_roles, false)
          or coalesce(v_row.has_taxonomy_review, false)
          or v_row.queue_state = 'already_complete'
          or v_row.queue_lane = 'complete_no_action';

        if not v_completed_row then
          v_result_status := 'rejected_not_completed_row';
          v_reason := 'The row is not already taxonomy-complete.';
        end if;
      end if;
    end if;

    if v_result_status is null then
      if v_source_evidence_type = 'official_notes_only'
         and (
           coalesce(array_length(v_top_notes, 1), 0) > 0
           or coalesce(array_length(v_heart_notes, 1), 0) > 0
           or coalesce(array_length(v_base_notes, 1), 0) > 0
         ) then
        v_result_status := 'rejected_would_mutate_disallowed_field';
        v_blocked_fields := v_blocked_fields || array['top_notes', 'heart_notes', 'base_notes']::text[];
        v_reason := 'official_notes_only payloads cannot set positional notes.';
      elsif v_source_evidence_type = 'official_pyramid'
            and coalesce(array_length(v_top_notes, 1), 0) = 0
            and coalesce(array_length(v_heart_notes, 1), 0) = 0
            and coalesce(array_length(v_base_notes, 1), 0) = 0 then
        v_result_status := 'skipped_ambiguous_source';
        v_reason := 'official_pyramid payload must provide at least one positional note array.';
      elsif v_source_evidence_type = 'official_notes_only'
            and coalesce(array_length(v_notes, 1), 0) = 0 then
        v_result_status := 'skipped_ambiguous_source';
        v_reason := 'official_notes_only payload must provide flat notes.';
      end if;
    end if;

    if v_row.id is not null then
      v_notes_current := coalesce(v_row.notes, '{}'::text[]);
      v_top_current := coalesce(v_row.top_notes, '{}'::text[]);
      v_heart_current := coalesce(v_row.heart_notes, '{}'::text[]);
      v_base_current := coalesce(v_row.base_notes, '{}'::text[]);
      v_target_notes := v_notes_current;
      v_target_top := v_top_current;
      v_target_heart := v_heart_current;
      v_target_base := v_base_current;
      v_target_source_url := v_row.source_url;
      v_target_source_confidence := v_row.source_confidence;

      v_before_snapshot := jsonb_build_object(
        'fragrance_id', v_row.id,
        'name', v_row.name,
        'brand', v_row.brand,
        'family_key', v_row.family_key,
        'notes', to_jsonb(v_notes_current),
        'top_notes', to_jsonb(v_top_current),
        'heart_notes', to_jsonb(v_heart_current),
        'base_notes', to_jsonb(v_base_current),
        'accords', to_jsonb(coalesce(v_row.accords, '{}'::text[])),
        'longevity_score', v_row.longevity_score,
        'projection_score', v_row.projection_score,
        'source_url', v_row.source_url,
        'source_confidence', v_row.source_confidence,
        'updated_at', v_row.updated_at,
        'has_final_facets', coalesce(v_row.has_final_facets, false),
        'has_final_roles', coalesce(v_row.has_final_roles, false),
        'has_taxonomy_review', coalesce(v_row.has_taxonomy_review, false),
        'queue_state', v_row.queue_state,
        'queue_lane', v_row.queue_lane
      );
    end if;

    if v_result_status is null then
      if v_source_url is not null and v_row.source_url is distinct from v_source_url then
        v_changed_fields := array_append(v_changed_fields, 'source_url');
        v_target_source_url := v_source_url;
      end if;

      if v_source_confidence_text is not null and v_row.source_confidence is distinct from v_source_confidence_text then
        v_changed_fields := array_append(v_changed_fields, 'source_confidence');
        v_target_source_confidence := v_source_confidence_text;
      end if;

      if coalesce(array_length(v_notes, 1), 0) > 0 then
        if coalesce(array_length(v_notes_current, 1), 0) = 0 then
          v_changed_fields := array_append(v_changed_fields, 'notes');
          v_target_notes := v_notes;
        elsif v_notes_current is distinct from v_notes then
          v_blocked_fields := array_append(v_blocked_fields, 'notes');
        end if;
      end if;

      if coalesce(array_length(v_top_notes, 1), 0) > 0 then
        if coalesce(array_length(v_top_current, 1), 0) = 0 then
          v_changed_fields := array_append(v_changed_fields, 'top_notes');
          v_target_top := v_top_notes;
        elsif v_top_current is distinct from v_top_notes then
          v_blocked_fields := array_append(v_blocked_fields, 'top_notes');
        end if;
      end if;

      if coalesce(array_length(v_heart_notes, 1), 0) > 0 then
        if coalesce(array_length(v_heart_current, 1), 0) = 0 then
          v_changed_fields := array_append(v_changed_fields, 'heart_notes');
          v_target_heart := v_heart_notes;
        elsif v_heart_current is distinct from v_heart_notes then
          v_blocked_fields := array_append(v_blocked_fields, 'heart_notes');
        end if;
      end if;

      if coalesce(array_length(v_base_notes, 1), 0) > 0 then
        if coalesce(array_length(v_base_current, 1), 0) = 0 then
          v_changed_fields := array_append(v_changed_fields, 'base_notes');
          v_target_base := v_base_notes;
        elsif v_base_current is distinct from v_base_notes then
          v_blocked_fields := array_append(v_blocked_fields, 'base_notes');
        end if;
      end if;

      v_proposed_snapshot := jsonb_build_object(
        'fragrance_id', v_row.id,
        'name', v_row.name,
        'brand', v_row.brand,
        'family_key', v_row.family_key,
        'notes', to_jsonb(v_target_notes),
        'top_notes', to_jsonb(v_target_top),
        'heart_notes', to_jsonb(v_target_heart),
        'base_notes', to_jsonb(v_target_base),
        'accords', to_jsonb(coalesce(v_row.accords, '{}'::text[])),
        'longevity_score', v_row.longevity_score,
        'projection_score', v_row.projection_score,
        'source_url', v_target_source_url,
        'source_confidence', v_target_source_confidence,
        'queue_state', v_row.queue_state,
        'queue_lane', v_row.queue_lane
      );

      if cardinality(v_changed_fields) > 0 then
        v_result_status := 'accepted_patch';
        v_reason := coalesce(v_reason, 'Completed-row official source patch is safe and scoped to allowed fields.');
      elsif cardinality(v_blocked_fields) > 0 then
        v_result_status := 'skipped_weaker_existing';
        v_reason := coalesce(v_reason, 'Existing row already has stronger or non-empty values for the attempted fields.');
      else
        v_result_status := 'skipped_no_change';
        v_reason := coalesce(v_reason, 'Payload matches existing completed-row source/note state.');
      end if;
    end if;

    if not p_dry_run and v_entry.fragrance_id is not null then
      if v_result_status = 'accepted_patch' and v_row.id is not null then
        update public.fragrances
        set
          source_url = case when 'source_url' = any(v_changed_fields) then v_target_source_url else source_url end,
          source_confidence = case when 'source_confidence' = any(v_changed_fields) then v_target_source_confidence else source_confidence end,
          notes = case when 'notes' = any(v_changed_fields) then v_target_notes else notes end,
          top_notes = case when 'top_notes' = any(v_changed_fields) then v_target_top else top_notes end,
          heart_notes = case when 'heart_notes' = any(v_changed_fields) then v_target_heart else heart_notes end,
          base_notes = case when 'base_notes' = any(v_changed_fields) then v_target_base else base_notes end,
          updated_at = now()
        where id = v_row.id;

        select
          jsonb_build_object(
            'fragrance_id', f.id,
            'name', f.name,
            'brand', f.brand,
            'family_key', f.family_key,
            'notes', to_jsonb(coalesce(f.notes, '{}'::text[])),
            'top_notes', to_jsonb(coalesce(f.top_notes, '{}'::text[])),
            'heart_notes', to_jsonb(coalesce(f.heart_notes, '{}'::text[])),
            'base_notes', to_jsonb(coalesce(f.base_notes, '{}'::text[])),
            'accords', to_jsonb(coalesce(f.accords, '{}'::text[])),
            'longevity_score', f.longevity_score,
            'projection_score', f.projection_score,
            'source_url', f.source_url,
            'source_confidence', f.source_confidence,
            'updated_at', f.updated_at
          )
        into v_applied_snapshot
        from public.fragrances f
        where f.id = v_row.id;

        v_updated_count := v_updated_count + 1;
      end if;

      insert into public.fragrance_completed_source_patch_audit_v1 (
        fragrance_id,
        patch_status,
        actor_label,
        source_type,
        source_evidence_type,
        source_url,
        source_confidence,
        changed_fields,
        blocked_fields,
        before_snapshot,
        proposed_snapshot,
        applied_snapshot,
        source_payload,
        source_verification_summary,
        reason
      )
      values (
        v_entry.fragrance_id,
        v_result_status,
        v_actor_label,
        coalesce(v_source_type, 'official_brand'),
        case
          when v_source_evidence_type in ('official_pyramid', 'official_notes_only') then v_source_evidence_type
          else 'official_notes_only'
        end,
        v_source_url,
        v_source_confidence,
        coalesce(v_changed_fields, '{}'::text[]),
        coalesce(v_blocked_fields, '{}'::text[]),
        v_before_snapshot,
        v_proposed_snapshot,
        v_applied_snapshot,
        v_source_payload,
        v_source_verification_summary,
        v_reason
      );

      v_audit_written_count := v_audit_written_count + 1;
    end if;

    if v_result_status = 'accepted_patch' then
      v_would_update_count := v_would_update_count + 1;
    end if;

    v_results := v_results || jsonb_build_array(
      jsonb_strip_nulls(
        jsonb_build_object(
          'fragrance_id', v_entry.fragrance_id,
          'payload_ordinal', v_entry.payload_ordinal,
          'patch_status', v_result_status,
          'changed_fields', to_jsonb(coalesce(v_changed_fields, '{}'::text[])),
          'blocked_fields', to_jsonb(coalesce(v_blocked_fields, '{}'::text[])),
          'before_snapshot', v_before_snapshot,
          'proposed_snapshot', v_proposed_snapshot,
          'applied_snapshot', case when p_dry_run then null else v_applied_snapshot end,
          'reason', v_reason
        )
      )
    );

    if v_entry.fragrance_id is not null and not (v_entry.fragrance_id = any(v_processed_ids)) then
      v_processed_ids := array_append(v_processed_ids, v_entry.fragrance_id);
    end if;
  end loop;

  foreach v_scope_id in array coalesce(v_scope_ids, array[]::uuid[])
  loop
    if not (v_scope_id = any(v_processed_ids)) then
      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'fragrance_id', v_scope_id,
          'patch_status', 'rejected_not_exact_scope',
          'changed_fields', '[]'::jsonb,
          'blocked_fields', '[]'::jsonb,
          'before_snapshot', '{}'::jsonb,
          'proposed_snapshot', '{}'::jsonb,
          'reason', 'A scope fragrance_id was provided without a matching payload row.'
        )
      );
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'requested_count', v_requested_count,
    'payload_count', v_payload_count,
    'picked_count', v_picked_count,
    'would_update_count', v_would_update_count,
    'updated_count', v_updated_count,
    'audit_written_count', v_audit_written_count,
    'results', v_results
  );
end;
$function$;

revoke all on function public.apply_completed_fragrance_official_source_patch_v1(uuid[], jsonb, text, boolean) from public;
revoke all on function public.apply_completed_fragrance_official_source_patch_v1(uuid[], jsonb, text, boolean) from anon;
revoke all on function public.apply_completed_fragrance_official_source_patch_v1(uuid[], jsonb, text, boolean) from authenticated;
grant execute on function public.apply_completed_fragrance_official_source_patch_v1(uuid[], jsonb, text, boolean) to service_role;

comment on function public.apply_completed_fragrance_official_source_patch_v1(uuid[], jsonb, text, boolean) is
  'Applies exact-row official source and note patches to already taxonomy-complete fragrances while preserving family, accords, performance, taxonomy, provider evidence, and queue state. Dry-run returns per-row proposals without writing.';

commit;
