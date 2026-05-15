-- Narrow patch for notes-only promotion source URL identity validation.
--
-- The original guard required every normalized fragrance-name token to appear in
-- the source URL. That was too strict for safe connector words such as "of" in
-- names where provider product URLs naturally omit the connector, e.g.
-- "Key of Life" -> ".../Key-Life-30ML-...".
--
-- This keeps the source guard intact: all meaningful identity tokens still must
-- appear in the normalized source URL, and the existing name/brand/confidence,
-- canonical-state, staged-notes, explicit-ID, and refresh guards remain
-- unchanged.

do $migration$
declare
  v_fn text;
  v_patched text;
  v_old_declarations text := $old$
  v_source_norm text;
  v_name_matches boolean;
$old$;
  v_new_declarations text := $new$
  v_source_norm text;
  v_source_identity_tokens text[];
  v_source_required_token_count integer;
  v_source_match_token_count integer;
  v_name_matches boolean;
$new$;
  v_old_source_check text := $old$
      v_source_matches := v_source_norm <> ''
        and not exists (
          select 1
          from unnest(string_to_array(v_name_norm, ' ')) as token(value)
          where length(token.value) > 1
            and position(token.value in v_source_norm) = 0
        );
$old$;
  v_new_source_check text := $new$
      select
        coalesce(array_agg(token.value order by token.ord), '{}'::text[]),
        count(*)::integer,
        coalesce(count(*) filter (where position(token.value in v_source_norm) > 0), 0)::integer
      into
        v_source_identity_tokens,
        v_source_required_token_count,
        v_source_match_token_count
      from unnest(string_to_array(v_name_norm, ' ')) with ordinality as token(value, ord)
      where length(token.value) > 1
        and token.value not in (
          'a',
          'an',
          'and',
          'by',
          'de',
          'des',
          'du',
          'eau',
          'edc',
          'edp',
          'edt',
          'el',
          'for',
          'la',
          'le',
          'les',
          'ml',
          'of',
          'oz',
          'parfum',
          'perfume',
          'spray',
          'the',
          'toilette',
          'travel'
        );

      v_source_matches := v_source_norm <> ''
        and v_source_required_token_count > 0
        and v_source_match_token_count = v_source_required_token_count;
$new$;
begin
  select pg_get_functiondef(p.oid)
  into v_fn
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'promote_fragrance_text_enrichment_notes_only_v1'
    and pg_get_function_identity_arguments(p.oid) =
      'p_fragrance_ids text[], p_actor_label text, p_reason text, p_dry_run boolean, p_refresh_after_promotion boolean';

  if v_fn is null then
    raise exception 'public.promote_fragrance_text_enrichment_notes_only_v1(text[], text, text, boolean, boolean) not found';
  end if;

  if position('v_source_identity_tokens text[]' in v_fn) > 0 then
    return;
  end if;

  v_patched := replace(v_fn, v_old_declarations, v_new_declarations);
  if v_patched = v_fn then
    raise exception 'Unable to patch notes-only function declarations; expected source block not found';
  end if;

  v_fn := v_patched;
  v_patched := replace(v_fn, v_old_source_check, v_new_source_check);
  if v_patched = v_fn then
    raise exception 'Unable to patch notes-only function source URL token check; expected source block not found';
  end if;

  execute v_patched;
end;
$migration$;

revoke all on function public.promote_fragrance_text_enrichment_notes_only_v1(text[], text, text, boolean, boolean) from public;
revoke all on function public.promote_fragrance_text_enrichment_notes_only_v1(text[], text, text, boolean, boolean) from anon;
revoke all on function public.promote_fragrance_text_enrichment_notes_only_v1(text[], text, text, boolean, boolean) from authenticated;
grant execute on function public.promote_fragrance_text_enrichment_notes_only_v1(text[], text, text, boolean, boolean) to service_role;
