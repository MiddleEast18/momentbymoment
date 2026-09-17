(() => {
  'use strict';
  const SUPABASE_URL = 'https://dndlkenyfymlrjnslyzb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx';
  const client = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_KEY);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const flag = { dz: '🇩🇿', eg: '🇪🇬', ye: '🇾🇪' };
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
      return `<a class="country-card" href="${countryUrl(country.slug)}"><span class="country-card__flag" aria-hidden="true">${flag[country.flag_code] || '◉'}</span><h2>${esc(country.name_ar)}</h2><p>${esc(country.name_en)} — أخبار من ثلاثة مصادر محددة</p><span class="country-card__footer"><span>${Number(count || 0)} خبرًا منشورًا</span><span class="country-card__arrow" aria-hidden="true">←</span></span></a>`;
    }));
    grid.innerHTML = cards.join('');
    setStatus(`${countries.length} دول متاحة في المرحلة التجريبية`);
  }

  if (document.getElementById('countryGrid')) renderCountries();
})();
