DROP FUNCTION IF EXISTS public.accept_today_pick_v1(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.skip_today_pick_v1(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.dislike_fragrance_v1(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_todays_oracle_v3(uuid, numeric, text, text, text);

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;