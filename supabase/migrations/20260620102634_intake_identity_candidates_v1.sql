begin;

create table if not exists public.fragrance_intake_identity_candidates_v1 (
  id uuid primary key default gen_random_uuid(),
  intake_request_id uuid not null references public.fragrance_intake_requests_v1(id) on delete cascade,

  candidate_name text not null,
  candidate_brand text not null,
  candidate_source_url text,
  source_type text not null,
  confidence numeric not null,
  confidence_reasons jsonb not null default '[]'::jsonb,
  ambiguity_warnings jsonb not null default '[]'::jsonb,
  selection_state text not null default 'proposed',
  actor_label text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fragrance_intake_identity_candidates_name_check
    check (length(btrim(candidate_name)) between 2 and 160),
  constraint fragrance_intake_identity_candidates_brand_check
    check (length(btrim(candidate_brand)) between 1 and 160),
  constraint fragrance_intake_identity_candidates_source_url_check
    check (
      candidate_source_url is null
      or (
        candidate_source_url ~* '^https?://'
        and candidate_source_url !~ '[[:space:]]'
        and length(candidate_source_url) <= 1000
      )
    ),
  constraint fragrance_intake_identity_candidates_source_type_check
    check (source_type in (
      'official_brand',
      'trusted_retailer',
      'community_non_official',
      'search_index'
    )),
  constraint fragrance_intake_identity_candidates_confidence_check
    check (confidence >= 0 and confidence <= 1),
  constraint fragrance_intake_identity_candidates_reasons_check
    check (jsonb_typeof(confidence_reasons) = 'array'),
  constraint fragrance_intake_identity_candidates_warnings_check
    check (jsonb_typeof(ambiguity_warnings) = 'array'),
  constraint fragrance_intake_identity_candidates_selection_state_check
    check (selection_state in (
      'proposed',
      'auto_selected',
      'user_selected',
      'rejected',
      'superseded'
    )),
  constraint fragrance_intake_identity_candidates_actor_label_check
    check (actor_label is null or length(btrim(actor_label)) between 1 and 120)
);

comment on table public.fragrance_intake_identity_candidates_v1 is
  'Sanitized identity candidates for missing-fragrance intake requests. These rows are not canonical fragrance truth and never write to public.fragrances.';

comment on column public.fragrance_intake_identity_candidates_v1.candidate_source_url is
  'Optional source URL used by service-role Vesperizer tooling. Authenticated read helpers expose only the source host/label, not the raw URL.';

create index if not exists fragrance_intake_identity_candidates_request_state_idx
  on public.fragrance_intake_identity_candidates_v1 (
    intake_request_id,
    selection_state,
    confidence desc,
    created_at desc
  );

create unique index if not exists fragrance_intake_identity_candidates_one_selected_uidx
  on public.fragrance_intake_identity_candidates_v1 (intake_request_id)
  where selection_state in ('auto_selected', 'user_selected');

create index if not exists fragrance_intake_identity_candidates_active_identity_idx
  on public.fragrance_intake_identity_candidates_v1 (
    intake_request_id,
    lower(btrim(candidate_name)),
    lower(btrim(candidate_brand)),
    lower(btrim(coalesce(candidate_source_url, '')))
  )
  where selection_state in ('proposed', 'auto_selected', 'user_selected');

drop trigger if exists fragrance_intake_identity_candidates_v1_touch_updated_at
  on public.fragrance_intake_identity_candidates_v1;
create trigger fragrance_intake_identity_candidates_v1_touch_updated_at
before update on public.fragrance_intake_identity_candidates_v1
for each row
execute function public.set_updated_at_v1();

alter table public.fragrance_intake_identity_candidates_v1 enable row level security;

drop policy if exists fragrance_intake_identity_candidates_v1_select_own
  on public.fragrance_intake_identity_candidates_v1;
create policy fragrance_intake_identity_candidates_v1_select_own
on public.fragrance_intake_identity_candidates_v1
for select
to authenticated
using (
  exists (
    select 1
    from public.fragrance_intake_requests_v1 r
    where r.id = fragrance_intake_identity_candidates_v1.intake_request_id
      and r.user_id = auth.uid()
  )
);

revoke all on table public.fragrance_intake_identity_candidates_v1
  from public, anon, authenticated;
grant all on table public.fragrance_intake_identity_candidates_v1
  to service_role;

create or replace function public.record_fragrance_intake_identity_candidates_v1(
  p_intake_request_id uuid,
  p_candidates jsonb,
  p_actor text,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidates jsonb := coalesce(p_candidates, '[]'::jsonb);
  v_candidate jsonb;
  v_requested_count integer := 0;
  v_valid_count integer := 0;
  v_rejected_count integer := 0;
  v_would_insert_count integer := 0;
  v_would_update_count integer := 0;
  v_inserted_count integer := 0;
  v_updated_count integer := 0;
  v_rejections jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_name text;
  v_brand text;
  v_source_url text;
  v_source_type text;
  v_confidence numeric;
  v_reasons jsonb;
  v_warnings jsonb;
  v_actor text := nullif(btrim(p_actor), '');
  v_existing_id uuid;
  v_intake_exists boolean := false;
begin
  select true
  into v_intake_exists
  from public.fragrance_intake_requests_v1 r
  where r.id = p_intake_request_id
  limit 1;

  if coalesce(v_intake_exists, false) is false then
    raise exception 'intake_request_id does not exist.';
  end if;

  if jsonb_typeof(v_candidates) <> 'array' then
    raise exception 'p_candidates must be a JSON array.';
  end if;

  v_requested_count := jsonb_array_length(v_candidates);

  if v_requested_count > 10 then
    raise exception 'At most 10 identity candidates may be recorded for one intake request.';
  end if;

  for v_candidate in
    select value
    from jsonb_array_elements(v_candidates)
  loop
    v_name := nullif(btrim(coalesce(v_candidate->>'candidate_name', v_candidate->>'name')), '');
    v_brand := nullif(btrim(coalesce(v_candidate->>'candidate_brand', v_candidate->>'brand')), '');
    v_source_url := nullif(btrim(coalesce(v_candidate->>'candidate_source_url', v_candidate->>'source_url')), '');
    v_source_type := lower(nullif(btrim(coalesce(v_candidate->>'source_type', '')), ''));
    v_reasons := coalesce(v_candidate->'confidence_reasons', v_candidate->'reasons', '[]'::jsonb);
    v_warnings := coalesce(v_candidate->'ambiguity_warnings', v_candidate->'warnings', '[]'::jsonb);

    begin
      v_confidence := (v_candidate->>'confidence')::numeric;
    exception
      when others then
        v_confidence := null;
    end;

    if v_reasons is null or jsonb_typeof(v_reasons) <> 'array' then
      v_reasons := '[]'::jsonb;
    end if;

    if v_warnings is null or jsonb_typeof(v_warnings) <> 'array' then
      v_warnings := '[]'::jsonb;
    end if;

    select coalesce(jsonb_agg(to_jsonb(left(value, 240))), '[]'::jsonb)
    into v_reasons
    from jsonb_array_elements_text(v_reasons)
    where nullif(btrim(value), '') is not null;

    select coalesce(jsonb_agg(to_jsonb(left(value, 240))), '[]'::jsonb)
    into v_warnings
    from jsonb_array_elements_text(v_warnings)
    where nullif(btrim(value), '') is not null;

    if v_name is null or length(v_name) < 2 or length(v_name) > 160 then
      v_rejected_count := v_rejected_count + 1;
      v_rejections := v_rejections || jsonb_build_array(jsonb_build_object(
        'candidate_name', v_name,
        'reason', 'candidate_name_required'
      ));
      continue;
    end if;

    if v_brand is null or length(v_brand) < 1 or length(v_brand) > 160 then
      v_rejected_count := v_rejected_count + 1;
      v_rejections := v_rejections || jsonb_build_array(jsonb_build_object(
        'candidate_name', v_name,
        'reason', 'candidate_brand_required'
      ));
      continue;
    end if;

    if v_source_type not in ('official_brand', 'trusted_retailer', 'community_non_official', 'search_index') then
      v_rejected_count := v_rejected_count + 1;
      v_rejections := v_rejections || jsonb_build_array(jsonb_build_object(
        'candidate_name', v_name,
        'candidate_brand', v_brand,
        'reason', 'invalid_source_type'
      ));
      continue;
    end if;

    if v_confidence is null or v_confidence < 0 or v_confidence > 1 then
      v_rejected_count := v_rejected_count + 1;
      v_rejections := v_rejections || jsonb_build_array(jsonb_build_object(
        'candidate_name', v_name,
        'candidate_brand', v_brand,
        'reason', 'invalid_confidence'
      ));
      continue;
    end if;

    if v_source_url is not null
      and (v_source_url !~* '^https?://' or v_source_url ~ '[[:space:]]' or length(v_source_url) > 1000) then
      v_rejected_count := v_rejected_count + 1;
      v_rejections := v_rejections || jsonb_build_array(jsonb_build_object(
        'candidate_name', v_name,
        'candidate_brand', v_brand,
        'reason', 'invalid_source_url'
      ));
      continue;
    end if;

    v_valid_count := v_valid_count + 1;

    select c.id
    into v_existing_id
    from public.fragrance_intake_identity_candidates_v1 c
    where c.intake_request_id = p_intake_request_id
      and c.selection_state in ('proposed', 'auto_selected', 'user_selected')
      and lower(btrim(c.candidate_name)) = lower(v_name)
      and lower(btrim(c.candidate_brand)) = lower(v_brand)
      and lower(btrim(coalesce(c.candidate_source_url, ''))) = lower(coalesce(v_source_url, ''))
    order by c.created_at desc
    limit 1;

    if p_dry_run then
      if v_existing_id is null then
        v_would_insert_count := v_would_insert_count + 1;
      else
        v_would_update_count := v_would_update_count + 1;
      end if;

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'candidate_id', v_existing_id,
        'would_insert', v_existing_id is null,
        'would_update', v_existing_id is not null,
        'candidate_name', v_name,
        'candidate_brand', v_brand,
        'source_type', v_source_type,
        'confidence', v_confidence,
        'selection_state', 'proposed'
      ));
    elsif v_existing_id is null then
      insert into public.fragrance_intake_identity_candidates_v1 (
        intake_request_id,
        candidate_name,
        candidate_brand,
        candidate_source_url,
        source_type,
        confidence,
        confidence_reasons,
        ambiguity_warnings,
        selection_state,
        actor_label
      )
      values (
        p_intake_request_id,
        v_name,
        v_brand,
        v_source_url,
        v_source_type,
        v_confidence,
        v_reasons,
        v_warnings,
        'proposed',
        coalesce(v_actor, 'vesperizer_intake_autopilot_v1')
      )
      returning id into v_existing_id;

      v_inserted_count := v_inserted_count + 1;

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'candidate_id', v_existing_id,
        'inserted', true,
        'updated', false,
        'candidate_name', v_name,
        'candidate_brand', v_brand,
        'source_type', v_source_type,
        'confidence', v_confidence,
        'selection_state', 'proposed'
      ));
    else
      update public.fragrance_intake_identity_candidates_v1 c
      set
        source_type = v_source_type,
        confidence = v_confidence,
        confidence_reasons = v_reasons,
        ambiguity_warnings = v_warnings,
        selection_state = case
          when c.selection_state in ('auto_selected', 'user_selected') then c.selection_state
          else 'proposed'
        end,
        actor_label = coalesce(v_actor, c.actor_label, 'vesperizer_intake_autopilot_v1')
      where c.id = v_existing_id;

      v_updated_count := v_updated_count + 1;

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'candidate_id', v_existing_id,
        'inserted', false,
        'updated', true,
        'candidate_name', v_name,
        'candidate_brand', v_brand,
        'source_type', v_source_type,
        'confidence', v_confidence,
        'selection_state', (
          select c.selection_state
          from public.fragrance_intake_identity_candidates_v1 c
          where c.id = v_existing_id
        )
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'intake_request_id', p_intake_request_id,
    'requested_count', v_requested_count,
    'valid_count', v_valid_count,
    'rejected_count', v_rejected_count,
    'would_insert_count', case when p_dry_run then v_would_insert_count else 0 end,
    'would_update_count', case when p_dry_run then v_would_update_count else 0 end,
    'inserted_count', case when p_dry_run then 0 else v_inserted_count end,
    'updated_count', case when p_dry_run then 0 else v_updated_count end,
    'results', v_results,
    'rejections', v_rejections
  );
end;
$$;

create or replace function public.get_my_fragrance_intake_identity_candidates_v1(
  p_intake_request_id uuid default null
)
returns table (
  id uuid,
  intake_request_id uuid,
  candidate_name text,
  candidate_brand text,
  source_type text,
  source_label text,
  source_host text,
  confidence numeric,
  confidence_reasons jsonb,
  ambiguity_warnings jsonb,
  selection_state text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth_user uuid := auth.uid();
begin
  if v_auth_user is null then
    raise exception 'Signed-in identity candidate read requires auth.uid().';
  end if;

  return query
  select
    c.id,
    c.intake_request_id,
    c.candidate_name,
    c.candidate_brand,
    c.source_type,
    case c.source_type
      when 'official_brand' then 'Official source match'
      when 'trusted_retailer' then 'Retailer source match'
      when 'community_non_official' then 'Community source match'
      else 'Search result match'
    end as source_label,
    case
      when c.candidate_source_url is null then null
      else lower(split_part(regexp_replace(c.candidate_source_url, '^https?://(www\\.)?', '', 'i'), '/', 1))
    end as source_host,
    c.confidence,
    c.confidence_reasons,
    c.ambiguity_warnings,
    c.selection_state,
    c.created_at,
    c.updated_at
  from public.fragrance_intake_identity_candidates_v1 c
  join public.fragrance_intake_requests_v1 r
    on r.id = c.intake_request_id
  where r.user_id = v_auth_user
    and c.selection_state in ('proposed', 'auto_selected', 'user_selected')
    and (p_intake_request_id is null or c.intake_request_id = p_intake_request_id)
  order by
    c.intake_request_id,
    case c.selection_state
      when 'user_selected' then 0
      when 'auto_selected' then 1
      else 2
    end,
    c.confidence desc,
    c.created_at desc;
end;
$$;

create or replace function public.select_my_fragrance_intake_identity_candidate_v1(
  p_candidate_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth_user uuid := auth.uid();
  v_candidate public.fragrance_intake_identity_candidates_v1%rowtype;
  v_rejected_count integer := 0;
begin
  if v_auth_user is null then
    raise exception 'Signed-in identity candidate selection requires auth.uid().';
  end if;

  select c.*
  into v_candidate
  from public.fragrance_intake_identity_candidates_v1 c
  join public.fragrance_intake_requests_v1 r
    on r.id = c.intake_request_id
  where c.id = p_candidate_id
    and r.user_id = v_auth_user
    and c.selection_state in ('proposed', 'auto_selected', 'user_selected')
  limit 1;

  if v_candidate.id is null then
    raise exception 'Identity candidate not found for signed-in user.';
  end if;

  update public.fragrance_intake_identity_candidates_v1 c
  set selection_state = 'rejected'
  where c.intake_request_id = v_candidate.intake_request_id
    and c.id <> v_candidate.id
    and c.selection_state in ('proposed', 'auto_selected', 'user_selected');

  get diagnostics v_rejected_count = row_count;

  update public.fragrance_intake_identity_candidates_v1 c
  set selection_state = 'user_selected'
  where c.id = v_candidate.id
  returning * into v_candidate;

  return jsonb_build_object(
    'candidate_id', v_candidate.id,
    'intake_request_id', v_candidate.intake_request_id,
    'candidate_name', v_candidate.candidate_name,
    'candidate_brand', v_candidate.candidate_brand,
    'source_type', v_candidate.source_type,
    'confidence', v_candidate.confidence,
    'selection_state', v_candidate.selection_state,
    'rejected_sibling_count', v_rejected_count
  );
end;
$$;

create or replace function public.auto_select_fragrance_intake_identity_candidate_v1(
  p_intake_request_id uuid,
  p_actor text default 'vesperizer_intake_autopilot_v1',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_active_count integer := 0;
  v_eligible_count integer := 0;
  v_competing_count integer := 0;
  v_candidate public.fragrance_intake_identity_candidates_v1%rowtype;
  v_rejected_count integer := 0;
begin
  select count(*)
  into v_active_count
  from public.fragrance_intake_identity_candidates_v1 c
  where c.intake_request_id = p_intake_request_id
    and c.selection_state in ('proposed', 'auto_selected', 'user_selected');

  select count(*)
  into v_eligible_count
  from public.fragrance_intake_identity_candidates_v1 c
  where c.intake_request_id = p_intake_request_id
    and c.selection_state in ('proposed', 'auto_selected', 'user_selected')
    and c.source_type = 'official_brand'
    and c.confidence >= 0.90
    and jsonb_array_length(c.ambiguity_warnings) = 0
    and exists (
      select 1
      from jsonb_array_elements_text(c.confidence_reasons) reason
      where lower(reason) like '%exact%'
        and lower(reason) like '%name%'
    )
    and exists (
      select 1
      from jsonb_array_elements_text(c.confidence_reasons) reason
      where lower(reason) like '%brand%'
    );

  select c.*
  into v_candidate
  from public.fragrance_intake_identity_candidates_v1 c
  where c.intake_request_id = p_intake_request_id
    and c.selection_state in ('proposed', 'auto_selected', 'user_selected')
    and c.source_type = 'official_brand'
    and c.confidence >= 0.90
    and jsonb_array_length(c.ambiguity_warnings) = 0
    and exists (
      select 1
      from jsonb_array_elements_text(c.confidence_reasons) reason
      where lower(reason) like '%exact%'
        and lower(reason) like '%name%'
    )
    and exists (
      select 1
      from jsonb_array_elements_text(c.confidence_reasons) reason
      where lower(reason) like '%brand%'
    )
  order by c.confidence desc, c.created_at asc
  limit 1;

  select count(*)
  into v_competing_count
  from public.fragrance_intake_identity_candidates_v1 c
  where c.intake_request_id = p_intake_request_id
    and c.selection_state in ('proposed', 'auto_selected', 'user_selected')
    and c.id is distinct from v_candidate.id
    and c.confidence >= 0.70;

  if v_active_count <> 1 or v_eligible_count <> 1 or v_candidate.id is null or v_competing_count > 0 then
    return jsonb_build_object(
      'dry_run', p_dry_run,
      'intake_request_id', p_intake_request_id,
      'auto_select_eligible', false,
      'active_count', v_active_count,
      'eligible_count', v_eligible_count,
      'competing_count', v_competing_count,
      'selected_count', 0,
      'reason', 'strict_auto_select_rule_not_met'
    );
  end if;

  if p_dry_run then
    return jsonb_build_object(
      'dry_run', true,
      'intake_request_id', p_intake_request_id,
      'auto_select_eligible', true,
      'candidate_id', v_candidate.id,
      'candidate_name', v_candidate.candidate_name,
      'candidate_brand', v_candidate.candidate_brand,
      'source_type', v_candidate.source_type,
      'confidence', v_candidate.confidence,
      'selected_count', 0,
      'would_select_count', 1
    );
  end if;

  update public.fragrance_intake_identity_candidates_v1 c
  set selection_state = 'rejected'
  where c.intake_request_id = p_intake_request_id
    and c.id <> v_candidate.id
    and c.selection_state in ('proposed', 'auto_selected', 'user_selected');

  get diagnostics v_rejected_count = row_count;

  update public.fragrance_intake_identity_candidates_v1 c
  set
    selection_state = 'auto_selected',
    actor_label = coalesce(nullif(btrim(p_actor), ''), c.actor_label, 'vesperizer_intake_autopilot_v1')
  where c.id = v_candidate.id
  returning * into v_candidate;

  return jsonb_build_object(
    'dry_run', false,
    'intake_request_id', p_intake_request_id,
    'auto_select_eligible', true,
    'candidate_id', v_candidate.id,
    'candidate_name', v_candidate.candidate_name,
    'candidate_brand', v_candidate.candidate_brand,
    'source_type', v_candidate.source_type,
    'confidence', v_candidate.confidence,
    'selection_state', v_candidate.selection_state,
    'selected_count', 1,
    'rejected_sibling_count', v_rejected_count
  );
end;
$$;

revoke all on function public.record_fragrance_intake_identity_candidates_v1(uuid, jsonb, text, boolean)
  from public, anon, authenticated;
revoke all on function public.get_my_fragrance_intake_identity_candidates_v1(uuid)
  from public, anon, authenticated;
revoke all on function public.select_my_fragrance_intake_identity_candidate_v1(uuid)
  from public, anon, authenticated;
revoke all on function public.auto_select_fragrance_intake_identity_candidate_v1(uuid, text, boolean)
  from public, anon, authenticated;

grant execute on function public.record_fragrance_intake_identity_candidates_v1(uuid, jsonb, text, boolean)
  to service_role;
grant execute on function public.get_my_fragrance_intake_identity_candidates_v1(uuid)
  to authenticated, service_role;
grant execute on function public.select_my_fragrance_intake_identity_candidate_v1(uuid)
  to authenticated, service_role;
grant execute on function public.auto_select_fragrance_intake_identity_candidate_v1(uuid, text, boolean)
  to service_role;

commit;
