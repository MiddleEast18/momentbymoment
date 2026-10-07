-- Retire the one-time bootstrap route and its Vault capabilities.
-- The continuous archive indexer is independent and remains active.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.mirsad_archive_bootstrap_jobs
    WHERE active IS TRUE AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'archive_bootstrap_job_still_active';
  END IF;
END
$$;

DELETE FROM vault.secrets s
USING public.mirsad_archive_bootstrap_jobs j
WHERE s.id = j.secret_id;

DROP FUNCTION IF EXISTS public.mirsad_archive_bootstrap_start(uuid);
DROP FUNCTION IF EXISTS public.mirsad_archive_bootstrap_enqueue(uuid);
DROP FUNCTION IF EXISTS public.mirsad_archive_bootstrap_set_cleanup(uuid, text);
DROP FUNCTION IF EXISTS public.mirsad_archive_bootstrap_record_batch(uuid, integer, integer, text, boolean);
DROP FUNCTION IF EXISTS public.mirsad_archive_bootstrap_authorize(uuid, text);
DROP FUNCTION IF EXISTS public.mirsad_archive_bootstrap_create_job();
DROP TABLE IF EXISTS public.mirsad_archive_bootstrap_jobs;
