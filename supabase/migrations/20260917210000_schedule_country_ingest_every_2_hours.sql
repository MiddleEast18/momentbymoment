-- Run the country-news ingest independently every two hours.
-- The invoke key is stored in Supabase Vault, never in the cron command or Git history.
do $migration$
begin
  if not exists (select 1 from vault.secrets where name = 'mirsad_country_ingest_anon_key') then
    perform vault.create_secret(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRuZGxrZW55ZnltbHJqbnNseXpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NDczMDEsImV4cCI6MjEwNDUyMzMwMX0.jBNL9JBF8OvwfieTl-HoAVL4leihYeAUkAQ-JaXy0y4',
      'mirsad_country_ingest_anon_key',
      'Anon key used only to invoke the JWT-protected country ingest function from pg_cron.'
    );
  end if;
  if exists (select 1 from cron.job where jobname = 'mirsad-country-news-ingest') then
    perform cron.unschedule('mirsad-country-news-ingest');
  end if;
  perform cron.schedule(
    'mirsad-country-news-ingest',
    '0 */2 * * *',
    $cron$
    select net.http_post(
      url := 'https://dndlkenyfymlrjnslyzb.supabase.co/functions/v1/mirsad-country-ingest',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'mirsad_country_ingest_anon_key'),
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mirsad_country_ingest_anon_key')
      ),
      body := '{}'::jsonb
    );
    $cron$
  );
end
$migration$;
