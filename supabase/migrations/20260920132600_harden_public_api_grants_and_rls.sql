-- Surgical API hardening. Does not change ingest, cron, product RPCs, or table data.
-- Applied live as 20260920132600_harden_public_api_grants_and_rls.

-- 1) storage_guard_runs was public and writable. Close it.
ALTER TABLE public.storage_guard_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.storage_guard_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.storage_guard_runs TO postgres, service_role;

-- 2) Wheel tables have no RLS. Product uses SECURITY DEFINER RPCs only.
ALTER TABLE public.wheel_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wheel_daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wheel_user_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wheel_spin_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wheel_configs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.wheel_daily_usage FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.wheel_user_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.wheel_spin_ledger FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.wheel_configs, public.wheel_daily_usage, public.wheel_user_state, public.wheel_spin_ledger TO postgres, service_role;

-- 3) Public-read content: keep SELECT, drop write/truncate.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.arab_countries,
  public.country_news_articles,
  public.country_news_sources,
  public.country_article_translations,
  public.news_article_revisions
FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE
  public.arab_countries,
  public.country_news_articles,
  public.country_news_sources,
  public.country_article_translations,
  public.news_article_revisions
TO anon, authenticated;

-- 4) Rapid news feed is read from the guest UI. Keep SELECT only.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.rapid_news FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.rapid_news TO anon, authenticated;

-- 5) Account tables: drop anon access and truncate. Keep authenticated SELECT (RLS own-row).
REVOKE ALL ON TABLE
  public.user_unlocks,
  public.unlock_ledger,
  public.article_unlocks,
  public.referral_codes,
  public.referrals,
  public.daily_reward_claims,
  public.rapid_news_seen
FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.user_unlocks,
  public.unlock_ledger,
  public.article_unlocks,
  public.referral_codes,
  public.referrals,
  public.daily_reward_claims
FROM authenticated;
GRANT SELECT ON TABLE
  public.user_unlocks,
  public.unlock_ledger,
  public.article_unlocks,
  public.referral_codes,
  public.referrals,
  public.daily_reward_claims
TO authenticated;
REVOKE ALL ON TABLE public.rapid_news_seen FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.rapid_news_seen TO authenticated;

-- 6) Pending-verification view must not be public.
REVOKE ALL ON TABLE public.admin_ops_queue FROM PUBLIC, anon, authenticated;

-- 7) Maintenance SECURITY DEFINER functions must not be callable via the API.
REVOKE ALL ON FUNCTION public.mirsad_trim_news_to_400() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mirsad_storage_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mirsad_reconcile_legacy_ledger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_source_item_ledger_article_fk() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mirsad_trim_news_to_400() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.mirsad_storage_guard() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.mirsad_reconcile_legacy_ledger() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.guard_source_item_ledger_article_fk() TO postgres, service_role;

-- 8) Pin search_path on helper functions flagged by the linter. Behavior unchanged.
ALTER FUNCTION public.mirsad_enforce_news_category() SET search_path = public, pg_temp;
ALTER FUNCTION public.mirsad_classify_category(text, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.wheel_alpha_for_mean(numeric, integer[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.wheel_effective_weight(integer, numeric, integer, integer, integer, integer, integer, integer, integer, integer, integer, numeric, numeric, numeric, numeric, numeric) SET search_path = public, pg_temp;
