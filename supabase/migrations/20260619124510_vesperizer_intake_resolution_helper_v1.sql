begin;

create or replace function public.resolve_fragrance_intake_request_v1(
  p_request_id uuid,
  p_canonical_fragrance_id uuid,
  p_actor_label text,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_label text := nullif(btrim(p_actor_label), '');
  v_request public.fragrance_intake_requests_v1%rowtype;
  v_updated public.fragrance_intake_requests_v1%rowtype;
  v_canonical public.fragrances%rowtype;
begin
  if p_request_id is null then
    raise exception 'p_request_id is required.';
  end if;

  if p_canonical_fragrance_id is null then
    raise exception 'p_canonical_fragrance_id is required.';
  end if;

  if v_actor_label is null or length(v_actor_label) > 120 then
    raise exception 'p_actor_label is required and must be 120 characters or less.';
  end if;

  if p_dry_run then
    select r.*
    into v_request
    from public.fragrance_intake_requests_v1 r
    where r.id = p_request_id;
  else
    select r.*
    into v_request
    from public.fragrance_intake_requests_v1 r
    where r.id = p_request_id
    for update;
  end if;

  if v_request.id is null then
    raise exception 'intake request not found.';
  end if;

  select f.*
  into v_canonical
  from public.fragrances f
  where f.id = p_canonical_fragrance_id;

  if v_canonical.id is null then
    raise exception 'canonical fragrance not found.';
  end if;

  if v_request.canonical_fragrance_id is not null then
    if v_request.canonical_fragrance_id = p_canonical_fragrance_id
      and v_request.request_status in ('matched_existing', 'canonical_created', 'resolved') then
      return jsonb_build_object(
        'dry_run', p_dry_run,
        'status', 'skipped_already_linked',
        'request_id', v_request.id,
        'canonical_fragrance_id', v_request.canonical_fragrance_id,
        'request_status', v_request.request_status,
        'desired_status', v_request.desired_status,
        'desired_status_application', 'not_applied_in_v1',
        'limited_intel', v_request.limited_intel,
        'actor_label', v_actor_label
      );
    end if;

    raise exception 'intake request is already linked to a different canonical fragrance.';
  end if;

  if v_request.request_status not in ('pending', 'searching', 'needs_review') then
    raise exception 'intake request status is not resolvable in V1.';
  end if;

  if p_dry_run then
    return jsonb_build_object(
      'dry_run', true,
      'status', 'would_link',
      'request_id', v_request.id,
      'submitted_name', v_request.submitted_name,
      'submitted_brand', v_request.submitted_brand,
      'desired_status', v_request.desired_status,
      'desired_status_application', 'not_applied_in_v1',
      'current_request_status', v_request.request_status,
      'canonical_fragrance_id', v_canonical.id,
      'canonical_name', v_canonical.name,
      'canonical_brand', v_canonical.brand,
      'limited_intel', v_request.limited_intel,
      'actor_label', v_actor_label
    );
  end if;

  update public.fragrance_intake_requests_v1 r
  set
    canonical_fragrance_id = p_canonical_fragrance_id,
    request_status = 'matched_existing',
    resolved_at = now()
  where r.id = p_request_id
    and r.canonical_fragrance_id is null
    and r.request_status in ('pending', 'searching', 'needs_review')
  returning *
  into v_updated;

  if v_updated.id is null then
    raise exception 'intake request could not be linked; it may have changed concurrently.';
  end if;

  return jsonb_build_object(
    'dry_run', false,
    'status', 'linked_existing_canonical',
    'request_id', v_updated.id,
    'canonical_fragrance_id', v_updated.canonical_fragrance_id,
    'request_status', v_updated.request_status,
    'desired_status', v_updated.desired_status,
    'desired_status_application', 'not_applied_in_v1',
    'limited_intel', v_updated.limited_intel,
    'resolved_at', v_updated.resolved_at,
    'actor_label', v_actor_label
  );
end;
$$;

revoke all on function public.resolve_fragrance_intake_request_v1(uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.resolve_fragrance_intake_request_v1(uuid, uuid, text, boolean)
  to service_role;

commit;
