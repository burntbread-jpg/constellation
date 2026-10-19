alter table public.health_alert_events
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by uuid,
  add column if not exists resolution_note text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'health_alert_events_resolution_note_length'
      and conrelid = 'public.health_alert_events'::regclass
  ) then
    alter table public.health_alert_events
      add constraint health_alert_events_resolution_note_length
      check (resolution_note is null or char_length(resolution_note) between 5 and 500);
  end if;
end
$$;

create index if not exists health_alert_events_unacknowledged_idx
  on public.health_alert_events (created_at desc)
  where acknowledged_at is null;

alter table public.health_alert_events enable row level security;
revoke all on public.health_alert_events from anon, authenticated;
grant all on public.health_alert_events to service_role;
