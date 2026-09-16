(() => {
  'use strict';
  const SUPABASE_URL = 'https://dndlkenyfymlrjnslyzb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx';
  const REQUIRED = 19;
  const inFlight = new Map();

  const showGuestDialog = () => {
    let dialog = document.getElementById('mirsadSourceGuestDialog');
    if (!dialog) {
      const style = document.createElement('style');
      style.id = 'mirsadSourceGuestDialogStyles';
      style.textContent = '.mirsad-source-dialog-backdrop{position:fixed;inset:0;z-index:7000;display:grid;place-items:center;padding:20px;background:rgba(5,8,12,.68)}.mirsad-source-dialog{width:min(420px,100%);padding:22px;border:1px solid rgba(201,162,39,.42);border-radius:16px;background:#10151c;color:#f2eee6;box-shadow:0 18px 50px rgba(0,0,0,.4);text-align:center;font:500 14px/1.7 var(--font-sans,inherit)}.mirsad-source-dialog h2{margin:0 0 8px;color:var(--gold,#c9a227);font:700 18px/1.4 var(--font-display,inherit)}.mirsad-source-dialog p{margin:0 0 16px;color:#c9c5bc}.mirsad-source-dialog__actions{display:flex;justify-content:center;gap:8px}.mirsad-source-dialog button{padding:8px 16px;border:1px solid rgba(201,162,39,.55);border-radius:999px;background:transparent;color:#f2eee6;cursor:pointer;font:600 13px var(--font-sans,inherit)}.mirsad-source-dialog button.primary{background:var(--gold,#c9a227);color:#10151c}';
      document.head.appendChild(style);
      dialog = document.createElement('div');
      dialog.id = 'mirsadSourceGuestDialog';
      dialog.className = 'mirsad-source-dialog-backdrop';
      dialog.setAttribute('role', 'presentation');
      dialog.innerHTML = '<section class="mirsad-source-dialog" role="dialog" aria-modal="true" aria-labelledby="mirsadSourceGuestTitle"><h2 id="mirsadSourceGuestTitle">سجّل الدخول لفتح المصدر</h2><p>للوصول إلى المصدر الأصلي للخبر، يرجى إنشاء حساب أو تسجيل الدخول أولًا.</p><div class="mirsad-source-dialog__actions"><button type="button" data-source-dialog-close>إغلاق</button><button type="button" class="primary" data-source-dialog-login>تسجيل الدخول</button></div></section>';
      document.body.appendChild(dialog);
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog || event.target.closest('[data-source-dialog-close]')) dialog.remove();
        if (event.target.closest('[data-source-dialog-login]')) {
          dialog.remove();
          document.getElementById('mirsadAuthGate')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    }
  };

  const showNotice = (message) => {
    let notice = document.getElementById('mirsadSourceNotice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'mirsadSourceNotice';
      notice.setAttribute('role', 'alert');
      notice.style.cssText = 'position:fixed;left:14px;right:14px;bottom:14px;z-index:7000;padding:11px 14px;border:1px solid rgba(201,162,39,.45);border-radius:12px;background:rgba(16,21,28,.96);color:#f2eee6;box-shadow:0 10px 30px rgba(0,0,0,.28);text-align:center;font:600 12px/1.5 var(--font-sans,inherit);';
      document.body.appendChild(notice);
    }
    notice.textContent = message;
    clearTimeout(showNotice.timer);
    showNotice.timer = setTimeout(() => notice.remove(), 3600);
  };

  const getClient = () => window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_KEY);
  const open = async (url, sourceKind, sourceId) => {
    const sourceUrl = String(url || '').trim();
    if (!/^https?:\/\//i.test(sourceUrl) || !['article', 'rapid'].includes(sourceKind) || !sourceId) return false;
    const client = getClient();
    if (!client) { showNotice('تعذر الاتصال بالخدمة. حاول مرة أخرى.'); return false; }
    const { data: { session } = {} } = await client.auth.getSession();
    if (!session?.user) { showGuestDialog(); return false; }
    const key = `${sourceKind}:${sourceId}`;
    if (inFlight.has(key)) return inFlight.get(key);
    const request = (async () => {
      const requestId = crypto.randomUUID();
      const { data, error } = await client.rpc('open_original_source', { p_source_url: sourceUrl, p_request_id: requestId, p_source_kind: sourceKind, p_source_id: sourceId });
      if (error) { showNotice('تعذر التحقق من الرصيد. حاول مرة أخرى.'); return false; }
      const result = Array.isArray(data) ? data[0] : data;
      const remaining = Number(result?.remaining_unlocks ?? 0);
      if (!result?.opened) { showNotice(`فتح المصدر الأصلي يحتاج إلى ${REQUIRED} فتحة. رصيدك الحالي ${remaining} فتحة، وهو غير كافٍ.`); return false; }
      window.dispatchEvent(new CustomEvent('mirsad:unlock-balance', { detail: { remaining, unlimited: Boolean(result?.unlimited) } }));
      if (result?.charged && typeof window.mirsadNotifyDeduction === 'function') window.mirsadNotifyDeduction(`المصدر الأصلي: تم خصم ${REQUIRED} فتحة، المتبقي ${remaining}`, REQUIRED);
      window.location.assign(sourceUrl);
      return true;
    })();
    inFlight.set(key, request);
    try { return await request; } finally { inFlight.delete(key); }
  };

  window.mirsadOpenOriginalSource = open;
})();
