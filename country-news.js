(() => {
  'use strict';
  const SUPABASE_URL = 'https://dndlkenyfymlrjnslyzb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx';
  const client = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_KEY);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const formatTime = (value) => { if (!value) return 'وقت النشر غير متاح'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'وقت النشر غير متاح' : new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(date); };
  const setStatus = (text) => { const el = document.getElementById('countryStatus'); if (el) el.textContent = text; };
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('slug') || '';

  async function loadCountry() {
    if (!client || !slug) { setStatus('رابط الدولة غير صالح.'); return; }
    const { data: country, error: countryError } = await client.from('arab_countries').select('id,name_ar,name_en,slug,flag_code').eq('slug', slug).eq('is_active', true).maybeSingle();
    if (countryError || !country) { setStatus('تعذر العثور على الدولة.'); return; }
    document.title = `أخبار ${country.name_ar} — مِرصاد`;
    document.getElementById('countryTitle').textContent = `أخبار ${country.name_ar}`;
    document.getElementById('countrySubtitle').textContent = `${country.name_en} — تغطية تجريبية من مصادر محلية وإقليمية ودولية`;
    const [{ data: sources, error: sourceError }, { data: articles, error: articleError }] = await Promise.all([
      client.from('country_news_sources').select('source_name,source_type,priority,source_url').eq('country_id', country.id).eq('is_active', true).order('priority').limit(3),
      client.from('country_news_articles').select('id,source_id,source_url,headline,summary,category,published_at,importance_score,confidence_score,country_news_sources(source_name,source_url)').eq('country_id', country.id).eq('is_published', true).order('published_at', { ascending: false, nullsFirst: false }).limit(30)
    ]);
    if (sourceError || articleError) { console.error('[mirsad country]', sourceError || articleError); setStatus('تعذر تحميل أخبار الدولة حاليًا.'); return; }
    document.getElementById('sourceList').innerHTML = (sources || []).map((source) => `<a class="source-chip" href="${esc(source.source_url)}" target="_blank" rel="noopener noreferrer">${esc(source.source_name)}</a>`).join('');
    const grid = document.getElementById('articleGrid');
    if (!articles?.length) { grid.innerHTML = ''; document.getElementById('emptyState').hidden = false; setStatus('لم تصل أخبار منشورة بعد — الجلب التجريبي قيد التجهيز.'); return; }
    grid.innerHTML = articles.map((article) => {
      const source = Array.isArray(article.country_news_sources) ? article.country_news_sources[0] : article.country_news_sources;
      return `<article class="country-article"><div class="country-article__meta"><span>${esc(source?.source_name || 'مصدر غير محدد')}</span><span>${esc(article.category || 'عام')}</span></div><h2>${esc(article.headline)}</h2><p>${esc(article.summary)}</p><time class="country-article__time" datetime="${esc(article.published_at || '')}">${esc(formatTime(article.published_at))}</time></article>`;
    }).join('');
    setStatus(`${articles.length} خبرًا منشورًا`);
  }
  loadCountry();
})();
