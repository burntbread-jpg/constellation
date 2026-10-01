create table if not exists public.profiles (
  id uuid primary key,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.archive_items (
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_id text not null references public.works(id) on delete cascade,
  work_json jsonb,
  rating smallint,
  my_comment text not null default '',
  ai_comment text not null default '',
  analysis_status text not null default 'pending',
  analysis_json jsonb,
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
alter table public.archive_items add column if not exists updated_at timestamptz not null default now();
alter table public.archive_items add column if not exists taste_vector extensions.vector(25);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'archive_items_rating_check') then
    alter table public.archive_items add constraint archive_items_rating_check check (rating between 1 and 5);
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

create index if not exists archive_items_user_created_idx
  on public.archive_items (user_id, created_at desc);

create index if not exists taste_tags_user_score_idx
  on public.taste_tags (user_id, score desc);

create index if not exists connections_user_source_idx
  on public.connections (user_id, from_work_id, connection_type, score desc);

create index if not exists archive_items_taste_vector_idx
  on public.archive_items using hnsw (taste_vector extensions.vector_cosine_ops);

alter table public.profiles enable row level security;
alter table public.works enable row level security;
alter table public.archive_items enable row level security;
alter table public.taste_tags enable row level security;
alter table public.connections enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.works from anon, authenticated;
revoke all on public.archive_items from anon, authenticated;
revoke all on public.taste_tags from anon, authenticated;
revoke all on public.connections from anon, authenticated;

grant all on public.profiles to service_role;
grant all on public.works to service_role;
grant all on public.archive_items to service_role;
grant all on public.taste_tags to service_role;
grant all on public.connections to service_role;

create or replace function public.save_connections(
  p_user_id uuid,
  p_connections jsonb
) returns void
language plpgsql
security definer
set search_path = public
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
set search_path = public, extensions
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
set search_path = public
as $$
begin
  insert into public.works (
    id, external_id, title, original_title, creator, release_year,
    media_type, poster_url, description, tags, source
  ) values (
    p_work->>'id', p_work->>'external_id', p_work->>'title', p_work->>'original_title',
    p_work->>'creator', (p_work->>'release_year')::integer, p_work->>'media_type',
    p_work->>'poster_url', p_work->>'description', coalesce(p_work->'tags', '[]'::jsonb),
    p_work->>'source'
  ) on conflict (id) do nothing;

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
  select
    (tag->>'user_id')::uuid, tag->>'work_id', tag->>'tag', tag->>'category',
    (tag->>'score')::double precision, tag->>'evidence', tag->>'engine'
  from jsonb_array_elements(p_tags) as tag;
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
set search_path = public, extensions
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
