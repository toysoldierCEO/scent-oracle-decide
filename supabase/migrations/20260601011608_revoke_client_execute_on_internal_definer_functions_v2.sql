begin;

revoke execute on function public.get_recommendations_v4_smoke(uuid, text, text, integer) from public;
revoke execute on function public.get_recommendations_v4_smoke(uuid, text, text, integer) from anon;
revoke execute on function public.get_recommendations_v4_smoke(uuid, text, text, integer) from authenticated;

commit;
