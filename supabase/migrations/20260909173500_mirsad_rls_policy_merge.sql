drop policy if exists public_read_live on public.news_articles;
create policy public_read_live_anon on public.news_articles for select to anon using (is_pending_verification = false);
create policy authenticated_read_live on public.news_articles for select to authenticated using (
  is_pending_verification = false
  or (select coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'news_admin')
);