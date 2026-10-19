-- Run after storing these Vault secrets:
--   taste_site_url: https://your-site.example
--   taste_health_monitor_token: the same HEALTH_MONITOR_TOKEN configured on Sites
--   taste_sites_bypass_token: the Site service-access token (for non-public Sites)
-- The secret values never appear in cron.job or application source.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'taste-constellation-health-monitor';

select cron.schedule(
  'taste-constellation-health-monitor',
  '*/5 * * * *',
  $monitor$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'taste_site_url' limit 1) || '/api/health/scheduled',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'taste_health_monitor_token' limit 1),
      'OAI-Sites-Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'taste_sites_bypass_token' limit 1)
    ),
    body := jsonb_build_object('source', 'supabase-cron', 'requestedAt', now()),
    timeout_milliseconds := 20000
  );
  $monitor$
);
