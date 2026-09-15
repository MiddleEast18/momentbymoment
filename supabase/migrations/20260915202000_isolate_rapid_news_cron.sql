do $migration$
declare
  existing_schedule text;
  existing_command text;
begin
  select schedule, command
    into existing_schedule, existing_command
  from cron.job
  where jobname = 'mirsad-rapid-news-ingest'
  limit 1;

  if existing_command is null then
    raise exception 'mirsad-rapid-news-ingest cron job was not found';
  end if;

  if position('delete from public.rapid_news' in lower(existing_command)) = 0 then
    raise exception 'mirsad-rapid-news-ingest cron command did not contain the expected rapid-news cross-delete';
  end if;

  existing_command := regexp_replace(
    existing_command,
    'delete[[:space:]]+from[[:space:]]+public\.rapid_news[[:space:]]+r[[:space:]]+using[[:space:]]+public\.news_articles[[:space:]]+n[[:space:]]+where[[:space:]]+r\.source_url[[:space:]]*=[[:space:]]*n\.source_url[[:space:]]*;[[:space:]]*',
    '',
    'i'
  );

  perform cron.unschedule('mirsad-rapid-news-ingest');
  perform cron.schedule('mirsad-rapid-news-ingest', existing_schedule, existing_command);
end
$migration$;
