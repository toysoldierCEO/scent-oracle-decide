
CREATE OR REPLACE FUNCTION public.get_todays_oracle_v3(
  p_user_id uuid,
  p_temperature integer DEFAULT 25,
  p_context text DEFAULT 'daily'::text,
  p_brand text DEFAULT NULL::text,
  p_wear_date date DEFAULT CURRENT_DATE
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_preferred_families text[];
  v_main_row record;
  v_layer_row record;
  v_alternates jsonb;
  v_layer_modes jsonb;
  v_why text;
  v_effect text;
  v_reason text;
  v_seed text;
BEGIN
  -- Build a deterministic seed from user + date + context
  v_seed := p_user_id::text || p_wear_date::text || p_context;

  -- Context-aware family preferences
  CASE p_context
    WHEN 'work' THEN
      v_preferred_families := ARRAY['woody-clean','fresh-citrus','aromatic-fougere','fresh-aquatic','green-earthy'];
    WHEN 'date' THEN
      v_preferred_families := ARRAY['oud-amber','sweet-gourmand','dark-leather','floral-rich','spicy-warm'];
    WHEN 'hangout' THEN
      v_preferred_families := ARRAY['fresh-citrus','sweet-gourmand','woody-clean','fresh-aquatic','earthy-patchouli','aromatic-fougere'];
    ELSE -- 'daily'
      v_preferred_families := ARRAY['woody-clean','fresh-citrus','oud-amber','sweet-gourmand','aromatic-fougere','fresh-aquatic'];
  END CASE;

  -- Pick main fragrance: prefer context families, deterministic order from seed
  SELECT * INTO v_main_row
  FROM public.fragrances
  WHERE family_key = ANY(v_preferred_families)
    AND id NOT IN (
      SELECT fragrance_id FROM public.oracle_skips
      WHERE user_id = p_user_id
        AND created_at > now() - interval '24 hours'
    )
  ORDER BY
    array_position(v_preferred_families, family_key),
    md5(v_seed || id::text)
  LIMIT 1;

  -- Fallback if no preferred family match
  IF v_main_row IS NULL THEN
    SELECT * INTO v_main_row
    FROM public.fragrances
    ORDER BY md5(v_seed || id::text)
    LIMIT 1;
  END IF;

  -- Pick layer candidate from a different family
  SELECT * INTO v_layer_row
  FROM public.fragrances
  WHERE id != v_main_row.id
    AND family_key IS NOT NULL
    AND family_key != v_main_row.family_key
  ORDER BY md5(v_seed || id::text || 'layer')
  LIMIT 1;

  -- Build alternates (3 others, different from main and layer)
  SELECT jsonb_agg(
    jsonb_build_object(
      'fragrance_id', f.id,
      'name', f.name,
      'family', f.family_key,
      'reason', f.brand
    )
  ) INTO v_alternates
  FROM (
    SELECT id, name, family_key, brand
    FROM public.fragrances
    WHERE id != v_main_row.id
      AND (v_layer_row IS NULL OR id != v_layer_row.id)
      AND family_key = ANY(v_preferred_families)
    ORDER BY md5(v_seed || id::text || 'alt')
    LIMIT 3
  ) f;

  -- Fallback alternates if not enough
  IF v_alternates IS NULL OR jsonb_array_length(v_alternates) < 3 THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'fragrance_id', f.id,
        'name', f.name,
        'family', f.family_key,
        'reason', f.brand
      )
    ) INTO v_alternates
    FROM (
      SELECT id, name, family_key, brand
      FROM public.fragrances
      WHERE id != v_main_row.id
        AND (v_layer_row IS NULL OR id != v_layer_row.id)
      ORDER BY md5(v_seed || id::text || 'alt')
      LIMIT 3
    ) f;
  END IF;

  -- Build context-aware reason
  CASE p_context
    WHEN 'work' THEN v_reason := 'Clean and understated — built for focus.';
    WHEN 'date' THEN v_reason := 'Rich and magnetic — designed to draw closer.';
    WHEN 'hangout' THEN v_reason := 'Easy and approachable — no effort, all vibe.';
    ELSE v_reason := 'Balanced for the day — works anywhere.';
  END CASE;

  RETURN jsonb_build_object(
    'today_pick', jsonb_build_object(
      'fragrance_id', v_main_row.id,
      'name', v_main_row.name,
      'family', COALESCE(v_main_row.family_key, ''),
      'reason', v_reason,
      'brand', COALESCE(v_main_row.brand, ''),
      'notes', COALESCE(to_jsonb(v_main_row.notes), '[]'::jsonb),
      'accords', COALESCE(to_jsonb(v_main_row.accords), '[]'::jsonb)
    ),
    'alternates', COALESCE(v_alternates, '[]'::jsonb)
  );
END;
$function$;
