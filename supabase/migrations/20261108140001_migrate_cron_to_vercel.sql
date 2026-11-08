-- Stage 3 release gate: Vercel owns application scheduling after its
-- production Cron routes and CRON_SECRET have been verified. Run history is
-- intentionally retained by pg_cron even after these jobs are unscheduled.
do $migration$
declare
  v_job_name text;
begin
  foreach v_job_name in array array[
    'taste-constellation-health-monitor',
    'taste-constellation-data-retention',
    'taste-constellation-recommendation-metrics-retention'
  ]
  loop
    if exists (select 1 from cron.job where jobname = v_job_name) then
      perform cron.unschedule(v_job_name);
    end if;
  end loop;
end
$migration$;
