(() => {
  'use strict';
  const CONFIG = { url: 'https://dndlkenyfymlrjnslyzb.supabase.co', key: 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx' };
  const rail = document.getElementById('rapidNews');
  const list = document.getElementById('rapidNewsList');
  const badge = document.getElementById('rapidNewsBadge');
  const status = document.getElementById('rapidNewsStatus');
  const toggle = document.getElementById('rapidNewsToggle');
  const more = document.getElementById('rapidNewsMore');
  const all = document.getElementById('rapidNewsAll');
  if (!rail || !list || !badge || !toggle || !more || !all || !window.supabase?.createClient) return;
  const sb = window.supabase.createClient(CONFIG.url, CONFIG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cleanRichText = (value) => MirsadText.normalize(value);
  const storyKey = (value) => MirsadText.search(value).replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
  const storyTokens = (value) => new Set(storyKey(value).split(/\s+/).filter((token) => token.length >= 2));
  const similarStory = (left, right) => {
    const a = storyTokens(left);
    const b = storyTokens(right);
    if (!a.size || !b.size) return false;
    let shared = 0;
    a.forEach((token) => { if (b.has(token)) shared += 1; });
    return shared / Math.max(1, Math.min(a.size, b.size)) >= 0.78;
  };
  const isMeaningful = (row) => {
    const headline = cleanRichText(row?.headline);
    const summary = cleanRichText(row?.summary);
    const tokens = storyTokens(headline);
    return headline.length >= 24 && tokens.size >= 4 && (summary.length >= 35 || Number(row?.importance_score || 0) >= 60);
  };
  const uniqueStories = (rows) => {
    const result = [];
    for (const row of rows || []) {
      const headline = cleanRichText(row.headline);
      result.push({ ...row, headline, summary: cleanRichText(row.summary) });
    }
    return result;
  };
  const relative = (value) => { const time = new Date(value || 0).getTime(); if (!Number.isFinite(time)) return ''; const mins = Math.round((time - Date.now()) / 60000); const formatter = new Intl.RelativeTimeFormat('ar', { numeric: 'auto' }); return Math.abs(mins) < 60 ? formatter.format(mins, 'minute') : formatter.format(Math.round(mins / 60), 'hour'); };
  let opened = false;
  let currentUser = false;
  let channel = null;
  let timer = null;
  let currentRows = [];
  let visibleCount = 3;
  const ACCESS_KINDS = new Set(['more', 'all']);
  let noticeTimer = null;
  const showAccessNotice = (text) => { let notice = document.getElementById('rapidNewsNotice'); if (!notice) { const style = document.createElement('style'); style.textContent = '.rapid-news__notice{position:fixed;left:16px;right:16px;bottom:16px;z-index:5600;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid rgba(201,162,39,.5);border-radius:12px;background:rgba(16,21,28,.97);color:var(--text,#f2eee6);box-shadow:0 10px 30px rgba(0,0,0,.3);font:600 12px/1.5 var(--font-sans,inherit);opacity:0;transform:translateY(10px);transition:opacity .18s ease,transform .18s ease}.rapid-news__notice.is-visible{opacity:1;transform:translateY(0)}.rapid-news__notice button{border:1px solid var(--gold,#c9a227);border-radius:999px;padding:7px 12px;background:rgba(201,162,39,.12);color:var(--gold,#c9a227);font:inherit;white-space:nowrap;cursor:pointer}'; document.head.appendChild(style); notice = document.createElement('div'); notice.id = 'rapidNewsNotice'; notice.className = 'rapid-news__notice'; document.body.appendChild(notice); } notice.replaceChildren(); const message = document.createElement('span'); message.textContent = text === 'سجّل الدخول' ? 'تسجيل الدخول مطلوب لاستخدام عرض المزيد أو عرض الكل.' : text; notice.appendChild(message); if (text === 'سجّل الدخول') { const login = document.createElement('button'); login.type = 'button'; login.textContent = 'تسجيل الدخول'; login.addEventListener('click', () => document.getElementById('mirsadGuestExit')?.click()); notice.appendChild(login); } notice.classList.add('is-visible'); clearTimeout(noticeTimer); noticeTimer = setTimeout(() => notice.classList.remove('is-visible'), 5000); };
  const setBadge = (count) => { badge.textContent = count > 99 ? '99+' : String(Math.max(0, count)); badge.hidden = count <= 0; };
  const showRapidNotice = (message) => {
    if (!message) return;
    let notice = document.getElementById('mirsadRapidNotice');
    if (!notice) {
      const style = document.createElement('style');
      style.id = 'mirsadRapidNoticeStyles';
      style.textContent = '.mirsad-rapid-notice{position:fixed;left:14px;right:14px;bottom:14px;z-index:6000;display:flex;justify-content:center;padding:11px 14px;border:1px solid rgba(201,162,39,.45);border-radius:12px;background:rgba(16,21,28,.96);color:#f2eee6;box-shadow:0 10px 30px rgba(0,0,0,.28);font:600 12px/1.5 var(--font-sans,inherit);opacity:0;transform:translateY(10px);transition:opacity .18s ease,transform .18s ease}.mirsad-rapid-notice.is-visible{opacity:1;transform:translateY(0)}';
      document.head.appendChild(style);
      notice = document.createElement('div');
      notice.id = 'mirsadRapidNotice';
      notice.className = 'mirsad-rapid-notice';
      notice.setAttribute('role', 'status');
      notice.setAttribute('aria-live', 'polite');
      document.body.appendChild(notice);
    }
    notice.textContent = message;
    notice.classList.remove('is-visible');
    requestAnimationFrame(() => notice.classList.add('is-visible'));
    clearTimeout(showRapidNotice.timer);
    showRapidNotice.timer = setTimeout(() => {
      notice.classList.remove('is-visible');
      setTimeout(() => notice.remove(), 220);
    }, 2800);
  };
  const pinIcon = '<span class="rapid-news__pin" title="خبر مهم مثبت" aria-label="خبر مهم مثبت"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 3.5 20.5 9l-2.2 2.2-1.1-.3-3.1 3.1.5 3.2-1.5 1.5-3.8-3.8-4.6 4.6-.9-.9 4.6-4.6-3.8-3.8 1.5-1.5 3.2.5 3.1-3.1-.3-1.1 2.2-2.2Z"/></svg></span>';
  const captureTime = (row) => new Date(row.published_at || row.received_at || 0).getTime() || 0;
  const publicationTime = (row) => new Date(row.published_at || row.received_at || 0).getTime() || 0;
  const PIN_MAX_AGE_MS = 100 * 60 * 60 * 1000;
  const render = (rows) => { const chronological = uniqueStories(rows).sort((a, b) => captureTime(b) - captureTime(a)); const now = Date.now(); const pinnedRows = chronological.filter((row) => Number(row.importance_score || 0) >= 60 && now - publicationTime(row) <= PIN_MAX_AGE_MS).slice(0, 4); const pinnedIds = new Set(pinnedRows.map((row) => row.id)); const ordered = chronological; currentRows = ordered; visibleCount = Math.min(Math.max(visibleCount, 3), ordered.length); const visible = ordered.slice(0, visibleCount); list.innerHTML = visible.length ? visible.map((row) => { const pinned = pinnedIds.has(row.id); const publishedAt = row.published_at || row.received_at; return `<article class="rapid-news__item${pinned ? ' is-pinned' : ''}" data-source-id="${escapeHtml(row.id)}">${pinned ? pinIcon : ''}<div class="rapid-news__meta"><span>${escapeHtml(cleanRichText(row.source_name))}</span><time datetime="${escapeHtml(publishedAt)}">نُشر ${escapeHtml(relative(publishedAt))}</time></div><h3>${escapeHtml(row.headline)}</h3><p>${escapeHtml(row.summary)}</p><a href="${escapeHtml(row.source_url)}" target="_blank" rel="noopener noreferrer">المصدر الأصلي</a></article>`; }).join('') : '<p class="rapid-news__empty">لا توجد أخبار الشرق الأوسط بالإنجليزية ذات مضمون واضح حاليًا.</p>'; more.hidden = visibleCount >= ordered.length; all.hidden = visibleCount >= ordered.length; };
  const load = async () => { const { data, error } = await sb.from('rapid_news').select('id,source_key,source_name,source_url,headline,summary,published_at,received_at,importance_score').eq('source_key', 'middleeasteye').order('published_at', { ascending: false, nullsFirst: false }).order('received_at', { ascending: false, nullsFirst: false }).limit(400); if (error) { showRapidNotice('تعذر تحميل أخبار الشرق الأوسط بالإنجليزية'); status.textContent = ''; return; } render(data || []); status.textContent = ''; };
  const refreshUnread = async () => { if (!currentUser) { setBadge(0); return; } const { data, error } = await sb.rpc('rapid_news_unread_count'); if (error) { setBadge(0); return; } setBadge(Number(data || 0)); };
  let opening = false;
  const open = async () => {
    if (!window.mirsadViewAccess || opening) return;
    opening = true;
    toggle.disabled = true;
    try {
      const access = await window.mirsadViewAccess.openRapid();
      if (!access.allowed) {
        const err = String(access.error?.message || '').toLowerCase();
        const unread = Number(access.unread_count || 0);
        const remaining = Number(access.remaining_unlocks || 0);
        const notice = (!currentUser || err.includes('not_authenticated'))
          ? 'سجّل الدخول'
          : (unread > 0 ? `تحتاج ${unread} فتحة لعرض الأخبار غير المقروءة (رصيدك ${remaining})` : 'لا توجد فتحات كافية');
        showRapidNotice(notice);
        status.textContent = '';
        await refreshUnread();
        return;
      }
      opened = true;
      rail.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      const unreadCount = Number(access.unread_count || 0);
      showRapidNotice(access.charged
        ? `خُصمت ${unreadCount} فتحة حسب الأخبار غير المقروءة`
        : (unreadCount > 0 ? `تم عرض ${unreadCount} خبرًا جديدًا` : 'لا أخبار جديدة غير مقروءة'));
      status.textContent = '';
      setBadge(0);
    } finally {
      opening = false;
      toggle.disabled = false;
    }
  };
  const consume = async (kind) => { if (!window.mirsadViewAccess || !ACCESS_KINDS.has(kind)) return false; more.disabled = true; all.disabled = true; let result; try { result = await window.mirsadViewAccess.consume(kind); } catch (error) { result = { allowed: false, error }; } more.disabled = false; all.disabled = false; if (!result || result.allowed !== true) { const message = String(result?.error?.message || result?.error?.code || '').toLowerCase(); const requiresLogin = !currentUser || message.includes('not_authenticated') || message.includes('jwt') || message.includes('unauthorized') || message === '401'; const notice = requiresLogin ? 'سجّل الدخول' : (result?.error ? 'تعذر التحقق، حاول مجددًا' : 'لا توجد فتحات كافية'); showRapidNotice(notice); status.textContent = ''; return false; } showRapidNotice(result.charged ? `خُصمت ${kind === 'more' ? 5 : 100} فتحات` : 'مجاني هذه الدورة'); status.textContent = ''; return true; };
  list.addEventListener('click', (event) => { const link = event.target.closest?.('a[href]'); if (!link) return; event.preventDefault(); if (typeof window.mirsadOpenOriginalSource === 'function') void window.mirsadOpenOriginalSource(link.href, 'rapid', link.closest('[data-source-id]')?.dataset.sourceId); });
  more.addEventListener('click', async () => { if (!(await consume('more'))) return; visibleCount += 5; render(currentRows); });
  all.addEventListener('click', async () => { if (!(await consume('all'))) return; visibleCount = currentRows.length; render(currentRows); });
  toggle.addEventListener('click', () => { if (opened) { opened = false; rail.hidden = true; toggle.setAttribute('aria-expanded', 'false'); } else void open(); });
  window.addEventListener('mirsad:session-end', () => { opened = false; rail.hidden = true; toggle.setAttribute('aria-expanded', 'false'); visibleCount = 3; if (currentRows.length) render(currentRows); });
  const start = async () => { await load(); const { data: { session } } = await sb.auth.getSession(); currentUser = Boolean(session?.user); await refreshUnread(); channel = sb.channel('mirsad-rapid-news-live').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rapid_news' }, () => { void load(); void refreshUnread(); }).subscribe(); timer = setInterval(async () => { await load(); await refreshUnread(); }, 60000); };
  sb.auth.onAuthStateChange((_event, session) => { currentUser = Boolean(session?.user); if (currentUser) void refreshUnread(); else setBadge(0); });
  window.addEventListener('pagehide', () => { if (timer) clearInterval(timer); if (channel) sb.removeChannel(channel); });
  
  void start();
})();
