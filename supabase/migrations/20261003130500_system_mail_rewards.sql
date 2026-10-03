-- Isolated system mail, developer reports, and idempotent rewards.
-- Deliberately does not alter news, ingest, country-news, or rapid-news tables.

create table if not exists public.system_messages (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  sender_user_id uuid references auth.users(id) on delete set null,
  message_type text not null default 'general' check (message_type in ('general','reward','security','developer_alert','activity_report','system_error')),
  title text not null check (char_length(title) between 1 and 180),
  body text not null check (char_length(body) between 1 and 10000),
  metadata jsonb not null default '{}'::jsonb,
  reference_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists system_messages_recipient_created_idx
  on public.system_messages (recipient_user_id, created_at desc);
create index if not exists system_messages_unread_idx
  on public.system_messages (recipient_user_id, read_at)
  where read_at is null;

create table if not exists public.system_reward_operations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  reward_type text not null default 'unlock' check (reward_type in ('unlock','points','premium_days')),
  amount integer not null check (amount > 0 and amount <= 100000),
  reason text not null check (char_length(reason) between 1 and 1000),
  period_start date,
  period_end date,
  message_id uuid,
  created_at timestamptz not null default now(),
  constraint system_reward_period_order check (period_start is null or period_end is null or period_start <= period_end),
  constraint system_reward_message_fk foreign key (message_id) references public.system_messages(id) on delete set null
);

create index if not exists system_reward_operations_recipient_idx
  on public.system_reward_operations (recipient_user_id, created_at desc);
create index if not exists system_reward_operations_actor_idx
  on public.system_reward_operations (actor_user_id, created_at desc);

create table if not exists public.system_activity_reports (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  generated_by uuid references auth.users(id) on delete set null,
  period_start date not null,
  period_end date not null,
  summary jsonb not null default '{}'::jsonb,
  risk_flags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint system_activity_period_order check (period_start <= period_end)
);

create index if not exists system_activity_reports_recipient_idx
  on public.system_activity_reports (recipient_user_id, created_at desc);

create or replace function public.is_system_developer(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id in (
    '3a148696-88f0-4132-9248-386276d9febd'::uuid,
    '1a5347c1-e2e8-41f2-81b1-d0cbbf88cdf2'::uuid
  );
$$;

revoke all on function public.is_system_developer(uuid) from public;
grant execute on function public.is_system_developer(uuid) to authenticated;

alter table public.system_messages enable row level security;
alter table public.system_reward_operations enable row level security;
alter table public.system_activity_reports enable row level security;

drop policy if exists system_messages_recipient_read on public.system_messages;
create policy system_messages_recipient_read on public.system_messages
  for select to authenticated
  using (recipient_user_id = auth.uid() or public.is_system_developer());

drop policy if exists system_messages_recipient_mark_read on public.system_messages;
create policy system_messages_recipient_mark_read on public.system_messages
  for update to authenticated
  using (recipient_user_id = auth.uid() or public.is_system_developer())
  with check (recipient_user_id = auth.uid() or public.is_system_developer());

drop policy if exists system_reward_operations_developer_read on public.system_reward_operations;
create policy system_reward_operations_developer_read on public.system_reward_operations
  for select to authenticated
  using (public.is_system_developer());

drop policy if exists system_activity_reports_developer_read on public.system_activity_reports;
create policy system_activity_reports_developer_read on public.system_activity_reports
  for select to authenticated
  using (public.is_system_developer());

create or replace function public.mark_system_message_read(p_message_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update public.system_messages
     set read_at = coalesce(read_at, now())
   where id = p_message_id
     and (recipient_user_id = auth.uid() or public.is_system_developer());
end;
$$;

grant execute on function public.mark_system_message_read(uuid) to authenticated;

create or replace function public.send_system_reward(
  p_recipient_user_id uuid,
  p_amount integer,
  p_reason text,
  p_period_start date default null,
  p_period_end date default null,
  p_reward_type text default 'unlock',
  p_request_id uuid default gen_random_uuid()
)
returns table (operation_id uuid, message_id uuid, amount integer, duplicate boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  existing public.system_reward_operations;
  op_id uuid;
  msg_id uuid;
begin
  if actor is null then raise exception 'not_authenticated'; end if;
  if not public.is_system_developer(actor) then raise exception 'system_developer_required'; end if;
  if p_recipient_user_id is null then raise exception 'recipient_required'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000 then raise exception 'invalid_reward_amount'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'reward_reason_required'; end if;
  if p_period_start is not null and p_period_end is not null and p_period_start > p_period_end then raise exception 'invalid_reward_period'; end if;
  if p_reward_type not in ('unlock','points','premium_days') then raise exception 'invalid_reward_type'; end if;

  select * into existing from public.system_reward_operations where request_id = p_request_id;
  if found then
    return query select existing.id, existing.message_id, existing.amount, true;
    return;
  end if;

  if not exists (select 1 from auth.users where id = p_recipient_user_id) then
    raise exception 'recipient_not_found';
  end if;

  insert into public.system_reward_operations(
    request_id, recipient_user_id, actor_user_id, reward_type, amount, reason, period_start, period_end
  ) values (
    p_request_id, p_recipient_user_id, actor, p_reward_type, p_amount, btrim(p_reason), p_period_start, p_period_end
  ) returning id into op_id;

  if p_reward_type = 'unlock' then
    insert into public.user_unlocks(user_id, unlock_balance)
    values (p_recipient_user_id, p_amount)
    on conflict (user_id) do update
      set unlock_balance = case when public.user_unlocks.unlimited_unlocks then public.user_unlocks.unlock_balance else public.user_unlocks.unlock_balance + excluded.unlock_balance end,
          updated_at = now();

    insert into public.unlock_ledger(user_id, amount, event_type, reference_id)
    values (p_recipient_user_id, p_amount, 'system_reward', op_id);
  end if;

  insert into public.system_messages(
    recipient_user_id, sender_user_id, message_type, title, body, metadata, reference_id
  ) values (
    p_recipient_user_id,
    actor,
    'reward',
    'تمت إضافة مكافأة إلى حسابك',
    format('تمت إضافة %s إلى حسابك تقديرًا لنشاطك. السبب: %s', p_amount, btrim(p_reason)),
    jsonb_build_object('reward_type', p_reward_type, 'amount', p_amount, 'reason', btrim(p_reason), 'period_start', p_period_start, 'period_end', p_period_end),
    op_id
  ) returning id into msg_id;

  update public.system_reward_operations set message_id = msg_id where id = op_id;
  return query select op_id, msg_id, p_amount, false;
end;
$$;

revoke all on function public.send_system_reward(uuid, integer, text, date, date, text, uuid) from public;
grant execute on function public.send_system_reward(uuid, integer, text, date, date, text, uuid) to authenticated;

create or replace function public.list_system_messages(p_limit integer default 50, p_offset integer default 0)
returns setof public.system_messages
language sql
security invoker
set search_path = public
as $$
  select * from public.system_messages
  where recipient_user_id = auth.uid() or public.is_system_developer()
  order by created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.list_system_messages(integer, integer) to authenticated;

comment on table public.system_messages is 'Isolated in-app system mailbox; does not modify news or ingest tables.';
comment on table public.system_reward_operations is 'Idempotent developer-issued rewards with audit trail.';
comment on table public.system_activity_reports is 'Developer-only activity report snapshots; populated by a future isolated collector.';
