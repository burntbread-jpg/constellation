alter function public.fill_metadata_change_provenance() security invoker;
alter function public.fill_metadata_change_provenance() set search_path = '';

revoke execute on function public.fill_metadata_change_provenance() from public, anon, authenticated;
grant execute on function public.fill_metadata_change_provenance() to service_role;
