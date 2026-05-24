begin;

create table if not exists public.fragrance_canonical_aliases_v1 (
  id uuid primary key default gen_random_uuid(),
  canonical_identity_key text not null,
  decision_review_id uuid not null references public.fragrance_canonical_identity_reviews_v1(id),
  canonical_fragrance_id uuid not null references public.fragrances(id),
  alias_fragrance_id uuid not null references public.fragrances(id),
  alias_status text not null,
  alias_reason text null,
  recommended_next_action text null,
  actor_label text not null,
  decision_snapshot jsonb not null default '{}'::jsonb,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  cluster_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  superseded_at timestamptz null,
  superseded_by uuid null references public.fragrance_canonical_aliases_v1(id),
  constraint fragrance_canonical_aliases_v1_status_check check (
    alias_status in ('active', 'inactive', 'superseded', 'reverted', 'needs_review')
  ),
  constraint fragrance_canonical_aliases_v1_distinct_ids_check check (
    canonical_fragrance_id <> alias_fragrance_id
  )
);

create index if not exists fragrance_canonical_aliases_v1_alias_idx
  on public.fragrance_canonical_aliases_v1 (alias_fragrance_id);

create index if not exists fragrance_canonical_aliases_v1_canonical_idx
  on public.fragrance_canonical_aliases_v1 (canonical_fragrance_id);

create index if not exists fragrance_canonical_aliases_v1_key_idx
  on public.fragrance_canonical_aliases_v1 (canonical_identity_key);

create index if not exists fragrance_canonical_aliases_v1_review_idx
  on public.fragrance_canonical_aliases_v1 (decision_review_id);

create index if not exists fragrance_canonical_aliases_v1_status_idx
  on public.fragrance_canonical_aliases_v1 (alias_status);

create index if not exists fragrance_canonical_aliases_v1_created_idx
  on public.fragrance_canonical_aliases_v1 (created_at desc);

create unique index if not exists fragrance_canonical_aliases_v1_one_active_alias_idx
  on public.fragrance_canonical_aliases_v1 (alias_fragrance_id)
  where alias_status = 'active' and superseded_at is null;

drop trigger if exists fragrance_canonical_aliases_v1_touch_updated_at
  on public.fragrance_canonical_aliases_v1;

create trigger fragrance_canonical_aliases_v1_touch_updated_at
before update on public.fragrance_canonical_aliases_v1
for each row
execute function public.set_updated_at_v1();

alter table public.fragrance_canonical_aliases_v1 enable row level security;

comment on table public.fragrance_canonical_aliases_v1 is
  'Operational alias mapping derived from canonical-selected identity decisions only. It does not merge rows, redirect app payloads, copy evidence, mutate public.fragrances, or rewrite user history; it exists for future Queue v2.3 and canonical resolution read models.';

comment on column public.fragrance_canonical_aliases_v1.decision_snapshot is
  'Snapshot of the canonical identity decision that justified the alias mapping. Operational routing evidence only, not source truth, taxonomy truth, or app-facing redirect behavior.';

comment on column public.fragrance_canonical_aliases_v1.evidence_snapshot is
  'Captured operational evidence snapshot from the source review/decision lane. It must not be treated as notes, accords, source, taxonomy, or recommendation truth.';

comment on column public.fragrance_canonical_aliases_v1.cluster_snapshot is
  'Captured cluster/member snapshot from the source decision lane. It does not merge, delete, or copy data between fragrance rows.';

create table if not exists public.fragrance_canonical_alias_events_v1 (
  id uuid primary key default gen_random_uuid(),
  alias_id uuid not null references public.fragrance_canonical_aliases_v1(id),
  canonical_identity_key text not null,
  event_type text not null,
  event_status text not null,
  actor_label text not null,
  event_reason text null,
  event_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint fragrance_canonical_alias_events_v1_type_check check (
    event_type in (
      'create_alias_mapping',
      'supersede_alias_mapping',
      'revert_alias_mapping',
      'manual_override'
    )
  ),
  constraint fragrance_canonical_alias_events_v1_status_check check (
    event_status in ('recorded', 'preview', 'skipped', 'failed')
  )
);

create index if not exists fragrance_canonical_alias_events_v1_alias_idx
  on public.fragrance_canonical_alias_events_v1 (alias_id);

create index if not exists fragrance_canonical_alias_events_v1_key_idx
  on public.fragrance_canonical_alias_events_v1 (canonical_identity_key);

create index if not exists fragrance_canonical_alias_events_v1_created_idx
  on public.fragrance_canonical_alias_events_v1 (created_at desc);

alter table public.fragrance_canonical_alias_events_v1 enable row level security;

comment on table public.fragrance_canonical_alias_events_v1 is
  'Append-only audit log for canonical alias mapping events. Operational memory only: no merge, no redirect application, no evidence copy, and no public.fragrances mutation.';

create or replace view public.fragrance_canonical_resolution_v1
with (security_invoker = true)
as
with active_aliases as (
  select
    a.id as alias_id,
    a.canonical_identity_key,
    a.decision_review_id,
    a.canonical_fragrance_id,
    a.alias_fragrance_id,
    a.alias_status,
    a.alias_reason,
    a.recommended_next_action,
    a.created_at,
    a.updated_at
  from public.fragrance_canonical_aliases_v1 a
  where a.alias_status = 'active'
    and a.superseded_at is null
),
canonical_targets as (
  select
    a.canonical_fragrance_id,
    (array_agg(a.canonical_identity_key order by a.created_at desc, a.alias_id desc))[1] as canonical_identity_key,
    (array_agg(a.decision_review_id order by a.created_at desc, a.alias_id desc))[1] as decision_review_id,
    count(*)::int as active_alias_count,
    min(a.created_at) as first_created_at,
    max(a.updated_at) as last_updated_at
  from active_aliases a
  group by a.canonical_fragrance_id
)
select
  src.id as source_fragrance_id,
  src.name as source_name,
  src.brand as source_brand,
  coalesce(alias_map.canonical_fragrance_id, src.id) as canonical_fragrance_id,
  coalesce(canonical_row.name, src.name) as canonical_name,
  coalesce(canonical_row.brand, src.brand) as canonical_brand,
  (alias_map.alias_id is not null) as is_alias,
  alias_map.alias_status,
  coalesce(alias_map.canonical_identity_key, canonical_target.canonical_identity_key) as canonical_identity_key,
  coalesce(alias_map.decision_review_id, canonical_target.decision_review_id) as decision_review_id,
  alias_map.alias_id,
  case
    when alias_map.alias_id is not null then 'alias_mapped'
    when canonical_target.active_alias_count > 0 then 'canonical_target'
    else 'self'
  end as resolution_status,
  case
    when alias_map.alias_id is not null then coalesce(alias_map.alias_reason, 'canonical_selected_alias_mapping')
    when canonical_target.active_alias_count > 0 then 'canonical_row_for_active_aliases'
    else 'self'
  end as resolution_reason,
  case
    when alias_map.alias_id is not null then alias_map.recommended_next_action
    when canonical_target.active_alias_count > 0 then 'work_canonical_row_only'
    else null
  end as recommended_next_action,
  coalesce(alias_map.created_at, canonical_target.first_created_at) as created_at,
  coalesce(alias_map.updated_at, canonical_target.last_updated_at) as updated_at
from public.fragrances src
left join active_aliases alias_map
  on alias_map.alias_fragrance_id = src.id
left join public.fragrances canonical_row
  on canonical_row.id = alias_map.canonical_fragrance_id
left join canonical_targets canonical_target
  on canonical_target.canonical_fragrance_id = src.id;

comment on view public.fragrance_canonical_resolution_v1 is
  'Read-only canonical resolution view for backend use. It exposes alias/canonical metadata without hiding rows, redirecting app payloads, merging rows, copying source or taxonomy evidence, or mutating public.fragrances.';

create or replace function public.create_fragrance_canonical_aliases_v1(
  p_canonical_identity_keys text[],
  p_actor_label text default 'codex_alias_mapping_v1',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_keys text[];
  v_actor_label text := coalesce(nullif(btrim(p_actor_label), ''), 'codex_alias_mapping_v1');
  v_requested_count integer := 0;
  v_picked_count integer := 0;
  v_eligible_count integer := 0;
  v_would_create_count integer := 0;
  v_created_count integer := 0;
  v_rejected_count integer := 0;
  v_skipped_count integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_cluster record;
  v_alias_id uuid;
  v_existing_alias record;
  v_new_alias_id uuid;
  v_new_event_id uuid;
  v_alias_reason text;
  v_decision_snapshot jsonb;
  v_alias_ids uuid[];
  v_alias_results jsonb;
  v_cluster_status text;
  v_blocker_reason text;
begin
  select array_agg(distinct clean_key order by clean_key)
  into v_keys
  from (
    select nullif(btrim(k), '') as clean_key
    from unnest(coalesce(p_canonical_identity_keys, array[]::text[])) as k
  ) cleaned
  where clean_key is not null;

  v_requested_count := coalesce(cardinality(v_keys), 0);

  if v_requested_count = 0 then
    raise exception 'create_fragrance_canonical_aliases_v1 requires explicit non-empty canonical identity keys';
  end if;

  if v_requested_count > 10 then
    raise exception 'create_fragrance_canonical_aliases_v1 accepts at most 10 canonical identity keys per call';
  end if;

  for v_cluster in
    with requested as (
      select unnest(v_keys) as canonical_identity_key
    )
    select
      req.canonical_identity_key,
      r.latest_review_id,
      r.decision_status,
      r.canonical_fragrance_id,
      r.alias_fragrance_ids,
      r.reviewed_fragrance_ids,
      r.decision_reason,
      r.recommended_next_action,
      r.actor_label as decision_actor_label,
      r.evidence_snapshot,
      r.cluster_snapshot,
      r.created_at,
      r.updated_at
    from requested req
    left join public.fragrance_canonical_identity_review_latest_v1 r
      on r.canonical_identity_key = req.canonical_identity_key
    order by req.canonical_identity_key
  loop
    v_alias_results := '[]'::jsonb;
    v_alias_ids := array[]::uuid[];
    v_cluster_status := null;
    v_blocker_reason := null;
    v_existing_alias := null;
    v_new_alias_id := null;
    v_new_event_id := null;

    if v_cluster.latest_review_id is null then
      v_rejected_count := v_rejected_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'canonical_identity_key', v_cluster.canonical_identity_key,
        'result_status', 'rejected',
        'blocker_reason', 'missing_latest_review'
      ));
      continue;
    end if;

    v_picked_count := v_picked_count + 1;

    if v_cluster.decision_status <> 'canonical_selected' then
      v_skipped_count := v_skipped_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'canonical_identity_key', v_cluster.canonical_identity_key,
        'decision_review_id', v_cluster.latest_review_id,
        'decision_status', v_cluster.decision_status,
        'canonical_fragrance_id', v_cluster.canonical_fragrance_id,
        'reviewed_fragrance_ids', to_jsonb(v_cluster.reviewed_fragrance_ids),
        'result_status', 'skipped_not_canonical_selected',
        'blocker_reason', 'canonical_selection_deferred_or_non_aliasable_decision'
      ));
      continue;
    end if;

    if v_cluster.canonical_fragrance_id is null then
      v_rejected_count := v_rejected_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'canonical_identity_key', v_cluster.canonical_identity_key,
        'decision_review_id', v_cluster.latest_review_id,
        'decision_status', v_cluster.decision_status,
        'result_status', 'rejected',
        'blocker_reason', 'canonical_fragrance_id_is_null'
      ));
      continue;
    end if;

    select coalesce(array_agg(distinct alias_id order by alias_id), array[]::uuid[])
    into v_alias_ids
    from unnest(coalesce(v_cluster.alias_fragrance_ids, array[]::uuid[])) as alias_ids(alias_id)
    where alias_id is not null;

    if cardinality(v_alias_ids) = 0 then
      v_rejected_count := v_rejected_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'canonical_identity_key', v_cluster.canonical_identity_key,
        'decision_review_id', v_cluster.latest_review_id,
        'decision_status', v_cluster.decision_status,
        'result_status', 'rejected',
        'blocker_reason', 'alias_fragrance_ids_empty'
      ));
      continue;
    end if;

    if not (v_cluster.canonical_fragrance_id = any(v_cluster.reviewed_fragrance_ids)) then
      v_rejected_count := v_rejected_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'canonical_identity_key', v_cluster.canonical_identity_key,
        'decision_review_id', v_cluster.latest_review_id,
        'decision_status', v_cluster.decision_status,
        'result_status', 'rejected',
        'blocker_reason', 'canonical_fragrance_id_not_in_reviewed_fragrance_ids'
      ));
      continue;
    end if;

    if exists (
      select 1
      from unnest(v_alias_ids) as alias_ids(alias_id)
      where alias_id = v_cluster.canonical_fragrance_id
         or not (alias_id = any(v_cluster.reviewed_fragrance_ids))
    ) then
      v_rejected_count := v_rejected_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'canonical_identity_key', v_cluster.canonical_identity_key,
        'decision_review_id', v_cluster.latest_review_id,
        'decision_status', v_cluster.decision_status,
        'result_status', 'rejected',
        'blocker_reason', 'alias_ids_invalid_for_reviewed_cluster'
      ));
      continue;
    end if;

    if exists (
      select 1
      from public.fragrance_canonical_aliases_v1 a
      where a.alias_fragrance_id = v_cluster.canonical_fragrance_id
        and a.alias_status = 'active'
        and a.superseded_at is null
    ) then
      v_rejected_count := v_rejected_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'canonical_identity_key', v_cluster.canonical_identity_key,
        'decision_review_id', v_cluster.latest_review_id,
        'decision_status', v_cluster.decision_status,
        'canonical_fragrance_id', v_cluster.canonical_fragrance_id,
        'result_status', 'rejected',
        'blocker_reason', 'canonical_fragrance_id_is_active_alias'
      ));
      continue;
    end if;

    v_alias_reason := coalesce(nullif(btrim(v_cluster.decision_reason), ''), 'canonical_selected_identity_alias_mapping');
    v_decision_snapshot := jsonb_strip_nulls(jsonb_build_object(
      'decision_review_id', v_cluster.latest_review_id,
      'canonical_identity_key', v_cluster.canonical_identity_key,
      'decision_status', v_cluster.decision_status,
      'canonical_fragrance_id', v_cluster.canonical_fragrance_id,
      'alias_fragrance_ids', to_jsonb(v_alias_ids),
      'reviewed_fragrance_ids', to_jsonb(v_cluster.reviewed_fragrance_ids),
      'decision_reason', v_cluster.decision_reason,
      'recommended_next_action', v_cluster.recommended_next_action,
      'decision_actor_label', v_cluster.decision_actor_label,
      'decision_created_at', v_cluster.created_at,
      'decision_updated_at', v_cluster.updated_at
    ));

    for v_alias_id in
      select unnest(v_alias_ids) as alias_fragrance_id
      order by alias_fragrance_id
    loop
      select
        a.id,
        a.canonical_fragrance_id,
        a.alias_status,
        a.canonical_identity_key
      into v_existing_alias
      from public.fragrance_canonical_aliases_v1 a
      where a.alias_fragrance_id = v_alias_id
        and a.alias_status = 'active'
        and a.superseded_at is null
      order by a.created_at desc, a.id desc
      limit 1;

      if found then
        v_skipped_count := v_skipped_count + 1;
        v_alias_results := v_alias_results || jsonb_build_array(jsonb_build_object(
          'alias_fragrance_id', v_alias_id,
          'canonical_fragrance_id', v_existing_alias.canonical_fragrance_id,
          'alias_id', v_existing_alias.id,
          'result_status', 'already_active_alias',
          'blocker_reason', 'active_alias_mapping_exists',
          'would_create', false
        ));
      elsif p_dry_run then
        v_eligible_count := v_eligible_count + 1;
        v_would_create_count := v_would_create_count + 1;
        v_alias_results := v_alias_results || jsonb_build_array(jsonb_build_object(
          'alias_fragrance_id', v_alias_id,
          'canonical_fragrance_id', v_cluster.canonical_fragrance_id,
          'result_status', 'would_create',
          'would_create', true
        ));
      else
        insert into public.fragrance_canonical_aliases_v1 (
          canonical_identity_key,
          decision_review_id,
          canonical_fragrance_id,
          alias_fragrance_id,
          alias_status,
          alias_reason,
          recommended_next_action,
          actor_label,
          decision_snapshot,
          evidence_snapshot,
          cluster_snapshot
        )
        values (
          v_cluster.canonical_identity_key,
          v_cluster.latest_review_id,
          v_cluster.canonical_fragrance_id,
          v_alias_id,
          'active',
          v_alias_reason,
          v_cluster.recommended_next_action,
          v_actor_label,
          v_decision_snapshot,
          coalesce(v_cluster.evidence_snapshot, '{}'::jsonb),
          coalesce(v_cluster.cluster_snapshot, '{}'::jsonb)
        )
        returning id into v_new_alias_id;

        insert into public.fragrance_canonical_alias_events_v1 (
          alias_id,
          canonical_identity_key,
          event_type,
          event_status,
          actor_label,
          event_reason,
          event_snapshot
        )
        values (
          v_new_alias_id,
          v_cluster.canonical_identity_key,
          'create_alias_mapping',
          'recorded',
          v_actor_label,
          v_alias_reason,
          jsonb_build_object(
            'alias_id', v_new_alias_id,
            'decision_review_id', v_cluster.latest_review_id,
            'canonical_identity_key', v_cluster.canonical_identity_key,
            'canonical_fragrance_id', v_cluster.canonical_fragrance_id,
            'alias_fragrance_id', v_alias_id,
            'alias_status', 'active',
            'recommended_next_action', v_cluster.recommended_next_action,
            'decision_snapshot', v_decision_snapshot
          )
        )
        returning id into v_new_event_id;

        v_eligible_count := v_eligible_count + 1;
        v_created_count := v_created_count + 1;
        v_alias_results := v_alias_results || jsonb_build_array(jsonb_build_object(
          'alias_fragrance_id', v_alias_id,
          'canonical_fragrance_id', v_cluster.canonical_fragrance_id,
          'alias_id', v_new_alias_id,
          'event_id', v_new_event_id,
          'result_status', 'created',
          'would_create', false
        ));
      end if;
    end loop;

    v_cluster_status := case
      when p_dry_run and exists (
        select 1
        from jsonb_array_elements(v_alias_results) as r(value)
        where r.value ->> 'result_status' = 'would_create'
      ) then 'would_create'
      when not p_dry_run and exists (
        select 1
        from jsonb_array_elements(v_alias_results) as r(value)
        where r.value ->> 'result_status' = 'created'
      ) then 'created'
      when exists (
        select 1
        from jsonb_array_elements(v_alias_results) as r(value)
        where r.value ->> 'result_status' = 'already_active_alias'
      ) then 'already_active_alias'
      else 'no_action'
    end;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'canonical_identity_key', v_cluster.canonical_identity_key,
      'decision_review_id', v_cluster.latest_review_id,
      'decision_status', v_cluster.decision_status,
      'canonical_fragrance_id', v_cluster.canonical_fragrance_id,
      'alias_fragrance_ids', to_jsonb(v_alias_ids),
      'reviewed_fragrance_ids', to_jsonb(v_cluster.reviewed_fragrance_ids),
      'result_status', v_cluster_status,
      'alias_results', v_alias_results
    ));
  end loop;

  return jsonb_build_object(
    'requested_count', v_requested_count,
    'picked_count', v_picked_count,
    'eligible_count', v_eligible_count,
    'would_create_count', v_would_create_count,
    'created_count', v_created_count,
    'rejected_count', v_rejected_count,
    'skipped_count', v_skipped_count,
    'dry_run', p_dry_run,
    'actor_label', v_actor_label,
    'results', v_results
  );
end;
$function$;

comment on function public.create_fragrance_canonical_aliases_v1(text[], text, boolean) is
  'Creates or previews durable alias mappings from explicit canonical-selected identity decisions only. It never merges rows, rewrites user history, mutates public.fragrances, copies source/taxonomy evidence, stages enrichment, writes taxonomy, or refreshes performance.';

revoke all on public.fragrance_canonical_aliases_v1 from public, anon, authenticated;
grant select, insert, update, delete on public.fragrance_canonical_aliases_v1 to service_role;

revoke all on public.fragrance_canonical_alias_events_v1 from public, anon, authenticated;
grant select, insert on public.fragrance_canonical_alias_events_v1 to service_role;

revoke all on public.fragrance_canonical_resolution_v1 from public, anon, authenticated;
grant select on public.fragrance_canonical_resolution_v1 to service_role;

revoke all on function public.create_fragrance_canonical_aliases_v1(text[], text, boolean)
  from public, anon, authenticated;
grant execute on function public.create_fragrance_canonical_aliases_v1(text[], text, boolean)
  to service_role;

commit;
