select cron.unschedule(13);
select cron.schedule(
  'mirsad-rss-ingest',
  '*/15 * * * *',
  $$select net.http_post(
    url := 'https://dndlkenyfymlrjnslyzb.supabase.co/functions/v1/mirsad-ingest',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb
  );$$
);
