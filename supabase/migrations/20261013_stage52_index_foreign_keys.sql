create index if not exists archive_items_work_idx
  on public.archive_items(work_id);

create index if not exists metadata_changes_report_idx
  on public.metadata_changes(report_id);

create index if not exists metadata_reports_user_idx
  on public.metadata_reports(user_id);
