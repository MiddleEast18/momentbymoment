create or replace function public.claim_mirsad_ingest_run(p_stale_after interval default interval '4 minutes')
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('mirsad-ingest-run'));

  update public.ingest_runs
  set status = 'failed',
      finished_at = clock_timestamp(),
      notes = jsonb_build_object('reason', 'stale_running_job', 'claimed_by', 'atomic_claim')::text
  where status = 'running'
    and started_at < clock_timestamp() - p_stale_after;

  if exists (select 1 from public.ingest_runs where status = 'running') then
    return null;
  end if;

  insert into public.ingest_runs(status, started_at)
  values ('running', clock_timestamp())
  returning id into claimed_id;

  return claimed_id;
end;
$$;

revoke all on function public.claim_mirsad_ingest_run(interval) from public, anon, authenticated;
grant execute on function public.claim_mirsad_ingest_run(interval) to service_role;
