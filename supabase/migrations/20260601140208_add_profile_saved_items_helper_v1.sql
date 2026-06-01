create or replace function public.get_odara_profile_saved_items_v1(
  p_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_auth_user uuid := auth.uid();
  v_user_id uuid := coalesce(p_user_id, v_auth_user);
begin
  if v_user_id is null then
    raise exception 'Signed-in saved items require p_user_id or auth.uid().';
  end if;

  if not (
    auth.role() = 'service_role'
    or session_user = 'postgres'
    or (v_auth_user is not null and v_user_id = v_auth_user)
  ) then
    raise exception 'Access denied: p_user_id must match auth.uid().';
  end if;

  return jsonb_build_object(
    'saved_item_contract_version', 'profile_saved_items_v1',
    'items', coalesce(
      (
        with saved_recipe_items as (
          select jsonb_build_object(
            'item_kind', 'saved_recipe',
            'item_id', sr.id,
            'title', coalesce(nullif(sr.today_pick->>'name', ''), 'Saved recipe'),
            'subtitle', coalesce(nullif(sr.context, ''), 'Saved recipe'),
            'created_at', sr.created_at,
            'updated_at', sr.updated_at,
            'wear_date', sr.wear_date,
            'context_key', sr.context,
            'ratio_a', null,
            'ratio_b', null,
            'application_style', null,
            'notes', nullif(sr.full_payload->>'why_it_works', ''),
            'liked', null,
            'main_fragrance_id', coalesce(
              nullif(sr.today_pick->>'fragrance_id', ''),
              nullif(sr.layer->>'anchor_id', '')
            ),
            'layer_fragrance_id', coalesce(
              nullif(sr.layer->>'top_id', ''),
              nullif(sr.layer->>'fragrance_id', '')
            ),
            'main_name', coalesce(
              nullif(sr.today_pick->>'name', ''),
              nullif(sr.layer->>'anchor', '')
            ),
            'layer_name', coalesce(
              nullif(sr.layer->>'top', ''),
              nullif(sr.layer->>'name', '')
            ),
            'main_brand', nullif(sr.today_pick->>'brand', ''),
            'layer_brand', null,
            'mode', nullif(sr.layer->>'mode', ''),
            'source_table', 'saved_recipes'
          ) as item,
          coalesce(sr.updated_at, sr.created_at) as sort_ts
          from public.saved_recipes sr
          where sr.user_id = v_user_id
        ),
        saved_combo_items as (
          select jsonb_build_object(
            'item_kind', 'saved_layer_combo',
            'item_id', slc.id,
            'title', coalesce(nullif(slc.combo_title, ''), 'Saved combo'),
            'subtitle', 'Saved combo',
            'created_at', slc.created_at,
            'updated_at', slc.updated_at,
            'wear_date', null,
            'context_key', null,
            'ratio_a', slc.ratio_a,
            'ratio_b', slc.ratio_b,
            'application_style', null,
            'notes', null,
            'liked', null,
            'main_fragrance_id', slc.fragrance_a,
            'layer_fragrance_id', slc.fragrance_b,
            'main_name', fa.name,
            'layer_name', fb.name,
            'main_brand', fa.brand,
            'layer_brand', fb.brand,
            'mode', null,
            'source_table', 'saved_layer_combos'
          ) as item,
          coalesce(slc.updated_at, slc.created_at) as sort_ts
          from public.saved_layer_combos slc
          left join public.fragrances fa on fa.id = slc.fragrance_a
          left join public.fragrances fb on fb.id = slc.fragrance_b
          where slc.user_id = v_user_id
        ),
        saved_layer_items as (
          select jsonb_build_object(
            'item_kind', 'saved_layer',
            'item_id', sl.id,
            'title', coalesce(
              nullif(sl.notes, ''),
              case
                when fa.name is not null and fb.name is not null then fa.name || ' + ' || fb.name
                else 'Saved layer'
              end
            ),
            'subtitle', coalesce(nullif(sl.application_style, ''), 'Saved layer'),
            'created_at', sl.created_at,
            'updated_at', sl.updated_at,
            'wear_date', null,
            'context_key', null,
            'ratio_a', sl.ratio_a,
            'ratio_b', sl.ratio_b,
            'application_style', sl.application_style,
            'notes', sl.notes,
            'liked', sl.liked,
            'main_fragrance_id', sl.fragrance_a,
            'layer_fragrance_id', sl.fragrance_b,
            'main_name', fa.name,
            'layer_name', fb.name,
            'main_brand', fa.brand,
            'layer_brand', fb.brand,
            'mode', null,
            'source_table', 'saved_layers'
          ) as item,
          coalesce(sl.updated_at, sl.created_at) as sort_ts
          from public.saved_layers sl
          left join public.fragrances fa on fa.id = sl.fragrance_a
          left join public.fragrances fb on fb.id = sl.fragrance_b
          where sl.user_id = v_user_id
        ),
        saved_union as (
          select * from saved_recipe_items
          union all
          select * from saved_combo_items
          union all
          select * from saved_layer_items
        )
        select jsonb_agg(item order by sort_ts desc nulls last)
        from saved_union
      ),
      '[]'::jsonb
    )
  );
end;
$function$;

revoke all on function public.get_odara_profile_saved_items_v1(uuid) from public, anon, authenticated;
grant execute on function public.get_odara_profile_saved_items_v1(uuid) to authenticated, service_role;
