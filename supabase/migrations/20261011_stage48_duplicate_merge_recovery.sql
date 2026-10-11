alter table public.duplicate_work_merges
  add column if not exists restored_at timestamptz,
  add column if not exists restored_by text,
  add column if not exists restore_reason text;

create or replace function public.restore_duplicate_work_merge(
  p_audit_id bigint,
  p_reviewer_id text,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_audit public.duplicate_work_merges%rowtype;
  v_removed public.works%rowtype;
begin
  select * into v_audit
  from public.duplicate_work_merges
  where id = p_audit_id
  for update;

  if not found then
    raise exception 'merge audit not found';
  end if;
  if v_audit.restored_at is not null then
    raise exception 'merge already restored';
  end if;
  if not exists (select 1 from public.works where id = v_audit.target_work_id) then
    raise exception 'merge target is missing';
  end if;
  if exists (select 1 from public.works where id = v_audit.removed_work_id) then
    raise exception 'removed work already exists';
  end if;

  v_removed := jsonb_populate_record(null::public.works, v_audit.removed_snapshot);
  insert into public.works
  select v_removed.*;

  update public.duplicate_work_merges
  set restored_at = now(),
      restored_by = p_reviewer_id,
      restore_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_audit_id;

  return jsonb_build_object(
    'audit_id', p_audit_id,
    'target_id', v_audit.target_work_id,
    'restored_id', v_audit.removed_work_id,
    'catalog_restored', true,
    'personalization_split', false
  );
end;
$$;

revoke all on function public.restore_duplicate_work_merge(bigint,text,text) from public, anon, authenticated;
grant execute on function public.restore_duplicate_work_merge(bigint,text,text) to service_role;
