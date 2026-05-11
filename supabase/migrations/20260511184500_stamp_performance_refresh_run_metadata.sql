create or replace function public.performance_feature_refresh_runs_v1_stamp_metadata()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_target_name text;
  v_target_brand text;
  v_dictionary_active_row_count integer := 0;
  v_dictionary_model_versions jsonb := '[]'::jsonb;
begin
  select
    count(*)::integer,
    to_jsonb(coalesce(array_agg(distinct d.model_version order by d.model_version), array[]::text[]))
  into
    v_dictionary_active_row_count,
    v_dictionary_model_versions
  from public.performance_signal_dictionary_v1 d
  where d.is_active;

  if new.target_fragrance_id is not null then
    select f.name, f.brand
    into v_target_name, v_target_brand
    from public.fragrances f
    where f.id = new.target_fragrance_id;
  end if;

  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_strip_nulls(
    jsonb_build_object(
      'target_fragrance_id', new.target_fragrance_id,
      'target_fragrance_name', v_target_name,
      'target_fragrance_brand', v_target_brand,
      'dictionary_active_row_count', v_dictionary_active_row_count,
      'dictionary_model_versions', coalesce(v_dictionary_model_versions, '[]'::jsonb),
      'has_text_enrichment_source', to_regclass('public.fragrance_text_enrichment') is not null
    )
  );

  return new;
end;
$function$;

revoke all on function public.performance_feature_refresh_runs_v1_stamp_metadata() from public;
revoke all on function public.performance_feature_refresh_runs_v1_stamp_metadata() from anon;
revoke all on function public.performance_feature_refresh_runs_v1_stamp_metadata() from authenticated;
grant execute on function public.performance_feature_refresh_runs_v1_stamp_metadata() to service_role;

drop trigger if exists performance_feature_refresh_runs_v1_stamp_metadata_trg
on public.performance_feature_refresh_runs_v1;

create trigger performance_feature_refresh_runs_v1_stamp_metadata_trg
before insert or update of target_fragrance_id, metadata
on public.performance_feature_refresh_runs_v1
for each row
execute function public.performance_feature_refresh_runs_v1_stamp_metadata();
