(() => {
  'use strict';

  const SUPABASE_URL = 'https://dndlkenyfymlrjnslyzb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx';
  const API = `${SUPABASE_URL}/rest/v1/news_articles`;
  const REVISIONS_API = `${SUPABASE_URL}/rest/v1/news_article_revisions`;
  const MIRSAD_API = `${SUPABASE_URL}/functions/v1/mirsad-analysis-api`;
  const CATEGORY_LABELS = { Politics:'سياسة', Economy:'اقتصاد', Tech:'تقنية', Society:'مجتمع', Sports:'رياضة' };
  const CATEGORY_COLORS = { Politics:'#8b7bc7', Economy:'#c9a227', Tech:'#4f9dde', Society:'#b8794a', Sports:'#4fa8a0' };
  const state = { open:false, article:null, related:[], revisions:[], selectedRevision:-1, returnFocus:null, mirsad:null, mirsadLoading:false, mirsadRequest:0 };

  const text = (value) => MirsadText.normalize(value);
  const stripHtml = (value) => MirsadText.normalize(value);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
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
    if (state.selectedRevision < 0) return { ...article, __isRevision:false, __revisionNumber:0, __capturedAt:article.updated_at || article.created_at };
    const revision = revisions[Math.min(state.selectedRevision, revisions.length - 1)];
    return { ...article, headline:revision.headline, summary:revision.summary, source_name:revision.source_name || article.source_name, source_url:revision.source_url || article.source_url, published_at:revision.published_at || article.published_at, __isRevision:true, __revisionId:revision.id, __revisionNumber:revision.revision_number, __revisionType:revision.revision_type, __capturedAt:revision.captured_at };
  }

  const contentHash = (display) => {
    const value = MirsadText.normalize(`${display?.headline || ''}\u0001${display?.summary || ''}`);
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  };
  const analysisKey = (display) => display?.__revisionId
    ? `${display.id}:revision:${display.__revisionId}`
    : `${display?.id}:current:${contentHash(display)}`;
  const revisionFingerprint = (revision) => [revision.revision_type, revision.source_url, MirsadText.normalize(revision.headline), MirsadText.normalize(revision.summary)].join('\u0001');

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
          <p class="mirsad-analysis__claim">${escapeHtml(MirsadText.normalize(state.mirsad.analytical_reading))}</p>
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
    return revision.revision_type === 'original' && Number(revision.revision_number) === 1 ? 'الأصل' : 'تحديث';
  }

  function revisionSentences(value) {
    return MirsadText.normalize(value).split(/[.!؟。]+\s*/).map((part) => part.trim()).filter((part) => part.length >= 18);
  }

  function revisionChange(current, previous) {
    if (!previous) return MirsadText.normalize(current.summary) || MirsadText.normalize(current.headline) || '';
    const previousText = MirsadText.normalize(`${previous.headline} ${previous.summary}`);
    const additions = revisionSentences(current.summary).filter((sentence) => !previousText.includes(sentence));
    if (additions.length) return additions.slice(0, 2).join('، ');
    if (MirsadText.normalize(current.headline) !== MirsadText.normalize(previous.headline)) return 'تغيّر عنوان الخبر في هذه النسخة.';
    return '';
  }

  function revisionTimeline(revisions, article) {
    const items = [];
    const hasOriginal = revisions.some((revision) => revision.revision_type === 'original');
    revisions.forEach((revision, index) => {
      if (!hasOriginal && revision.revision_type !== 'original' && index === 0) return;
      const previous = revisions[index - 1];
      const detail = revisionChange(revision, previous);
      if (!detail) return;
      items.push({ revision, label: revision.revision_type === 'original' ? 'الأصل' : 'تحديث', detail, current: false });
    });
    const latest = revisions[revisions.length - 1];
    const currentDetail = latest ? revisionChange(article, latest) : '';
    if (currentDetail) items.push({ revision: article, label: 'الأحدث', detail: currentDetail, current: true });
    return items;
  }

  function articleMarkup(article, related, revisions) {
    const display = activeDisplay(article, revisions);
    const category = CATEGORY_LABELS[display.category] || display.category || 'عام';
    const dot = CATEGORY_COLORS[display.category] || 'var(--gold)';
    const title = text(display.headline || display.title) || 'خبر دون عنوان';
    const summary = stripHtml(display.summary);
    const source = text(display.source_name) || 'مصدر';

    const timeline = revisionTimeline(revisions, article);
    const revisionMarkup = timeline.length ? `
      <section class="mirsad-reader__section mirsad-revisions" aria-labelledby="mirsadRevisionsTitle">
        <div class="mirsad-revisions__header">
          <div><span class="mirsad-analysis__eyebrow">سجل الخبر</span><h3 id="mirsadRevisionsTitle">الأصل والتحديثات</h3></div>
          <span class="mirsad-revisions__count">تطور الخبر</span>
        </div>
        <div class="mirsad-revisions__timeline" aria-label="التسلسل الزمني للخبر">
          ${timeline.map((item, index) => `
            <button type="button" class="mirsad-revision-event${item.label === 'الأصل' ? ' is-original' : ''}${item.label === 'الأحدث' ? ' is-latest' : ''}" data-revision-index="${revisions.indexOf(item.revision)}" aria-label="${escapeHtml(item.label)}">
              <span class="mirsad-revision-event__marker" aria-hidden="true"></span>
              <span class="mirsad-revision-event__body"><strong>${escapeHtml(item.label)}</strong><time datetime="${escapeHtml(item.revision.captured_at || item.revision.updated_at || '')}">${escapeHtml(relative(item.revision.captured_at || item.revision.updated_at))}</time><span>${escapeHtml(item.detail)}</span></span>
            </button>${index < timeline.length - 1 ? '<span class="mirsad-revision-event__line" aria-hidden="true"></span>' : ''}`).join('')}
        </div>
      </section>` : '';

    const relatedMarkup = related.length ? `
      <section class="mirsad-reader__section" aria-labelledby="mirsadRelatedTitle">
        <h3 id="mirsadRelatedTitle">أخبار مرتبطة بالحدث</h3>
        <div class="mirsad-reader__related">
          ${related.map((item) => `
            <button type="button" class="mirsad-related-item" data-related-id="${escapeHtml(item.id)}">
              ${escapeHtml(MirsadText.normalize(item.headline) || 'خبر مرتبط')}
              <small>${escapeHtml(MirsadText.normalize(item.source_name) || 'مصدر')} · ${escapeHtml(relative(item.published_at))}</small>
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

  async function loadMirsadAnalysis(article, display = article) {
    if (!article?.id) return;
    const requestId = ++state.mirsadRequest;
    const externalId = analysisKey(display) || article.id;
    state.mirsad = null;
    state.mirsadLoading = true;
    renderArticle();

    try {
      const response = await fetch(`${MIRSAD_API}?external_id=${encodeURIComponent(externalId)}`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));

      if (response.ok && data?.status === 'completed' && data?.analytical_reading) {
        if (requestId !== state.mirsadRequest) return;
        state.mirsad = data;
        state.mirsadLoading = false;
        renderArticle();
        return;
      }
      if (requestId !== state.mirsadRequest) return;

      const raw = article.raw_payload && typeof article.raw_payload === 'object' ? article.raw_payload : {};
      const longText = display.__isRevision
        ? MirsadText.normalize(display.summary || display.headline || '')
        : String(raw.content ?? raw.article_text ?? raw.text ?? raw.body ?? article.summary ?? '').trim();
      let submissionStatus = 'processing';

      if (longText) {
        if (requestId !== state.mirsadRequest) return;
        const submit = await fetch(MIRSAD_API, {
          method: 'POST',
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type':'application/json' },
          body: JSON.stringify({
            article: {
              external_id: externalId,
              headline: display.headline,
              content: longText,
              summary: display.summary || longText,
              source_name: display.source_name,
              source_url: display.source_url,
              category: article.category,
              published_at: display.published_at
            }
          })
        });
        const queued = await submit.json().catch(() => ({}));
        if (!submit.ok) throw new Error(queued?.error || 'تعذر إرسال الخبر إلى مِرصاد');
        submissionStatus = queued?.status || submissionStatus;
      }

      if (requestId !== state.mirsadRequest) return;
      state.mirsad = { status: submissionStatus, analytical_reading:null };
      state.mirsadLoading = false;
      renderArticle();

      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1800));
        if (requestId !== state.mirsadRequest) return;
        const poll = await fetch(`${MIRSAD_API}?external_id=${encodeURIComponent(externalId)}`, {
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
          cache: 'no-store',
        });
        const result = await poll.json().catch(() => ({}));
        if (poll.ok && result?.status === 'completed' && result?.analytical_reading) {
          if (requestId !== state.mirsadRequest) return;
          state.mirsad = result;
          renderArticle();
          return;
        }
      }
    } catch (error) {
      console.warn('[mirsad reader] analysis unavailable', error);
      if (requestId !== state.mirsadRequest) return;
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
    const revParams = new URLSearchParams({ select:'id,article_id,revision_number,revision_type,source_name,source_url,headline,summary,published_at,captured_at,created_at', article_id:`eq.${article.id}`, order:'captured_at.asc,revision_number.asc', limit:'20' });
    try {
      const rawRevisions = await fetchJson(`${REVISIONS_API}?${revParams.toString()}`);
      const seen = new Set();
      revisions = rawRevisions.filter((revision) => {
        const key = revisionFingerprint(revision);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } catch { revisions = []; }
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
      state.revisions = revisions.sort((a,b) => new Date(a.captured_at || 0) - new Date(b.captured_at || 0) || Number(a.revision_number) - Number(b.revision_number));
      state.selectedRevision = -1;
      state.mirsad = null;
      state.mirsadLoading = true;
      renderArticle();
      body.scrollTop = 0;
      void loadMirsadAnalysis(article, activeDisplay(article, state.revisions));
    } catch (error) {
      console.error('[mirsad reader] load failed', error);
      content.innerHTML = `<div class="mirsad-reader__error">${escapeHtml(error?.message || 'تعذر تحميل تفاصيل الخبر. حاول مرة أخرى.')}</div>`;
      sourceBtn.hidden = true;
    }
  }

  function wireRevisions() {
    content.querySelectorAll('[data-revision-index]').forEach((button) => {
      button.addEventListener('click', () => {
        const rawIndex = button.dataset.revisionIndex;
        const index = rawIndex === 'current' ? -1 : Number(rawIndex);
        if (!Number.isInteger(index) || index < -1 || index >= state.revisions.length) return;
        state.selectedRevision = index;
        state.mirsad = null;
        state.mirsadLoading = true;
        renderArticle();
        body.scrollTop = 0;
        void loadMirsadAnalysis(state.article, activeDisplay(state.article, state.revisions));
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
    state.selectedRevision = -1;
    state.mirsadRequest += 1;
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
