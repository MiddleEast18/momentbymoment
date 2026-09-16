-- Retire the legacy 24-hour news refresh jobs without deleting shared tables,
-- sources, RPCs, or article history. Safe to apply repeatedly.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'mirsad-news-24h-refresh') then
    perform cron.unschedule('mirsad-news-24h-refresh');
  end if;
  if exists (select 1 from cron.job where jobname = 'mirsad-trusted-news-ingest') then
    perform cron.unschedule('mirsad-trusted-news-ingest');
  end if;
end
$$;
