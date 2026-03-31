
-- Drop the OLD 4-parameter overload that doesn't accept p_wear_date
-- This forces all calls to use the date-aware version
DROP FUNCTION IF EXISTS public.get_todays_oracle_v3(uuid, integer, text, text);
