(() => {
  'use strict';

  const SUPABASE_URL = 'https://dndlkenyfymlrjnslyzb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx';
  const API = `${SUPABASE_URL}/rest/v1/news_articles`;
  const CATEGORY_LABELS = { Politics:'سياسة', Economy:'اقتصاد', Tech:'تقنية', Society:'مجتمع', Sports:'رياضة' };
  const CATEGORY_COLORS = { Politics:'#8b7bc7', Economy:'#c9a227', Tech:'#4f9dde', Society:'#b8794a', Sports:'#4fa8a0' };
  const state = { open:false, article:null, related:[], returnFocus:null };

  const text = (value) => String(value ?? '').trim();
  const stripHtml = (value) => {
    const box = document.createElement('div');
    box.innerHTML = String(value || '');
    return (box.textContent || box.innerText || '').replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').trim();
  };
  const formatTime = (value) => {
    const t = new Date(value || 0).getTime();
    if (!Number.isFinite(t) || t <= 0) return 'وقت غير محدد';
    return new Intl.DateTimeFormat('ar', { dateStyle:'medium', timeStyle:'short' }).format(new Date(t));
  };
  const relative = (value) => {
    const t = new Date(value || 0).getTime();
    if (!Number.isFinite(t) || t <= 0) return 'وقت غير محدد';
    const minutes = Math.round((t - Date.now()) / 60000);
    const rtf = new Intl.RelativeTimeFormat('ar', { numeric:'auto' });
    if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
    return rtf.format(Math.round(hours / 24), 'day');
  };
  const escUrl = (value) => {
    try { return new URL(value, window.location.href).href; } catch { return '#'; }
  };

  const backdrop = document.createElement('div');
  backdrop.className = 'mirsad-reader-backdrop';
  backdrop.hidden = true;
  backdrop.innerHTML = `
    <section class="mirsad-reader" role="dialog" aria-modal="true" aria-labelledby="mirsadReaderTitle">
      <header class="mirsad-reader__header">
        <p class="mirsad-reader__kicker">قراءة الخبر</p>
        <button class="mirsad-reader__close" type="button" aria-label="إغلاق">×</button>
      </header>
      <div class="mirsad-reader__body" tabindex="-1">
        <div class="mirsad-reader__content"></div>
      </div>
      <footer class="mirsad-reader__footer">
        <a class="mirsad-reader__source" href="#" target="_blank" rel="noopener noreferrer">المصدر الأصلي ↗</a>
      </footer>
    </section>`;
  document.body.appendChild(backdrop);

  const reader = backdrop.querySelector('.mirsad-reader');
  const body = backdrop.querySelector('.mirsad-reader__body');
  const content = backdrop.querySelector('.mirsad-reader__content');
  const closeBtn = backdrop.querySelector('.mirsad-reader__close');
  const sourceBtn = backdrop.querySelector('.mirsad-reader__source');

  function renderLoading() {
    content.innerHTML = '<div class="mirsad-reader__loading">جارٍ تحميل تفاصيل الخبر…</div>';
    sourceBtn.hidden = true;
  }

  function renderError() {
    content.innerHTML = '<div class="mirsad-reader__error">تعذر تحميل تفاصيل الخبر. حاول مرة أخرى.</div>';
    sourceBtn.hidden = true;
  }

  function articleMarkup(article, related) {
    const category = CATEGORY_LABELS[article.category] || article.category || 'عام';
    const dot = CATEGORY_COLORS[article.category] || 'var(--gold)';
    const title = text(article.headline || article.title) || 'خبر دون عنوان';
    const summary = stripHtml(article.summary);
    const source = text(article.source_name) || 'مصدر';
    const confidence = Math.round(Number(article.confidence_score) || 0);
    const importance = Math.round(Number(article.importance_score) || 0);
    const updates = Math.max(0, Number(article.update_count) || 0);
    const sources = Math.max(1, Number(article.source_count) || 1);

    const relatedMarkup = related.length ? `
      <section class="mirsad-reader__section" aria-labelledby="mirsadRelatedTitle">
        <h3 id="mirsadRelatedTitle">أخبار مرتبطة بالحدث</h3>
        <div class="mirsad-reader__related">
          ${related.map((item) => `
            <button type="button" class="mirsad-related-item" data-related-id="${item.id}">
              ${text(item.headline) || 'خبر مرتبط'}
              <small>${text(item.source_name) || 'مصدر'} · ${relative(item.published_at)}</small>
            </button>`).join('')}
        </div>
      </section>` : '';

    return `
      <div class="mirsad-reader__meta">
        <span class="mirsad-reader__dot" style="background:${dot}"></span>
        <span>${category}</span><span>·</span><span>${source}</span><span>·</span><span>${relative(article.published_at)}</span>
      </div>
      <h2 id="mirsadReaderTitle" class="mirsad-reader__title">${escapeHtml(title)}</h2>
      <p class="mirsad-reader__summary">${escapeHtml(summary || 'لا يتوفر ملخص لهذا الخبر.')}</p>
      <div class="mirsad-reader__stats">
        <div class="mirsad-reader__stat"><span>الأهمية</span><strong>${importance}</strong></div>
        <div class="mirsad-reader__stat"><span>الثقة</span><strong>${confidence}%</strong></div>
        <div class="mirsad-reader__stat"><span>التحديثات</span><strong>${updates}</strong></div>
        <div class="mirsad-reader__stat"><span>المصادر</span><strong>${sources}</strong></div>
        <div class="mirsad-reader__stat"><span>وقت النشر</span><strong>${escapeHtml(formatTime(article.published_at))}</strong></div>
        <div class="mirsad-reader__stat"><span>آخر مزامنة</span><strong>${escapeHtml(formatTime(article.updated_at || article.created_at))}</strong></div>
      </div>
      ${relatedMarkup}`;
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function loadArticle(id) {
    const params = new URLSearchParams({
      select: 'id,source_name,source_url,agency_urls,headline,summary,category,importance_score,sentiment,update_count,source_count,confidence_score,published_at,created_at,updated_at,cluster_id,is_pending_verification',
      id: `eq.${id}`,
      is_pending_verification: 'eq.false',
      limit: '1',
    });
    const rows = await fetchJson(`${API}?${params.toString()}`);
    if (!rows.length) throw new Error('article_not_found');
    const article = rows[0];
    let related = [];
    if (article.cluster_id) {
      const rel = new URLSearchParams({
        select: 'id,source_name,headline,published_at,updated_at',
        cluster_id: `eq.${article.cluster_id}`,
        is_pending_verification: 'eq.false',
        id: `neq.${article.id}`,
        order: 'published_at.desc.nullslast,updated_at.desc.nullslast',
        limit: '8',
      });
      related = await fetchJson(`${API}?${rel.toString()}`);
    }
    return { article, related };
  }

  function openReader(id, sourceElement) {
    if (!id || state.open) return;
    state.open = true;
    state.returnFocus = sourceElement || document.activeElement;
    backdrop.hidden = false;
    document.body.classList.add('mirsad-reader-open');
    body.scrollTop = 0;
    renderLoading();
    closeBtn.focus();
    loadArticle(id).then(({ article, related }) => {
      state.article = article;
      state.related = related;
      content.innerHTML = articleMarkup(article, related);
      sourceBtn.hidden = !article.source_url;
      sourceBtn.href = escUrl(article.source_url || (article.agency_urls || [])[0] || '#');
      body.scrollTop = 0;
      wireRelated();
    }).catch((error) => {
      console.error('[mirsad reader] load failed', error);
      renderError();
    });
  }

  function closeReader() {
    if (!state.open) return;
    state.open = false;
    state.article = null;
    state.related = [];
    backdrop.hidden = true;
    document.body.classList.remove('mirsad-reader-open');
    if (state.returnFocus && typeof state.returnFocus.focus === 'function') state.returnFocus.focus();
  }

  function wireRelated() {
    content.querySelectorAll('.mirsad-related-item').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.relatedId;
        if (!id) return;
        body.scrollTop = 0;
        renderLoading();
        loadArticle(id).then(({ article, related }) => {
          state.article = article;
          state.related = related;
          content.innerHTML = articleMarkup(article, related);
          sourceBtn.hidden = !article.source_url;
          sourceBtn.href = escUrl(article.source_url || (article.agency_urls || [])[0] || '#');
          body.scrollTop = 0;
          wireRelated();
        }).catch((error) => {
          console.error('[mirsad reader] related load failed', error);
          renderError();
        });
      });
    });
  }

  closeBtn.addEventListener('click', closeReader);
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeReader(); });
  document.addEventListener('keydown', (event) => {
    if (!state.open) return;
    if (event.key === 'Escape') { event.preventDefault(); closeReader(); }
  });

  document.addEventListener('click', (event) => {
    const card = event.target.closest?.('.card');
    if (!card || event.target.closest('a,button,input,select,textarea')) return;
    const id = card.dataset.id;
    if (!id) return;
    event.preventDefault();
    openReader(id, card);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest?.('.card');
    if (!card || event.target.closest('a,button,input,select,textarea')) return;
    event.preventDefault();
    const id = card.dataset.id;
    if (id) openReader(id, card);
  });
})();
