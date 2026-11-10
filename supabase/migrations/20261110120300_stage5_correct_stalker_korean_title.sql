update public.works
set title='스토커',
    canonical_key='film:스토커:1979',
    updated_at=now()
where id='reviewed:film:잠입자'
  and title='잠입자'
  and media_type='FILM'
  and release_year=1979;
