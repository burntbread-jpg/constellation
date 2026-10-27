-- Explicit deny policy documents the server-only boundary and keeps advisors clean.
drop policy if exists api_rate_limit_buckets_server_only on public.api_rate_limit_buckets;
create policy api_rate_limit_buckets_server_only
  on public.api_rate_limit_buckets
  for all
  to anon, authenticated
  using (false)
  with check (false);
