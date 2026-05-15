do $$
begin
  if exists (
    select 1
    from public.fragrance_text_enrichment
    where status not in (
      'pending',
      'enriched',
      'skipped_existing_good_data',
      'no_match',
      'low_confidence',
      'needs_review',
      'error',
      'already_enriched',
      'rejected_match',
      'notes_promoted'
    )
  ) then
    raise exception 'Cannot extend fragrance_text_enrichment status check: unexpected status values exist';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class cl
      on cl.oid = c.conrelid
    join pg_namespace n
      on n.oid = cl.relnamespace
    where n.nspname = 'public'
      and cl.relname = 'fragrance_text_enrichment'
      and c.conname = 'fragrance_text_enrichment_status_check'
      and pg_get_constraintdef(c.oid) like '%notes_promoted%'
  ) then
    alter table public.fragrance_text_enrichment
      drop constraint if exists fragrance_text_enrichment_status_check;

    alter table public.fragrance_text_enrichment
      add constraint fragrance_text_enrichment_status_check check (
        status in (
          'pending',
          'enriched',
          'skipped_existing_good_data',
          'no_match',
          'low_confidence',
          'needs_review',
          'error',
          'already_enriched',
          'rejected_match',
          'notes_promoted'
        )
      );
  end if;
end;
$$;

create table if not exists public.fragrance_text_enrichment_notes_promotions_v1 (
  id uuid primary key default gen_random_uuid(),
  fragrance_id uuid not null references public.fragrances(id) on delete cascade,
  action text not null default 'promote_notes_only',
  actor_label text not null default 'operator',
  reason text,
  previous_enrichment_status text,
  new_enrichment_status text,
  source_url text,
  source_confidence numeric,
  match_name text,
  match_brand text,
  canonical_notes_before text[] not null default '{}'::text[],
  canonical_accords_before text[] not null default '{}'::text[],
  canonical_notes_after text[] not null default '{}'::text[],
  canonical_accords_after text[] not null default '{}'::text[],
  staged_notes text[] not null default '{}'::text[],
  staged_accords text[] not null default '{}'::text[],
  enrichment_snapshot jsonb not null default '{}'::jsonb,
  refresh_result jsonb not null default '{}'::jsonb,
  result_status text not null,
  rejection_reason text,
  function_version text not null default 'fragrance_text_enrichment_notes_promote_v1',
  promoted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint fragrance_text_enrichment_notes_promotions_v1_action_check check (
    action in ('promote_notes_only')
  ),
  constraint fragrance_text_enrichment_notes_promotions_v1_result_status_check check (
    result_status in ('notes_promoted', 'rejected')
  )
);

alter table public.fragrance_text_enrichment_notes_promotions_v1 enable row level security;

revoke all on table public.fragrance_text_enrichment_notes_promotions_v1 from public;
revoke all on table public.fragrance_text_enrichment_notes_promotions_v1 from anon;
revoke all on table public.fragrance_text_enrichment_notes_promotions_v1 from authenticated;

grant select, insert on table public.fragrance_text_enrichment_notes_promotions_v1 to service_role;

create index if not exists fragrance_text_enrichment_notes_promotions_v1_fragrance_idx
  on public.fragrance_text_enrichment_notes_promotions_v1 (fragrance_id, created_at desc);

create index if not exists fragrance_text_enrichment_notes_promotions_v1_status_idx
  on public.fragrance_text_enrichment_notes_promotions_v1 (result_status, created_at desc);

create or replace function public.promote_fragrance_text_enrichment_notes_only_v1(
  p_fragrance_ids text[],
  p_actor_label text default 'operator',
  p_reason text default 'notes_only_promotion',
  p_dry_run boolean default true,
  p_refresh_after_promotion boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_function_version constant text := 'fragrance_text_enrichment_notes_promote_v1';
  v_max_ids constant integer := 10;
  v_min_source_confidence constant numeric := 0.58;
  v_new_enrichment_status constant text := 'notes_promoted';
  v_requested_count integer := coalesce(array_length(p_fragrance_ids, 1), 0);
  v_distinct_count integer := 0;
  v_picked integer := 0;
  v_would_promote_count integer := 0;
  v_promoted_count integer := 0;
  v_rejected_count integer := 0;
  v_refreshed_count integer := 0;
  v_actor_label text := coalesce(nullif(trim(p_actor_label), ''), 'operator');
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'notes_only_promotion');
  v_refresh_function_available boolean := exists (
    select 1
    from pg_proc p
    join pg_namespace n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'refresh_fragrance_performance_features_v1'
      and pg_get_function_identity_arguments(p.oid) = 'p_fragrance_id uuid'
  );
  v_invalid_ids text[] := '{}'::text[];
  v_missing_ids text[] := '{}'::text[];
  v_results jsonb := '[]'::jsonb;
  v_audit_id uuid;
  v_refresh_result jsonb;
  v_rejection_reason text;
  v_result_status text;
  v_should_promote boolean;
  v_before_notes text[];
  v_before_accords text[];
  v_after_notes text[];
  v_after_accords text[];
  v_name_norm text;
  v_match_norm text;
  v_brand_norm text;
  v_match_brand_norm text;
  v_source_norm text;
  v_name_matches boolean;
  v_brand_matches boolean;
  v_source_matches boolean;
  rec record;
begin
  if v_requested_count = 0 then
    return jsonb_build_object(
      'ok', false,
      'dry_run', p_dry_run,
      'requested_count', 0,
      'distinct_requested_count', 0,
      'picked', 0,
      'results_count', 0,
      'would_promote_count', 0,
      'promoted_count', 0,
      'rejected_count', 0,
      'refreshed_count', 0,
      'invalid_ids', '[]'::jsonb,
      'missing_ids', '[]'::jsonb,
      'max_ids', v_max_ids,
      'refresh_after_promotion', p_refresh_after_promotion,
      'refresh_function_available', v_refresh_function_available,
      'scope_mode', 'explicit_ids',
      'function_version', v_function_version,
      'error', 'explicit fragrance IDs are required'
    );
  end if;

  with raw_ids as (
    select nullif(trim(value), '') as input_id, ord
    from unnest(coalesce(p_fragrance_ids, '{}'::text[])) with ordinality as t(value, ord)
  ),
  ordered_ids as (
    select input_id, min(ord) as ord
    from raw_ids
    where input_id is not null
    group by input_id
  )
  select count(*)::integer
  into v_distinct_count
  from ordered_ids;

  if v_distinct_count = 0 then
    return jsonb_build_object(
      'ok', false,
      'dry_run', p_dry_run,
      'requested_count', v_requested_count,
      'distinct_requested_count', 0,
      'picked', 0,
      'results_count', 0,
      'would_promote_count', 0,
      'promoted_count', 0,
      'rejected_count', 0,
      'refreshed_count', 0,
      'invalid_ids', '[]'::jsonb,
      'missing_ids', '[]'::jsonb,
      'max_ids', v_max_ids,
      'refresh_after_promotion', p_refresh_after_promotion,
      'refresh_function_available', v_refresh_function_available,
      'scope_mode', 'explicit_ids',
      'function_version', v_function_version,
      'error', 'explicit fragrance IDs are required'
    );
  end if;

  if v_distinct_count > v_max_ids then
    return jsonb_build_object(
      'ok', false,
      'dry_run', p_dry_run,
      'requested_count', v_requested_count,
      'distinct_requested_count', v_distinct_count,
      'picked', 0,
      'results_count', 0,
      'would_promote_count', 0,
      'promoted_count', 0,
      'rejected_count', 0,
      'refreshed_count', 0,
      'invalid_ids', '[]'::jsonb,
      'missing_ids', '[]'::jsonb,
      'max_ids', v_max_ids,
      'refresh_after_promotion', p_refresh_after_promotion,
      'refresh_function_available', v_refresh_function_available,
      'scope_mode', 'explicit_ids',
      'function_version', v_function_version,
      'error', format('notes-only promotion is limited to %s explicit IDs per call', v_max_ids)
    );
  end if;

  for rec in
    with raw_ids as (
      select nullif(trim(value), '') as input_id, ord
      from unnest(coalesce(p_fragrance_ids, '{}'::text[])) with ordinality as t(value, ord)
    ),
    ordered_ids as (
      select input_id, min(ord) as ord
      from raw_ids
      where input_id is not null
      group by input_id
    ),
    parsed_ids as (
      select
        input_id,
        ord,
        case
          when input_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then input_id::uuid
          else null::uuid
        end as fragrance_id
      from ordered_ids
    )
    select
      pi.input_id,
      pi.ord,
      pi.fragrance_id as parsed_fragrance_id,
      f.id as existing_fragrance_id,
      f.name,
      f.brand,
      f.notes as current_notes,
      f.accords as current_accords,
      f.updated_at as fragrance_updated_at,
      te.provider,
      te.status as enrichment_status,
      te.source_url,
      te.source_confidence,
      te.match_name,
      te.match_brand,
      te.proposed_family_key,
      te.concentration,
      te.notes as staged_notes,
      te.accords as staged_accords,
      te.provider_payload,
      te.last_error,
      te.last_enriched_at,
      te.created_at as enrichment_created_at,
      te.updated_at as enrichment_updated_at
    from parsed_ids pi
    left join public.fragrances f
      on f.id = pi.fragrance_id
    left join public.fragrance_text_enrichment te
      on te.fragrance_id = f.id
    order by pi.ord
  loop
    v_audit_id := null;
    v_refresh_result := jsonb_build_object('status', 'not_requested');
    v_rejection_reason := null;
    v_result_status := null;
    v_should_promote := false;
    v_before_notes := coalesce(rec.current_notes, '{}'::text[]);
    v_before_accords := coalesce(rec.current_accords, '{}'::text[]);
    v_after_notes := v_before_notes;
    v_after_accords := v_before_accords;
    v_name_matches := false;
    v_brand_matches := false;
    v_source_matches := false;

    if rec.parsed_fragrance_id is null then
      v_result_status := 'invalid_id';
      v_rejection_reason := 'invalid_fragrance_id';
      v_invalid_ids := array_append(v_invalid_ids, rec.input_id);
    elsif rec.existing_fragrance_id is null then
      v_result_status := 'missing_fragrance';
      v_rejection_reason := 'fragrance_not_found';
      v_missing_ids := array_append(v_missing_ids, rec.input_id);
    else
      v_picked := v_picked + 1;

      v_name_norm := regexp_replace(
        btrim(regexp_replace(lower(coalesce(rec.name, '')), '[^a-z0-9]+', ' ', 'g')),
        '[[:space:]]+',
        ' ',
        'g'
      );
      v_match_norm := lower(coalesce(rec.match_name, ''));
      v_match_norm := regexp_replace(v_match_norm, '\m(unisex|men|women|male|female)\M', ' ', 'g');
      v_match_norm := regexp_replace(
        btrim(regexp_replace(v_match_norm, '[^a-z0-9]+', ' ', 'g')),
        '[[:space:]]+',
        ' ',
        'g'
      );
      v_brand_norm := regexp_replace(
        btrim(regexp_replace(lower(coalesce(rec.brand, '')), '[^a-z0-9]+', ' ', 'g')),
        '[[:space:]]+',
        ' ',
        'g'
      );
      v_match_brand_norm := regexp_replace(
        btrim(regexp_replace(lower(coalesce(rec.match_brand, '')), '[^a-z0-9]+', ' ', 'g')),
        '[[:space:]]+',
        ' ',
        'g'
      );
      v_source_norm := regexp_replace(
        btrim(regexp_replace(lower(coalesce(rec.source_url, '')), '[^a-z0-9]+', ' ', 'g')),
        '[[:space:]]+',
        ' ',
        'g'
      );

      v_name_matches := v_name_norm <> ''
        and v_match_norm <> ''
        and (
          v_match_norm = v_name_norm
          or position(v_name_norm in v_match_norm) > 0
          or position(v_match_norm in v_name_norm) > 0
        );

      v_brand_matches := v_brand_norm <> ''
        and v_match_brand_norm <> ''
        and (
          v_brand_norm = v_match_brand_norm
          or position(v_brand_norm in v_match_brand_norm) > 0
          or position(v_match_brand_norm in v_brand_norm) > 0
        );

      v_source_matches := v_source_norm <> ''
        and not exists (
          select 1
          from unnest(string_to_array(v_name_norm, ' ')) as token(value)
          where length(token.value) > 1
            and position(token.value in v_source_norm) = 0
        );

      if rec.enrichment_status is null then
        v_rejection_reason := 'enrichment_row_missing';
      elsif rec.enrichment_status <> 'needs_review' then
        v_rejection_reason := 'enrichment_status_not_needs_review';
      elsif coalesce(cardinality(rec.staged_notes), 0) = 0 then
        v_rejection_reason := 'staged_notes_missing';
      elsif coalesce(cardinality(v_before_notes), 0) > 0 then
        v_rejection_reason := 'canonical_notes_present';
      elsif coalesce(cardinality(v_before_accords), 0) = 0 then
        v_rejection_reason := 'canonical_accords_missing_use_full_promotion';
      elsif rec.match_name is null or btrim(rec.match_name) = '' then
        v_rejection_reason := 'match_name_missing';
      elsif rec.match_brand is null or btrim(rec.match_brand) = '' then
        v_rejection_reason := 'match_brand_missing';
      elsif rec.source_url is null or btrim(rec.source_url) = '' then
        v_rejection_reason := 'source_url_missing';
      elsif coalesce(rec.source_confidence, 0) < v_min_source_confidence then
        v_rejection_reason := 'source_confidence_below_minimum';
      elsif not v_name_matches then
        v_rejection_reason := 'match_name_conflicts_with_fragrance_name';
      elsif not v_brand_matches then
        v_rejection_reason := 'match_brand_conflicts_with_fragrance_brand';
      elsif not v_source_matches then
        v_rejection_reason := 'source_url_missing_fragrance_name_tokens';
      elsif p_refresh_after_promotion and not v_refresh_function_available then
        v_rejection_reason := 'refresh_function_unavailable';
      else
        v_should_promote := true;
        v_after_notes := coalesce(rec.staged_notes, '{}'::text[]);
        v_after_accords := v_before_accords;
      end if;

      if p_dry_run then
        if v_should_promote then
          v_result_status := 'eligible_preview';
          v_would_promote_count := v_would_promote_count + 1;
          if p_refresh_after_promotion then
            v_refresh_result := jsonb_build_object('status', 'would_refresh_after_notes_promotion');
          end if;
        else
          v_result_status := 'rejected';
          if p_refresh_after_promotion then
            v_refresh_result := jsonb_build_object(
              'status', 'skipped',
              'reason', 'notes_only_promotion_not_eligible'
            );
          end if;
        end if;
      elsif v_should_promote then
        update public.fragrances
        set
          notes = v_after_notes,
          updated_at = now()
        where id = rec.existing_fragrance_id
          and coalesce(cardinality(notes), 0) = 0
          and coalesce(cardinality(accords), 0) > 0
          and coalesce(accords, '{}'::text[]) = v_before_accords;

        if not found then
          v_result_status := 'rejected';
          v_rejection_reason := 'canonical_notes_write_precondition_failed';
          v_after_notes := v_before_notes;
          v_after_accords := v_before_accords;
        else
          update public.fragrance_text_enrichment
          set
            status = v_new_enrichment_status,
            last_error = null,
            updated_at = now()
          where fragrance_id = rec.existing_fragrance_id;

          if p_refresh_after_promotion then
            begin
              select public.refresh_fragrance_performance_features_v1(rec.existing_fragrance_id)
              into v_refresh_result;

              if coalesce(v_refresh_result ->> 'status', '') = 'completed' then
                v_refreshed_count := v_refreshed_count + 1;
              end if;
            exception
              when others then
                v_refresh_result := jsonb_build_object(
                  'status', 'error',
                  'error', sqlerrm
                );
            end;
          end if;

          insert into public.fragrance_text_enrichment_notes_promotions_v1 (
            fragrance_id,
            action,
            actor_label,
            reason,
            previous_enrichment_status,
            new_enrichment_status,
            source_url,
            source_confidence,
            match_name,
            match_brand,
            canonical_notes_before,
            canonical_accords_before,
            canonical_notes_after,
            canonical_accords_after,
            staged_notes,
            staged_accords,
            enrichment_snapshot,
            refresh_result,
            result_status,
            rejection_reason,
            function_version,
            promoted_at
          )
          values (
            rec.existing_fragrance_id,
            'promote_notes_only',
            v_actor_label,
            v_reason,
            rec.enrichment_status,
            v_new_enrichment_status,
            rec.source_url,
            rec.source_confidence,
            rec.match_name,
            rec.match_brand,
            v_before_notes,
            v_before_accords,
            v_after_notes,
            v_after_accords,
            coalesce(rec.staged_notes, '{}'::text[]),
            coalesce(rec.staged_accords, '{}'::text[]),
            jsonb_build_object(
              'provider', rec.provider,
              'proposed_family_key', rec.proposed_family_key,
              'concentration', rec.concentration,
              'provider_payload', coalesce(rec.provider_payload, '{}'::jsonb),
              'last_error_before_notes_promotion', rec.last_error,
              'last_enriched_at', rec.last_enriched_at,
              'enrichment_created_at', rec.enrichment_created_at,
              'enrichment_updated_at', rec.enrichment_updated_at,
              'normalized_fragrance_name', v_name_norm,
              'normalized_match_name', v_match_norm,
              'normalized_source_url', v_source_norm,
              'name_matches', v_name_matches,
              'brand_matches', v_brand_matches,
              'source_matches', v_source_matches
            ),
            coalesce(v_refresh_result, '{}'::jsonb),
            'notes_promoted',
            null,
            v_function_version,
            now()
          )
          returning id into v_audit_id;

          v_result_status := 'notes_promoted';
          v_promoted_count := v_promoted_count + 1;
        end if;
      else
        v_result_status := 'rejected';
      end if;

      if not p_dry_run and v_result_status = 'rejected' then
        insert into public.fragrance_text_enrichment_notes_promotions_v1 (
          fragrance_id,
          action,
          actor_label,
          reason,
          previous_enrichment_status,
          new_enrichment_status,
          source_url,
          source_confidence,
          match_name,
          match_brand,
          canonical_notes_before,
          canonical_accords_before,
          canonical_notes_after,
          canonical_accords_after,
          staged_notes,
          staged_accords,
          enrichment_snapshot,
          refresh_result,
          result_status,
          rejection_reason,
          function_version,
          promoted_at
        )
        values (
          rec.existing_fragrance_id,
          'promote_notes_only',
          v_actor_label,
          v_reason,
          rec.enrichment_status,
          null,
          rec.source_url,
          rec.source_confidence,
          rec.match_name,
          rec.match_brand,
          v_before_notes,
          v_before_accords,
          v_after_notes,
          v_after_accords,
          coalesce(rec.staged_notes, '{}'::text[]),
          coalesce(rec.staged_accords, '{}'::text[]),
          jsonb_build_object(
            'provider', rec.provider,
            'proposed_family_key', rec.proposed_family_key,
            'concentration', rec.concentration,
            'provider_payload', coalesce(rec.provider_payload, '{}'::jsonb),
            'last_error_before_notes_promotion', rec.last_error,
            'last_enriched_at', rec.last_enriched_at,
            'enrichment_created_at', rec.enrichment_created_at,
            'enrichment_updated_at', rec.enrichment_updated_at,
            'normalized_fragrance_name', v_name_norm,
            'normalized_match_name', v_match_norm,
            'normalized_source_url', v_source_norm,
            'name_matches', v_name_matches,
            'brand_matches', v_brand_matches,
            'source_matches', v_source_matches
          ),
          coalesce(v_refresh_result, '{}'::jsonb),
          'rejected',
          v_rejection_reason,
          v_function_version,
          null
        )
        returning id into v_audit_id;
      end if;
    end if;

    if v_result_status in ('invalid_id', 'missing_fragrance', 'rejected') then
      v_rejected_count := v_rejected_count + 1;
    end if;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'input_id', rec.input_id,
        'fragrance_id', coalesce(rec.existing_fragrance_id, rec.parsed_fragrance_id),
        'name', rec.name,
        'brand', rec.brand,
        'dry_run', p_dry_run,
        'actor_label', v_actor_label,
        'reason', v_reason,
        'previous_enrichment_status', rec.enrichment_status,
        'new_enrichment_status', case when v_should_promote then v_new_enrichment_status else null end,
        'source_url', rec.source_url,
        'source_confidence', rec.source_confidence,
        'match_name', rec.match_name,
        'match_brand', rec.match_brand,
        'normalized_fragrance_name', v_name_norm,
        'normalized_match_name', v_match_norm,
        'name_matches', v_name_matches,
        'brand_matches', v_brand_matches,
        'source_matches', v_source_matches,
        'canonical_notes_before_count', coalesce(cardinality(v_before_notes), 0),
        'canonical_accords_before_count', coalesce(cardinality(v_before_accords), 0),
        'canonical_notes_after_count', coalesce(cardinality(v_after_notes), 0),
        'canonical_accords_after_count', coalesce(cardinality(v_after_accords), 0),
        'staged_notes_count', coalesce(cardinality(rec.staged_notes), 0),
        'staged_accords_count', coalesce(cardinality(rec.staged_accords), 0),
        'canonical_accords_preserved',
          coalesce(v_before_accords, '{}'::text[]) = coalesce(v_after_accords, '{}'::text[]),
        'staged_accords_became_canonical',
          coalesce(rec.staged_accords, '{}'::text[]) = coalesce(v_after_accords, '{}'::text[])
          and coalesce(rec.staged_accords, '{}'::text[]) <> coalesce(v_before_accords, '{}'::text[]),
        'eligible_for_notes_only_promotion', v_should_promote,
        'result_status', v_result_status,
        'rejection_reason', v_rejection_reason,
        'would_refresh', p_refresh_after_promotion and v_should_promote,
        'refresh_result', coalesce(v_refresh_result, '{}'::jsonb),
        'audit_row_id', v_audit_id,
        'function_version', v_function_version
      )
    );
  end loop;

  return jsonb_build_object(
    'ok', v_rejected_count = 0,
    'dry_run', p_dry_run,
    'requested_count', v_requested_count,
    'distinct_requested_count', v_distinct_count,
    'picked', v_picked,
    'results_count', jsonb_array_length(v_results),
    'would_promote_count', v_would_promote_count,
    'promoted_count', v_promoted_count,
    'rejected_count', v_rejected_count,
    'refreshed_count', v_refreshed_count,
    'invalid_ids', to_jsonb(coalesce(v_invalid_ids, '{}'::text[])),
    'missing_ids', to_jsonb(coalesce(v_missing_ids, '{}'::text[])),
    'max_ids', v_max_ids,
    'refresh_after_promotion', p_refresh_after_promotion,
    'refresh_function_available', v_refresh_function_available,
    'scope_mode', 'explicit_ids',
    'function_version', v_function_version,
    'results', v_results
  );
end;
$function$;

revoke all on function public.promote_fragrance_text_enrichment_notes_only_v1(text[], text, text, boolean, boolean) from public;
revoke all on function public.promote_fragrance_text_enrichment_notes_only_v1(text[], text, text, boolean, boolean) from anon;
revoke all on function public.promote_fragrance_text_enrichment_notes_only_v1(text[], text, text, boolean, boolean) from authenticated;
grant execute on function public.promote_fragrance_text_enrichment_notes_only_v1(text[], text, text, boolean, boolean) to service_role;

notify pgrst, 'reload schema';
