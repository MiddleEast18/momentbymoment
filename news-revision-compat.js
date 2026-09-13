(() => {
  'use strict';

  const SUPABASE_URL = 'https://dndlkenyfymlrjnslyzb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx';
  const API = `${SUPABASE_URL}/rest/v1/news_articles`;
  const REVISIONS_API = `${SUPABASE_URL}/rest/v1/news_article_revisions`;

  let activeArticleId = null;
  let snapshot = null;
  let applying = false;

  const stripHtml = (value) => MirsadText.normalize(value).replace(/\s*\n\s*/g, ' ').trim();

  const relative = (value) => {
    const time = new Date(value || 0).getTime();
    if (!Number.isFinite(time) || time <= 0) return 'وقت غير محدد';
    const minutes = Math.round((time - Date.now()) / 60000);
    const rtf = new Intl.RelativeTimeFormat('ar', { numeric: 'auto' });
    if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
    return rtf.format(Math.round(hours / 24), 'day');
  };

  const formatTime = (value) => {
    const t = new Date(value || 0).getTime();
    if (!Number.isFinite(t) || t <= 0) return 'وقت غير محدد';
    return new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(t));
  };

  async function fetchJson(url) {
    const response = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function captureTarget(event) {
    const card = event.target.closest?.('.card[data-id]');
    if (card) {
      activeArticleId = card.dataset.id || null;
      snapshot = null;
      return;
    }
    const related = event.target.closest?.('.mirsad-related-item[data-related-id]');
    if (related) {
      activeArticleId = related.dataset.relatedId || null;
      snapshot = null;
    }
  }

  async function loadSnapshot(id) {
    if (!id) return null;
    const articleParams = new URLSearchParams({
      select: 'id,source_name,source_url,headline,summary,published_at,updated_at,update_count',
      id: `eq.${id}`,
      limit: '1',
    });
    const revisionParams = new URLSearchParams({
      select: 'id,revision_number,revision_type,source_name,source_url,headline,summary,published_at,captured_at',
      article_id: `eq.${id}`,
      order: 'revision_number.asc',
      limit: '20',
    });
    const [articles, revisions] = await Promise.all([
      fetchJson(`${API}?${articleParams.toString()}`),
      fetchJson(`${REVISIONS_API}?${revisionParams.toString()}`),
    ]);
    if (!articles.length) return null;
    return { article: articles[0], revisions };
  }

  function savedUpdates(data) {
    return data.revisions.filter((row) => row.revision_type === 'update');
  }

  function needsCompat(data) {
    return (Number(data.article.update_count) || 0) > savedUpdates(data).length;
  }

  function displayData(revision) {
    if (!revision) return snapshot.article;
    return {
      ...snapshot.article,
      source_name: revision.source_name || snapshot.article.source_name,
      source_url: revision.source_url || snapshot.article.source_url,
      headline: revision.headline || snapshot.article.headline,
      summary: revision.summary || snapshot.article.summary,
      published_at: revision.published_at || snapshot.article.published_at,
    };
  }

  function setReaderText(data) {
    const content = document.querySelector('.mirsad-reader__content');
    if (!content) return;
    const title = content.querySelector('.mirsad-reader__title');
    const summary = content.querySelector('.mirsad-reader__summary');
    const meta = content.querySelector('.mirsad-reader__meta');
    if (title) title.textContent = MirsadText.normalize(data.headline) || 'خبر دون عنوان';
    if (summary) summary.textContent = stripHtml(data.summary) || 'لا يتوفر ملخص لهذا الخبر.';
    if (meta) {
      const parts = [...meta.children];
      if (parts[3]) parts[3].textContent = MirsadText.normalize(data.source_name) || 'مصدر';
      if (parts[5]) parts[5].textContent = relative(data.published_at);
    }
    const sourceBtn = document.querySelector('.mirsad-reader__source');
    if (sourceBtn) {
      sourceBtn.hidden = !data.source_url;
      sourceBtn.href = data.source_url || '#';
    }
  }

  function buildCompatSection() {
    const article = snapshot.article;
    const revisions = snapshot.revisions;
    const updates = savedUpdates(snapshot);
    const declared = Math.max(0, Number(article.update_count) || 0);
    const missing = Math.max(0, declared - updates.length);
    const section = document.createElement('section');
    section.className = 'mirsad-reader__section mirsad-revisions mirsad-revisions--compat';
    section.setAttribute('aria-labelledby', 'mirsadCompatRevisionsTitle');

    const savedTabs = revisions.map((revision) => ({
      kind: 'saved',
      label: revision.revision_type === 'original' && Number(revision.revision_number) === 1
        ? 'الأصل'
        : `تحديث ${Math.max(1, Number(revision.revision_number || 1) - 1)}`,
      time: revision.captured_at,
    }));
    const missingTabs = Array.from({ length: missing }, (_, index) => ({
      kind: 'missing',
      label: `تحديث ${updates.length + index + 1}`,
      time: null,
    }));
    const currentTab = { kind: 'current', label: 'الحالي', time: article.updated_at };
    const tabs = [...savedTabs, ...missingTabs, currentTab];

    section.innerHTML = `
      <div class="mirsad-revisions__header">
        <div>
          <span class="mirsad-analysis__eyebrow">سجل الخبر</span>
          <h3 id="mirsadCompatRevisionsTitle">الأصل والتحديثات</h3>
        </div>
        <span class="mirsad-revisions__count">${declared} تحديث</span>
      </div>
      <div class="mirsad-revisions__notice">
        <strong>${missing ? `${missing} تحديثات سابقة غير محفوظة` : 'سجل الخبر مكتمل'}</strong>
        ${missing ? '<span>نعرض النسخ المحفوظة فقط، والنسخة الحالية دون اختلاق محتوى تاريخي غير متاح.</span>' : ''}
      </div>
      <div class="mirsad-revisions__tabs" role="tablist" aria-label="نسخ الخبر">
        ${tabs.map((tab, index) => `
          <button type="button"
            class="mirsad-revision-tab${tab.kind === 'current' ? ' is-active' : ''}${tab.kind === 'missing' ? ' is-unavailable' : ''}"
            data-compat-revision-index="${index}"
            role="tab"
            aria-selected="${tab.kind === 'current'}"
            ${tab.kind === 'missing' ? 'disabled aria-disabled="true"' : ''}>
            <span>${tab.label}</span>
            <small>${tab.time ? relative(tab.time) : 'غير محفوظ'}</small>
          </button>`).join('')}
      </div>
      <div class="mirsad-revisions__active">
        <span>الحالي</span>
        <time datetime="${article.updated_at || ''}">${formatTime(article.updated_at)}</time>
      </div>`;

    return section;
  }

  function wireCompat(section) {
    const content = document.querySelector('.mirsad-reader__content');
    if (!content) return;
    const tabs = [...section.querySelectorAll('[data-compat-revision-index]')];
    const currentIndex = snapshot.revisions.length + Math.max(0, (Number(snapshot.article.update_count) || 0) - savedUpdates(snapshot).length);

    tabs.forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.compatRevisionIndex);
        if (!Number.isInteger(index) || button.disabled) return;
        tabs.forEach((tab) => {
          tab.classList.toggle('is-active', tab === button);
          tab.setAttribute('aria-selected', String(tab === button));
        });
        const active = content.querySelector('.mirsad-revisions__active');
        if (index === currentIndex) {
          setReaderText(snapshot.article);
          if (active) {
            active.querySelector('span').textContent = 'الحالي';
            active.querySelector('time').textContent = formatTime(snapshot.article.updated_at);
          }
          return;
        }
        const item = snapshot.revisions[index];
        if (!item) return;
        setReaderText(displayData(item));
        if (active) {
          active.querySelector('span').textContent = button.firstElementChild?.textContent || 'نسخة محفوظة';
          active.querySelector('time').textContent = formatTime(item.captured_at);
        }
      });
    });
  }

  function applyCompatPatch() {
    if (applying || !snapshot || !needsCompat(snapshot)) return;
    const content = document.querySelector('.mirsad-reader__content');
    if (!content || content.querySelector('.mirsad-revisions--compat')) return;
    const anchor = content.querySelector('.mirsad-reader__summary');
    if (!anchor) return;

    applying = true;
    try {
      content.querySelector('.mirsad-revisions')?.remove();
      const section = buildCompatSection();
      anchor.insertAdjacentElement('afterend', section);
      setReaderText(snapshot.article);
      wireCompat(section);
    } finally {
      applying = false;
    }
  }

  async function reconcile() {
    if (!document.querySelector('.mirsad-reader__content') || !activeArticleId) return;
    try {
      const loaded = await loadSnapshot(activeArticleId);
      if (!loaded) return;
      snapshot = loaded;
      applyCompatPatch();
    } catch (error) {
      console.warn('[mirsad revision compat] unavailable', error);
    }
  }

  document.addEventListener('click', captureTarget, true);

  const observer = new MutationObserver(() => {
    const content = document.querySelector('.mirsad-reader__content');
    if (content && !content.querySelector('.mirsad-revisions--compat')) window.requestAnimationFrame(reconcile);
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
