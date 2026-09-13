(() => {
  'use strict';

  const SUPABASE_URL = 'https://dndlkenyfymlrjnslyzb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx';
  const API = `${SUPABASE_URL}/rest/v1/news_articles`;
  const REVISIONS_API = `${SUPABASE_URL}/rest/v1/news_article_revisions`;
  const MIRSAD_API = `${SUPABASE_URL}/functions/v1/mirsad-analysis-api`;
  const CATEGORY_LABELS = { Politics:'سياسة', Economy:'اقتصاد', Tech:'تقنية', Society:'مجتمع', Sports:'رياضة' };
  const CATEGORY_COLORS = { Politics:'#8b7bc7', Economy:'#c9a227', Tech:'#4f9dde', Society:'#b8794a', Sports:'#4fa8a0' };
  const state = { open:false, article:null, related:[], revisions:[], selectedRevision:0, returnFocus:null, mirsad:null, mirsadLoading:false };

  const text = (value) => String(value ?? '').trim();
  const stripHtml = (value) => {
    const box = document.createElement('div');
    box.innerHTML = String(value || '');
    return (box.textContent || box.innerText || '').replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').trim();
  };
  const escapeHtml = (value) => {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
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
  const safeUrl = (value) => {
    try {
      const url = new URL(value || '', window.location.href);
      return /^https?:$/i.test(url.protocol) ? url.href : '#';
    } catch { return '#'; }
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

  const body = backdrop.querySelector('.mirsad-reader__body');
  const content = backdrop.querySelector('.mirsad-reader__content');
  const closeBtn = backdrop.querySelector('.mirsad-reader__close');
  const sourceBtn = backdrop.querySelector('.mirsad-reader__source');

  function renderLoading() {
    content.innerHTML = '<div class="mirsad-reader__loading">جارٍ تحميل تفاصيل الخبر…</div>';
    sourceBtn.hidden = true;
  }

  function activeDisplay(article, revisions) {
    if (!revisions.length) return { ...article, __isRevision:false, __revisionNumber:0, __capturedAt:article.updated_at || article.created_at };
    const revision = revisions[Math.min(state.selectedRevision, revisions.length - 1)];
    return { ...article, headline:revision.headline, summary:revision.summary, source_name:revision.source_name || article.source_name, source_url:revision.source_url || article.source_url, published_at:revision.published_at || article.published_at, __isRevision:true, __revisionNumber:revision.revision_number, __revisionType:revision.revision_type, __capturedAt:revision.captured_at };
  }

  function mirsadBlock() {
    if (state.mirsad?.status === 'completed' && state.mirsad.analytical_reading) {
      return `
        <section class="mirsad-analysis" aria-labelledby="mirsadAnalysisTitle">
          <div class="mirsad-analysis__header">
            <div>
              <span class="mirsad-analysis__eyebrow">إضافة مِرصاد</span>
              <h3 id="mirsadAnalysisTitle">القراءة التحليلية</h3>
            </div>
          </div>
          <p class="mirsad-analysis__claim">${escapeHtml(state.mirsad.analytical_reading)}</p>
        </section>`;
    }
    const analysisPending = state.mirsadLoading || ['queued', 'processing', 'pending'].includes(state.mirsad?.status);
    return `
      <section class="mirsad-analysis" aria-labelledby="mirsadAnalysisTitle">
        <div class="mirsad-analysis__header">
          <div>
            <span class="mirsad-analysis__eyebrow">إضافة مِرصاد</span>
            <h3 id="mirsadAnalysisTitle">القراءة التحليلية</h3>
          </div>
        </div>
        ${analysisPending
          ? '<p class="mirsad-analysis__claim mirsad-analysis__loading" role="status" aria-live="polite"><span class="mirsad-analysis__spinner" aria-hidden="true"></span><span>جارٍ إعداد القراءة التحليلية…</span></p>'
          : '<p class="mirsad-analysis__claim">لا تتوفر قراءة تحليلية لهذا الخبر حاليًا.</p>'}
      </section>`;
  }

  function revisionLabel(revision) {
    return revision.revision_type === 'original' && revision.revision_number === 1 ? 'الأصل' : `تحديث ${Math.max(1, Number(revision.revision_number || 1) - 1)}`;
  }

  function articleMarkup(article, related, revisions) {
    const display = activeDisplay(article, revisions);
    const category = CATEGORY_LABELS[display.category] || display.category || 'عام';
    const dot = CATEGORY_COLORS[display.category] || 'var(--gold)';
    const title = text(display.headline || display.title) || 'خبر دون عنوان';
    const summary = stripHtml(display.summary);
    const source = text(display.source_name) || 'مصدر';

    const revisionMarkup = revisions.length > 1 ? `
      <section class="mirsad-reader__section mirsad-revisions" aria-labelledby="mirsadRevisionsTitle">
        <div class="mirsad-revisions__header">
          <div><span class="mirsad-analysis__eyebrow">سجل الخبر</span><h3 id="mirsadRevisionsTitle">الأصل والتحديثات</h3></div>
          <span class="mirsad-revisions__count">${revisions.length - 1} تحديث</span>
        </div>
        <div class="mirsad-revisions__tabs" role="tablist" aria-label="نسخ الخبر">
          ${revisions.map((revision, index) => `
            <button type="button" class="mirsad-revision-tab${index === state.selectedRevision ? ' is-active' : ''}" data-revision-index="${index}" role="tab" aria-selected="${index === state.selectedRevision}">
              <span>${escapeHtml(revisionLabel(revision))}</span><small>${escapeHtml(relative(revision.captured_at))}</small>
            </button>`).join('')}
        </div>
        <div class="mirsad-revisions__active"><span>${escapeHtml(revisions[state.selectedRevision] ? revisionLabel(revisions[state.selectedRevision]) : 'النسخة الحالية')}</span><time datetime="${escapeHtml(revisions[state.selectedRevision]?.captured_at || '')}">${escapeHtml(formatTime(revisions[state.selectedRevision]?.captured_at || display.__capturedAt))}</time></div>
      </section>` : '';

    const relatedMarkup = related.length ? `
      <section class="mirsad-reader__section" aria-labelledby="mirsadRelatedTitle">
        <h3 id="mirsadRelatedTitle">أخبار مرتبطة بالحدث</h3>
        <div class="mirsad-reader__related">
          ${related.map((item) => `
            <button type="button" class="mirsad-related-item" data-related-id="${escapeHtml(item.id)}">
              ${escapeHtml(text(item.headline) || 'خبر مرتبط')}
              <small>${escapeHtml(text(item.source_name) || 'مصدر')} · ${escapeHtml(relative(item.published_at))}</small>
            </button>`).join('')}
        </div>
      </section>` : '';

    return `
      <div class="mirsad-reader__meta">
        <span class="mirsad-reader__dot" style="background:${escapeHtml(dot)}"></span>
        <span>${escapeHtml(category)}</span><span>·</span><span>${escapeHtml(source)}</span><span>·</span><span>${escapeHtml(relative(display.published_at))}</span>
      </div>
      <h2 id="mirsadReaderTitle" class="mirsad-reader__title">${escapeHtml(title)}</h2>
      <p class="mirsad-reader__summary">${escapeHtml(summary || 'لا يتوفر ملخص لهذا الخبر.')}</p>

      ${revisionMarkup}

      ${mirsadBlock()}

      ${relatedMarkup}`;
  }

  async function fetchJson(url) {
    const response = await fetch(url, { headers:{ apikey:SUPABASE_KEY, Authorization:`Bearer ${SUPABASE_KEY}` }, cache:'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function loadMirsadAnalysis(article) {
    if (!article?.id) return;
    state.mirsad = null;
    state.mirsadLoading = true;
    renderArticle();

    try {
      const response = await fetch(`${MIRSAD_API}?external_id=${encodeURIComponent(article.id)}`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));

      if (response.ok && data?.status === 'completed' && data?.analytical_reading) {
        state.mirsad = data;
        state.mirsadLoading = false;
        renderArticle();
        return;
      }

      const raw = article.raw_payload && typeof article.raw_payload === 'object' ? article.raw_payload : {};
      const longText = String(raw.content ?? raw.article_text ?? raw.text ?? raw.body ?? article.summary ?? '').trim();
      let submissionStatus = 'processing';

      if (longText) {
        const submit = await fetch(MIRSAD_API, {
          method: 'POST',
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type':'application/json' },
          body: JSON.stringify({
            article: {
              external_id: article.id,
              headline: article.headline,
              content: longText,
              summary: article.summary || longText,
              source_name: article.source_name,
              source_url: article.source_url,
              category: article.category,
              published_at: article.published_at
            }
          })
        });
        const queued = await submit.json().catch(() => ({}));
        if (!submit.ok) throw new Error(queued?.error || 'تعذر إرسال الخبر إلى مِرصاد');
        submissionStatus = queued?.status || submissionStatus;
      }

      state.mirsad = { status: submissionStatus, analytical_reading:null };
      state.mirsadLoading = false;
      renderArticle();

      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1800));
        const poll = await fetch(`${MIRSAD_API}?external_id=${encodeURIComponent(article.id)}`, {
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
          cache: 'no-store',
        });
        const result = await poll.json().catch(() => ({}));
        if (poll.ok && result?.status === 'completed' && result?.analytical_reading) {
          state.mirsad = result;
          renderArticle();
          return;
        }
      }
    } catch (error) {
      console.warn('[mirsad reader] analysis unavailable', error);
      state.mirsad = { status:'unavailable', analytical_reading:null };
      state.mirsadLoading = false;
      renderArticle();
    }
  }

  async function loadArticle(id) {
    const params = new URLSearchParams({
      select:'id,source_name,source_url,agency_urls,headline,summary,category,importance_score,sentiment,update_count,source_count,confidence_score,published_at,created_at,updated_at,cluster_id,is_pending_verification,claim_digest,raw_payload',
      id:`eq.${id}`,
      is_pending_verification:'eq.false',
      limit:'1',
    });
    const rows = await fetchJson(`${API}?${params.toString()}`);
    if (!rows.length) throw new Error('article_not_found');
    const article = rows[0];
    let related = [];
    let revisions = [];
    if (article.cluster_id) {
      const rel = new URLSearchParams({ select:'id,source_name,headline,published_at,updated_at', cluster_id:`eq.${article.cluster_id}`, is_pending_verification:'eq.false', id:`neq.${article.id}`, order:'published_at.desc.nullslast,updated_at.desc.nullslast', limit:'8' });
      related = await fetchJson(`${API}?${rel.toString()}`);
    }
    const revParams = new URLSearchParams({ select:'id,article_id,revision_number,revision_type,source_name,source_url,headline,summary,published_at,captured_at,created_at', article_id:`eq.${article.id}`, order:'revision_number.desc', limit:'20' });
    try { revisions = await fetchJson(`${REVISIONS_API}?${revParams.toString()}`); } catch { revisions = []; }
    return { article, related, revisions };
  }

  function renderArticle() {
    if (!state.article) return;
    content.innerHTML = articleMarkup(state.article, state.related, state.revisions);
    const display = activeDisplay(state.article, state.revisions);
    sourceBtn.hidden = !display.source_url;
    sourceBtn.href = safeUrl(display.source_url || (display.agency_urls || [])[0] || '');
    wireRelated();
    wireRevisions();
  }

  async function authorizeArticleOpen(id) {
    const client = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_KEY);
    if (!client) throw new Error('supabase_unavailable');
    const { data, error } = await client.rpc('open_article', { p_article_id:id });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.opened) {
      const remaining = Number(result?.remaining_unlocks ?? 0);
      throw new Error(remaining <= 0 ? 'لا تملك فتحات أخبار كافية لفتح هذا الخبر.' : 'تعذر فتح الخبر حاليًا.');
    }
    window.dispatchEvent(new CustomEvent('mirsad:unlock-balance', { detail:{ remaining:Number(result?.remaining_unlocks || 0), unlimited:Boolean(result?.unlimited) } }));
    if (result?.charged && typeof window.mirsadNotifyDeduction === 'function') window.mirsadNotifyDeduction('الخبر', Number(result?.charged_amount || 1));
    return result;
  }

  async function showArticle(id) {
    body.scrollTop = 0;
    renderLoading();
    try {
      await authorizeArticleOpen(id);
      const { article, related, revisions } = await loadArticle(id);
      state.article = article;
      state.related = related;
      state.revisions = revisions.sort((a,b) => Number(a.revision_number) - Number(b.revision_number));
      state.selectedRevision = state.revisions.length ? state.revisions.length - 1 : 0;
      state.mirsad = null;
      state.mirsadLoading = true;
      renderArticle();
      body.scrollTop = 0;
      void loadMirsadAnalysis(article);
    } catch (error) {
      console.error('[mirsad reader] load failed', error);
      content.innerHTML = `<div class="mirsad-reader__error">${escapeHtml(error?.message || 'تعذر تحميل تفاصيل الخبر. حاول مرة أخرى.')}</div>`;
      sourceBtn.hidden = true;
    }
  }

  function wireRevisions() {
    content.querySelectorAll('[data-revision-index]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.revisionIndex);
        if (!Number.isInteger(index) || index < 0 || index >= state.revisions.length) return;
        state.selectedRevision = index;
        renderArticle();
        body.scrollTop = 0;
      });
    });
  }

  function openReader(id, sourceElement) {
    if (localStorage.getItem('mirsad.guest.v1') === '1') return;
    if (!id || state.open) return;
    state.open = true;
    state.returnFocus = sourceElement || document.activeElement;
    backdrop.hidden = false;
    document.body.classList.add('mirsad-reader-open');
    body.scrollTop = 0;
    renderLoading();
    closeBtn.focus();
    void showArticle(id);
  }

  function closeReader() {
    if (!state.open) return;
    state.open = false;
    state.article = null;
    state.related = [];
    state.revisions = [];
    state.selectedRevision = 0;
    state.mirsad = null;
    state.mirsadLoading = false;
    backdrop.hidden = true;
    document.body.classList.remove('mirsad-reader-open');
    if (state.returnFocus && typeof state.returnFocus.focus === 'function') state.returnFocus.focus();
  }

  function wireRelated() {
    content.querySelectorAll('.mirsad-related-item').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.relatedId;
        if (id) void showArticle(id);
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
