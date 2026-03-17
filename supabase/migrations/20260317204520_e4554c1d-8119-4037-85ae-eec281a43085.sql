
CREATE OR REPLACE FUNCTION public.get_todays_oracle_v3(
  p_user_id uuid,
  p_temperature integer DEFAULT 25,
  p_context text DEFAULT 'casual'::text,
  p_brand text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN jsonb_build_object(
    'today_pick', jsonb_build_object(
      'fragrance_id', '550e8400-e29b-41d4-a716-446655440001',
      'name', 'Valley of the Kings',
      'family', 'oud-amber',
      'reason', 'Dark amber lane fits your strongest scent identity.'
    ),
    'layer', jsonb_build_object(
      'base_id', '550e8400-e29b-41d4-a716-446655440001',
      'anchor_name', 'Valley of the Kings',
      'top_id', '550e8400-e29b-41d4-a716-446655440002',
      'top_name', 'Mystere 28',
      'top', 'Enhance with Mystere 28',
      'mode', 'balance',
      'anchor_sprays', 3,
      'top_sprays', 1,
      'anchor_placement', 'chest, neck, wrists',
      'top_placement', 'back of neck or inner elbow',
      'mixing_rule', 'Apply anchor first, let dry 30 seconds, then accent sparingly',
      'why_it_works', 'Mystere 28 adds lift without breaking depth',
      'strength_note', 'Mystere 28 projects more strongly — reduced to 1 spray as accent only',
      'dominance_level', 'high',
      'reason', 'Adds lift without breaking depth'
    ),
    'alternates', jsonb_build_array(
      jsonb_build_object('fragrance_id', '550e8400-e29b-41d4-a716-446655440003', 'name', 'Agar'),
      jsonb_build_object('fragrance_id', '550e8400-e29b-41d4-a716-446655440004', 'name', 'Hafez 1984'),
      jsonb_build_object('fragrance_id', '550e8400-e29b-41d4-a716-446655440005', 'name', 'Oasis Elixir')
    )
  );
END;
$function$;
