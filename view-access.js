(() => {
  'use strict';
  const CONFIG = { url: 'https://dndlkenyfymlrjnslyzb.supabase.co', key: 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx' };
  if (!window.supabase?.createClient) return;
  const sb = window.supabase.createClient(CONFIG.url, CONFIG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  const publishBalance = (result) => { if (result && (result.unlimited !== undefined || result.remaining_unlocks !== undefined)) window.dispatchEvent(new CustomEvent('mirsad:unlock-balance', { detail: { remaining: Number(result.remaining_unlocks || 0), unlimited: Boolean(result.unlimited) } })); return result; };
  window.mirsadViewAccess = {
    async openRapid() {
      const { data, error } = await sb.rpc('open_rapid_news');
      if (error) return { allowed: false, charged: false, error };
      return publishBalance({ ...(data?.[0] || data || {}), error: null });
    },
    async consume(kind) {
      const { data, error } = await sb.rpc('consume_news_view', { p_view_kind: kind });
      if (error) return { allowed: false, charged: false, error };
      return publishBalance({ ...(data?.[0] || data || {}), error: null });
    },
  };
})();
