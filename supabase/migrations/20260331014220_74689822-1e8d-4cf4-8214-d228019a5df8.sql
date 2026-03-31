
CREATE OR REPLACE FUNCTION public.get_todays_oracle_v3(
  p_user_id uuid,
  p_temperature numeric,
  p_context text,
  p_brand text default null::text,
  p_wear_date text default null::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare
  v_wear_date date;
  v_main_row record;
  v_layer_row record;
  v_has_layer boolean := false;
  v_alternates jsonb;
  v_reason text;
begin
  v_wear_date := coalesce(nullif(p_wear_date, '')::date, current_date);

  select f.*
  into v_main_row
  from public.fragrances f
  order by md5(
    coalesce(p_user_id::text,'') || '|' ||
    coalesce(p_context,'') || '|' ||
    v_wear_date::text || '|' ||
    f.id::text
  )
  limit 1;

  select f.*
  into v_layer_row
  from public.fragrances f
  where f.id <> v_main_row.id
    and f.family_key is not null
    and f.family_key <> v_main_row.family_key
  order by md5(
    coalesce(p_user_id::text,'') || '|' ||
    coalesce(p_context,'') || '|' ||
    v_wear_date::text || '|layer|' ||
    f.id::text
  )
  limit 1;

  v_has_layer := found;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'fragrance_id', f.id,
        'name', f.name,
        'family', f.family_key,
        'reason', coalesce(f.brand, '')
      )
    ),
    '[]'::jsonb
  )
  into v_alternates
  from (
    select f.*
    from public.fragrances f
    where f.id <> v_main_row.id
      and (not v_has_layer or f.id <> v_layer_row.id)
    order by md5(
      coalesce(p_user_id::text,'') || '|' ||
      coalesce(p_context,'') || '|' ||
      v_wear_date::text || '|alt|' ||
      f.id::text
    )
    limit 3
  ) f;

  case p_context
    when 'work' then v_reason := 'Clean and controlled — stays professional.';
    when 'date' then v_reason := 'Rich and magnetic — pulls people in.';
    when 'hangout' then v_reason := 'Relaxed and effortless — easy to wear.';
    else v_reason := 'Balanced for the day — works anywhere.';
  end case;

  return jsonb_build_object(
    'today_pick', jsonb_build_object(
      'fragrance_id', v_main_row.id,
      'name', v_main_row.name,
      'family', coalesce(v_main_row.family_key, ''),
      'reason', v_reason,
      'brand', coalesce(v_main_row.brand, ''),
      'notes', coalesce(v_main_row.notes, array[]::text[]),
      'accords', coalesce(v_main_row.accords, array[]::text[])
    ),
    'layer',
      case
        when v_has_layer then jsonb_build_object(
          'fragrance_id', v_layer_row.id,
          'name', v_layer_row.name,
          'family', coalesce(v_layer_row.family_key, ''),
          'brand', coalesce(v_layer_row.brand, ''),
          'notes', coalesce(v_layer_row.notes, array[]::text[]),
          'accords', coalesce(v_layer_row.accords, array[]::text[]),
          'reason',
            case
              when v_main_row.family_key = 'oud-amber' and v_layer_row.family_key = 'woody-clean' then 'Adds structure and lift.'
              when v_main_row.family_key = 'oud-amber' and v_layer_row.family_key = 'sweet-gourmand' then 'Softens the resinous edge with warmth.'
              when v_main_row.family_key = 'woody-clean' and v_layer_row.family_key = 'fresh-blue' then 'Adds air and clarity.'
              when v_main_row.family_key = 'fresh-blue' and v_layer_row.family_key = 'woody-clean' then 'Gives the freshness more backbone.'
              when v_main_row.family_key = 'sweet-gourmand' and v_layer_row.family_key = 'oud-amber' then 'Adds depth and darkness.'
              when v_main_row.family_key = 'tobacco-boozy' and v_layer_row.family_key = 'sweet-gourmand' then 'Rounds the smoke with sweetness.'
              when v_main_row.family_key = 'dark-leather' and v_layer_row.family_key = 'tobacco-boozy' then 'Makes the leather feel richer and more wearable.'
              else 'Creates contrast without clashing.'
            end
        )
        else null
      end,
    'alternates', coalesce(v_alternates, '[]'::jsonb)
  );
end;
$function$;
