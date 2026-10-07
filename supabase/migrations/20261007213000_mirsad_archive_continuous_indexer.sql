-- Isolated continuous archive indexer state.
-- This migration does not alter news_articles, ingest, translation, trimming, or live-feed ordering.

CREATE TABLE IF NOT EXISTS public.mirsad_archive_indexer_state (
  state_id boolean PRIMARY KEY DEFAULT true CHECK (state_id IS TRUE),
  lease_until timestamptz,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  batches_completed bigint NOT NULL DEFAULT 0 CHECK (batches_completed >= 0),
  articles_indexed bigint NOT NULL DEFAULT 0 CHECK (articles_indexed >= 0),
  articles_failed bigint NOT NULL DEFAULT 0 CHECK (articles_failed >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.mirsad_archive_indexer_state (state_id)
VALUES (true)
ON CONFLICT (state_id) DO NOTHING;

ALTER TABLE public.mirsad_archive_indexer_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mirsad_archive_indexer_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mirsad_archive_indexer_state TO service_role;

CREATE OR REPLACE FUNCTION public.mirsad_archive_indexer_try_claim(p_lease_seconds integer DEFAULT 120)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 600 THEN
    RETURN false;
  END IF;
  UPDATE public.mirsad_archive_indexer_state
  SET lease_until = now() + make_interval(secs => p_lease_seconds),
      last_run_at = now(),
      updated_at = now()
  WHERE state_id IS TRUE
    AND (lease_until IS NULL OR lease_until < now());
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mirsad_archive_indexer_finish(
  p_indexed integer DEFAULT 0,
  p_failed integer DEFAULT 0,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.mirsad_archive_indexer_state
  SET lease_until = NULL,
      last_success_at = CASE WHEN coalesce(p_error, '') = '' THEN now() ELSE last_success_at END,
      last_error = CASE WHEN p_error IS NULL THEN NULL ELSE left(p_error, 160) END,
      batches_completed = batches_completed + 1,
      articles_indexed = articles_indexed + greatest(coalesce(p_indexed, 0), 0),
      articles_failed = articles_failed + greatest(coalesce(p_failed, 0), 0),
      updated_at = now()
  WHERE state_id IS TRUE;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.mirsad_archive_indexer_try_claim(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mirsad_archive_indexer_finish(integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mirsad_archive_indexer_try_claim(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mirsad_archive_indexer_finish(integer, integer, text) TO service_role;

-- Run only the isolated archive worker. It uses the existing public anon JWT solely
-- to pass Supabase's JWT gate; the worker itself performs all data access with service role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mirsad-archive-index-worker') THEN
    PERFORM cron.schedule(
      'mirsad-archive-index-worker',
      '*/10 * * * *',
      $job$
        SELECT net.http_post(
          url := 'https://dndlkenyfymlrjnslyzb.supabase.co/functions/v1/mirsad-archive-index-worker',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRuZGxrZW55ZnltbHJqbnNseXpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NDczMDEsImV4cCI6MjEwNDUyMzMwMX0.jBNL9JBF8OvwfieTl-HoAVL4leihYeAUkAQ-JaXy0y4',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6ImFub24iLCJpYXQiOjE3ODg5NDczMDEsImV4cCI6MjEwNDUyMzMwMX0.jBNL9JBF8OvwfieTl-HoAVL4leihYeAUkAQ-JaXy0y4'
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 30000
        );
      $job$
    );
  END IF;
END
$$;
