set lock_timeout = '5s';

alter table public.works
  add column if not exists editorial_intro text;

update public.works
set editorial_intro = case media_type || ':' || regexp_replace(lower(coalesce(title, '')), '[^a-z0-9가-힣]', '', 'g')
  when 'ANIME:신세기에반게리온' then '고슴도치의 딜레마를 세계의 종말까지 밀어붙인 작품.'
  when 'BOOK:인간실격' then '웃는 얼굴을 가면으로 쓴 사람이 그 가면에 질식해 가는 작품.'
  when 'BOOK:유년기의끝' then '인류의 졸업식이 곧 인류의 장례식이 되는 작품.'
  when 'BOOK:클라라와태양' then '태양을 믿는 기계의 눈으로 인간의 사랑이 얼마나 계산적이고 간절한지 비추는 작품.'
  when 'BOOK:사랑의기술' then '사랑을 번개처럼 기다리는 대신 근육처럼 단련하라고 말하는 작품.'
  when 'FILM:her' then '목소리와 사랑에 빠진 남자를 통해 외로움이 운영체제까지 사람으로 만드는 작품.'
  when 'FILM:멜랑콜리아' then '세상이 끝나는 날에야 마음의 날씨와 우주의 날씨가 같아지는 작품.'
  when 'FILM:컨택트' then '외계의 언어를 배우는 일이 미래의 상실까지 사랑하는 법이 되는 작품.'
  when 'FILM:기생충' then '반지하와 대저택 사이의 계단에 한 사회의 욕망을 올려놓은 작품.'
  when 'ANIME:serialexperimentslain' then '인터넷에 접속할수록 내가 누구인지 로그아웃되는 작품.'
  when 'ANIME:공각기동대' then '몸을 갈아 끼울 수 있는 시대에 영혼만은 어디에 사는지 추적하는 작품.'
  when 'ANIME:천사의알' then '깨지면 믿음도 사라질 것 같은 알 하나로 폐허 전체를 숨 쉬게 하는 작품.'
  when 'ANIME:건버스터' then '우주를 구한 몇 분이 지구의 수천 년이 되는, 성장의 값을 시간으로 치르는 작품.'
  when 'BOOK:나를보내지마' then '빌려 쓴 인생에서도 사랑만큼은 자기 것이 될 수 있는지 묻는 작품.'
  when 'BOOK:어둠의왼손' then '성별이 계절처럼 바뀌는 별에서 고정된 편견이 더 낯선 생물이 되는 작품.'
  when 'BOOK:빌러비드' then '묻어 둔 과거가 문을 두드리며 돌아와 가족의 밥상에 앉는 작품.'
  when 'FILM:이터널선샤인' then '사랑을 지우는 수술대 위에서 헤어진 마음이 다시 도망치기 시작하는 작품.'
  when 'FILM:2001스페이스오디세이' then '원숭이가 던진 뼈를 우주선까지 날려 인간의 진화를 한 번의 점프로 보여주는 작품.'
  when 'FILM:화양연화' then '좁은 복도에서 스친 두 사람이 평생 건너지 못한 문턱을 바라보는 작품.'
  when 'ANIME:퍼펙트블루' then '스타의 얼굴을 여러 거울에 깨뜨려 진짜 내가 어느 조각인지 묻는 작품.'
  when 'ANIME:파프리카' then '꿈의 문이 고장 나자 잠든 욕망들이 한낮의 거리로 쏟아지는 작품.'
  else editorial_intro
end
where editorial_intro is null or btrim(editorial_intro) = '';

update public.works
set poster_url = case id
  when 'fallback:anime:lain' then 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx339-xF2wp1NQuQ4r.png'
  when 'fallback:anime:ghost-in-the-shell' then 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx43-Y6EjeEMM14dj.png'
  when 'fallback:anime:angels-egg' then 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx885-UqlerD6tJKxs.png'
  when 'fallback:anime:gunbuster' then 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx949-LDCFxDufSwTQ.png'
  when 'fallback:anime:perfect-blue' then 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx437-69NMlXKFeuse.jpg'
  when 'fallback:anime:paprika' then 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/b1943-jMCEYL1Ixmgc.png'
  else poster_url
end
where poster_url is null or btrim(poster_url) = '';

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
  select (x->>'user_id')::uuid, x->>'work_id', x->>'tag', x->>'category',
    (x->>'score')::real, x->>'evidence', x->>'engine'
  from jsonb_array_elements(coalesce(p_tags, '[]'::jsonb)) as x;
end;
$$;

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
    taste_analysis, taste_vector, taste_vector_updated_at
  )
  select
    item->>'id', nullif(item->>'external_id', ''), item->>'title',
    nullif(item->>'original_title', ''), item->>'creator',
    nullif(item->>'release_year', '')::integer, item->>'media_type',
    nullif(item->>'poster_url', ''), coalesce(item->>'description', ''),
    coalesce(item->'tags', '[]'::jsonb), coalesce(item->'publishers', '[]'::jsonb),
    coalesce((item->>'edition_verified')::boolean, false), nullif(item->>'editorial_intro', ''),
    coalesce(item->>'source', 'Taste Constellation'),
    item->'taste_analysis', (item->>'taste_vector')::extensions.vector, now()
  from jsonb_array_elements(coalesce(p_works, '[]'::jsonb)) as item
  where nullif(item->>'id', '') is not null
    and nullif(item->>'title', '') is not null
  on conflict (id) do update set
    external_id = coalesce(public.works.external_id, nullif(excluded.external_id, '')),
    original_title = coalesce(public.works.original_title, nullif(excluded.original_title, '')),
    creator = case when public.works.creator is null or public.works.creator = '작자 미상' then excluded.creator else public.works.creator end,
    release_year = coalesce(public.works.release_year, excluded.release_year),
    media_type = case when public.works.media_type = 'OTHER' then excluded.media_type else public.works.media_type end,
    poster_url = coalesce(public.works.poster_url, excluded.poster_url),
    description = case when length(excluded.description) > length(public.works.description) then excluded.description else public.works.description end,
    tags = case when jsonb_array_length(excluded.tags) > jsonb_array_length(public.works.tags) then excluded.tags else public.works.tags end,
    publishers = case when jsonb_array_length(excluded.publishers) > jsonb_array_length(public.works.publishers) then excluded.publishers else public.works.publishers end,
    edition_verified = public.works.edition_verified or excluded.edition_verified,
    editorial_intro = coalesce(excluded.editorial_intro, public.works.editorial_intro),
    taste_analysis = excluded.taste_analysis,
    taste_vector = excluded.taste_vector,
    taste_vector_updated_at = now(),
    updated_at = now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.save_archive_analysis(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_archive_analysis(jsonb, jsonb, jsonb) to service_role;
revoke all on function public.upsert_work_catalog(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_work_catalog(jsonb) to service_role;
