create or replace function public.get_consumption_recovery_status()
returns table(
  consumed_slots bigint,
  target_slots bigint,
  progress_percent numeric,
  price_usd numeric,
  remaining_slots bigint
)
language plpgsql
security definer
set search_path to public
as $f$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_consumed bigint := 0;
  v_target bigint := 100000;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select coalesce(sum(greatest(0, -l.amount)), 0)::bigint
    into v_consumed
    from public.unlock_ledger as l
   where l.user_id = v_uid;
  return query
    select v_consumed,
           v_target,
           round(least(100, (v_consumed::numeric / v_target::numeric) * 100), 2),
           10::numeric,
           greatest(0, v_target - v_consumed);
end;
$f$;

revoke all on function public.get_consumption_recovery_status() from public, anon;
grant execute on function public.get_consumption_recovery_status() to authenticated;
