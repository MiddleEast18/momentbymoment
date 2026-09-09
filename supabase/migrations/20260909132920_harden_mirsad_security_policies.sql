-- Applied to the existing project without changing or deleting news data.
alter function public.touch_updated_at() set search_path = public, pg_temp;
revoke all on function public.record_source_health(text, boolean, text) from public, anon, authenticated;
grant execute on function public.record_source_health(text, boolean, text) to service_role;
create or replace view public.admin_ops_queue with (security_invoker = true) as
select id, source_name, source_url, headline, summary, cluster_id, verification_notes, raw_payload, created_at
from public.news_articles
where is_pending_verification = true
order by created_at;
drop policy if exists news_admin_read_live on public.news_articles;
create policy news_admin_read_live on public.news_articles for select to authenticated
using ((select coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '')) = 'news_admin');
drop policy if exists news_admin_update_live on public.news_articles;
create policy news_admin_update_live on public.news_articles for update to authenticated
using ((select coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '')) = 'news_admin')
with check ((select coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '')) = 'news_admin');
drop policy if exists news_admin_manage_queue on public.news_verification_queue;
create policy news_admin_manage_queue on public.news_verification_queue for all to authenticated
using ((select coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '')) = 'news_admin')
with check ((select coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '')) = 'news_admin');
drop policy if exists news_admin_read_ingest_runs on public.ingest_runs;
create policy news_admin_read_ingest_runs on public.ingest_runs for select to authenticated
using ((select coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '')) = 'news_admin');
drop policy if exists news_admin_read_source_health on public.source_health;
create policy news_admin_read_source_health on public.source_health for select to authenticated
using ((select coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '')) = 'news_admin');
