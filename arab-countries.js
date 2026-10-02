(() => {
  'use strict';
  const SUPABASE_URL = 'https://dndlkenyfymlrjnslyzb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx';
  const client = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_KEY);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const flag = {
    dz: '<svg viewBox="0 0 72 48" role="img" aria-label="علم الجزائر"><rect width="36" height="48" fill="#006233"/><rect x="36" width="36" height="48" fill="#fff"/><path d="M36 14.5c-5.5 0-10 4-10 9.5s4.5 9.5 10 9.5c-4.1 0-7.5-3.4-7.5-9.5S31.9 14.5 36 14.5Z" fill="#d21034"/><path d="m42 17 1.8 5.6h5.9L45 26l1.8 5.6-4.8-3.5-4.8 3.5L39 26l-4.8-3.4H40Z" fill="#d21034"/></svg>',
    eg: '<svg viewBox="0 0 72 48" role="img" aria-label="علم مصر"><rect width="72" height="16" fill="#ce1126"/><rect y="16" width="72" height="16" fill="#fff"/><rect y="32" width="72" height="16" fill="#000"/><path d="M36 19c-3.8 0-5.5 2.2-5.5 5s1.7 5 5.5 5 5.5-2.2 5.5-5-1.7-5-5.5-5Z" fill="#c09300"/></svg>',
    ye: '<svg viewBox="0 0 72 48" role="img" aria-label="علم اليمن"><rect width="72" height="16" fill="#ce1126"/><rect y="16" width="72" height="16" fill="#fff"/><rect y="32" width="72" height="16" fill="#000"/></svg>',
    ma: '<svg viewBox="0 0 72 48" role="img" aria-label="علم المغرب"><rect width="72" height="48" fill="#c1272d"/><path d="m36 12 3.2 9.8h10.3l-8.3 6 3.2 9.8L36 31.6 27.6 37.6l3.2-9.8-8.3-6h10.3Z" fill="none" stroke="#006233" stroke-width="1.7"/></svg>',
    tn: '<svg viewBox="0 0 72 48" role="img" aria-label="علم تونس"><rect width="72" height="48" fill="#e70013"/><circle cx="36" cy="24" r="10" fill="#fff"/><circle cx="38" cy="24" r="7" fill="#e70013"/><circle cx="40" cy="24" r="5.5" fill="#fff"/><path d="m42 18 1.2 3.4h3.6l-2.9 2.1 1.1 3.4-3-2.2-3 2.2 1.1-3.4-2.9-2.1h3.6Z" fill="#e70013"/></svg>',
    ly: '<svg viewBox="0 0 72 48" role="img" aria-label="علم ليبيا"><rect width="72" height="12" fill="#e70013"/><rect y="12" width="72" height="24" fill="#000"/><rect y="36" width="72" height="12" fill="#239e46"/><circle cx="34" cy="24" r="6" fill="none" stroke="#fff" stroke-width="1.4"/><path d="m38 19.5 1 2.8h3l-2.4 1.8.9 2.8-2.5-1.8-2.5 1.8.9-2.8-2.4-1.8h3Z" fill="#fff"/></svg>',
    sd: '<svg viewBox="0 0 72 48" role="img" aria-label="علم السودان"><rect width="72" height="16" fill="#d21034"/><rect y="16" width="72" height="16" fill="#fff"/><rect y="32" width="72" height="16" fill="#000"/><path d="M0 0 28 24 0 48Z" fill="#007229"/></svg>',
    mr: '<svg viewBox="0 0 72 48" role="img" aria-label="علم موريتانيا"><rect width="72" height="48" fill="#d01c1f"/><rect y="8" width="72" height="32" fill="#00a95c"/><path d="M36 14c-6.2 0-10 4.2-10 9.2 3.4-2.4 6.6-3.2 10-3.2s6.6.8 10 3.2c0-5-3.8-9.2-10-9.2Z" fill="#ffd700"/><path d="m36 18 1.3 3.8h4l-3.2 2.3 1.2 3.8L36 25.6 32.7 28l1.2-3.8-3.2-2.3h4Z" fill="#ffd700"/></svg>',
    dj: '<svg viewBox="0 0 72 48" role="img" aria-label="علم جيبوتي"><rect width="72" height="24" fill="#6ab2e7"/><rect y="24" width="72" height="24" fill="#12ad2b"/><path d="M0 0 32 24 0 48Z" fill="#fff"/><path d="m14 18 1.4 4h4.2l-3.4 2.5 1.3 4L14 26.2 10.5 28.5l1.3-4L8.4 22h4.2Z" fill="#d7141a"/></svg>',
    km: '<svg viewBox="0 0 72 48" role="img" aria-label="علم جزر القمر"><rect width="72" height="12" fill="#ffd100"/><rect y="12" width="72" height="12" fill="#fff"/><rect y="24" width="72" height="12" fill="#ce1126"/><rect y="36" width="72" height="12" fill="#3a75c4"/><path d="M0 0 30 24 0 48Z" fill="#3d8e33"/><path d="M10 16c4 0 6.5 2.2 6.5 5.5S14 27 10 27c2.4 0 4.2-1.6 4.2-5.5S12.4 16 10 16Z" fill="#fff"/><path d="m16 18 1 2.6h2.8l-2.2 1.6.8 2.6-2.4-1.7-2.4 1.7.8-2.6-2.2-1.6H15Z" fill="#fff"/></svg>',
    so: '<svg viewBox="0 0 72 48" role="img" aria-label="علم الصومال"><rect width="72" height="48" fill="#4189dd"/><path d="m36 10 3.4 10.2h10.8L41.4 26.6l3.4 10.2L36 30.6 27.2 36.8l3.4-10.2-8.8-6.4h10.8Z" fill="#fff"/></svg>',
    ps: '<svg viewBox="0 0 72 48" role="img" aria-label="علم فلسطين"><rect width="72" height="16" fill="#000"/><rect y="16" width="72" height="16" fill="#fff"/><rect y="32" width="72" height="16" fill="#007a3d"/><path d="M0 0 30 24 0 48Z" fill="#ce1126"/></svg>',
    jo: '<svg viewBox="0 0 72 48" role="img" aria-label="علم الأردن"><rect width="72" height="16" fill="#000"/><rect y="16" width="72" height="16" fill="#fff"/><rect y="32" width="72" height="16" fill="#007a3d"/><path d="M0 0 30 24 0 48Z" fill="#ce1126"/><path d="m12 20 1 2.4h2.6l-2 1.5.8 2.4-2.4-1.6-2.4 1.6.8-2.4-2-1.5H11Z" fill="#fff"/></svg>',
    lb: '<svg viewBox="0 0 72 48" role="img" aria-label="علم لبنان"><rect width="72" height="14" fill="#d21034"/><rect y="14" width="72" height="20" fill="#fff"/><rect y="34" width="72" height="14" fill="#d21034"/><path d="M36 18 40 30h-8Z" fill="#007a3d"/><path d="M32 28h8l-1 3h-6Z" fill="#007a3d"/></svg>',
    sy: '<svg viewBox="0 0 72 48" role="img" aria-label="علم سوريا"><rect width="72" height="16" fill="#ce1126"/><rect y="16" width="72" height="16" fill="#fff"/><rect y="32" width="72" height="16" fill="#000"/><path d="m28 20 1 2.6h2.8l-2.2 1.6.8 2.6-2.4-1.7-2.4 1.7.8-2.6-2.2-1.6H27Z" fill="#007a3d"/><path d="m44 20 1 2.6h2.8l-2.2 1.6.8 2.6-2.4-1.7-2.4 1.7.8-2.6-2.2-1.6H43Z" fill="#007a3d"/></svg>',
    iq: '<svg viewBox="0 0 72 48" role="img" aria-label="علم العراق"><rect width="72" height="16" fill="#ce1126"/><rect y="16" width="72" height="16" fill="#fff"/><rect y="32" width="72" height="16" fill="#000"/><text x="36" y="27.5" text-anchor="middle" font-size="8" fill="#007a3d" font-family="sans-serif">الله أكبر</text></svg>',
    sa: '<svg viewBox="0 0 72 48" role="img" aria-label="علم السعودية"><rect width="72" height="48" fill="#006c35"/><text x="36" y="22" text-anchor="middle" font-size="7" fill="#fff" font-family="sans-serif">لا إله إلا الله</text><path d="M24 30h24l-2 2H26Z" fill="#fff"/></svg>',
    om: '<svg viewBox="0 0 72 48" role="img" aria-label="علم عُمان"><rect width="72" height="16" fill="#fff"/><rect y="16" width="72" height="16" fill="#db161b"/><rect y="32" width="72" height="16" fill="#008000"/><rect width="18" height="48" fill="#db161b"/></svg>',
    ae: '<svg viewBox="0 0 72 48" role="img" aria-label="علم الإمارات"><rect width="72" height="16" fill="#00732f"/><rect y="16" width="72" height="16" fill="#fff"/><rect y="32" width="72" height="16" fill="#000"/><rect width="18" height="48" fill="#ff0000"/></svg>',
    qa: '<svg viewBox="0 0 72 48" role="img" aria-label="علم قطر"><rect width="72" height="48" fill="#8d1b3d"/><path d="M0 0h24l8 4-8 4 8 4-8 4 8 4-8 4 8 4-8 4 8 4-8 4 8 4H0Z" fill="#fff"/></svg>',
    bh: '<svg viewBox="0 0 72 48" role="img" aria-label="علم البحرين"><rect width="72" height="48" fill="#ce1126"/><path d="M0 0h24l8 6-8 6 8 6-8 6 8 6-8 6 8 6-8 6 8 6H0Z" fill="#fff"/></svg>',
    kw: '<svg viewBox="0 0 72 48" role="img" aria-label="علم الكويت"><rect width="72" height="16" fill="#007a3d"/><rect y="16" width="72" height="16" fill="#fff"/><rect y="32" width="72" height="16" fill="#ce1126"/><path d="M0 0 20 16v16L0 48Z" fill="#000"/></svg>'
  };
  const formatTime = (value) => { if (!value) return 'وقت النشر غير متاح'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'وقت النشر غير متاح' : new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(date); };
  const setStatus = (text) => { const el = document.getElementById('countryStatus'); if (el) el.textContent = text; };
  const countryUrl = (slug) => `country-news.html?slug=${encodeURIComponent(slug)}`;

  async function renderCountries() {
    const grid = document.getElementById('countryGrid');
    if (!grid || !client) { setStatus('تعذر تحميل خدمة الأخبار.'); return; }
    const { data: countries, error } = await client.from('arab_countries').select('id,name_ar,name_en,slug,flag_code,display_order').eq('is_active', true).order('display_order').limit(30);
    if (error) { console.error('[mirsad countries]', error); setStatus('تعذر تحميل الدول حاليًا.'); return; }
    if (!countries?.length) { setStatus('لا توجد دول مفعلة حاليًا.'); return; }
    const cards = await Promise.all(countries.map(async (country) => {
      const { count } = await client.from('country_news_articles').select('id', { count: 'exact', head: true }).eq('country_id', country.id).eq('is_published', true);
      const articleCount = Number(count || 0);
      return `<a class="country-card" href="${countryUrl(country.slug)}"><span class="country-card__topline"><span class="country-card__eyebrow">تغطية محلية</span><span class="country-card__source-count">3 مصادر</span></span><span class="country-card__flag">${flag[country.flag_code] || '<svg viewBox="0 0 72 48" role="img" aria-label="علم الدولة"><circle cx="36" cy="24" r="18" fill="none" stroke="currentColor" stroke-width="3"/></svg>'}</span><span class="country-card__name"><h2>${esc(country.name_ar)}</h2><span class="country-card__code">${esc(country.name_en)}</span></span><p>أخبار محلية منتقاة من مصادر موثوقة</p><span class="country-card__footer"><span><strong>${articleCount}</strong> خبر منشور</span><span class="country-card__arrow" aria-hidden="true">↗</span></span></a>`;
    }));
    grid.innerHTML = cards.join('');
    setStatus(`${countries.length} دولة عربية`);
  }

  if (document.getElementById('countryGrid')) renderCountries();
})();
