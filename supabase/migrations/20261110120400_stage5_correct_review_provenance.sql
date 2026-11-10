update public.works
set source=regexp_replace(source, '^Human review ·', 'Editorial review ·'),
    updated_at=now()
where catalog_status='verified'
  and source like 'Human review ·%';
