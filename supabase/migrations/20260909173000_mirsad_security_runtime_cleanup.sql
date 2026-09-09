revoke execute on function public.news_public_stats() from public, anon, authenticated;
grant execute on function public.news_public_stats() to service_role;

create policy ingest_lock_service_role on public.ingest_lock
  for all to service_role
  using (true)
  with check (true);