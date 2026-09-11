create or replace function public.open_article(p_article_id uuid)
returns table(opened boolean, charged boolean, remaining_unlocks integer, unlimited boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  acct public.user_unlocks;
  already_opened boolean;
  pending_referral public.referrals;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.news_articles where id = p_article_id and is_pending_verification = false) then
    raise exception 'article_unavailable';
  end if;

  insert into public.user_unlocks(user_id) values(uid) on conflict (user_id) do nothing;
  select * into acct from public.user_unlocks where user_id = uid for update;

  select exists(
    select 1 from public.article_unlocks
    where user_id = uid and article_id = p_article_id
  ) into already_opened;

  if already_opened then
    return query select true, false, acct.unlock_balance, acct.unlimited_unlocks;
    return;
  end if;

  if acct.unlimited_unlocks then
    insert into public.article_unlocks(user_id, article_id) values(uid, p_article_id);
    return query select true, false, acct.unlock_balance, true;
    return;
  end if;

  if acct.unlock_balance <= 0 then
    return query select false, false, 0, false;
    return;
  end if;

  update public.user_unlocks
  set unlock_balance = unlock_balance - 1, updated_at = now()
  where user_id = uid
  returning * into acct;

  insert into public.article_unlocks(user_id, article_id) values(uid, p_article_id);
  insert into public.unlock_ledger(user_id, amount, event_type, reference_id)
  values(uid, -1, 'article_unlock', p_article_id);

  select * into pending_referral
  from public.referrals
  where referred_user_id = uid and status = 'pending'
  for update;

  if pending_referral.id is not null then
    update public.referrals
    set status = 'rewarded', qualified_at = now(), rewarded_at = now()
    where id = pending_referral.id;

    insert into public.user_unlocks(user_id)
    values(pending_referral.referrer_user_id)
    on conflict (user_id) do nothing;

    update public.user_unlocks
    set unlock_balance = unlock_balance + pending_referral.reward_amount,
        updated_at = now()
    where user_id = pending_referral.referrer_user_id;

    insert into public.unlock_ledger(user_id, amount, event_type, reference_id)
    values(pending_referral.referrer_user_id, pending_referral.reward_amount, 'referral_reward', pending_referral.id);
  end if;

  return query select true, true, acct.unlock_balance, acct.unlimited_unlocks;
end;
$function$;
