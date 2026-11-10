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

  if new.catalog_status = 'quarantined' then
    new.metadata_verified_at := null;
  elsif new.catalog_status in ('curated','verified') and new.metadata_quality_score < 90 then
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

update public.works candidate
set catalog_status='quarantined', updated_at=now()
where candidate.catalog_status='candidate'
  and exists (
    select 1 from public.works verified
    where verified.catalog_status='verified'
      and verified.id<>candidate.id
      and verified.canonical_key=candidate.canonical_key
  );
