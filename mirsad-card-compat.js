(() => {
  'use strict';

  const SUPABASE_URL = 'https://dndlkenyfymlrjnslyzb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx';
  const API = `${SUPABASE_URL}/rest/v1/news_articles`;
  const escapeHtml = (value) => {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
  };

  let lastCard = null;
  let pending = false;

  async function restoreCard(card) {
    if (!card || card === lastCard || pending) return;
    lastCard = card;
    pending = true;

    const claim = card.querySelector('.mirsad-analysis__claim')?.textContent?.trim() || 'لا تتوفر قراءة تحليلية لهذا الخبر حاليًا.';
    const title = document.querySelector('.mirsad-reader__title')?.textContent?.trim();
    if (!title) {
      pending = false;
      return;
    }

    let article = null;
    try {
      const params = new URLSearchParams({
        select: 'source_count,update_count',
        headline: `eq.${title}`,
        is_pending_verification: 'eq.false',
        limit: '1'
      });
      const response = await fetch(`${API}?${params.toString()}`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        cache: 'no-store'
      });
      if (response.ok) {
        const rows = await response.json();
        article = rows[0] || null;
      }
    } catch (error) {
      console.warn('[mirsad card compat] metadata unavailable', error);
    }

    card.innerHTML = `
      <div class="mirsad-analysis__header">
        <div>
          <span class="mirsad-analysis__eyebrow">إضافة مِرصاد</span>
          <h3 id="mirsadAnalysisTitle">القراءة التحليلية</h3>
        </div>
      </div>
      <p class="mirsad-analysis__claim">${escapeHtml(claim)}</p>
      <div class="mirsad-analysis__notice" role="note">
        <span class="mirsad-analysis__ai-icon" aria-hidden="true">
          <svg viewBox="0 0 32 32" focusable="false"><path d="M16 3.5l2.25 7.1a4.5 4.5 0 0 0 3.15 3.15L28.5 16l-7.1 2.25a4.5 4.5 0 0 0-3.15 3.15L16 28.5l-2.25-7.1a4.5 4.5 0 0 0-3.15-3.15L3.5 16l7.1-2.25a4.5 4.5 0 0 0 3.15-3.15L16 3.5Z"/><path d="M25.5 4.5v5M23 7h5M7 23v4M5 25h4"/></svg>
        </span>
        <span>هذا الملخص أُعدّ بواسطة الذكاء الاصطناعي. لتفاصيل أدق، يُرجى الانتقال إلى المصدر الأصلي.</span>
      </div>`;
    pending = false;
  }

  const observer = new MutationObserver(() => {
    const card = document.querySelector('.mirsad-analysis');
    if (card && card !== lastCard) restoreCard(card);
  });
  observer.observe(document.body, { childList:true, subtree:true });
})();
