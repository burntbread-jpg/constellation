-- Stage 53: make the server-only boundary explicit for Taste Constellation data.
-- Table privileges are already limited to postgres/service_role. These policies
-- provide defense in depth if anon/authenticated privileges are granted later.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'archive_items',
    'connections',
    'duplicate_work_merges',
    'metadata_changes',
    'metadata_reports',
    'recommendation_feedback',
    'taste_tags',
    'work_identity_exceptions',
    'works'
  ]
  loop
    execute format('drop policy if exists %I on public.%I',
      table_name || '_deny_client_access', table_name);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (false) with check (false)',
      table_name || '_deny_client_access', table_name);
  end loop;
end
$$;
