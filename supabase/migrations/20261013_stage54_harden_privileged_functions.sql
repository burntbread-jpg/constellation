-- Stage 54: privileged functions must not resolve user-controlled objects.
-- Vector functions need the extension operator at runtime, so they use only
-- trusted pg_catalog/extensions schemas. All other functions use an empty path.

alter function public.backfill_taste_graph(uuid) set search_path = pg_catalog, extensions;
alter function public.match_work_catalog(extensions.vector, text[], integer) set search_path = pg_catalog, extensions;
alter function public.merge_duplicate_works(text, text, jsonb, text) set search_path = '';
alter function public.restore_duplicate_work_merge(bigint, text, text) set search_path = '';
alter function public.save_archive_analysis(jsonb, jsonb, jsonb) set search_path = '';
alter function public.save_connections(uuid, jsonb) set search_path = '';
alter function public.taste_similarity_edges(uuid, integer) set search_path = pg_catalog, extensions;
alter function public.upsert_work_catalog(jsonb) set search_path = '';

revoke all on function public.backfill_taste_graph(uuid) from public, anon, authenticated;
revoke all on function public.match_work_catalog(extensions.vector, text[], integer) from public, anon, authenticated;
revoke all on function public.merge_duplicate_works(text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.restore_duplicate_work_merge(bigint, text, text) from public, anon, authenticated;
revoke all on function public.save_archive_analysis(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.save_connections(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.taste_similarity_edges(uuid, integer) from public, anon, authenticated;
revoke all on function public.upsert_work_catalog(jsonb) from public, anon, authenticated;

grant execute on function public.backfill_taste_graph(uuid) to service_role;
grant execute on function public.match_work_catalog(extensions.vector, text[], integer) to service_role;
grant execute on function public.merge_duplicate_works(text, text, jsonb, text) to service_role;
grant execute on function public.restore_duplicate_work_merge(bigint, text, text) to service_role;
grant execute on function public.save_archive_analysis(jsonb, jsonb, jsonb) to service_role;
grant execute on function public.save_connections(uuid, jsonb) to service_role;
grant execute on function public.taste_similarity_edges(uuid, integer) to service_role;
grant execute on function public.upsert_work_catalog(jsonb) to service_role;
