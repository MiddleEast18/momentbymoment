-- Isolated system-owner reward send.
-- Does not alter news, ingest, country-news, rapid-news, wheel, or daily-reward tables.

create or replace function public.is_privileged_system_account(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to public
as $$
  select p_user_id is not null
     and (
       exists (select 1 from public.mirsad_owner as owner_row where owner_row.user_id = p_user_id)
       or p_user_id in (
         '3a148696-88f0-4132-9248-386276d9febd'::uuid,
         '1a5347c1-e2e8-41f2-81b1-d0cbbf88cdf2'::uuid
       )
     );
$$;

revoke all on function public.is_privileged_system_account(uuid) from public, anon, authenticated;

drop function if exists public.list_system_reward_recipients();

create function public.list_system_reward_recipients()
returns table (
  user_id uuid,
  email text,
  display_name text,
  username text,
  unlock_balance integer,
  unlimited_unlocks boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language sql
security definer
set search_path to public
as $$
  select
    users_row.id,
    users_row.email,
    profiles_row.display_name,
    profiles_row.username,
    coalesce(unlocks_row.unlock_balance, 0),
    coalesce(unlocks_row.unlimited_unlocks, false),
    users_row.created_at,
    users_row.last_sign_in_at
  from auth.users as users_row
  left join public.profiles as profiles_row on profiles_row.id = users_row.id
  left join public.user_unlocks as unlocks_row on unlocks_row.user_id = users_row.id
  where public.is_system_developer()
    and not public.is_privileged_system_account(users_row.id)
  order by coalesce(unlocks_row.unlock_balance, 0) asc, users_row.created_at desc;
$$;

revoke all on function public.list_system_reward_recipients() from public, anon;
grant execute on function public.list_system_reward_recipients() to authenticated;

drop function if exists public.send_system_reward(uuid, integer, text, date, date, text, uuid);

create function public.send_system_reward(
  p_recipient_user_id uuid,
  p_amount integer,
  p_reason text,
  p_period_start date default null,
  p_period_end date default null,
  p_reward_type text default 'unlock',
  p_request_id uuid default gen_random_uuid()
)
returns table (
  operation_id uuid,
  message_id uuid,
  granted_amount integer,
  duplicate boolean,
  remaining_unlocks integer
)
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  existing_op public.system_reward_operations;
  op_id uuid;
  msg_id uuid;
  reason_text text := btrim(coalesce(p_reason, ''));
  reward_label text;
  period_text text := '';
  message_body text;
  new_balance integer := 0;
  recipient_unlimited boolean := false;
begin
  if actor is null then
    raise exception 'يجب تسجيل الدخول أولاً.';
  end if;
  if not public.is_system_developer(actor) then
    raise exception 'هذه العملية متاحة لمالك النظام فقط.';
  end if;
  if p_recipient_user_id is null then
    raise exception 'اختر الحساب المستهدف.';
  end if;
  if public.is_privileged_system_account(p_recipient_user_id) then
    raise exception 'حساب المالك/المطور لا يحتاج فتحات ولا بريد نظام.';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000 then
    raise exception 'قيمة الفتحات غير صحيحة.';
  end if;
  if reason_text = '' or char_length(reason_text) > 1000 then
    raise exception 'أدخل سبب المكافأة.';
  end if;
  if p_period_start is not null and p_period_end is not null and p_period_start > p_period_end then
    raise exception 'الفترة الزمنية غير صحيحة.';
  end if;
  if p_reward_type is distinct from 'unlock' then
    raise exception 'حالياً يمكن منح فتحات القراءة فقط.';
  end if;
  if not exists (select 1 from auth.users as users_row where users_row.id = p_recipient_user_id) then
    raise exception 'الحساب المستهدف غير موجود.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_recipient_user_id::text || ':unlock', 0));

  select ops.*
    into existing_op
    from public.system_reward_operations as ops
   where ops.request_id = p_request_id;
  if found then
    select coalesce(unlocks_row.unlock_balance, 0)
      into new_balance
      from public.user_unlocks as unlocks_row
     where unlocks_row.user_id = existing_op.recipient_user_id;
    return query
      select existing_op.id, existing_op.message_id, existing_op.amount, true, coalesce(new_balance, 0);
    return;
  end if;

  select ops.*
    into existing_op
    from public.system_reward_operations as ops
   where ops.recipient_user_id = p_recipient_user_id
     and ops.reward_type = p_reward_type
     and ops.amount = p_amount
     and ops.reason = reason_text
     and ops.period_start is not distinct from p_period_start
     and ops.period_end is not distinct from p_period_end
     and ops.created_at > now() - interval '90 seconds'
   order by ops.created_at desc
   limit 1;
  if found then
    select coalesce(unlocks_row.unlock_balance, 0)
      into new_balance
      from public.user_unlocks as unlocks_row
     where unlocks_row.user_id = existing_op.recipient_user_id;
    return query
      select existing_op.id, existing_op.message_id, existing_op.amount, true, coalesce(new_balance, 0);
    return;
  end if;

  insert into public.user_unlocks as unlocks_row (user_id, unlock_balance)
  values (p_recipient_user_id, 0)
  on conflict (user_id) do nothing;

  select unlocks_row.unlimited_unlocks
    into recipient_unlimited
    from public.user_unlocks as unlocks_row
   where unlocks_row.user_id = p_recipient_user_id
   for update;
  if coalesce(recipient_unlimited, false) then
    raise exception 'هذا الحساب يملك فتحات غير محدودة ولا يحتاج شحناً.';
  end if;

  insert into public.system_reward_operations as ops (
    request_id, recipient_user_id, actor_user_id, reward_type, amount, reason, period_start, period_end
  ) values (
    p_request_id, p_recipient_user_id, actor, 'unlock', p_amount, reason_text, p_period_start, p_period_end
  )
  returning ops.id into op_id;

  update public.user_unlocks as unlocks_row
     set unlock_balance = unlocks_row.unlock_balance + p_amount,
         updated_at = now()
   where unlocks_row.user_id = p_recipient_user_id
   returning unlocks_row.unlock_balance into new_balance;

  insert into public.unlock_ledger as ledger_row (user_id, amount, event_type, reference_id)
  values (p_recipient_user_id, p_amount, 'admin_adjustment', op_id);

  reward_label := 'فتحة قراءة';
  if p_period_start is not null and p_period_end is not null then
    period_text := format(' الفترة: %s — %s.', p_period_start, p_period_end);
  elsif p_period_start is not null then
    period_text := format(' بداية الفترة: %s.', p_period_start);
  elsif p_period_end is not null then
    period_text := format(' نهاية الفترة: %s.', p_period_end);
  end if;
  message_body := format(
    'تمت إضافة %s %s إلى حسابك تقديرًا لنشاطك. السبب: %s.%s',
    p_amount, reward_label, reason_text, period_text
  );

  insert into public.system_messages as messages_row (
    recipient_user_id, sender_user_id, message_type, title, body, metadata, reference_id
  ) values (
    p_recipient_user_id,
    actor,
    'reward',
    'تمت إضافة مكافأة إلى حسابك',
    message_body,
    jsonb_build_object(
      'reward_type', 'unlock',
      'granted_amount', p_amount,
      'reason', reason_text,
      'period_start', p_period_start,
      'period_end', p_period_end
    ),
    op_id
  )
  returning messages_row.id into msg_id;

  update public.system_reward_operations as ops
     set message_id = msg_id
   where ops.id = op_id;

  return query select op_id, msg_id, p_amount, false, coalesce(new_balance, p_amount);
end;
$$;

revoke all on function public.send_system_reward(uuid, integer, text, date, date, text, uuid) from public, anon;
grant execute on function public.send_system_reward(uuid, integer, text, date, date, text, uuid) to authenticated;

notify pgrst, 'reload schema';
