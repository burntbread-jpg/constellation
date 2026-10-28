-- Privacy-minimised product analytics. This table deliberately contains no
-- user identifier, work identifier, free text, IP address, or request ID.
create table if not exists public.recommendation_metrics_daily (
  metric_date date not null default current_date,
  connection_mode text not null,
  source_media_type text not null,
  target_media_type text not null,
  event_type text not null,
  event_count bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (metric_date, connection_mode, source_media_type, target_media_type, event_type),
  constraint recommendation_metrics_mode_check check (connection_mode in ('story','mood','idea','visual','deep')),
  constraint recommendation_metrics_source_media_check check (source_media_type in ('ANIME','FILM','TV','BOOK','MANGA','OTHER')),
  constraint recommendation_metrics_target_media_check check (target_media_type in ('ANIME','FILM','TV','BOOK','MANGA','OTHER')),
  constraint recommendation_metrics_event_check check (event_type in ('impression','like','hide','save')),
  constraint recommendation_metrics_count_check check (event_count >= 0)
);

alter table public.recommendation_metrics_daily enable row level security;
drop policy if exists recommendation_metrics_server_only on public.recommendation_metrics_daily;
create policy recommendation_metrics_server_only on public.recommendation_metrics_daily
  for all to anon, authenticated using (false) with check (false);
revoke all on public.recommendation_metrics_daily from public, anon, authenticated;
grant all on public.recommendation_metrics_daily to service_role;

create or replace function public.record_recommendation_metrics(p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer := 0;
begin
  if jsonb_typeof(coalesce(p_events, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_events, '[]'::jsonb)) > 100 then
    raise exception 'invalid recommendation metric batch';
  end if;

  with normalized as (
    select
      current_date as metric_date,
      case when item->>'mode' in ('story','mood','idea','visual','deep') then item->>'mode' else 'deep' end as connection_mode,
      case when upper(coalesce(item->>'source_media_type','')) in ('ANIME','FILM','TV','BOOK','MANGA','OTHER') then upper(item->>'source_media_type') else 'OTHER' end as source_media_type,
      case when upper(coalesce(item->>'target_media_type','')) in ('ANIME','FILM','TV','BOOK','MANGA','OTHER') then upper(item->>'target_media_type') else 'OTHER' end as target_media_type,
      item->>'event_type' as event_type,
      greatest(1, least(100, coalesce(nullif(item->>'count','')::integer, 1)))::bigint as event_count
    from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) item
    where item->>'event_type' in ('impression','like','hide','save')
  ), grouped as (
    select metric_date, connection_mode, source_media_type, target_media_type, event_type, sum(event_count)::bigint as event_count
    from normalized
    group by metric_date, connection_mode, source_media_type, target_media_type, event_type
  )
  insert into public.recommendation_metrics_daily as metric (
    metric_date, connection_mode, source_media_type, target_media_type, event_type, event_count, updated_at
  )
  select metric_date, connection_mode, source_media_type, target_media_type, event_type, event_count, now()
  from grouped
  on conflict (metric_date, connection_mode, source_media_type, target_media_type, event_type)
  do update set event_count = metric.event_count + excluded.event_count, updated_at = excluded.updated_at;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.record_recommendation_metrics(jsonb) from public, anon, authenticated;
grant execute on function public.record_recommendation_metrics(jsonb) to service_role;

create or replace function public.prune_recommendation_metrics(p_before date default current_date - 730)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_deleted integer := 0;
begin
  delete from public.recommendation_metrics_daily where metric_date < p_before;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_recommendation_metrics(date) from public, anon, authenticated;
grant execute on function public.prune_recommendation_metrics(date) to service_role;

do $$
declare v_job_id bigint;
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    for v_job_id in select jobid from cron.job where jobname='taste-constellation-recommendation-metrics-retention'
    loop perform cron.unschedule(v_job_id); end loop;
    perform cron.schedule(
      'taste-constellation-recommendation-metrics-retention',
      '15 4 * * *',
      $job$select public.prune_recommendation_metrics();$job$
    );
  end if;
end $$;
