
CREATE OR REPLACE FUNCTION public.get_todays_oracle_v3(
  p_user_id UUID,
  p_temperature INT DEFAULT 25,
  p_context TEXT DEFAULT 'casual',
  p_brand TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'today_pick', jsonb_build_object(
      'name', 'Valley of the Kings',
      'family', 'oud-amber',
      'reason', 'Dark amber lane fits your strongest scent identity.'
    ),
    'layer', jsonb_build_object(
      'top', 'Enhance with Mystere 28',
      'mode', 'balance mode',
      'reason', 'Adds lift without breaking depth'
    ),
    'alternates', jsonb_build_array(
      jsonb_build_object('name', 'Agar'),
      jsonb_build_object('name', 'Hafez 1984'),
      jsonb_build_object('name', 'Oasis Elixir')
    )
  );
END;
$$;
