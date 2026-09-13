(() => {
  'use strict';

  const SUPABASE_URL = 'https://dndlkenyfymlrjnslyzb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx';
  const API = `${SUPABASE_URL}/rest/v1/news_articles`;
  const formatTime = (value) => {
    const t = new Date(value || 0).getTime();
    if (!Number.isFinite(t) || t <= 0) return 'وقت غير محدد';
    return new Intl.DateTimeFormat('ar', { dateStyle:'medium', timeStyle:'short' }).format(new Date(t));
  };
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
        select: 'importance_score,confidence_score,source_count,update_count,published_at,updated_at,created_at,claim_digest',
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

    const importance = Math.round(Number(article?.importance_score) || 0);
    const confidence = Math.round(Number(article?.confidence_score) || 0);
    const sources = Math.max(1, Number(article?.source_count) || 1);
    const updates = Math.max(0, Number(article?.update_count) || 0);

    let significance = 'خبر للمتابعة ضمن المستجدات الجارية.';
    if (importance >= 80) significance = 'تطور مرتفع الأهمية ويستحق المتابعة المباشرة.';
    else if (importance >= 60) significance = 'تطور مهم وقد يستدعي متابعة تحديثاته.';
    else if (importance >= 40) significance = 'تطور متوسط الأهمية ضمن سياق الأخبار الجارية.';

    const evidence = sources > 1
      ? `يدعمه أكثر من مصدر (${sources})، ما يرفع قابلية المقارنة بين الروايات.`
      : 'يستند حاليًا إلى مصدر واحد، لذلك يُنصح بالرجوع إلى المصدر الأصلي لأي تفاصيل إضافية.';

    const freshness = updates > 0
      ? `شهد ${updates} ${updates === 1 ? 'تحديثًا' : 'تحديثات'} منذ نشره.`
      : 'لم يُسجَّل تحديث إضافي حتى آخر مزامنة.';

    card.innerHTML = `
      <div class="mirsad-analysis__header">
        <div>
          <span class="mirsad-analysis__eyebrow">إضافة مِرصاد</span>
          <h3 id="mirsadAnalysisTitle">القراءة التحليلية</h3>
        </div>
        <span class="mirsad-analysis__confidence">ثقة ${confidence}%</span>
      </div>
      <p class="mirsad-analysis__claim">${escapeHtml(claim)}</p>
      <div class="mirsad-analysis__points">
        <div class="mirsad-analysis__point"><strong>الأهمية</strong><span>${escapeHtml(significance)}</span></div>
        <div class="mirsad-analysis__point"><strong>المصادر</strong><span>${escapeHtml(evidence)}</span></div>
        <div class="mirsad-analysis__point"><strong>التحديث</strong><span>${escapeHtml(freshness)}</span></div>
      </div>`;

    const existingStats = card.parentElement?.querySelector('.mirsad-reader__stats--compact');
    if (!existingStats) {
      card.insertAdjacentHTML('afterend', `
        <div class="mirsad-reader__stats mirsad-reader__stats--compact">
          <div class="mirsad-reader__stat"><span>الأهمية</span><strong>${importance}</strong></div>
          <div class="mirsad-reader__stat"><span>الثقة</span><strong>${confidence}%</strong></div>
          <div class="mirsad-reader__stat"><span>المصادر</span><strong>${sources}</strong></div>
          <div class="mirsad-reader__stat"><span>التحديثات</span><strong>${updates}</strong></div>
          <div class="mirsad-reader__stat"><span>النشر</span><strong>${escapeHtml(formatTime(article?.published_at))}</strong></div>
          <div class="mirsad-reader__stat"><span>آخر مزامنة</span><strong>${escapeHtml(formatTime(article?.updated_at || article?.created_at))}</strong></div>
        </div>`);
    }
    pending = false;
  }

  const observer = new MutationObserver(() => {
    const card = document.querySelector('.mirsad-analysis');
    if (card && card !== lastCard) restoreCard(card);
  });
  observer.observe(document.body, { childList:true, subtree:true });
})();
