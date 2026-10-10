alter table public.metadata_reports
  add column if not exists evidence_type text
  check (evidence_type in ('official','publisher','award_body','authority_database','reference','other')),
  add column if not exists source_url text;

alter table public.metadata_changes
  add column if not exists evidence_type text
  check (evidence_type in ('official','publisher','award_body','authority_database','reference','other')),
  add column if not exists source_url text;

create or replace function public.fill_metadata_change_provenance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.report_id is not null then
    select evidence_type, source_url
      into new.evidence_type, new.source_url
      from public.metadata_reports
      where id = new.report_id;
  end if;
  return new;
end;
$$;

drop trigger if exists metadata_change_provenance on public.metadata_changes;
create trigger metadata_change_provenance
before insert on public.metadata_changes
for each row execute function public.fill_metadata_change_provenance();
