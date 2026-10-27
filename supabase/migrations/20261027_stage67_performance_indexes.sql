-- Stage 67: indexes aligned with the archive and constellation read paths.
create index if not exists archive_items_user_updated_idx
  on public.archive_items (user_id, updated_at desc);

create index if not exists connections_user_score_idx
  on public.connections (user_id, score desc);
