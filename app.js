(() => {
  'use strict';

  const CONFIG = {
    SUPABASE_URL: 'https://dndlkenyfymlrjnslyzb.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx',
    TABLE: 'news_articles',
    INITIAL_FETCH_LIMIT: 240,
    MAX_KEPT_ARTICLES: 240,
    POLL_FALLBACK_INTERVAL_MS: 30 * 1000,
    FLIP_DURATION_MS: 650,
    FLIP_EASING: 'cubic-bezier(0.16, 1, 0.3, 1)',
    TICKER_MAX_ITEMS: 12,
  };

  const CATEGORY_LABELS = { Politics: 'سياسة', Economy: 'اقتصاد', Tech: 'تقنية', Society: 'مجتمع', Sports: 'رياضة' };
  const CATEGORY_COLORS = { Politics: '#8b7bc7', Economy: '#c9a227', Tech: '#4f9dde', Society: '#b8794a', Sports: '#4fa8a0' };

  const gridEl = document.getElementById('newsGrid');
  const featuredRailEl = document.getElementById('featuredRail');
  const emptyStateEl = document.getElementById('emptyState');
  const liveCountEl = document.getElementById('liveCount');
  const tickerTrackEl = document.getElementById('tickerTrack');
  const statusDotEl = document.getElementById('statusDot');
  const statusTextEl = document.getElementById('statusText');
  const lastSyncEl = document.getElementById('lastSync');
  const categoryFiltersEl = document.getElementById('categoryFilters');
  const searchBoxEl = document.getElementById('searchBox');
  const sortBoxEl = document.getElementById('sortBox');
  const insightClusterCountEl = document.getElementById('insightClusterCount');
  const insightPendingCountEl = document.getElementById('insightPendingCount');
  const insightAvgConfidenceEl = document.getElementById('insightAvgConfidence');
  const insightTrustedSourcesEl = document.getElementById('insightTrustedSources');
  const cardTemplate = document.getElementById('cardTemplate');

  if (!window.supabase) throw new Error('Supabase JS not loaded');
  const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

  const state = { articles: [], activeFilter: 'all', searchQuery: '', sortMode: 'priority', channel: null, pollTimer: null };
  const STORAGE_KEY = 'mirsad.ui.state.v1';
  const SELECT_COLUMNS = 'id,source_name,source_url,agency_urls,headline,summary,category,importance_score,sentiment,layout_size,cluster_id,update_count,source_count,source_trust_score,confidence_score,is_pending_verification,verification_notes,inherited_from_cache,llm_model_used,claim_digest,raw_payload,published_at,created_at,updated_at';

  function loadPreferences() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        state.activeFilter = parsed.activeFilter || state.activeFilter;
        state.searchQuery = parsed.searchQuery || state.searchQuery;
        state.sortMode = parsed.sortMode || state.sortMode;
      }
    } catch {}
  }

  function savePreferences() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeFilter: state.activeFilter, searchQuery: state.searchQuery, sortMode: state.sortMode })); } catch {}
  }

  function syncControlsFromState() {
    searchBoxEl.value = state.searchQuery;
    sortBoxEl.value = state.sortMode;
    [...categoryFiltersEl.children].forEach((chip) => chip.classList.toggle('is-active', chip.dataset.category === state.activeFilter));
  }

  function updateInsights() {
    const clusters = new Set(), trustedSources = new Set();
    let pendingCount = 0, confidenceSum = 0, confidenceCount = 0;
    for (const article of state.articles) {
      if (article.cluster_id) clusters.add(article.cluster_id);
      if (article.is_pending_verification) pendingCount += 1;
      const conf = Number(article.confidence_score);
      if (Number.isFinite(conf)) { confidenceSum += conf; confidenceCount += 1; }
      if (Number(article.source_trust_score || 0) >= 0.8) trustedSources.add(article.source_name || article.source_url || 'source');
    }
    insightClusterCountEl.textContent = String(clusters.size);
    insightPendingCountEl.textContent = String(pendingCount);
    insightAvgConfidenceEl.textContent = `${confidenceCount ? Math.round(confidenceSum / confidenceCount) : 0}%`;
    insightTrustedSourcesEl.textContent = String(trustedSources.size);
    liveCountEl.textContent = `${getVisibleArticles().length} خبر معروض · ${pendingCount} قيد المراجعة`;
  }

  function layoutClass(size) { return size === 'large' ? 'card-large' : size === 'medium' ? 'card-medium' : ''; }
  function importanceTier(score) { return Math.min(5, Math.max(1, Math.ceil(Number(score || 0) / 20))); }
  const relativeTimeFormatter = new Intl.RelativeTimeFormat('ar', { numeric: 'auto' });

  function formatRelativeTime(iso) {
    const time = new Date(iso).getTime();
    if (!Number.isFinite(time)) return 'وقت غير محدد';
    const diffMin = Math.round((time - Date.now()) / 60000);
    if (Math.abs(diffMin) < 60) return relativeTimeFormatter.format(diffMin, 'minute');
    const diffHour = Math.round(diffMin / 60);
    if (Math.abs(diffHour) < 24) return relativeTimeFormatter.format(diffHour, 'hour');
    return relativeTimeFormatter.format(Math.round(diffHour / 24), 'day');
  }

  function setConnectionState(newState) {
    statusDotEl.dataset.state = newState;
    statusTextEl.textContent = { connecting: 'جارٍ الاتصال بالبث الحي…', live: 'بث مباشر', polling: 'وضع احتياطي — تحديث كل 30 ثانية' }[newState] || newState;
  }

  function touchLastSync() {
    lastSyncEl.textContent = `آخر مزامنة: ${new Intl.DateTimeFormat('ar', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`;
  }

  function populateCard(node, article) {
    node.className = ['card', layoutClass(article.layout_size)].filter(Boolean).join(' ');
    node.dataset.id = article.id;
    node.dataset.sentiment = article.sentiment || 'Neutral';
    node.dataset.tier = String(importanceTier(article.importance_score));
    node.querySelector('.card__score').textContent = String(article.importance_score ?? '');
    node.querySelector('.card__category').textContent = CATEGORY_LABELS[article.category] || article.category || 'عام';
    node.querySelector('.card__dot').style.background = CATEGORY_COLORS[article.category] || '#888';
    node.querySelector('.card__source').textContent = article.source_name || article.source_domain || 'مصدر';
    node.querySelector('.card__headline').textContent = String(article.headline || article.title || '');
    node.querySelector('.card__summary').textContent = String(article.summary || '');
    const timeEl = node.querySelector('.card__time');
    timeEl.textContent = formatRelativeTime(article.published_at);
    timeEl.setAttribute('datetime', article.published_at || '');
    node.querySelector('.card__confidence').textContent = `ثقة ${Math.round(Number(article.confidence_score ?? 0))}%`;
    const evidenceEl = node.querySelector('.card__evidence');
    const evidence = [];
    if (article.claim_digest) evidence.push(typeof article.claim_digest === 'string' ? article.claim_digest : article.claim_digest.main_claim || '');
    if (article.evidence_summary) evidence.push(article.evidence_summary);
    if (!evidence.length && Number(article.source_count || 0) > 1) evidence.push(`مجمّع من ${article.source_count} مصادر`);
    evidenceEl.textContent = evidence.filter(Boolean).join(' · ');
    const updateBadge = node.querySelector('.card__update-badge');
    updateBadge.hidden = Number(article.update_count || 0) <= 0;
    if (!updateBadge.hidden) updateBadge.textContent = `+${article.update_count} تحديث`;
    const verificationBadge = node.querySelector('.card__verification-badge');
    verificationBadge.hidden = !article.is_pending_verification;
    if (article.is_pending_verification) verificationBadge.textContent = 'بانتظار التحقق';
  }

  function createCardElement(article) { const node = cardTemplate.content.firstElementChild.cloneNode(true); populateCard(node, article); return node; }
  function flashUpdateBadge(cardId) {
    const badgeEl = gridEl.querySelector(`[data-id="${CSS.escape(String(cardId))}"] .card__update-badge`);
    if (!badgeEl) return;
    badgeEl.animate([{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-3px) scale(1.04)' }, { transform: 'translateY(0) scale(1)' }], { duration: 700, easing: CONFIG.FLIP_EASING });
  }

  function normalizeForSearch(value) {
    return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0610-\u061A\u06D6-\u06ED]/g, '').replace(/[أإآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ة/g, 'ه');
  }

  function getVisibleArticles() {
    const q = normalizeForSearch(state.searchQuery);
    return state.articles.filter((a) => !a.is_pending_verification).filter((a) => state.activeFilter === 'all' || a.category === state.activeFilter).filter((a) => !q || normalizeForSearch(`${a.headline || a.title || ''} ${a.summary || ''} ${a.source_name || ''}`).includes(q));
  }

  function sortArticles(items) {
    const copy = [...items];
    switch (state.sortMode) {
      case 'latest': return copy.sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));
      case 'updates': return copy.sort((a, b) => (Number(b.update_count) || 0) - (Number(a.update_count) || 0) || new Date(b.updated_at || b.published_at || 0) - new Date(a.updated_at || a.published_at || 0));
      default: return copy.sort((a, b) => (Number(b.importance_score) || 0) - (Number(a.importance_score) || 0) || (Number(b.update_count) || 0) - (Number(a.update_count) || 0) || new Date(b.updated_at || b.published_at || 0) - new Date(a.updated_at || a.published_at || 0));
    }
  }

  function getUrgentRows() {
    const candidates = state.articles.filter((a) => !a.is_pending_verification && a.headline);
    const important = [...candidates].sort((a, b) => (Number(b.importance_score) || 0) - (Number(a.importance_score) || 0) || new Date(b.updated_at || b.published_at || 0) - new Date(a.updated_at || a.published_at || 0));
    const strong = important.filter((a) => Number(a.importance_score || 0) >= 45);
    const source = strong.length ? strong : important;
    const rows = [];
    const seen = new Set();
    for (const article of source) {
      const key = normalizeForSearch(article.headline).replace(/\s+/g, ' ').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(article);
      if (rows.length >= CONFIG.TICKER_MAX_ITEMS) break;
    }
    return rows;
  }

  function renderTicker() {
    const rows = getUrgentRows();
    tickerTrackEl.innerHTML = '';
    const items = rows.length ? rows : [{ headline: 'لا توجد أخبار عاجلة جديدة — آخر المستجدات معروضة أدناه' }];
    for (let pass = 0; pass < 2; pass++) {
      for (const item of items) {
        const span = document.createElement('span');
        span.className = 'ticker-strip__item';
        span.textContent = item.headline || item.title || 'خبر جديد';
        tickerTrackEl.appendChild(span);
      }
    }
  }

  function renderFeaturedRail(visibleArticles) {
    featuredRailEl.innerHTML = '';
    const largeCards = visibleArticles.filter((a) => a.layout_size === 'large').slice(0, 5);
    const list = largeCards.length ? largeCards : visibleArticles.slice(0, 4);
    list.forEach((article) => {
      const card = createCardElement(article);
      card.classList.add(largeCards.length ? 'card-large' : 'card-medium');
      card.style.minWidth = '86%';
      card.style.scrollSnapAlign = 'center';
      featuredRailEl.appendChild(card);
    });
  }

  function renderWithFlip(justUpdatedId) {
    const visible = sortArticles(getVisibleArticles());
    const visibleIds = new Set(visible.map((a) => a.id));
    const firstRects = new Map();
    gridEl.querySelectorAll('.card').forEach((el) => firstRects.set(el.dataset.id, el.getBoundingClientRect()));
    gridEl.querySelectorAll('.card').forEach((el) => { if (!visibleIds.has(el.dataset.id)) el.remove(); });
    const existingById = new Map();
    gridEl.querySelectorAll('.card').forEach((el) => existingById.set(el.dataset.id, el));
    const newlyCreatedIds = new Set();
    visible.forEach((article) => {
      let el = existingById.get(article.id);
      if (!el) { el = createCardElement(article); el.style.opacity = '0'; newlyCreatedIds.add(article.id); }
      else populateCard(el, article);
      gridEl.appendChild(el);
    });
    emptyStateEl.hidden = visible.length > 0;
    gridEl.querySelectorAll('.card').forEach((el) => {
      const id = el.dataset.id;
      if (newlyCreatedIds.has(id)) {
        el.style.opacity = '';
        el.animate([{ transform: 'translateY(-16px) scale(0.98)', opacity: 0 }, { transform: 'translateY(0) scale(1)', opacity: 1 }], { duration: CONFIG.FLIP_DURATION_MS, easing: CONFIG.FLIP_EASING });
        return;
      }
      const first = firstRects.get(id);
      if (!first) return;
      const last = el.getBoundingClientRect();
      const dx = first.left - last.left, dy = first.top - last.top;
      if (dx || dy) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: CONFIG.FLIP_DURATION_MS, easing: CONFIG.FLIP_EASING });
    });
    renderFeaturedRail(visible);
    renderTicker();
    updateInsights();
    if (justUpdatedId) flashUpdateBadge(justUpdatedId);
  }

  function upsertArticle(row) {
    if (!row || !row.id) return;
    const idx = state.articles.findIndex((a) => a.id === row.id);
    if (idx !== -1) state.articles.splice(idx, 1);
    state.articles.unshift(row);
    state.articles.sort((a, b) => new Date(b.updated_at || b.published_at || 0) - new Date(a.updated_at || a.published_at || 0));
    if (state.articles.length > CONFIG.MAX_KEPT_ARTICLES) state.articles.length = CONFIG.MAX_KEPT_ARTICLES;
  }

  async function fetchInitialBatch() {
    const { data, error } = await sb.from(CONFIG.TABLE).select(SELECT_COLUMNS).eq('is_pending_verification', false).order('updated_at', { ascending: false }).limit(CONFIG.INITIAL_FETCH_LIMIT);
    if (error) { console.error('[mirsad] initial fetch failed', error); return []; }
    return data || [];
  }

  async function fetchLatestViaRest() {
    const params = new URLSearchParams({ select: SELECT_COLUMNS, is_pending_verification: 'eq.false', order: 'updated_at.desc.nullslast', limit: String(CONFIG.INITIAL_FETCH_LIMIT) });
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${CONFIG.TABLE}?${params.toString()}`, { headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}` } });
    if (!res.ok) throw new Error(`REST poll failed: ${res.status}`);
    return res.json();
  }

  function startPollingFallback() {
    setConnectionState('polling');
    if (state.pollTimer) return;
    state.pollTimer = setInterval(async () => {
      try {
        const rows = await fetchLatestViaRest();
        state.articles = [];
        rows.forEach(upsertArticle);
        renderWithFlip();
        touchLastSync();
      } catch (error) { console.error('[mirsad] poll failed', error); }
      subscribeRealtime();
    }, CONFIG.POLL_FALLBACK_INTERVAL_MS);
  }

  function stopPollingFallback() { if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; } }

  function subscribeRealtime() {
    if (state.channel) { sb.removeChannel(state.channel); state.channel = null; }
    state.channel = sb.channel('news_articles-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: CONFIG.TABLE }, (payload) => {
        if (payload.new.is_pending_verification) return;
        upsertArticle(payload.new); renderWithFlip(payload.new.id); touchLastSync();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: CONFIG.TABLE }, (payload) => {
        if (payload.new.is_pending_verification) { state.articles = state.articles.filter((a) => a.id !== payload.new.id); renderWithFlip(); touchLastSync(); return; }
        const prevCount = payload.old ? payload.old.update_count : 0;
        upsertArticle(payload.new);
        const isClusterUpdate = Number(payload.new.update_count || 0) > Number(prevCount || 0);
        renderWithFlip(isClusterUpdate ? payload.new.id : undefined); touchLastSync();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') { setConnectionState('live'); stopPollingFallback(); }
        else if (['CLOSED', 'CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) startPollingFallback();
      });
  }

  categoryFiltersEl.addEventListener('click', (event) => { const btn = event.target.closest('.chip'); if (!btn) return; state.activeFilter = btn.dataset.category; savePreferences(); [...categoryFiltersEl.children].forEach((chip) => chip.classList.toggle('is-active', chip === btn)); renderWithFlip(); });
  searchBoxEl.addEventListener('input', (event) => { state.searchQuery = event.target.value; savePreferences(); renderWithFlip(); });
  sortBoxEl.addEventListener('change', (event) => { state.sortMode = event.target.value; savePreferences(); renderWithFlip(); });
  document.addEventListener('keydown', (event) => { if (event.key === '/' && !/input|textarea|select/i.test(event.target.tagName)) { event.preventDefault(); searchBoxEl.focus(); return; } if (event.key === 'Escape' && document.activeElement === searchBoxEl) { searchBoxEl.value = ''; state.searchQuery = ''; savePreferences(); renderWithFlip(); } });

  async function init() {
    setConnectionState('connecting'); loadPreferences(); syncControlsFromState();
    const initialRows = await fetchInitialBatch();
    state.articles = []; initialRows.forEach(upsertArticle);
    renderWithFlip(); touchLastSync(); subscribeRealtime();
  }

  document.addEventListener('DOMContentLoaded', init);
})();