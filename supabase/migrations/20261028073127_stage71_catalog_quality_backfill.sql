-- The classifier trigger is column-scoped. Touch a watched column so every
-- historical row receives a canonical key, quality score, and candidate or
-- quarantine classification before reviewed launch works are promoted.
update public.works
set canonical_key = canonical_key;

update public.works
set catalog_status = 'curated'
where source = 'Taste Constellation'
  and metadata_quality_score >= 90;

delete from public.connections c
using public.works w
where c.to_work_id = w.id
  and w.catalog_status not in ('curated','verified');
