(() => {
  'use strict';
  const SUPABASE_URL = 'https://dndlkenyfymlrjnslyzb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx';
  const client = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_KEY);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const flag = {
    dz: '<svg viewBox="0 0 72 48" role="img" aria-label="علم الجزائر"><rect width="36" height="48" fill="#006233"/><rect x="36" width="36" height="48" fill="#fff"/><path d="M36 14.5c-5.5 0-10 4-10 9.5s4.5 9.5 10 9.5c-4.1 0-7.5-3.4-7.5-9.5S31.9 14.5 36 14.5Z" fill="#d21034"/><path d="m42 17 1.8 5.6h5.9L45 26l1.8 5.6-4.8-3.5-4.8 3.5L39 26l-4.8-3.4H40Z" fill="#d21034"/></svg>',
    eg: '<svg viewBox="0 0 72 48" role="img" aria-label="علم مصر"><rect width="72" height="16" fill="#ce1126"/><rect y="16" width="72" height="16" fill="#fff"/><rect y="32" width="72" height="16" fill="#000"/><path d="M36 19c-3.8 0-5.5 2.2-5.5 5s1.7 5 5.5 5 5.5-2.2 5.5-5-1.7-5-5.5-5Z" fill="#c09300"/><path d="M33 20h6v8h-6z" fill="#c09300"/></svg>',
    ye: '<svg viewBox="0 0 72 48" role="img" aria-label="علم اليمن"><rect width="72" height="16" fill="#ce1126"/><rect y="16" width="72" height="16" fill="#fff"/><rect y="32" width="72" height="16" fill="#000"/></svg>'
  };
  const formatTime = (value) => { if (!value) return 'وقت النشر غير متاح'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'وقت النشر غير متاح' : new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(date); };
  const setStatus = (text) => { const el = document.getElementById('countryStatus'); if (el) el.textContent = text; };
  const countryUrl = (slug) => `country-news.html?slug=${encodeURIComponent(slug)}`;

  async function renderCountries() {
    const grid = document.getElementById('countryGrid');
    if (!grid || !client) { setStatus('تعذر تحميل خدمة الأخبار.'); return; }
    const { data: countries, error } = await client.from('arab_countries').select('id,name_ar,name_en,slug,flag_code,display_order').eq('is_active', true).order('display_order').limit(3);
    if (error) { console.error('[mirsad countries]', error); setStatus('تعذر تحميل الدول حاليًا.'); return; }
    if (!countries?.length) { setStatus('لا توجد دول مفعلة حاليًا.'); return; }
    const cards = await Promise.all(countries.map(async (country) => {
      const { count } = await client.from('country_news_articles').select('id', { count: 'exact', head: true }).eq('country_id', country.id).eq('is_published', true);
      const articleCount = Number(count || 0);
      return `<a class="country-card" href="${countryUrl(country.slug)}"><span class="country-card__topline"><span class="country-card__eyebrow">تغطية محلية</span><span class="country-card__source-count">3 مصادر</span></span><span class="country-card__flag">${flag[country.flag_code] || '<svg viewBox="0 0 72 48" role="img" aria-label="علم الدولة"><circle cx="36" cy="24" r="18" fill="none" stroke="currentColor" stroke-width="3"/></svg>'}</span><span class="country-card__name"><h2>${esc(country.name_ar)}</h2><span class="country-card__code">${esc(country.name_en)}</span></span><p>أخبار محلية منتقاة من مصادر موثوقة</p><span class="country-card__footer"><span><strong>${articleCount}</strong> خبر منشور</span><span class="country-card__arrow" aria-hidden="true">↗</span></span></a>`;
    }));
    grid.innerHTML = cards.join('');
    setStatus(`${countries.length} دول متاحة في المرحلة التجريبية`);
  }

  if (document.getElementById('countryGrid')) renderCountries();
})();
