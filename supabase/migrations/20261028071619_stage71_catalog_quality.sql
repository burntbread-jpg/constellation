alter table public.works
  add column if not exists catalog_status text not null default 'candidate',
  add column if not exists metadata_quality_score integer not null default 0,
  add column if not exists metadata_verified_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'works_catalog_status_check') then
    alter table public.works add constraint works_catalog_status_check
      check (catalog_status in ('candidate','curated','verified','quarantined'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'works_metadata_quality_score_check') then
    alter table public.works add constraint works_metadata_quality_score_check
      check (metadata_quality_score between 0 and 100);
  end if;
end $$;

create or replace function public.catalog_metadata_quality(
  p_title text,
  p_creator text,
  p_release_year integer,
  p_poster_url text,
  p_description text,
  p_editorial_intro text,
  p_canonical_key text
) returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (case when nullif(btrim(p_title), '') is not null then 10 else 0 end) +
    (case when nullif(btrim(p_creator), '') is not null and lower(btrim(p_creator)) not in ('unknown','미상','작자 미상','제작진 정보 없음','정보 없음') then 15 else 0 end) +
    (case when p_release_year between 1800 and extract(year from current_date)::integer + 3 then 15 else 0 end) +
    (case when p_poster_url ~ '^https://' then 20 else 0 end) +
    (case when length(btrim(coalesce(p_description, ''))) >= 24 then 15 else 0 end) +
    (case when length(btrim(coalesce(p_editorial_intro, ''))) >= 12 then 20 else 0 end) +
    (case when nullif(btrim(p_canonical_key), '') is not null then 5 else 0 end);
$$;

revoke execute on function public.catalog_metadata_quality(text,text,integer,text,text,text,text) from public, anon, authenticated;
grant execute on function public.catalog_metadata_quality(text,text,integer,text,text,text,text) to service_role;

create or replace function public.classify_work_catalog()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.canonical_key := coalesce(
    nullif(btrim(new.canonical_key), ''),
    lower(new.media_type) || ':' || regexp_replace(lower(coalesce(new.title, '')), '[^a-z0-9가-힣]+', '', 'g') || ':' || coalesce(new.release_year::text, 'unknown')
  );
  new.metadata_quality_score := public.catalog_metadata_quality(
    new.title, new.creator, new.release_year, new.poster_url,
    new.description, new.editorial_intro, new.canonical_key
  );

  if new.catalog_status in ('curated','verified') and new.metadata_quality_score < 90 then
    new.catalog_status := 'candidate';
    new.metadata_verified_at := null;
  elsif new.catalog_status in ('curated','verified') then
    new.metadata_verified_at := coalesce(new.metadata_verified_at, now());
  elsif new.source <> 'Taste Constellation' and (
    new.metadata_quality_score < 55
    or new.title ~* '(전[0-9]+권|[0-9]+권|완결|세트|애장판|완전판|리버시|외전|가이드북|화보집|대본집)'
    or concat_ws(' ', new.title, new.description, new.tags::text) ~* '(웹\s*소설|web\s*novel|juvenile nonfiction|study aids?|textbooks?|교양\s*수업|학습서|문제집|수험서|교과서)'
  ) then
    new.catalog_status := 'quarantined';
    new.metadata_verified_at := null;
  else
    new.catalog_status := 'candidate';
    new.metadata_verified_at := null;
  end if;
  return new;
end;
$$;

revoke execute on function public.classify_work_catalog() from public, anon, authenticated;
grant execute on function public.classify_work_catalog() to service_role;
drop trigger if exists works_catalog_classification on public.works;
create trigger works_catalog_classification
before insert or update of title, creator, release_year, poster_url, description, editorial_intro, canonical_key, catalog_status
on public.works for each row execute function public.classify_work_catalog();

-- Official/reference artwork verified on 2026-10-28. Runtime artwork lookup can
-- still choose a higher-resolution localized alternative without changing identity.
update public.works set
  external_id = case id
    when 'fallback:film:her' then '152601'
    when 'fallback:film:parasite' then '496243'
    when 'fallback:film:melancholia' then '62215'
    when 'fallback:film:arrival' then '329865'
    when 'fallback:film:eternal-sunshine' then '38'
    when 'fallback:film:2001' then '62'
    when 'fallback:film:in-the-mood' then '843'
    else external_id end,
  original_title = case id
    when 'fallback:film:her' then 'Her'
    when 'fallback:film:parasite' then 'Parasite'
    when 'fallback:film:melancholia' then 'Melancholia'
    when 'fallback:film:arrival' then 'Arrival'
    when 'fallback:film:eternal-sunshine' then 'Eternal Sunshine of the Spotless Mind'
    when 'fallback:film:2001' then '2001: A Space Odyssey'
    when 'fallback:film:in-the-mood' then 'In the Mood for Love'
    else original_title end,
  poster_url = case id
    when 'fallback:film:her' then 'https://image.tmdb.org/t/p/w780/eCOtqtfvn7mxGl6nfmq4b1exJRc.jpg'
    when 'fallback:film:parasite' then 'https://image.tmdb.org/t/p/w780/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg'
    when 'fallback:film:melancholia' then 'https://upload.wikimedia.org/wikipedia/en/7/71/Melancholia_%282011_film_poster%29.png'
    when 'fallback:film:arrival' then 'https://image.tmdb.org/t/p/w780/x2FJsf1ElAgr63Y3PNPtJrcmpoe.jpg'
    when 'fallback:film:eternal-sunshine' then 'https://image.tmdb.org/t/p/w780/5MwkWH9tYHv3mV9OdYTMR5qreIz.jpg'
    when 'fallback:film:2001' then 'https://image.tmdb.org/t/p/w780/ve72VxNqjGM69Uky4WTo2bK6rfq.jpg'
    when 'fallback:film:in-the-mood' then 'https://image.tmdb.org/t/p/w780/iYypPT4bhqXfq1b6EnmxvRt6b2Y.jpg'
    else poster_url end,
  catalog_status = 'curated'
where id in (
  'fallback:film:her','fallback:film:parasite','fallback:film:melancholia',
  'fallback:film:arrival','fallback:film:eternal-sunshine','fallback:film:2001',
  'fallback:film:in-the-mood'
);

insert into public.works (
  id, external_id, title, original_title, creator, release_year, media_type,
  poster_url, description, tags, source, canonical_key, editorial_intro, catalog_status
) values
  (
    'fallback:manga:parasite', null, '기생수', '寄生獣', '이와아키 히토시', 1988, 'MANGA',
    'https://upload.wikimedia.org/wikipedia/ko/d/d9/%EA%B8%B0%EC%83%9D%EC%88%98_1%EA%B6%8C_%ED%91%9C%EC%A7%80.jpg',
    '인간의 오른손에 자리 잡은 기생생물과의 공존을 통해 인간과 포식자의 경계를 묻는 만화',
    '["인간과 비인간","신체","공존","윤리"]'::jsonb, 'Taste Constellation',
    'manga:기생수:series', '오른손을 빌려준 외계 생명체와 함께 인간이 정말 지구의 주인인지 되묻는 작품.', 'curated'
  ),
  (
    'fallback:manga:fullmetal-alchemist', null, '강철의 연금술사', '鋼の錬金術師', '아라카와 히로무', 2001, 'MANGA',
    'https://upload.wikimedia.org/wikipedia/ko/0/0b/%EA%B0%95%EC%B2%A0%EC%9D%98_%EC%97%B0%EA%B8%88%EC%88%A0%EC%82%AC_1%EA%B6%8C_%ED%91%9C%EC%A7%80.jpg',
    '금지된 연금술로 몸을 잃은 형제가 대가와 책임, 국가 폭력의 진실을 좇는 만화',
    '["형제","대가","신체","국가"]'::jsonb, 'Taste Constellation',
    'manga:강철의연금술사:series', '죽은 엄마를 되돌리려다 몸을 잃은 형제가, 대가 없는 기적은 없다는 법칙과 싸우는 작품.', 'curated'
  )
on conflict (id) do update set
  original_title = excluded.original_title,
  creator = excluded.creator,
  release_year = excluded.release_year,
  media_type = excluded.media_type,
  poster_url = excluded.poster_url,
  description = excluded.description,
  tags = excluded.tags,
  source = excluded.source,
  canonical_key = excluded.canonical_key,
  editorial_intro = excluded.editorial_intro,
  catalog_status = excluded.catalog_status,
  updated_at = now();

-- Reclassify every historical row, then explicitly promote the reviewed seed.
update public.works set updated_at = updated_at;
update public.works set catalog_status = 'curated'
where source = 'Taste Constellation' and metadata_quality_score >= 90;

-- Connections are derived caches. Remove only cached targets that failed the
-- catalog gate so the next request rebuilds them from reviewed works.
delete from public.connections c
using public.works w
where c.to_work_id = w.id
  and w.catalog_status not in ('curated','verified');

create index if not exists works_catalog_ready_idx
  on public.works (catalog_status, media_type, metadata_quality_score desc)
  where catalog_status in ('curated','verified') and taste_vector is not null;

create or replace function public.upsert_work_catalog(p_works jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer := 0;
begin
  insert into public.works (
    id, external_id, title, original_title, creator, release_year,
    media_type, poster_url, description, tags, publishers, edition_verified,
    editorial_intro, source, canonical_key, catalog_status, metadata_verified_at,
    taste_analysis, taste_vector, taste_vector_updated_at
  )
  select
    item->>'id', nullif(item->>'external_id',''), item->>'title', nullif(item->>'original_title',''),
    item->>'creator', nullif(item->>'release_year','')::integer, item->>'media_type',
    nullif(item->>'poster_url',''), coalesce(item->>'description',''), coalesce(item->'tags','[]'::jsonb),
    coalesce(item->'publishers','[]'::jsonb), coalesce((item->>'edition_verified')::boolean,false),
    nullif(item->>'editorial_intro',''), coalesce(item->>'source','Taste Constellation'),
    nullif(item->>'canonical_key',''),
    case when item->>'catalog_status' in ('curated','verified') then item->>'catalog_status' else 'candidate' end,
    case when item->>'catalog_status' in ('curated','verified') then now() else null end,
    item->'taste_analysis', (item->>'taste_vector')::extensions.vector, now()
  from jsonb_array_elements(coalesce(p_works,'[]'::jsonb)) item
  where nullif(item->>'id','') is not null and nullif(item->>'title','') is not null
  on conflict (id) do update set
    external_id=coalesce(public.works.external_id,nullif(excluded.external_id,'')),
    original_title=coalesce(public.works.original_title,nullif(excluded.original_title,'')),
    creator=case when public.works.creator is null or public.works.creator in ('작자 미상','제작진 정보 없음') then excluded.creator else public.works.creator end,
    release_year=coalesce(public.works.release_year,excluded.release_year),
    media_type=case when public.works.media_type='OTHER' then excluded.media_type else public.works.media_type end,
    poster_url=coalesce(public.works.poster_url,excluded.poster_url),
    description=case when length(excluded.description)>length(public.works.description) then excluded.description else public.works.description end,
    tags=case when jsonb_array_length(excluded.tags)>jsonb_array_length(public.works.tags) then excluded.tags else public.works.tags end,
    publishers=case when jsonb_array_length(excluded.publishers)>jsonb_array_length(public.works.publishers) then excluded.publishers else public.works.publishers end,
    edition_verified=public.works.edition_verified or excluded.edition_verified,
    editorial_intro=coalesce(excluded.editorial_intro,public.works.editorial_intro),
    canonical_key=coalesce(public.works.canonical_key,excluded.canonical_key),
    catalog_status=case when public.works.catalog_status in ('curated','verified') then public.works.catalog_status else excluded.catalog_status end,
    metadata_verified_at=case when public.works.catalog_status in ('curated','verified') then public.works.metadata_verified_at else excluded.metadata_verified_at end,
    taste_analysis=excluded.taste_analysis, taste_vector=excluded.taste_vector,
    taste_vector_updated_at=now(), updated_at=now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.upsert_work_catalog(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_work_catalog(jsonb) to service_role;

drop function if exists public.match_work_catalog(extensions.vector,text[],integer);
create function public.match_work_catalog(
  p_query extensions.vector(25), p_excluded text[] default array[]::text[], p_limit integer default 48
) returns table (
  id text, external_id text, title text, original_title text, creator text,
  release_year integer, media_type text, poster_url text, description text,
  tags jsonb, publishers jsonb, edition_verified boolean, editorial_intro text,
  source text, taste_analysis jsonb, similarity double precision
)
language sql
security definer
set search_path = pg_catalog, extensions
stable
as $$
  select w.id,w.external_id,w.title,w.original_title,w.creator,w.release_year,w.media_type,
    w.poster_url,w.description,w.tags,w.publishers,w.edition_verified,w.editorial_intro,w.source,w.taste_analysis,
    1-(w.taste_vector<=>p_query) as similarity
  from public.works w
  where w.taste_vector is not null
    and w.catalog_status in ('curated','verified')
    and w.metadata_quality_score >= 90
    and not (w.id=any(coalesce(p_excluded,array[]::text[])))
  order by w.taste_vector<=>p_query
  limit greatest(1,least(coalesce(p_limit,48),100));
$$;

revoke all on function public.match_work_catalog(extensions.vector,text[],integer) from public, anon, authenticated;
grant execute on function public.match_work_catalog(extensions.vector,text[],integer) to service_role;
