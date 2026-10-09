alter table public.metadata_reports add column if not exists resolution_note text;
alter table public.metadata_reports add column if not exists reviewed_by text;
