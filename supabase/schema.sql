create table if not exists public.profiles (
  id uuid primary key,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Sites authenticates visitors outside Supabase Auth. Keep application profiles
-- independent so stable Sites identities can own private archive rows.
alter table public.profiles drop constraint if exists profiles_id_fkey;

create extension if not exists vector with schema extensions;

create table if not exists public.works (
  id text primary key,
  external_id text,
  title text not null,
  original_title text,
  creator text not null,
  release_year integer,
  media_type text not null,
  poster_url text,
  description text not null default '',
  tags jsonb not null default '[]'::jsonb,
  publishers jsonb not null default '[]'::jsonb,
  edition_verified boolean not null default false,
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.works add column if not exists taste_analysis jsonb;
alter table public.works add column if not exists taste_vector extensions.vector(25);
alter table public.works add column if not exists taste_vector_updated_at timestamptz;
alter table public.works add column if not exists publishers jsonb not null default '[]'::jsonb;
alter table public.works add column if not exists edition_verified boolean not null default false;
alter table public.works add column if not exists canonical_key text;
alter table public.works add column if not exists editorial_intro text;
alter table public.works add column if not exists catalog_status text not null default 'candidate';
alter table public.works add column if not exists metadata_quality_score integer not null default 0;
alter table public.works add column if not exists metadata_verified_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='works_catalog_status_check') then
    alter table public.works add constraint works_catalog_status_check check (catalog_status in ('candidate','curated','verified','quarantined'));
  end if;
  if not exists (select 1 from pg_constraint where conname='works_metadata_quality_score_check') then
    alter table public.works add constraint works_metadata_quality_score_check check (metadata_quality_score between 0 and 100);
  end if;
end $$;
create or replace function public.catalog_metadata_quality(text,text,integer,text,text,text,text) returns integer
language sql stable security invoker set search_path='' as $$
  select (case when nullif(btrim($1),'') is not null then 10 else 0 end)
    +(case when nullif(btrim($2),'') is not null and lower(btrim($2)) not in ('unknown','미상','작자 미상','제작진 정보 없음','정보 없음') then 15 else 0 end)
    +(case when $3 between 1800 and extract(year from current_date)::integer+3 then 15 else 0 end)
    +(case when $4 ~ '^https://' then 20 else 0 end)
    +(case when length(btrim(coalesce($5,'')))>=24 then 15 else 0 end)
    +(case when length(btrim(coalesce($6,'')))>=12 then 20 else 0 end)
    +(case when nullif(btrim($7),'') is not null then 5 else 0 end)
$$;
revoke execute on function public.catalog_metadata_quality(text,text,integer,text,text,text,text) from public,anon,authenticated;
grant execute on function public.catalog_metadata_quality(text,text,integer,text,text,text,text) to service_role;
create or replace function public.classify_work_catalog() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  new.canonical_key:=coalesce(nullif(btrim(new.canonical_key),''),lower(new.media_type)||':'||regexp_replace(lower(coalesce(new.title,'')),'[^a-z0-9가-힣]+','','g')||':'||coalesce(new.release_year::text,'unknown'));
  new.metadata_quality_score:=public.catalog_metadata_quality(new.title,new.creator,new.release_year,new.poster_url,new.description,new.editorial_intro,new.canonical_key);
  if new.catalog_status in('curated','verified') and new.metadata_quality_score>=90 then new.metadata_verified_at:=coalesce(new.metadata_verified_at,now());
  elsif new.source<>'Taste Constellation' and (new.metadata_quality_score<55 or new.title~*'(전[0-9]+권|[0-9]+권|완결|세트|애장판|완전판|리버시|외전|가이드북|화보집|대본집)' or concat_ws(' ',new.title,new.description,new.tags::text)~*'(웹\s*소설|web\s*novel|juvenile nonfiction|study aids?|textbooks?|교양\s*수업|학습서|문제집|수험서|교과서)') then new.catalog_status:='quarantined';new.metadata_verified_at:=null;
  else new.catalog_status:='candidate';new.metadata_verified_at:=null; end if;
  return new;
end $$;
revoke execute on function public.classify_work_catalog() from public,anon,authenticated;
grant execute on function public.classify_work_catalog() to service_role;
drop trigger if exists works_catalog_classification on public.works;
create trigger works_catalog_classification before insert or update of title,creator,release_year,poster_url,description,editorial_intro,canonical_key,catalog_status on public.works for each row execute function public.classify_work_catalog();

create table if not exists public.metadata_reports (
  id bigint generated by default as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_id text not null,
  work_title text not null,
  canonical_key text,
  issue_type text not null check (issue_type in ('poster','year','creator','title','media_type','other')),
  current_value text,
  suggested_value text,
  note text,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
alter table public.metadata_reports add column if not exists resolution_note text;
alter table public.metadata_reports add column if not exists reviewed_by text;
alter table public.metadata_reports add column if not exists evidence_type text check (evidence_type in ('official','publisher','award_body','authority_database','reference','other'));
alter table public.metadata_reports add column if not exists source_url text;
create index if not exists metadata_reports_pending_idx on public.metadata_reports(status, created_at desc);
create index if not exists metadata_reports_user_idx on public.metadata_reports(user_id);
alter table public.metadata_reports enable row level security;
revoke all on public.metadata_reports from anon, authenticated;
grant all on public.metadata_reports to service_role;

create table if not exists public.metadata_changes (
  id bigint generated by default as identity primary key,
  report_id bigint references public.metadata_reports(id) on delete set null,
  work_id text not null,
  work_title text not null,
  field_name text not null check (field_name in ('poster_url','release_year','creator','title','media_type')),
  previous_value jsonb,
  new_value jsonb,
  status text not null default 'applying' check (status in ('applying','applied','rolled_back')),
  changed_by text not null,
  changed_at timestamptz not null default now(),
  rolled_back_by text,
  rolled_back_at timestamptz,
  rollback_note text
);
alter table public.metadata_changes add column if not exists evidence_type text check (evidence_type in ('official','publisher','award_body','authority_database','reference','other'));
alter table public.metadata_changes add column if not exists source_url text;
create or replace function public.fill_metadata_change_provenance()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.report_id is not null then
    select evidence_type, source_url into new.evidence_type, new.source_url
    from public.metadata_reports where id = new.report_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.fill_metadata_change_provenance() from public, anon, authenticated;
grant execute on function public.fill_metadata_change_provenance() to service_role;
drop trigger if exists metadata_change_provenance on public.metadata_changes;
create trigger metadata_change_provenance before insert on public.metadata_changes
for each row execute function public.fill_metadata_change_provenance();
create index if not exists metadata_changes_work_idx on public.metadata_changes(work_id, changed_at desc);
create index if not exists metadata_changes_report_idx on public.metadata_changes(report_id);
alter table public.metadata_changes enable row level security;
revoke all on public.metadata_changes from anon, authenticated;
grant all on public.metadata_changes to service_role;

create table if not exists public.archive_items (
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_id text not null references public.works(id) on delete cascade,
  work_json jsonb,
  rating smallint,
  my_comment text not null default '',
  ai_comment text not null default '',
  analysis_status text not null default 'pending',
  analysis_json jsonb,
  archive_state text not null default 'completed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, work_id)
);

alter table public.archive_items add column if not exists rating smallint;
alter table public.archive_items add column if not exists work_json jsonb;
alter table public.archive_items add column if not exists my_comment text not null default '';
alter table public.archive_items add column if not exists ai_comment text not null default '';
alter table public.archive_items add column if not exists analysis_status text not null default 'pending';
alter table public.archive_items add column if not exists analysis_json jsonb;
alter table public.archive_items add column if not exists archive_state text not null default 'completed';
alter table public.archive_items add column if not exists updated_at timestamptz not null default now();
alter table public.archive_items add column if not exists taste_vector extensions.vector(25);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'archive_items_rating_check') then
    alter table public.archive_items add constraint archive_items_rating_check check (rating between 1 and 5);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'archive_items_state_check') then
    alter table public.archive_items add constraint archive_items_state_check check (archive_state in ('completed', 'planned'));
  end if;
end $$;

create table if not exists public.taste_tags (
  user_id uuid not null,
  work_id text not null,
  tag text not null,
  category text not null,
  score double precision not null,
  evidence text,
  engine text not null default 'metadata-lexicon-v1',
  created_at timestamptz not null default now(),
  primary key (user_id, work_id, tag),
  foreign key (user_id, work_id)
    references public.archive_items(user_id, work_id) on delete cascade
);

create table if not exists public.connections (
  user_id uuid not null references public.profiles(id) on delete cascade,
  from_work_id text not null,
  to_work_id text not null,
  connection_type text not null,
  reason text not null,
  score double precision not null,
  shared_tags jsonb not null default '[]'::jsonb,
  work_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, from_work_id, to_work_id, connection_type)
);

create table if not exists public.recommendation_feedback (
  user_id uuid not null references public.profiles(id) on delete cascade,
  from_work_id text not null,
  to_work_id text not null,
  connection_mode text not null,
  value smallint not null check (value in (-1, 1)),
  to_work_title_key text,
  shared_tags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, from_work_id, to_work_id, connection_mode)
);

alter table public.recommendation_feedback
  add column if not exists shared_tags jsonb not null default '[]'::jsonb;

alter table public.recommendation_feedback
  add column if not exists to_work_title_key text;

create table if not exists public.recommendation_metrics_daily (
  metric_date date not null default current_date,
  connection_mode text not null check (connection_mode in ('story','mood','idea','visual','deep')),
  source_media_type text not null check (source_media_type in ('ANIME','FILM','TV','BOOK','MANGA','OTHER')),
  target_media_type text not null check (target_media_type in ('ANIME','FILM','TV','BOOK','MANGA','OTHER')),
  event_type text not null check (event_type in ('impression','like','hide','save')),
  event_count bigint not null default 0 check (event_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (metric_date, connection_mode, source_media_type, target_media_type, event_type)
);

create or replace function public.record_recommendation_metrics(p_events jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer := 0;
begin
  if jsonb_typeof(coalesce(p_events,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_events,'[]'::jsonb)) > 100 then raise exception 'invalid recommendation metric batch';end if;
  with normalized as (
    select current_date metric_date,
      case when item->>'mode' in ('story','mood','idea','visual','deep') then item->>'mode' else 'deep' end connection_mode,
      case when upper(coalesce(item->>'source_media_type','')) in ('ANIME','FILM','TV','BOOK','MANGA','OTHER') then upper(item->>'source_media_type') else 'OTHER' end source_media_type,
      case when upper(coalesce(item->>'target_media_type','')) in ('ANIME','FILM','TV','BOOK','MANGA','OTHER') then upper(item->>'target_media_type') else 'OTHER' end target_media_type,
      item->>'event_type' event_type,
      greatest(1,least(100,coalesce(nullif(item->>'count','')::integer,1)))::bigint event_count
    from jsonb_array_elements(coalesce(p_events,'[]'::jsonb)) item where item->>'event_type' in ('impression','like','hide','save')
  ), grouped as (
    select metric_date,connection_mode,source_media_type,target_media_type,event_type,sum(event_count)::bigint event_count from normalized
    group by metric_date,connection_mode,source_media_type,target_media_type,event_type
  )
  insert into public.recommendation_metrics_daily as metric(metric_date,connection_mode,source_media_type,target_media_type,event_type,event_count,updated_at)
  select metric_date,connection_mode,source_media_type,target_media_type,event_type,event_count,now() from grouped
  on conflict(metric_date,connection_mode,source_media_type,target_media_type,event_type)
  do update set event_count=metric.event_count+excluded.event_count,updated_at=excluded.updated_at;
  get diagnostics v_count=row_count;return v_count;
end;$$;
revoke all on function public.record_recommendation_metrics(jsonb) from public,anon,authenticated;
grant execute on function public.record_recommendation_metrics(jsonb) to service_role;

create or replace function public.prune_recommendation_metrics(p_before date default current_date-730)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_deleted integer:=0;begin delete from public.recommendation_metrics_daily where metric_date<p_before;get diagnostics v_deleted=row_count;return v_deleted;end;$$;
revoke all on function public.prune_recommendation_metrics(date) from public,anon,authenticated;
grant execute on function public.prune_recommendation_metrics(date) to service_role;

create index if not exists archive_items_user_created_idx
  on public.archive_items (user_id, created_at desc);
create index if not exists archive_items_work_idx
  on public.archive_items (work_id);
create index if not exists archive_items_user_state_idx
  on public.archive_items (user_id, archive_state, updated_at desc);
create index if not exists archive_items_user_updated_idx
  on public.archive_items (user_id, updated_at desc);

create index if not exists taste_tags_user_score_idx
  on public.taste_tags (user_id, score desc);

create index if not exists connections_user_source_idx
  on public.connections (user_id, from_work_id, connection_type, score desc);
create index if not exists connections_user_score_idx
  on public.connections (user_id, score desc);

create index if not exists recommendation_feedback_user_source_idx
  on public.recommendation_feedback (user_id, from_work_id, connection_mode, value);

create index if not exists archive_items_taste_vector_idx
  on public.archive_items using hnsw (taste_vector extensions.vector_cosine_ops);

create index if not exists works_taste_vector_idx
  on public.works using hnsw (taste_vector extensions.vector_cosine_ops);
create index if not exists works_catalog_ready_idx
  on public.works (catalog_status, media_type, metadata_quality_score desc)
  where catalog_status in ('curated','verified') and taste_vector is not null;

create table if not exists public.api_rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now(),
  constraint api_rate_limit_buckets_key_check check (bucket_key ~ '^[a-f0-9]{64}$')
);
create index if not exists api_rate_limit_buckets_updated_at_idx
  on public.api_rate_limit_buckets (updated_at);
alter table public.api_rate_limit_buckets enable row level security;
drop policy if exists api_rate_limit_buckets_server_only on public.api_rate_limit_buckets;
create policy api_rate_limit_buckets_server_only on public.api_rate_limit_buckets
  for all to anon, authenticated using (false) with check (false);
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
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window integer := greatest(1, least(coalesce(p_window_seconds, 60), 3600));
  v_limit integer := greatest(1, least(coalesce(p_limit, 1), 10000));
  v_start timestamptz;
  v_count integer;
begin
  if p_bucket_key is null or p_bucket_key !~ '^[a-f0-9]{64}$' then raise exception 'invalid rate-limit bucket key'; end if;
  v_start := to_timestamp(floor(extract(epoch from v_now) / v_window) * v_window);
  insert into public.api_rate_limit_buckets as bucket (bucket_key, window_started_at, request_count, updated_at)
  values (p_bucket_key, v_start, 1, v_now)
  on conflict (bucket_key) do update set
    window_started_at = case when bucket.window_started_at = excluded.window_started_at then bucket.window_started_at else excluded.window_started_at end,
    request_count = case when bucket.window_started_at = excluded.window_started_at then bucket.request_count + 1 else 1 end,
    updated_at = excluded.updated_at
  returning bucket.request_count into v_count;
  return query select v_count <= v_limit, v_count, v_limit, greatest(0, v_limit - v_count),
    case when v_count <= v_limit then 0 else greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => v_window) - v_now)))::integer) end,
    v_start + make_interval(secs => v_window);
end;
$$;
revoke all on function public.consume_api_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer) to service_role;

alter table public.profiles enable row level security;
alter table public.works enable row level security;
alter table public.archive_items enable row level security;
alter table public.taste_tags enable row level security;
alter table public.connections enable row level security;
alter table public.recommendation_feedback enable row level security;
alter table public.recommendation_metrics_daily enable row level security;
drop policy if exists recommendation_metrics_server_only on public.recommendation_metrics_daily;
create policy recommendation_metrics_server_only on public.recommendation_metrics_daily for all to anon,authenticated using(false) with check(false);

revoke all on public.profiles from anon, authenticated;
revoke all on public.works from anon, authenticated;
revoke all on public.archive_items from anon, authenticated;
revoke all on public.taste_tags from anon, authenticated;
revoke all on public.connections from anon, authenticated;
revoke all on public.recommendation_feedback from anon, authenticated;
revoke all on public.recommendation_metrics_daily from public, anon, authenticated;

grant all on public.profiles to service_role;
grant all on public.works to service_role;
grant all on public.archive_items to service_role;
grant all on public.taste_tags to service_role;
grant all on public.connections to service_role;
grant all on public.recommendation_feedback to service_role;
grant all on public.recommendation_metrics_daily to service_role;

create table if not exists public.duplicate_work_merges (
  id bigint generated by default as identity primary key,
  target_work_id text not null,
  removed_work_id text not null,
  target_snapshot jsonb not null,
  removed_snapshot jsonb not null,
  merged_fields jsonb not null,
  impact jsonb not null default '{}'::jsonb,
  merged_by text not null,
  merged_at timestamptz not null default now(),
  restored_at timestamptz,
  restored_by text,
  restore_reason text
);
alter table public.duplicate_work_merges add column if not exists restored_at timestamptz;
alter table public.duplicate_work_merges add column if not exists restored_by text;
alter table public.duplicate_work_merges add column if not exists restore_reason text;
create index if not exists duplicate_work_merges_target_idx on public.duplicate_work_merges(target_work_id, merged_at desc);
alter table public.duplicate_work_merges enable row level security;
revoke all on public.duplicate_work_merges from anon, authenticated;
grant all on public.duplicate_work_merges to service_role;

create or replace function public.restore_duplicate_work_merge(p_audit_id bigint,p_reviewer_id text,p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_audit public.duplicate_work_merges%rowtype; v_removed public.works%rowtype;
begin
  select * into v_audit from public.duplicate_work_merges where id=p_audit_id for update;
  if not found then raise exception 'merge audit not found'; end if;
  if v_audit.restored_at is not null then raise exception 'merge already restored'; end if;
  if not exists(select 1 from public.works where id=v_audit.target_work_id) then raise exception 'merge target is missing'; end if;
  if exists(select 1 from public.works where id=v_audit.removed_work_id) then raise exception 'removed work already exists'; end if;
  v_removed:=jsonb_populate_record(null::public.works,v_audit.removed_snapshot);
  insert into public.works select v_removed.*;
  update public.duplicate_work_merges set restored_at=now(),restored_by=p_reviewer_id,restore_reason=nullif(trim(coalesce(p_reason,'')),'') where id=p_audit_id;
  return jsonb_build_object('audit_id',p_audit_id,'target_id',v_audit.target_work_id,'restored_id',v_audit.removed_work_id,'catalog_restored',true,'personalization_split',false);
end; $$;
revoke all on function public.restore_duplicate_work_merge(bigint,text,text) from public,anon,authenticated;
grant execute on function public.restore_duplicate_work_merge(bigint,text,text) to service_role;

create table if not exists public.work_identity_exceptions (
  id bigint generated by default as identity primary key,
  left_work_id text not null,
  right_work_id text not null,
  reason_type text not null check (reason_type in ('adaptation','remake','homonym','distinct_edition','other')),
  note text,
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint work_identity_exceptions_distinct check (left_work_id <> right_work_id)
);
create unique index if not exists work_identity_exceptions_pair_idx on public.work_identity_exceptions(least(left_work_id,right_work_id),greatest(left_work_id,right_work_id));
alter table public.work_identity_exceptions enable row level security;
revoke all on public.work_identity_exceptions from anon,authenticated;
grant all on public.work_identity_exceptions to service_role;

create or replace function public.save_connections(
  p_user_id uuid,
  p_connections jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.connections (
    user_id, from_work_id, to_work_id, connection_type,
    reason, score, shared_tags, work_json
  )
  select
    p_user_id, item->>'from_work_id', item->>'to_work_id', item->>'connection_type',
    item->>'reason', (item->>'score')::double precision,
    coalesce(item->'shared_tags', '[]'::jsonb), item->'work_json'
  from jsonb_array_elements(p_connections) as item
  on conflict (user_id, from_work_id, to_work_id, connection_type) do update set
    reason = excluded.reason,
    score = excluded.score,
    shared_tags = excluded.shared_tags,
    work_json = excluded.work_json,
    updated_at = now();
end;
$$;

revoke all on function public.save_connections(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_connections(uuid, jsonb) to service_role;

create or replace function public.backfill_taste_graph(
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_vectors integer := 0;
  v_connections integer := 0;
begin
  update public.archive_items a
  set taste_vector = (
    select ('[' || string_agg(coalesce((
      select (tag_item->>'score')::double precision
      from jsonb_array_elements(coalesce(a.analysis_json->'tags', '[]'::jsonb)) tag_item
      where tag_item->>'tag' = axis.tag
      limit 1
    ), 0)::text, ',' order by axis.ordinality) || ']')::extensions.vector
    from unnest(array[
      '고독','자아정체성','기억','상실','성장','가족','사랑과 친밀감','인간과 비인간',
      '계급과 불평등','권력과 통제','존재와 죽음','연결의 실패','종말과 재난','미지와 우주',
      '기술과 미래','꿈과 현실','신체와 변형','도시적 고독','공간과 경계','운명과 선택',
      '정의와 죄책감','자연과 인간','멜랑콜리','불안과 공포','유머와 아이러니'
    ]) with ordinality as axis(tag, ordinality)
  )
  where a.user_id = p_user_id
    and a.taste_vector is null
    and jsonb_typeof(a.analysis_json->'tags') = 'array';
  get diagnostics v_vectors = row_count;

  with ranked_pairs as (
    select
      a.user_id,
      a.work_id as from_work_id,
      b.work_id as to_work_id,
      1 - (a.taste_vector <=> b.taste_vector) as score,
      b.work_json,
      coalesce((
        select jsonb_agg(shared.tag order by shared.score desc)
        from (
          select ta.tag, greatest(ta.score, tb.score) as score
          from public.taste_tags ta
          join public.taste_tags tb
            on tb.user_id = ta.user_id and tb.tag = ta.tag and tb.work_id = b.work_id
          where ta.user_id = p_user_id and ta.work_id = a.work_id
          order by greatest(ta.score, tb.score) desc
          limit 3
        ) shared
      ), '[]'::jsonb) as shared_tags
    from public.archive_items a
    join public.archive_items b
      on b.user_id = a.user_id and a.work_id < b.work_id
    where a.user_id = p_user_id
      and a.taste_vector is not null
      and b.taste_vector is not null
    order by a.taste_vector <=> b.taste_vector
    limit 100
  )
  insert into public.connections (
    user_id, from_work_id, to_work_id, connection_type,
    reason, score, shared_tags, work_json
  )
  select
    user_id, from_work_id, to_work_id, 'archive',
    '기존 아카이브에서 Taste DNA 유사도 ' || round((score * 100)::numeric) || '%로 복원된 연결입니다.',
    score, shared_tags, work_json
  from ranked_pairs
  where score > 0
  on conflict (user_id, from_work_id, to_work_id, connection_type) do nothing;
  get diagnostics v_connections = row_count;

  return jsonb_build_object('vectors', v_vectors, 'connections', v_connections, 'version', 1);
end;
$$;

revoke all on function public.backfill_taste_graph(uuid) from public, anon, authenticated;
grant execute on function public.backfill_taste_graph(uuid) to service_role;

create or replace function public.save_archive_analysis(
  p_work jsonb,
  p_item jsonb,
  p_tags jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.works (
    id, external_id, title, original_title, creator, release_year,
    media_type, poster_url, description, tags, publishers, edition_verified, editorial_intro, source
  ) values (
    p_work->>'id', p_work->>'external_id', p_work->>'title', p_work->>'original_title',
    p_work->>'creator', (p_work->>'release_year')::integer, p_work->>'media_type',
    p_work->>'poster_url', p_work->>'description', coalesce(p_work->'tags', '[]'::jsonb),
    coalesce(p_work->'publishers', '[]'::jsonb),
    coalesce((p_work->>'edition_verified')::boolean, false),
    nullif(p_work->>'editorial_intro', ''),
    p_work->>'source'
  ) on conflict (id) do update set
    poster_url = coalesce(public.works.poster_url, excluded.poster_url),
    editorial_intro = coalesce(excluded.editorial_intro, public.works.editorial_intro),
    original_title = coalesce(public.works.original_title, excluded.original_title),
    release_year = coalesce(public.works.release_year, excluded.release_year),
    updated_at = now();

  insert into public.archive_items (
    user_id, work_id, work_json, rating, my_comment, ai_comment, analysis_status, analysis_json, taste_vector
  ) values (
    (p_item->>'user_id')::uuid, p_item->>'work_id', p_item->'work_json', (p_item->>'rating')::smallint,
    coalesce(p_item->>'my_comment', ''), coalesce(p_item->>'ai_comment', ''),
    'complete', p_item->'analysis_json', (p_item->>'taste_vector')::extensions.vector
  ) on conflict (user_id, work_id) do update set
    rating = excluded.rating,
    work_json = excluded.work_json,
    my_comment = excluded.my_comment,
    ai_comment = excluded.ai_comment,
    analysis_status = excluded.analysis_status,
    analysis_json = excluded.analysis_json,
    taste_vector = excluded.taste_vector,
    updated_at = now();

  delete from public.taste_tags
    where user_id = (p_item->>'user_id')::uuid and work_id = p_item->>'work_id';

  insert into public.taste_tags (user_id, work_id, tag, category, score, evidence, engine)
  select distinct on (tag->>'tag')
    (tag->>'user_id')::uuid, tag->>'work_id', tag->>'tag', tag->>'category',
    (tag->>'score')::double precision, tag->>'evidence', tag->>'engine'
  from jsonb_array_elements(p_tags) as tag
  order by tag->>'tag';
end;
$$;

revoke all on function public.save_archive_analysis(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_archive_analysis(jsonb, jsonb, jsonb) to service_role;

create or replace function public.taste_similarity_edges(
  p_user_id uuid,
  p_limit integer default 24
) returns table (
  source_work_id text,
  target_work_id text,
  similarity double precision
)
language sql
security definer
set search_path = pg_catalog, extensions
stable
as $$
  select
    a.work_id as source_work_id,
    b.work_id as target_work_id,
    1 - (a.taste_vector <=> b.taste_vector) as similarity
  from public.archive_items a
  join public.archive_items b
    on a.user_id = b.user_id and a.work_id < b.work_id
  where a.user_id = p_user_id
    and a.taste_vector is not null
    and b.taste_vector is not null
  order by a.taste_vector <=> b.taste_vector
  limit greatest(1, least(coalesce(p_limit, 24), 100));
$$;

revoke all on function public.taste_similarity_edges(uuid, integer) from public, anon, authenticated;
grant execute on function public.taste_similarity_edges(uuid, integer) to service_role;

create or replace function public.upsert_work_catalog(
  p_works jsonb
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  insert into public.works (
    id, external_id, title, original_title, creator, release_year,
    media_type, poster_url, description, tags, publishers, edition_verified, editorial_intro, source,
    canonical_key, catalog_status, metadata_verified_at,
    taste_analysis, taste_vector, taste_vector_updated_at
  )
  select
    item->>'id', nullif(item->>'external_id', ''), item->>'title',
    nullif(item->>'original_title', ''), item->>'creator',
    nullif(item->>'release_year', '')::integer, item->>'media_type',
    nullif(item->>'poster_url', ''), coalesce(item->>'description', ''),
    coalesce(item->'tags', '[]'::jsonb), coalesce(item->'publishers', '[]'::jsonb), coalesce((item->>'edition_verified')::boolean, false), nullif(item->>'editorial_intro', ''), coalesce(item->>'source', 'Taste Constellation'),
    nullif(item->>'canonical_key',''), case when item->>'catalog_status' in ('curated','verified') then item->>'catalog_status' else 'candidate' end,
    case when item->>'catalog_status' in ('curated','verified') then now() else null end,
    item->'taste_analysis', (item->>'taste_vector')::extensions.vector, now()
  from jsonb_array_elements(coalesce(p_works, '[]'::jsonb)) as item
  where nullif(item->>'id', '') is not null
    and nullif(item->>'title', '') is not null
  on conflict (id) do update set
    external_id = coalesce(works.external_id, nullif(excluded.external_id, '')),
    original_title = coalesce(works.original_title, nullif(excluded.original_title, '')),
    creator = case when works.creator is null or works.creator = '작자 미상' then excluded.creator else works.creator end,
    release_year = coalesce(works.release_year, excluded.release_year),
    media_type = case when works.media_type = 'OTHER' then excluded.media_type else works.media_type end,
    poster_url = coalesce(works.poster_url, excluded.poster_url),
    description = case when length(excluded.description) > length(works.description) then excluded.description else works.description end,
    tags = case when jsonb_array_length(excluded.tags) > jsonb_array_length(works.tags) then excluded.tags else works.tags end,
    publishers = case when jsonb_array_length(excluded.publishers) > jsonb_array_length(works.publishers) then excluded.publishers else works.publishers end,
    edition_verified = works.edition_verified or excluded.edition_verified,
    editorial_intro = coalesce(excluded.editorial_intro, works.editorial_intro),
    canonical_key = coalesce(works.canonical_key, excluded.canonical_key),
    catalog_status = case when works.catalog_status in ('curated','verified') then works.catalog_status else excluded.catalog_status end,
    metadata_verified_at = case when works.catalog_status in ('curated','verified') then works.metadata_verified_at else excluded.metadata_verified_at end,
    taste_analysis = excluded.taste_analysis,
    taste_vector = excluded.taste_vector,
    taste_vector_updated_at = now(),
    updated_at = now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.upsert_work_catalog(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_work_catalog(jsonb) to service_role;

create or replace function public.match_work_catalog(
  p_query extensions.vector(25),
  p_excluded text[] default array[]::text[],
  p_limit integer default 48
) returns table (
  id text,
  external_id text,
  title text,
  original_title text,
  creator text,
  release_year integer,
  media_type text,
  poster_url text,
  description text,
  tags jsonb,
  publishers jsonb,
  edition_verified boolean,
  editorial_intro text,
  source text,
  taste_analysis jsonb,
  similarity double precision
)
language sql
security definer
set search_path = pg_catalog, extensions
stable
as $$
  select
    w.id, w.external_id, w.title, w.original_title, w.creator, w.release_year,
    w.media_type, w.poster_url, w.description, w.tags, w.publishers, w.edition_verified, w.editorial_intro, w.source, w.taste_analysis,
    1 - (w.taste_vector <=> p_query) as similarity
  from public.works w
  where w.taste_vector is not null
    and w.catalog_status in ('curated','verified')
    and w.metadata_quality_score >= 90
    and not (w.id = any(coalesce(p_excluded, array[]::text[])))
  order by w.taste_vector <=> p_query
  limit greatest(1, least(coalesce(p_limit, 48), 100));
$$;

revoke all on function public.match_work_catalog(extensions.vector, text[], integer) from public, anon, authenticated;
grant execute on function public.match_work_catalog(extensions.vector, text[], integer) to service_role;

-- Taste Constellation tables are server-only. Grants above remain the primary
-- boundary; explicit deny policies protect against accidental future grants.
create table if not exists public.health_check_runs (
  id bigint generated by default as identity primary key,
  status text not null check (status in ('ready','warning','degraded')),
  database_ready boolean not null,
  pgvector_ready boolean not null,
  provider_failures integer not null default 0 check (provider_failures >= 0),
  providers jsonb not null default '{}'::jsonb,
  traffic jsonb not null default '{}'::jsonb,
  latency_ms integer not null default 0 check (latency_ms >= 0),
  checked_at timestamptz not null default now()
);

create index if not exists health_check_runs_checked_at_idx on public.health_check_runs (checked_at desc);
alter table public.health_check_runs enable row level security;
revoke all on public.health_check_runs from anon, authenticated;
grant all on public.health_check_runs to service_role;

create table if not exists public.health_alert_events (
  id bigint generated by default as identity primary key,
  health_check_run_id bigint not null unique references public.health_check_runs(id) on delete cascade,
  kind text not null check (kind in ('service_degraded','sustained_warning','recovered')),
  status text not null check (status in ('ready','warning','degraded')),
  message text not null,
  details jsonb not null default '{}'::jsonb,
  delivery_attempts integer not null default 0 check (delivery_attempts >= 0),
  delivered_at timestamptz,
  last_delivery_error text,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  resolution_note text check (resolution_note is null or char_length(resolution_note) between 5 and 500),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_summary text check (resolution_summary is null or char_length(resolution_summary) between 5 and 500),
  created_at timestamptz not null default now()
);
create index if not exists health_alert_events_pending_idx on public.health_alert_events (created_at) where delivered_at is null;
create index if not exists health_alert_events_unacknowledged_idx on public.health_alert_events (created_at desc) where acknowledged_at is null;
create index if not exists health_alert_events_open_idx on public.health_alert_events (created_at desc) where resolved_at is null;
alter table public.health_alert_events enable row level security;
revoke all on public.health_alert_events from anon, authenticated;
grant all on public.health_alert_events to service_role;

create table if not exists public.health_alert_actions (
  id bigint generated by default as identity primary key,
  health_alert_event_id bigint not null references public.health_alert_events(id) on delete cascade,
  action text not null check (action in ('acknowledged','resolved','reopened')),
  actor_id uuid not null,
  note text not null check (char_length(note) between 5 and 500),
  created_at timestamptz not null default now()
);
create index if not exists health_alert_actions_event_created_idx on public.health_alert_actions (health_alert_event_id, created_at desc);
alter table public.health_alert_actions enable row level security;
revoke all on public.health_alert_actions from anon, authenticated;
grant all on public.health_alert_actions to service_role;

create or replace function public.record_health_alert_action(p_alert_id bigint,p_action text,p_actor_id uuid,p_note text)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare alert public.health_alert_events%rowtype; action_name text; acted_at timestamptz := now();
begin
  p_note := btrim(coalesce(p_note, ''));
  if p_action not in ('acknowledge','resolve','reopen') then raise exception 'invalid alert action'; end if;
  if char_length(p_note) < 5 or char_length(p_note) > 500 then raise exception 'invalid alert action note'; end if;
  select * into alert from public.health_alert_events where id=p_alert_id for update;
  if not found then raise exception 'alert not found'; end if;
  if p_action='acknowledge' then
    if alert.acknowledged_at is not null or alert.resolved_at is not null then raise exception 'invalid alert transition'; end if;
    update public.health_alert_events set acknowledged_at=acted_at,acknowledged_by=p_actor_id,resolution_note=p_note where id=p_alert_id;
    action_name := 'acknowledged';
  elsif p_action='resolve' then
    if alert.acknowledged_at is null or alert.resolved_at is not null then raise exception 'invalid alert transition'; end if;
    update public.health_alert_events set resolved_at=acted_at,resolved_by=p_actor_id,resolution_summary=p_note where id=p_alert_id;
    action_name := 'resolved';
  else
    if alert.resolved_at is null then raise exception 'invalid alert transition'; end if;
    update public.health_alert_events set acknowledged_at=null,acknowledged_by=null,resolution_note=null,resolved_at=null,resolved_by=null,resolution_summary=null where id=p_alert_id;
    action_name := 'reopened';
  end if;
  insert into public.health_alert_actions(health_alert_event_id,action,actor_id,note,created_at) values(p_alert_id,action_name,p_actor_id,p_note,acted_at);
  return jsonb_build_object('id',p_alert_id,'action',action_name,'actedAt',acted_at,'acknowledged',p_action<>'reopen','resolved',p_action='resolve');
end $$;
revoke all on function public.record_health_alert_action(bigint,text,uuid,text) from public, anon, authenticated;
grant execute on function public.record_health_alert_action(bigint,text,uuid,text) to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'archive_items',
    'connections',
    'duplicate_work_merges',
    'health_alert_actions',
    'health_alert_events',
    'health_check_runs',
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

-- Privacy retention policy v1 (Stage 70).
create extension if not exists pg_cron;
create table if not exists public.data_retention_runs (
  id bigint generated by default as identity primary key,
  policy_version smallint not null default 1 check (policy_version > 0),
  executed_at timestamptz not null default now(),
  cutoff_reference timestamptz not null,
  counts jsonb not null default '{}'::jsonb,
  duration_ms integer not null default 0 check (duration_ms >= 0)
);
create index if not exists data_retention_runs_executed_at_idx on public.data_retention_runs(executed_at desc);
alter table public.data_retention_runs enable row level security;
drop policy if exists data_retention_runs_deny_client_access on public.data_retention_runs;
create policy data_retention_runs_deny_client_access on public.data_retention_runs
  for all to anon, authenticated using(false) with check(false);
revoke all on public.data_retention_runs from public,anon,authenticated;
grant all on public.data_retention_runs to service_role;

create or replace function public.delete_user_private_data(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_archives integer;v_tags integer;v_connections integer;v_feedback integer;v_reports integer;v_profile integer;
begin
  if p_user_id is null then raise exception 'user id is required';end if;
  select count(*) into v_archives from public.archive_items where user_id=p_user_id;
  select count(*) into v_tags from public.taste_tags where user_id=p_user_id;
  select count(*) into v_connections from public.connections where user_id=p_user_id;
  select count(*) into v_feedback from public.recommendation_feedback where user_id=p_user_id;
  select count(*) into v_reports from public.metadata_reports where user_id=p_user_id;
  delete from public.profiles where id=p_user_id;get diagnostics v_profile=row_count;
  if exists(select 1 from public.archive_items where user_id=p_user_id)
    or exists(select 1 from public.taste_tags where user_id=p_user_id)
    or exists(select 1 from public.connections where user_id=p_user_id)
    or exists(select 1 from public.recommendation_feedback where user_id=p_user_id)
    or exists(select 1 from public.metadata_reports where user_id=p_user_id)
  then raise exception 'private data deletion was incomplete';end if;
  return jsonb_build_object('deleted',true,'profile',v_profile,'archives',v_archives,'tasteTags',v_tags,'connections',v_connections,'recommendationFeedback',v_feedback,'metadataReports',v_reports);
end $$;
revoke all on function public.delete_user_private_data(uuid) from public,anon,authenticated;
grant execute on function public.delete_user_private_data(uuid) to service_role;

create or replace function public.run_data_retention(p_now timestamptz default clock_timestamp(),p_batch_size integer default 5000) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_started timestamptz:=clock_timestamp();v_batch integer:=greatest(1,least(coalesce(p_batch_size,5000),20000));
  v_connections integer:=0;v_feedback integer:=0;v_reports integer:=0;v_changes integer:=0;v_merges integer:=0;
  v_alerts integer:=0;v_health integer:=0;v_buckets integer:=0;v_run_history integer:=0;v_cron_history integer:=0;
  v_run_id bigint;v_counts jsonb;v_duration integer;
begin
  with candidates as(select ctid from public.connections where updated_at<p_now-interval '180 days' order by updated_at limit v_batch for update skip locked)
    delete from public.connections t using candidates c where t.ctid=c.ctid;get diagnostics v_connections=row_count;
  with candidates as(select ctid from public.recommendation_feedback where updated_at<p_now-interval '730 days' order by updated_at limit v_batch for update skip locked)
    delete from public.recommendation_feedback t using candidates c where t.ctid=c.ctid;get diagnostics v_feedback=row_count;
  with candidates as(select ctid from public.metadata_reports where(status in('accepted','rejected') and reviewed_at<p_now-interval '365 days')or(status='pending' and created_at<p_now-interval '180 days')order by created_at limit v_batch for update skip locked)
    delete from public.metadata_reports t using candidates c where t.ctid=c.ctid;get diagnostics v_reports=row_count;
  with candidates as(select ctid from public.metadata_changes where report_id is null and status<>'applying' and changed_at<p_now-interval '1095 days' order by changed_at limit v_batch for update skip locked)
    delete from public.metadata_changes t using candidates c where t.ctid=c.ctid;get diagnostics v_changes=row_count;
  with candidates as(select ctid from public.duplicate_work_merges where restored_at<p_now-interval '1095 days' order by restored_at limit v_batch for update skip locked)
    delete from public.duplicate_work_merges t using candidates c where t.ctid=c.ctid;get diagnostics v_merges=row_count;
  with candidates as(select ctid from public.health_alert_events where resolved_at<p_now-interval '365 days' order by resolved_at limit v_batch for update skip locked)
    delete from public.health_alert_events t using candidates c where t.ctid=c.ctid;get diagnostics v_alerts=row_count;
  with candidates as(select r.ctid from public.health_check_runs r where r.checked_at<p_now-interval '90 days' and not exists(select 1 from public.health_alert_events e where e.health_check_run_id=r.id)order by r.checked_at limit v_batch for update of r skip locked)
    delete from public.health_check_runs t using candidates c where t.ctid=c.ctid;get diagnostics v_health=row_count;
  with candidates as(select ctid from public.api_rate_limit_buckets where updated_at<p_now-interval '2 days' order by updated_at limit v_batch for update skip locked)
    delete from public.api_rate_limit_buckets t using candidates c where t.ctid=c.ctid;get diagnostics v_buckets=row_count;
  with candidates as(select ctid from public.data_retention_runs where executed_at<p_now-interval '365 days' order by executed_at limit v_batch for update skip locked)
    delete from public.data_retention_runs t using candidates c where t.ctid=c.ctid;get diagnostics v_run_history=row_count;
  if to_regclass('cron.job_run_details') is not null then
    execute format('with candidates as (select ctid from cron.job_run_details where end_time < $1 - interval ''30 days'' order by end_time limit %s) delete from cron.job_run_details t using candidates c where t.ctid=c.ctid',v_batch)using p_now;
    get diagnostics v_cron_history=row_count;
  end if;
  v_counts:=jsonb_build_object('connections',v_connections,'recommendationFeedback',v_feedback,'metadataReports',v_reports,'metadataChanges',v_changes,'restoredMergeAudits',v_merges,'resolvedHealthAlerts',v_alerts,'healthChecks',v_health,'rateLimitBuckets',v_buckets,'retentionRuns',v_run_history,'cronRuns',v_cron_history);
  v_duration:=greatest(0,floor(extract(epoch from(clock_timestamp()-v_started))*1000)::integer);
  insert into public.data_retention_runs(policy_version,executed_at,cutoff_reference,counts,duration_ms)values(1,clock_timestamp(),p_now,v_counts,v_duration)returning id into v_run_id;
  return jsonb_build_object('runId',v_run_id,'policyVersion',1,'counts',v_counts,'durationMs',v_duration);
end $$;
revoke all on function public.run_data_retention(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.run_data_retention(timestamptz,integer) to service_role;

do $schedule$ declare v_job_id bigint;begin
  for v_job_id in select jobid from cron.job where jobname='taste-constellation-data-retention' loop perform cron.unschedule(v_job_id);end loop;
  perform cron.schedule('taste-constellation-data-retention','40 3 * * *',$job$select public.run_data_retention();$job$);
  for v_job_id in select jobid from cron.job where jobname='taste-constellation-recommendation-metrics-retention' loop perform cron.unschedule(v_job_id);end loop;
  perform cron.schedule('taste-constellation-recommendation-metrics-retention','15 4 * * *',$job$select public.prune_recommendation_metrics();$job$);
end $schedule$;
