alter function public._is_admin()
  set search_path = public;

alter function public.handle_new_auth_user()
  set search_path = public;

revoke execute on function public.stage_recipe_import_payload_v1(jsonb, text, text, text)
from public, anon, authenticated;

revoke execute on function public.promote_recipe_import_batch_v1(bigint, text, boolean)
from public, anon, authenticated;

revoke execute on function public.promote_recipe_import_stage_v1(bigint, text)
from public, anon, authenticated;

revoke execute on function public.refresh_fragrance_card_token_cache_all_v1(integer)
from public, anon, authenticated;

revoke execute on function public.refresh_fragrance_card_token_cache_v1(uuid, integer)
from public, anon, authenticated;

revoke execute on function public.rls_auto_enable()
from public, anon, authenticated;
