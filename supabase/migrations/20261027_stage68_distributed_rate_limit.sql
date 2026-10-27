-- Stage 68: atomic, privacy-preserving rate limits shared by every Worker.
create table if not exists public.api_rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now(),
  constraint api_rate_limit_buckets_key_check
    check (bucket_key ~ '^[a-f0-9]{64}$')
);

create index if not exists api_rate_limit_buckets_updated_at_idx
  on public.api_rate_limit_buckets (updated_at);

alter table public.api_rate_limit_buckets enable row level security;
revoke all on public.api_rate_limit_buckets from public, anon, authenticated;
grant all on public.api_rate_limit_buckets to service_role;

create or replace function public.consume_api_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer default 60
) returns table (
  allowed boolean,
  request_count integer,
  limit_value integer,
  remaining integer,
  retry_after integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window integer := greatest(1, least(coalesce(p_window_seconds, 60), 3600));
  v_limit integer := greatest(1, least(coalesce(p_limit, 1), 10000));
  v_start timestamptz;
  v_count integer;
begin
  if p_bucket_key is null or p_bucket_key !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid rate-limit bucket key';
  end if;

  v_start := to_timestamp(floor(extract(epoch from v_now) / v_window) * v_window);

  insert into public.api_rate_limit_buckets as bucket (
    bucket_key, window_started_at, request_count, updated_at
  ) values (
    p_bucket_key, v_start, 1, v_now
  )
  on conflict (bucket_key) do update set
    window_started_at = case
      when bucket.window_started_at = excluded.window_started_at then bucket.window_started_at
      else excluded.window_started_at
    end,
    request_count = case
      when bucket.window_started_at = excluded.window_started_at then bucket.request_count + 1
      else 1
    end,
    updated_at = excluded.updated_at
  returning bucket.request_count into v_count;

  return query select
    v_count <= v_limit,
    v_count,
    v_limit,
    greatest(0, v_limit - v_count),
    case when v_count <= v_limit then 0 else greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => v_window) - v_now)))::integer) end,
    v_start + make_interval(secs => v_window);
end;
$$;

revoke all on function public.consume_api_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer) to service_role;

comment on table public.api_rate_limit_buckets is
  'Hashed fixed-window API buckets shared by all runtime instances; no raw user identifiers or IP addresses are stored.';
comment on function public.consume_api_rate_limit(text, integer, integer) is
  'Atomically consumes one request from a shared fixed-window bucket.';
