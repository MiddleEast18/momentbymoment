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

    const sources = Math.max(1, Number(article?.source_count) || 1);
    const updates = Math.max(0, Number(article?.update_count) || 0);

    card.innerHTML = `
      <div class="mirsad-analysis__header">
        <div>
          <span class="mirsad-analysis__eyebrow">إضافة مِرصاد</span>
          <h3 id="mirsadAnalysisTitle">القراءة التحليلية</h3>
        </div>
      </div>
      <p class="mirsad-analysis__claim">${escapeHtml(claim)}</p>
      <div class="mirsad-analysis__points">
        <div class="mirsad-analysis__point"><strong>عدد المصادر</strong><span>${sources}</span></div>
        <div class="mirsad-analysis__point"><strong>التحديثات</strong><span>${updates}</span></div>
      </div>`;
    pending = false;
  }

  const observer = new MutationObserver(() => {
    const card = document.querySelector('.mirsad-analysis');
    if (card && card !== lastCard) restoreCard(card);
  });
  observer.observe(document.body, { childList:true, subtree:true });
})();
