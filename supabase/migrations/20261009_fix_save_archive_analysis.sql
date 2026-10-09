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
    media_type, poster_url, description, tags, publishers, edition_verified, source
  ) values (
    p_work->>'id', p_work->>'external_id', p_work->>'title', p_work->>'original_title',
    p_work->>'creator', (p_work->>'release_year')::integer, p_work->>'media_type',
    p_work->>'poster_url', p_work->>'description', coalesce(p_work->'tags', '[]'::jsonb),
    coalesce(p_work->'publishers', '[]'::jsonb),
    coalesce((p_work->>'edition_verified')::boolean, false),
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
  select distinct on (tag->>'tag')
    (tag->>'user_id')::uuid, tag->>'work_id', tag->>'tag', tag->>'category',
    (tag->>'score')::double precision, tag->>'evidence', tag->>'engine'
  from jsonb_array_elements(p_tags) as tag
  order by tag->>'tag';
end;
$$;

revoke all on function public.save_archive_analysis(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_archive_analysis(jsonb, jsonb, jsonb) to service_role;
