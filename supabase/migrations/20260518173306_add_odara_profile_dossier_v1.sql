create or replace function public.get_odara_profile_dossier_v1(
  p_user_id uuid default null,
  p_surface text default 'signed_in'::text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_surface text := case
    when lower(coalesce(nullif(p_surface, ''), 'signed_in')) = 'guest' then 'guest'
    else 'signed_in'
  end;
  v_auth_user uuid := auth.uid();
  v_user_id uuid := coalesce(p_user_id, v_auth_user);
  v_display_name text;
  v_initials text;
  v_payload jsonb := '{}'::jsonb;
begin
  if v_surface = 'signed_in' then
    if v_user_id is null then
      raise exception 'Signed-in dossier requires p_user_id or auth.uid().';
    end if;

    if not (
      auth.role() = 'service_role'
      or session_user = 'postgres'
      or (v_auth_user is not null and v_user_id = v_auth_user)
    ) then
      raise exception 'Access denied: p_user_id must match auth.uid() for signed-in dossier.';
    end if;

    v_display_name := coalesce(
      nullif(auth.jwt() #>> '{user_metadata,full_name}', ''),
      nullif(auth.jwt() #>> '{user_metadata,name}', ''),
      nullif(split_part(coalesce(auth.jwt()->>'email', ''), '@', 1), ''),
      'Signed in'
    );
    v_initials := upper(left(regexp_replace(v_display_name, '[^[:alnum:]]', '', 'g'), 2));

    with collection as (
      select
        item.representative_fragrance_id as fragrance_id,
        coalesce(item.representative_family_key, f.family_key) as family_key,
        coalesce(f.notes, '{}'::text[]) as notes,
        coalesce(f.accords, '{}'::text[]) as accords,
        item.effective_status,
        item.has_signature,
        item.has_owned
      from public.user_collection_effective_items_v2 item
      left join public.fragrances f
        on f.id = item.representative_fragrance_id
      where item.user_id = v_user_id
        and (item.has_owned or item.has_signature)
    ),
    collection_stats as (
      select
        count(*) as bottle_count,
        count(*) filter (where family_key is not null and family_key <> 'unknown') as classified_bottle_count,
        count(*) filter (where has_signature or effective_status = 'signature') as signature_count
      from collection
    ),
    family_counts as (
      select
        family_key,
        count(*) as cnt
      from collection
      where family_key is not null
        and family_key <> 'unknown'
      group by 1
      order by count(*) desc, family_key
    ),
    family_summary as (
      select
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'family_key', fc.family_key,
              'label', initcap(replace(fc.family_key, '-', ' ')),
              'count', fc.cnt,
              'pct', case
                when cs.classified_bottle_count > 0 then round((fc.cnt::numeric / cs.classified_bottle_count::numeric) * 100.0)
                else 0
              end
            )
            order by fc.cnt desc, fc.family_key
          ) filter (where fc.family_key is not null),
          '[]'::jsonb
        ) as family_counts,
        (select fc.family_key from family_counts fc order by fc.cnt desc, fc.family_key limit 1) as dominant_family_key,
        (select fc.cnt from family_counts fc order by fc.cnt desc, fc.family_key limit 1) as dominant_family_count
      from collection_stats cs
      left join family_counts fc
        on true
    ),
    taste as (
      select *
      from public.user_taste_profiles_v1
      where user_id = v_user_id
      limit 1
    ),
    saved as (
      select
        (select count(*) from public.saved_layers sl where sl.user_id = v_user_id) as saved_layers_count,
        (select count(*) from public.saved_layer_combos slc where slc.user_id = v_user_id) as saved_combo_count,
        (select count(*) from public.saved_recipes sr where sr.user_id = v_user_id) as saved_recipe_count
    ),
    history as (
      select
        (select count(*) from public.wear_events we where we.user_id = v_user_id) as wear_count,
        (select count(*) from public.user_scent_decision_events se where se.user_id = v_user_id) as decision_count,
        (select count(*) from public.user_wear_trials uwt where uwt.user_id = v_user_id) as wear_trial_count
    ),
    context_summary as (
      select
        coalesce(sum(cnt) filter (where context in ('daily', 'work')), 0) as day_count,
        coalesce(sum(cnt) filter (where context in ('hangout', 'date')), 0) as night_count,
        coalesce(sum(cnt), 0) as total_count
      from (
        select context, count(*) as cnt
        from public.wear_events
        where user_id = v_user_id
        group by 1
      ) ctx
    ),
    repeat_summary as (
      select coalesce(max(cnt), 0) as top_repeat_count
      from (
        select fragrance_id, count(*) as cnt
        from public.wear_events
        where user_id = v_user_id
        group by 1
      ) repeats
    ),
    layer_usage as (
      select count(*) as layer_memory_count
      from public.odara_signed_in_day_memory dm
      where dm.user_id = v_user_id
        and (
          dm.state_json->'lockedLayerCard' is not null
          or dm.state_json->'manualLayerCard' is not null
        )
    ),
    signed_in_payload as (
      select jsonb_build_object(
        'profile_contract_version', 'profile_dossier_v1',
        'surface_type', 'signed_in',
        'computed_at', now(),
        'profile_identity', jsonb_build_object(
          'display_name', v_display_name,
          'initials', coalesce(nullif(v_initials, ''), 'OD'),
          'status_label', 'Signed in'
        ),
        'collection_summary', jsonb_build_object(
          'bottle_count', cs.bottle_count,
          'source', 'user_collection_effective_items_v2',
          'enough_data', (cs.bottle_count > 0),
          'empty_reason', case
            when cs.bottle_count > 0 then null
            else 'No owned bottles yet.'
          end
        ),
        'family_balance', jsonb_build_object(
          'dominant_family', case
            when fs.dominant_family_key is not null then initcap(replace(fs.dominant_family_key, '-', ' '))
            else null
          end,
          'dominant_family_key', fs.dominant_family_key,
          'family_counts', fs.family_counts,
          'coverage_copy', case
            when cs.classified_bottle_count > 0 and fs.dominant_family_key is not null then
              format(
                'Strongest lane: %s (%s of %s classified bottles).',
                initcap(replace(fs.dominant_family_key, '-', ' ')),
                fs.dominant_family_count,
                cs.classified_bottle_count
              )
            when cs.bottle_count > 0 then
              'Collection is real, but family labeling is still thin.'
            else
              'No collection coverage yet.'
          end,
          'enough_data', (cs.classified_bottle_count > 0),
          'empty_reason', case
            when cs.bottle_count = 0 then 'Add real bottles to see family balance.'
            when cs.classified_bottle_count = 0 then 'Not enough labeled family metadata yet.'
            else null
          end
        ),
        'insights', jsonb_build_object(
          'lean', jsonb_build_object(
            'value', case
              when t.user_id is null then null
              when t.bright_dark <= 0.45 then 'Bright / airy'
              when t.bright_dark >= 0.55 then 'Dark / rich'
              else 'Balanced'
            end,
            'confidence', case
              when t.user_id is null then 'low'
              when coalesce(t.interaction_count, 0) >= 8 then 'high'
              when coalesce(t.interaction_count, 0) >= 1 then 'medium'
              else 'low'
            end,
            'source', case when t.user_id is null then null else 'user_taste_profiles_v1.bright_dark' end,
            'empty_reason', case
              when t.user_id is null then 'Not enough real taste signal yet.'
              else null
            end
          ),
          'texture', jsonb_build_object(
            'value', case
              when t.user_id is null then null
              when t.smooth_textured <= 0.45 then 'Smooth'
              when t.smooth_textured >= 0.55 then 'Textured'
              else 'Balanced'
            end,
            'confidence', case
              when t.user_id is null then 'low'
              when coalesce(t.interaction_count, 0) >= 8 then 'high'
              when coalesce(t.interaction_count, 0) >= 1 then 'medium'
              else 'low'
            end,
            'source', case when t.user_id is null then null else 'user_taste_profiles_v1.smooth_textured' end,
            'empty_reason', case
              when t.user_id is null then 'Not enough real texture signal yet.'
              else null
            end
          ),
          'dominant_family', jsonb_build_object(
            'value', case
              when fs.dominant_family_key is not null then initcap(replace(fs.dominant_family_key, '-', ' '))
              else null
            end,
            'confidence', case when fs.dominant_family_key is not null then 'medium' else 'low' end,
            'source', case when fs.dominant_family_key is not null then 'user_collection_effective_items_v2 + fragrances.family_key' else null end,
            'empty_reason', case
              when cs.bottle_count = 0 then 'No collection signal yet.'
              when fs.dominant_family_key is null then 'Not enough labeled family metadata yet.'
              else null
            end
          ),
          'layering', jsonb_build_object(
            'value', case
              when (sv.saved_layers_count + sv.saved_combo_count) >= 3 or lu.layer_memory_count >= 8 then 'Active'
              when (sv.saved_layers_count + sv.saved_combo_count) > 0 or lu.layer_memory_count > 0 then 'Emerging'
              else null
            end,
            'confidence', case
              when (sv.saved_layers_count + sv.saved_combo_count) >= 3 or lu.layer_memory_count >= 8 then 'medium'
              when (sv.saved_layers_count + sv.saved_combo_count) > 0 or lu.layer_memory_count > 0 then 'low'
              else 'low'
            end,
            'source', case
              when (sv.saved_layers_count + sv.saved_combo_count) > 0 or lu.layer_memory_count > 0 then 'saved_layer_combos + saved_layers + odara_signed_in_day_memory'
              else null
            end,
            'empty_reason', case
              when (sv.saved_layers_count + sv.saved_combo_count) > 0 or lu.layer_memory_count > 0 then null
              else 'No real layer activity yet.'
            end
          ),
          'day_night', jsonb_build_object(
            'value', case
              when hs.wear_count + hs.decision_count + hs.wear_trial_count < 3 then null
              when ctx.day_count >= greatest(ctx.night_count * 2, 4) then 'Day-leaning'
              when ctx.night_count >= greatest(ctx.day_count * 2, 4) then 'Night-leaning'
              else 'Balanced'
            end,
            'confidence', case
              when hs.wear_count + hs.decision_count + hs.wear_trial_count >= 10 then 'high'
              when hs.wear_count + hs.decision_count + hs.wear_trial_count >= 3 then 'medium'
              else 'low'
            end,
            'source', case
              when hs.wear_count + hs.decision_count + hs.wear_trial_count >= 3 then 'wear_events.context'
              else null
            end,
            'empty_reason', case
              when hs.wear_count + hs.decision_count + hs.wear_trial_count >= 3 then null
              else 'Not enough real day/night wear history yet.'
            end
          ),
          'signature_gravity', jsonb_build_object(
            'value', case
              when cs.bottle_count = 0 then null
              when cs.signature_count >= 3 or rs.top_repeat_count >= 6 then 'High'
              when cs.signature_count >= 1 or rs.top_repeat_count >= 3 then 'Defined'
              else 'Open rotation'
            end,
            'confidence', case
              when cs.signature_count >= 3 or rs.top_repeat_count >= 6 then 'medium'
              when cs.signature_count >= 1 or rs.top_repeat_count >= 3 then 'low'
              when cs.bottle_count > 0 then 'low'
              else 'low'
            end,
            'source', case
              when cs.bottle_count > 0 then 'user_collection_effective_items_v2 + wear_events'
              else null
            end,
            'empty_reason', case
              when cs.bottle_count > 0 then null
              else 'No repeat-wear or signature signal yet.'
            end
          )
        ),
        'library', jsonb_build_object(
          'collection_count', cs.bottle_count,
          'saved_count', sv.saved_layers_count + sv.saved_combo_count + sv.saved_recipe_count,
          'history_count', hs.wear_count + hs.decision_count + hs.wear_trial_count,
          'recipes_count', sv.saved_recipe_count,
          'saved_empty_reason', case
            when (sv.saved_layers_count + sv.saved_combo_count + sv.saved_recipe_count) > 0 then null
            else 'No real saved items yet.'
          end,
          'history_empty_reason', case
            when (hs.wear_count + hs.decision_count + hs.wear_trial_count) > 0 then null
            else 'No real scent history yet.'
          end
        ),
        'data_quality', jsonb_build_object(
          'has_collection', (cs.bottle_count > 0),
          'has_history', ((hs.wear_count + hs.decision_count + hs.wear_trial_count) > 0),
          'has_wear_trials', (hs.wear_trial_count > 0),
          'has_saved', ((sv.saved_layers_count + sv.saved_combo_count + sv.saved_recipe_count) > 0),
          'has_guest_collection', false
        )
      ) as payload
      from collection_stats cs
      cross join family_summary fs
      left join taste t on true
      cross join saved sv
      cross join history hs
      cross join context_summary ctx
      cross join repeat_summary rs
      cross join layer_usage lu
    )
    select payload
    into v_payload
    from signed_in_payload;

    return v_payload;
  end if;

  with guest_bottles as (
    select distinct on (
      coalesce(
        gb.fragrance_id::text,
        gb.style_key || '|' || lower(gb.bottle_name) || '|' || lower(gb.bottle_brand)
      )
    )
      coalesce(
        gb.fragrance_id::text,
        gb.style_key || '|' || lower(gb.bottle_name) || '|' || lower(gb.bottle_brand)
      ) as bottle_key,
      gb.fragrance_id,
      gb.style_key,
      gb.bottle_role,
      coalesce(f.family_key, gb.family_label_override, gsw.canonical_family_key, 'unknown') as family_key,
      coalesce(f.notes, '{}'::text[]) as notes,
      coalesce(f.accords, '{}'::text[]) as accords
    from public.guest_style_world_bottles gb
    left join public.fragrances f
      on f.id = gb.fragrance_id
    left join public.guest_style_worlds gsw
      on gsw.style_key = gb.style_key
    where gb.is_active
    order by
      coalesce(
        gb.fragrance_id::text,
        gb.style_key || '|' || lower(gb.bottle_name) || '|' || lower(gb.bottle_brand)
      ),
      gb.display_rank
  ),
  guest_stats as (
    select
      count(*) as bottle_count,
      count(*) filter (where family_key is not null and family_key <> 'unknown') as classified_bottle_count
    from guest_bottles
  ),
  guest_family_counts as (
    select
      family_key,
      count(*) as cnt
    from guest_bottles
    where family_key is not null
      and family_key <> 'unknown'
    group by 1
    order by count(*) desc, family_key
  ),
  guest_family_summary as (
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'family_key', gfc.family_key,
            'label', initcap(replace(gfc.family_key, '-', ' ')),
            'count', gfc.cnt,
            'pct', case
              when gs.classified_bottle_count > 0 then round((gfc.cnt::numeric / gs.classified_bottle_count::numeric) * 100.0)
              else 0
            end
          )
          order by gfc.cnt desc, gfc.family_key
        ) filter (where gfc.family_key is not null),
        '[]'::jsonb
      ) as family_counts,
      (select gfc.family_key from guest_family_counts gfc order by gfc.cnt desc, gfc.family_key limit 1) as dominant_family_key,
      (select gfc.cnt from guest_family_counts gfc order by gfc.cnt desc, gfc.family_key limit 1) as dominant_family_count
    from guest_stats gs
    left join guest_family_counts gfc
      on true
  ),
  guest_role_summary as (
    select
      count(*) filter (where role_bucket <> 'hero') as layer_role_count,
      count(*) filter (where role_bucket = 'mode') as mode_role_count,
      count(*) filter (where role_bucket = 'alternate') as alternate_role_count
    from public.guest_style_role_matrix_v1
  ),
  guest_family_signal as (
    select
      coalesce(sum(cnt) filter (where family_key in ('citrus-cologne', 'fresh-blue', 'woody-clean')), 0) as bright_family_count,
      coalesce(sum(cnt) filter (where family_key in ('oud-amber', 'sweet-gourmand', 'dark-leather', 'tobacco-boozy')), 0) as rich_family_count,
      coalesce(sum(cnt) filter (where family_key in ('woody-clean', 'fresh-blue', 'sweet-gourmand')), 0) as smooth_family_count,
      coalesce(sum(cnt) filter (where family_key in ('dark-leather', 'oud-amber', 'tobacco-boozy')), 0) as textured_family_count,
      coalesce(sum(cnt) filter (where family_key in ('citrus-cologne', 'fresh-blue', 'woody-clean')), 0) as day_family_count,
      coalesce(sum(cnt) filter (where family_key in ('dark-leather', 'oud-amber', 'tobacco-boozy', 'sweet-gourmand')), 0) as night_family_count
    from guest_family_counts
  ),
  guest_accord_signal as (
    select
      coalesce(sum(cnt) filter (where accord ~* '(citrus|fresh|clean|aromatic|aquatic|soapy)'), 0) as bright_accord_count,
      coalesce(sum(cnt) filter (where accord ~* '(amber|oud|gourmand|vanilla|leather|smoky|boozy|sweet)'), 0) as rich_accord_count,
      coalesce(sum(cnt) filter (where accord ~* '(musk|powdery|creamy|vanilla|soft|iris)'), 0) as smooth_accord_count,
      coalesce(sum(cnt) filter (where accord ~* '(spicy|leather|smoky|woody|oud|green|earthy|resinous|tobacco)'), 0) as textured_accord_count
    from (
      select lower(trim(value)) as accord, count(*) as cnt
      from guest_bottles gb
      cross join lateral unnest(gb.accords) value
      where trim(value) <> ''
      group by 1
    ) guest_accords
  ),
  guest_payload as (
    select jsonb_build_object(
      'profile_contract_version', 'profile_dossier_v1',
      'surface_type', 'guest',
      'computed_at', now(),
      'profile_identity', jsonb_build_object(
        'display_name', 'Guest Preview',
        'initials', 'GP',
        'status_label', 'Demo wardrobe'
      ),
      'collection_summary', jsonb_build_object(
        'bottle_count', gs.bottle_count,
        'source', 'guest_style_world_bottles',
        'enough_data', (gs.bottle_count > 0),
        'empty_reason', case
          when gs.bottle_count > 0 then null
          else 'Guest demo wardrobe is empty.'
        end
      ),
      'family_balance', jsonb_build_object(
        'dominant_family', case
          when gfs.dominant_family_key is not null then initcap(replace(gfs.dominant_family_key, '-', ' '))
          else null
        end,
        'dominant_family_key', gfs.dominant_family_key,
        'family_counts', gfs.family_counts,
        'coverage_copy', case
          when gs.classified_bottle_count > 0 and gfs.dominant_family_key is not null then
            format(
              'Guest preview spans %s real demo bottles, led by %s.',
              gs.bottle_count,
              initcap(replace(gfs.dominant_family_key, '-', ' '))
            )
          when gs.bottle_count > 0 then
            'Guest preview is real, but some bottles are still waiting on catalog binding.'
          else
            'Guest preview has no active bottles.'
        end,
        'enough_data', (gs.classified_bottle_count > 0),
        'empty_reason', case
          when gs.bottle_count = 0 then 'Guest preview has no active collection.'
          when gs.classified_bottle_count = 0 then 'Not enough guest family labeling yet.'
          else null
        end
      ),
      'insights', jsonb_build_object(
        'lean', jsonb_build_object(
          'value', case
            when gs.bottle_count = 0 then null
            when (gsig.bright_family_count + gasig.bright_accord_count) >= (gsig.rich_family_count + gasig.rich_accord_count) * 1.2 then 'Bright / fresh'
            when (gsig.rich_family_count + gasig.rich_accord_count) >= (gsig.bright_family_count + gasig.bright_accord_count) * 1.2 then 'Rich / deep'
            else 'Balanced'
          end,
          'confidence', case when gs.bottle_count > 0 then 'low' else 'low' end,
          'source', case when gs.bottle_count > 0 then 'guest_style_world_bottles + fragrances.accords' else null end,
          'empty_reason', case
            when gs.bottle_count > 0 then null
            else 'Guest preview needs a real demo wardrobe first.'
          end
        ),
        'texture', jsonb_build_object(
          'value', case
            when gs.bottle_count = 0 then null
            when (gsig.textured_family_count + gasig.textured_accord_count) >= (gsig.smooth_family_count + gasig.smooth_accord_count) * 1.2 then 'Textured'
            when (gsig.smooth_family_count + gasig.smooth_accord_count) >= (gsig.textured_family_count + gasig.textured_accord_count) * 1.2 then 'Smooth'
            else 'Balanced'
          end,
          'confidence', case when gs.bottle_count > 0 then 'low' else 'low' end,
          'source', case when gs.bottle_count > 0 then 'guest_style_world_bottles + fragrances.accords' else null end,
          'empty_reason', case
            when gs.bottle_count > 0 then null
            else 'Not enough guest texture signal yet.'
          end
        ),
        'dominant_family', jsonb_build_object(
          'value', case
            when gfs.dominant_family_key is not null then initcap(replace(gfs.dominant_family_key, '-', ' '))
            else null
          end,
          'confidence', case when gfs.dominant_family_key is not null then 'medium' else 'low' end,
          'source', case when gfs.dominant_family_key is not null then 'guest_style_world_bottles.family_label_override + fragrances.family_key' else null end,
          'empty_reason', case
            when gs.bottle_count = 0 then 'No guest wardrobe signal yet.'
            when gfs.dominant_family_key is null then 'Not enough guest family labeling yet.'
            else null
          end
        ),
        'layering', jsonb_build_object(
          'value', case
            when grs.layer_role_count > 0 then 'Layer-ready'
            else null
          end,
          'confidence', case when grs.layer_role_count > 0 then 'medium' else 'low' end,
          'source', case when grs.layer_role_count > 0 then 'guest_style_role_matrix_v1.role_bucket' else null end,
          'empty_reason', case
            when grs.layer_role_count > 0 then null
            else 'Guest preview has no layer structure yet.'
          end
        ),
        'day_night', jsonb_build_object(
          'value', case
            when gsig.day_family_count > 0 and gsig.night_family_count > 0 then 'Day-to-night range'
            when gsig.day_family_count > 0 and gsig.night_family_count = 0 then 'Day-leaning'
            when gsig.night_family_count > 0 and gsig.day_family_count = 0 then 'Night-leaning'
            else null
          end,
          'confidence', case
            when gsig.day_family_count > 0 or gsig.night_family_count > 0 then 'low'
            else 'low'
          end,
          'source', case
            when gsig.day_family_count > 0 or gsig.night_family_count > 0 then 'guest_style_world_bottles family mix'
            else null
          end,
          'empty_reason', case
            when gsig.day_family_count > 0 or gsig.night_family_count > 0 then null
            else 'Guest preview has no real day/night range signal yet.'
          end
        ),
        'signature_gravity', jsonb_build_object(
          'value', null,
          'confidence', 'low',
          'source', null,
          'empty_reason', 'Guest preview has no repeat-wear signal yet.'
        )
      ),
      'library', jsonb_build_object(
        'collection_count', gs.bottle_count,
        'saved_count', 0,
        'history_count', 0,
        'recipes_count', 0,
        'saved_empty_reason', 'Guest preview does not carry real saved items.',
        'history_empty_reason', 'Guest preview has no real scent history yet.'
      ),
      'data_quality', jsonb_build_object(
        'has_collection', false,
        'has_history', false,
        'has_wear_trials', false,
        'has_saved', false,
        'has_guest_collection', (gs.bottle_count > 0)
      )
    ) as payload
    from guest_stats gs
    cross join guest_family_summary gfs
    cross join guest_role_summary grs
    cross join guest_family_signal gsig
    cross join guest_accord_signal gasig
  )
  select payload
  into v_payload
  from guest_payload;

  return v_payload;
end;
$function$;

grant execute on function public.get_odara_profile_dossier_v1(uuid, text) to anon, authenticated, service_role;
