alter table public.archive_items
  add column if not exists archive_state text not null default 'completed';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'archive_items_state_check') then
    alter table public.archive_items
      add constraint archive_items_state_check
      check (archive_state in ('completed', 'planned'));
  end if;
end $$;

create index if not exists archive_items_user_state_idx
  on public.archive_items (user_id, archive_state, updated_at desc);
