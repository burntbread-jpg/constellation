-- RETIRED: Stage 3 moved application scheduling to Vercel Cron.
-- This compatibility script is intentionally safe to run on an older project:
-- it removes the legacy health job instead of recreating a Sites HTTP call.
select cron.unschedule(jobname)
from cron.job
where jobname = 'taste-constellation-health-monitor';
