-- Isolated unread-count helpers for the in-app mailbox.
-- Does not alter news, ingest, country-news, rapid-news, or unlock charging.

create or replace function public.unread_system_message_count()
returns integer
language sql
stable
security invoker
set search_path to public
as $$
  select count(*)::integer
    from public.system_messages
   where recipient_user_id = auth.uid()
     and read_at is null;
$$;

revoke all on function public.unread_system_message_count() from public, anon;
grant execute on function public.unread_system_message_count() to authenticated;

create or replace function public.mark_all_system_messages_read()
returns integer
language plpgsql
security invoker
set search_path to public
as $$
declare
  n integer := 0;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول أولاً.';
  end if;
  update public.system_messages
     set read_at = now()
   where recipient_user_id = auth.uid()
     and read_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.mark_all_system_messages_read() from public, anon;
grant execute on function public.mark_all_system_messages_read() to authenticated;

notify pgrst, 'reload schema';
