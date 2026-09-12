(() => {
  'use strict';
  const CONFIG = { url: 'https://dndlkenyfymlrjnslyzb.supabase.co', key: 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx' };
  if (!window.supabase?.createClient) return;
  const sb = window.supabase.createClient(CONFIG.url, CONFIG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  function showDeductionToast(result, label) {
    if (!result?.charged) return;
    const amount = label || 'الفتح';
    let toast = document.getElementById('mirsadDeductionToast');
    if (!toast) {
      const style = document.createElement('style');
      style.id = 'mirsadDeductionToastStyles';
      style.textContent = '.mirsad-deduction-toast{position:fixed;left:14px;right:14px;bottom:14px;z-index:6000;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 13px;border:1px solid rgba(201,162,39,.45);border-radius:12px;background:rgba(16,21,28,.96);color:#f2eee6;box-shadow:0 10px 30px rgba(0,0,0,.28);font:600 12px/1.4 var(--font-sans,inherit);opacity:0;transform:translateY(10px);transition:opacity .18s ease,transform .18s ease} .mirsad-deduction-toast.is-visible{opacity:1;transform:translateY(0)} .mirsad-deduction-toast__brand{color:var(--gold,#c9a227);white-space:nowrap}.mirsad-deduction-toast__text{min-width:0}';
      document.head.appendChild(style);
      toast = document.createElement('div');
      toast.id = 'mirsadDeductionToast';
      toast.className = 'mirsad-deduction-toast';
      toast.innerHTML = '<span class="mirsad-deduction-toast__brand">مِرصاد</span><span class="mirsad-deduction-toast__text"></span>';
      document.body.appendChild(toast);
    }
    const text = toast.querySelector('.mirsad-deduction-toast__text');
    text.textContent = `تم خصم ${amount} من فتحات الأخبار`;
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    clearTimeout(showDeductionToast.timer);
    showDeductionToast.timer = setTimeout(() => {
      toast.classList.remove('is-visible');
      setTimeout(() => toast.remove(), 220);
    }, 2600);
  }
  const publishBalance = (result, label) => {
    if (result && (result.unlimited !== undefined || result.remaining_unlocks !== undefined)) {
      window.dispatchEvent(new CustomEvent('mirsad:unlock-balance', { detail: { remaining: Number(result.remaining_unlocks || 0), unlimited: Boolean(result.unlimited) } }));
    }
    showDeductionToast(result, label);
    return result;
  };
  window.mirsadViewAccess = {
    async openRapid() {
      const { data, error } = await sb.rpc('open_rapid_news');
      if (error) return { allowed: false, charged: false, error };
      return publishBalance({ ...(data?.[0] || data || {}), error: null }, '');
    },
    async consume(kind) {
      const { data, error } = await sb.rpc('consume_news_view', { p_view_kind: kind });
      if (error) return { allowed: false, charged: false, error };
      const result = { ...(data?.[0] || data || {}), error: null };
      const labels = { more: '5 فتحة', all: '100 فتحة', '24h': '50 فتحة' };
      return publishBalance(result, labels[kind] || 'فتحة');
    },
  };
})();
