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
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
  const changeText = (revision, previous) => {
    const currentSummary = stripHtml(revision.summary);
    if (!previous) return currentSummary || stripHtml(revision.headline);
    const previousText = stripHtml(`${previous.headline} ${previous.summary}`);
    const additions = currentSummary.split(/[.!؟]+\s*/).map((part) => part.trim()).filter((part) => part.length >= 18 && !previousText.includes(part));
    if (additions.length) return additions.slice(0, 2).join('، ');
    if (stripHtml(revision.headline) !== stripHtml(previous.headline)) return 'تغيّر عنوان الخبر في هذه النسخة.';
    return '';
  };

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
      order: 'captured_at.asc,revision_number.asc',
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
    const revisions = snapshot.revisions;
    const section = document.createElement('section');
    section.className = 'mirsad-reader__section mirsad-revisions mirsad-revisions--compat';
    section.setAttribute('aria-labelledby', 'mirsadCompatRevisionsTitle');

    const hasOriginal = revisions.some((revision) => revision.revision_type === 'original');
    const savedTimeline = revisions.map((revision, index) => ({
      revision,
      label: revision.revision_type === 'original' ? 'الأصل' : 'تحديث',
      detail: changeText(revision, revisions[index - 1]),
      hiddenBaseline: !hasOriginal && index === 0 && revision.revision_type !== 'original',
    })).filter((item) => item.detail && !item.hiddenBaseline);

    section.innerHTML = `
      <div class="mirsad-revisions__header">
        <div>
          <span class="mirsad-analysis__eyebrow">سجل الخبر</span>
          <h3 id="mirsadCompatRevisionsTitle">الأصل والتحديثات</h3>
        </div>
        <span class="mirsad-revisions__count">سجل محفوظ</span>
      </div>
      <div class="mirsad-revisions__timeline" aria-label="التسلسل الزمني للخبر">
        ${savedTimeline.map((item, index) => `
          <div class="mirsad-revision-event${item.label === 'الأصل' ? ' is-original' : ''}">
            <span class="mirsad-revision-event__marker" aria-hidden="true"></span>
            <span class="mirsad-revision-event__body"><strong>${escapeHtml(item.label)}</strong><time datetime="${escapeHtml(item.revision.captured_at || '')}">${escapeHtml(relative(item.revision.captured_at))}</time><span>${escapeHtml(item.detail)}</span></span>
          </div>${index < savedTimeline.length - 1 ? '<span class="mirsad-revision-event__line" aria-hidden="true"></span>' : ''}`).join('')}
      </div>
      <p class="mirsad-revisions__note">نعرض النصوص المحفوظة فقط؛ لا تتوفر تفاصيل نصية موثوقة لبعض التحديثات السابقة.</p>`;

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
