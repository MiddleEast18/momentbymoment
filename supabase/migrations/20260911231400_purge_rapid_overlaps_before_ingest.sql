select cron.unschedule('mirsad-rapid-news-ingest');

select cron.schedule(
  'mirsad-rapid-news-ingest',
  '* * * * *',
  $$
    delete from public.rapid_news r using public.news_articles n
    where r.source_url = n.source_url;
    select net.http_post(
      url := 'https://dndlkenyfymlrjnslyzb.supabase.co/functions/v1/mirsad-rapid-ingest',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRuZGxrZW55ZnltbHJqbnNseXpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NDczMDEsImV4cCI6MjEwNDUyMzMwMX0.jBNL9JBF8OvwfieTl-HoAVL4leihYeAUkAQ-JaXy0y4',
        'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRuZGxrZW55ZnltbHJqbnNseXpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NDczMDEsImV4cCI6MjEwNDUyMzMwMX0.jBNL9JBF8OvwfieTl-HoAVL4leihYeAUkAQ-JaXy0y4'
      ),
      body := '{}'::jsonb
    );
  $$
);
