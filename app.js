(() => {
  'use strict';

  const CONFIG = {
    SUPABASE_URL: 'https://dndlkenyfymlrjnslyzb.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx',
    TABLE: 'news_articles',
    INITIAL_FETCH_LIMIT: 400,
    MAX_KEPT_ARTICLES: 400,
    POLL_FALLBACK_INTERVAL_MS: 30 * 1000,
    FLIP_DURATION_MS: 650,
    FLIP_EASING: 'cubic-bezier(0.16, 1, 0.3, 1)',
    TICKER_MAX_ITEMS: 12,
    TRUSTED_SOURCE_COUNT: 14,
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
  const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  const state = { articles: [], activeFilter: 'all', searchQuery: '', sortMode: 'priority', channel: null, pollTimer: null, featuredLoading: true };
  const STORAGE_KEY = 'mirsad.ui.state.v1';
  const SELECT_COLUMNS = 'id,source_name,source_url,agency_urls,headline,summary,category,importance_score,sentiment,layout_size,cluster_id,update_count,source_count,source_trust_score,confidence_score,is_pending_verification,verification_notes,inherited_from_cache,llm_model_used,claim_digest,raw_payload,published_at,created_at,updated_at';

  function loadPreferences() { try { const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return; const parsed = JSON.parse(raw); if (parsed && typeof parsed === 'object') { state.activeFilter = parsed.activeFilter || state.activeFilter; state.searchQuery = parsed.searchQuery || state.searchQuery; state.sortMode = ['priority','latest','updates'].includes(parsed.sortMode) ? parsed.sortMode : state.sortMode; } } catch {} }
  function savePreferences() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeFilter: state.activeFilter, searchQuery: state.searchQuery, sortMode: state.sortMode })); } catch {} }
  function syncControlsFromState() { searchBoxEl.value = state.searchQuery; if (sortBoxEl?.matches('select')) sortBoxEl.value = state.sortMode; if (sortBoxEl?.matches('button')) { sortBoxEl.textContent = state.sortMode === 'latest' ? 'الأحدث' : state.sortMode === 'updates' ? 'الأكثر تحديثًا' : 'الأولوية'; sortBoxEl.dataset.sortMode = state.sortMode; } [...categoryFiltersEl.children].forEach((chip) => chip.classList.toggle('is-active', chip.dataset.category === state.activeFilter)); }
  function updateInsights() { const clusters = new Set(), trustedSources = new Set(); let pendingCount = 0, confidenceSum = 0, confidenceCount = 0; for (const article of state.articles) { if (article.cluster_id) clusters.add(article.cluster_id); if (article.is_pending_verification) pendingCount += 1; const conf = Number(article.confidence_score); if (Number.isFinite(conf)) { confidenceSum += conf; confidenceCount += 1; } if (Number(article.source_trust_score || 0) >= 0.8) trustedSources.add(article.source_name || article.source_url || 'source'); } insightClusterCountEl.textContent = String(clusters.size); insightPendingCountEl.textContent = String(pendingCount); insightAvgConfidenceEl.textContent = `${confidenceCount ? Math.round(confidenceSum / confidenceCount) : 0}%`; insightTrustedSourcesEl.textContent = String(CONFIG.TRUSTED_SOURCE_COUNT); liveCountEl.textContent = `${getVisibleArticles().length} خبر معروض · ${pendingCount} قيد المراجعة`; }
  function layoutClass(size) { return size === 'large' ? 'card-large' : size === 'medium' ? 'card-medium' : ''; }
  function importanceTier(score) { return Math.min(5, Math.max(1, Math.ceil(Number(score || 0) / 20))); }
  const relativeTimeFormatter = new Intl.RelativeTimeFormat('ar', { numeric: 'auto' });
  function formatRelativeTime(iso) { const time = new Date(iso).getTime(); if (!Number.isFinite(time)) return 'وقت غير محدد'; const diffMin = Math.round((time - Date.now()) / 60000); if (Math.abs(diffMin) < 60) return relativeTimeFormatter.format(diffMin, 'minute'); const diffHour = Math.round(diffMin / 60); if (Math.abs(diffHour) < 24) return relativeTimeFormatter.format(diffHour, 'hour'); return relativeTimeFormatter.format(Math.round(diffHour / 24), 'day'); }
  function setConnectionState(newState) { statusDotEl.dataset.state = newState; statusTextEl.textContent = { connecting: 'جارٍ الاتصال بالبث الحي…', live: 'بث مباشر', polling: 'وضع احتياطي — تحديث كل 30 ثانية' }[newState] || newState; }
  function touchLastSync() { lastSyncEl.textContent = `آخر مزامنة: ${new Intl.DateTimeFormat('ar', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`; }
  function populateCard(node, article) { node.className = ['card', layoutClass(article.layout_size)].filter(Boolean).join(' '); node.dataset.id = article.id; node.dataset.sentiment = article.sentiment || 'Neutral'; node.dataset.tier = String(importanceTier(article.importance_score)); node.querySelector('.card__score').textContent = String(article.importance_score ?? ''); node.querySelector('.card__category').textContent = CATEGORY_LABELS[article.category] || article.category || 'عام'; node.querySelector('.card__dot').style.background = CATEGORY_COLORS[article.category] || '#888'; node.querySelector('.card__source').textContent = article.source_name || article.source_domain || 'مصدر'; node.querySelector('.card__headline').textContent = String(article.headline || article.title || ''); node.querySelector('.card__summary').textContent = String(article.summary || ''); const timeEl = node.querySelector('.card__time'); timeEl.textContent = formatRelativeTime(article.published_at); timeEl.setAttribute('datetime', article.published_at || ''); node.querySelector('.card__confidence').textContent = `ثقة ${Math.round(Number(article.confidence_score ?? 0))}%`; const evidenceEl = node.querySelector('.card__evidence'); const evidence = []; if (article.claim_digest) evidence.push(typeof article.claim_digest === 'string' ? article.claim_digest : article.claim_digest.main_claim || ''); if (article.evidence_summary) evidence.push(article.evidence_summary); if (!evidence.length && Number(article.source_count || 0) > 1) evidence.push(`مجمّع من ${article.source_count} مصادر`); evidenceEl.textContent = evidence.filter(Boolean).join(' · '); const updateBadge = node.querySelector('.card__update-badge'); updateBadge.hidden = Number(article.update_count || 0) <= 0; if (!updateBadge.hidden) updateBadge.textContent = `+${article.update_count} تحديث`; const verificationBadge = node.querySelector('.card__verification-badge'); verificationBadge.hidden = !article.is_pending_verification; if (article.is_pending_verification) verificationBadge.textContent = 'بانتظار التحقق'; }
  function createCardElement(article) { const node = cardTemplate.content.firstElementChild.cloneNode(true); populateCard(node, article); return node; }
  function flashUpdateBadge(cardId) { const badgeEl = gridEl.querySelector(`[data-id="${CSS.escape(String(cardId))}"] .card__update-badge`); if (!badgeEl) return; badgeEl.animate([{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-3px) scale(1.04)' }, { transform: 'translateY(0) scale(1)' }], { duration: 700, easing: CONFIG.FLIP_EASING }); }
  function normalizeForSearch(value) { return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0610-\u061A\u06D6-\u06ED]/g, '').replace(/[أإآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ة/g, 'ه'); }
  function isArabicHeadline(value) { const text = String(value || '').trim(); if (!text) return false; const arabic = (text.match(/[ء-ي]/g) || []).length; const letters = (text.match(/[\p{L}]/gu) || []).length; return arabic >= 2 && arabic / Math.max(1, letters) >= 0.2; }
  function getVisibleArticles() { const q = normalizeForSearch(state.searchQuery); return state.articles.filter((a) => !a.is_pending_verification).filter((a) => isArabicHeadline(a.headline || a.title)).filter((a) => state.activeFilter === 'all' || a.category === state.activeFilter).filter((a) => !q || normalizeForSearch(`${a.headline || a.title || ''} ${a.summary || ''} ${a.source_name || ''}`).includes(q)); }

  function getTime(article, key) { const value = new Date(article?.[key] || 0).getTime(); return Number.isFinite(value) ? value : 0; }
  function compareLatest(a, b) { return getTime(b, 'published_at') - getTime(a, 'published_at') || getTime(b, 'updated_at') - getTime(a, 'updated_at') || getTime(b, 'created_at') - getTime(a, 'created_at') || String(b?.id || '').localeCompare(String(a?.id || '')); }
  function comparePriority(a, b) { return (Number(b?.importance_score) || 0) - (Number(a?.importance_score) || 0) || (Number(b?.update_count) || 0) - (Number(a?.update_count) || 0) || getTime(b, 'updated_at') - getTime(a, 'updated_at') || getTime(b, 'published_at') - getTime(a, 'published_at') || getTime(b, 'created_at') - getTime(a, 'created_at') || String(b?.id || '').localeCompare(String(a?.id || '')); }
  function compareUpdates(a, b) { return (Number(b?.update_count) || 0) - (Number(a?.update_count) || 0) || getTime(b, 'updated_at') - getTime(a, 'updated_at') || getTime(b, 'published_at') - getTime(a, 'published_at') || getTime(b, 'created_at') - getTime(a, 'created_at') || String(b?.id || '').localeCompare(String(a?.id || '')); }

  function rankingSignal(article) {
    const importance = Math.max(0, Math.min(100, Number(article?.importance_score) || 0));
    const confidence = Math.max(0, Math.min(100, Number(article?.confidence_score) || 0));
    const trust = Math.max(0, Math.min(1, Number(article?.source_trust_score) || 0)) * 100;
    const sources = Math.max(1, Number(article?.source_count) || 1);
    const updates = Math.max(0, Number(article?.update_count) || 0);
    const published = getTime(article, 'published_at') || getTime(article, 'created_at');
    const ageHours = Math.max(0, (Date.now() - published) / 3600000);
    const freshness = 100 * Math.exp(-ageHours / 18);
    const momentum = 100 * (1 - Math.exp(-(updates * 1.5 + Math.max(0, sources - 1)) / 3));
    const independentEvidence = Math.min(100, (sources - 1) * 20);
    const evidence = Math.min(100, confidence * 0.65 + trust * 0.20 + independentEvidence * 0.15);
    return importance * 0.34 + freshness * 0.20 + evidence * 0.18 + momentum * 0.12 + trust * 0.06 + Math.min(100, sources * 12) * 0.05 + (article?.cluster_id ? 3 : 0);
  }

  function sortPriorityIntelligently(items) {
    const ranked = [...items].map((article) => ({ article, base: rankingSignal(article) })).sort((a, b) => b.base - a.base || compareLatest(a.article, b.article));
    const selected = [];
    const clusterCounts = new Map();
    const sourceCounts = new Map();
    const remaining = ranked.slice();

    while (remaining.length) {
      let bestIndex = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < remaining.length; i += 1) {
        const { article, base } = remaining[i];
        const clusterKey = article.cluster_id || 'article:' + article.id;
        const sourceKey = String(article.source_name || article.source_url || '').trim().toLowerCase();
        const clusterPenalty = Math.min(18, (clusterCounts.get(clusterKey) || 0) * 8);
        const sourcePenalty = Math.min(8, (sourceCounts.get(sourceKey) || 0) * 2);
        const adjusted = base - clusterPenalty - sourcePenalty;
        if (adjusted > bestScore) { bestScore = adjusted; bestIndex = i; }
      }
      const [picked] = remaining.splice(bestIndex, 1);
      selected.push(picked.article);
      const clusterKey = picked.article.cluster_id || 'article:' + picked.article.id;
      const sourceKey = String(picked.article.source_name || picked.article.source_url || '').trim().toLowerCase();
      clusterCounts.set(clusterKey, (clusterCounts.get(clusterKey) || 0) + 1);
      if (sourceKey) sourceCounts.set(sourceKey, (sourceCounts.get(sourceKey) || 0) + 1);
    }
    return selected;
  }

  function sortArticles(items) { const copy = [...items]; if (state.sortMode === 'latest') return copy.sort(compareLatest); if (state.sortMode === 'updates') return copy.sort(compareUpdates); return sortPriorityIntelligently(copy); }

  function getUrgentRows() { const candidates = state.articles.filter((a) => !a.is_pending_verification && isArabicHeadline(a.headline)); const rows = []; const seen = new Set(); for (const article of [...candidates].sort(compareLatest)) { const key = normalizeForSearch(article.headline).replace(/\s+/g, ' ').trim(); if (!key || seen.has(key)) continue; seen.add(key); rows.push(article); if (rows.length >= 4) break; } return rows; }
  function renderTicker() { const rows = getUrgentRows(); tickerTrackEl.innerHTML = ''; const items = rows.length ? rows : [{ headline: 'لا توجد أخبار عاجلة جديدة — آخر المستجدات معروضة أدناه' }]; for (const item of items) { const span = document.createElement('span'); span.className = 'ticker-strip__item'; span.textContent = item.headline || item.title || 'خبر جديد'; tickerTrackEl.appendChild(span); } }
  function renderFeaturedRail(visibleArticles) {
    const loader = document.getElementById('featuredLoader');
    featuredRailEl.innerHTML = '';
    if (loader) featuredRailEl.appendChild(loader);
    const largeCards = visibleArticles.filter((a) => a.layout_size === 'large').slice(0, 5);
    const list = largeCards.length >= 2 ? largeCards : visibleArticles.slice(0, 4);
    if (loader) loader.hidden = !state.featuredLoading;
    list.forEach((article, index) => {
      const card = createCardElement(article);
      card.classList.add(largeCards.length >= 2 ? 'card-large' : (index === 0 ? 'card-large' : 'card-medium'));
      card.style.minWidth = '86%';
      card.style.scrollSnapAlign = 'center';
      featuredRailEl.appendChild(card);
    });
  }
  function renderWithFlip(justUpdatedId, options = {}) {
    const animateNew = options.animateNew !== false;
    const animateMoves = options.animateMoves !== false;
    const visible = sortArticles(getVisibleArticles());
    const visibleIds = new Set(visible.map((a) => a.id));
    const firstRects = new Map();
    gridEl.querySelectorAll('.card').forEach((el) => {
      el.getAnimations().forEach((animation) => animation.cancel());
      el.style.transform = '';
      firstRects.set(el.dataset.id, el.getBoundingClientRect());
    });
    gridEl.querySelectorAll('.card').forEach((el) => { if (!visibleIds.has(el.dataset.id)) el.remove(); });

    // Keep the grid's existing nodes and only apply FLIP when content/order actually changes.
    // This prevents a category change from temporarily retaining cards from the previous filter.
    const existingById = new Map();
    gridEl.querySelectorAll('.card').forEach((el) => existingById.set(el.dataset.id, el));
    const fragment = document.createDocumentFragment();
    const newlyCreatedIds = new Set();

    visible.forEach((article) => {
      let el = existingById.get(article.id);
      if (!el) {
        el = createCardElement(article);
        newlyCreatedIds.add(article.id);
      } else {
        populateCard(el, article);
      }
      fragment.appendChild(el);
    });
    gridEl.replaceChildren(fragment);

    emptyStateEl.hidden = visible.length > 0;

    gridEl.querySelectorAll('.card').forEach((el) => {
      const id = el.dataset.id;
      if (newlyCreatedIds.has(id)) {
        if (animateNew) {
          el.animate(
            [{ transform: 'translateY(-16px) scale(0.98)', opacity: 0 }, { transform: 'translateY(0) scale(1)', opacity: 1 }],
            { duration: CONFIG.FLIP_DURATION_MS, easing: CONFIG.FLIP_EASING }
          );
        }
        return;
      }
      if (!animateMoves) return;
      const first = firstRects.get(id);
      if (!first) return;
      const last = el.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (dx || dy) el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: CONFIG.FLIP_DURATION_MS, easing: CONFIG.FLIP_EASING }
      );
    });

    // These always derive from the newly filtered list.
    renderFeaturedRail(visible);
    renderTicker();
    updateInsights();
    if (justUpdatedId) flashUpdateBadge(justUpdatedId);
  }
  function upsertArticle(row) { if (!row || !row.id || !isArabicHeadline(row.headline || row.title)) return; const idx = state.articles.findIndex((a) => a.id === row.id); if (idx !== -1) state.articles.splice(idx, 1); state.articles.unshift(row); state.articles.sort(compareLatest); if (state.articles.length > CONFIG.MAX_KEPT_ARTICLES) state.articles.length = CONFIG.MAX_KEPT_ARTICLES; }
  async function fetchInitialBatch() { const { data, error } = await sb.from(CONFIG.TABLE).select(SELECT_COLUMNS).eq('is_pending_verification', false).order('published_at', { ascending: false, nullsFirst: false }).order('updated_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false, nullsFirst: false }).limit(CONFIG.INITIAL_FETCH_LIMIT); if (error) { console.error('[mirsad] initial fetch failed', error); return []; } return (data || []).filter((row) => isArabicHeadline(row.headline || row.title)).sort(compareLatest); }
  async function fetchLatestViaRest() { const params = new URLSearchParams({ select: SELECT_COLUMNS, is_pending_verification: 'eq.false', order: 'published_at.desc.nullslast,updated_at.desc.nullslast,created_at.desc.nullslast', limit: String(CONFIG.INITIAL_FETCH_LIMIT) }); try { const response = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${CONFIG.TABLE}?${params.toString()}`, { headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}` } }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return (await response.json()).filter((row) => isArabicHeadline(row.headline || row.title)).sort(compareLatest); } catch (error) { console.error('[mirsad] REST fetch failed', error); return []; } }
  async function initialLoad() { loadPreferences(); syncControlsFromState(); setConnectionState('connecting'); let rows = await fetchInitialBatch(); if (!rows.length) rows = await fetchLatestViaRest(); state.articles = rows.slice(0, CONFIG.MAX_KEPT_ARTICLES).sort(compareLatest); renderWithFlip(); state.featuredLoading = false; renderFeaturedRail(getVisibleArticles()); touchLastSync(); setConnectionState('live'); startRealtime(); startPollingFallback(); }
  function startRealtime() { if (state.channel) sb.removeChannel(state.channel); state.channel = sb.channel('mirsad-news-live').on('postgres_changes', { event: 'INSERT', schema: 'public', table: CONFIG.TABLE }, ({ new: row }) => { if (row?.is_pending_verification || !isArabicHeadline(row?.headline || row?.title)) return; upsertArticle(row); renderWithFlip(); touchLastSync(); }).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: CONFIG.TABLE }, ({ new: row }) => { if (row?.is_pending_verification || !isArabicHeadline(row?.headline || row?.title)) return; upsertArticle(row); renderWithFlip(row?.id); touchLastSync(); }).subscribe((status) => { if (status === 'SUBSCRIBED') setConnectionState('live'); if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setConnectionState('polling'); }); }
  async function refreshFromServer() { const rows = await fetchInitialBatch(); if (rows.length) { state.articles = rows.slice(0, CONFIG.MAX_KEPT_ARTICLES).sort(compareLatest); renderWithFlip(); touchLastSync(); } }
  function startPollingFallback() { if (state.pollTimer) clearInterval(state.pollTimer); state.pollTimer = setInterval(refreshFromServer, CONFIG.POLL_FALLBACK_INTERVAL_MS); }
  function handleSortChange(value) { const next = ['priority','latest','updates'].includes(value) ? value : 'priority'; if (state.sortMode === next) return; state.sortMode = next; savePreferences(); syncControlsFromState(); renderWithFlip(); }
  function wireControls() { searchBoxEl.addEventListener('input', () => { state.searchQuery = searchBoxEl.value; savePreferences(); renderWithFlip(); }); categoryFiltersEl.addEventListener('click', (event) => { const button = event.target.closest('[data-category]'); if (!button) return; state.activeFilter = button.dataset.category || 'all'; savePreferences(); syncControlsFromState(); renderWithFlip(undefined, { animateNew: false, animateMoves: false }); }); sortBoxEl?.addEventListener('change', () => handleSortChange(sortBoxEl.matches('select') ? sortBoxEl.value : sortBoxEl.dataset.sortMode)); sortBoxEl?.addEventListener('sortchange', (event) => handleSortChange(event.detail?.value)); }
  loadPreferences();
  wireControls();
  syncControlsFromState();
  initialLoad();
})();
