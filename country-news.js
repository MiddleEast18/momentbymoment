(() => {
  'use strict';
  const SUPABASE_URL = 'https://dndlkenyfymlrjnslyzb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx';
  const TRANSLATE_FUNCTION = `${SUPABASE_URL}/functions/v1/mirsad-translate-country-article`;
  const client = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_KEY);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const formatTime = (value) => { if (!value) return 'وقت النشر غير متاح'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'وقت النشر غير متاح' : new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(date); };
  const setStatus = (text) => { const el = document.getElementById('countryStatus'); if (el) el.textContent = text; };
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('slug') || '';
  const foreignLanguage = (language, sourceKey) => !String(language || 'ar').toLowerCase().startsWith('ar') || ['dz_tsa', 'eg_dailynewsegypt'].includes(sourceKey);
  const translationButton = (article) => foreignLanguage(article.language, article.country_news_sources?.source_key) ? `<button class="country-translate" type="button" data-article-id="${esc(article.id)}" aria-label="ترجمة عنوان وملخص الخبر إلى العربية">ترجمة إلى العربية</button>` : '';
  const translateArticle = async (button) => {
    const articleId = button.dataset.articleId;
    button.disabled = true; button.textContent = 'جارٍ الترجمة…';
    try {
      const { data: cached, error: cacheError } = await client.from('country_article_translations').select('translated_headline,translated_summary,model').eq('article_id', articleId).eq('target_language', 'ar').maybeSingle();
      if (cacheError) throw cacheError;
      const result = cached ? { translation: cached, cached: true } : await fetch(TRANSLATE_FUNCTION, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, body: JSON.stringify({ article_id: articleId }) }).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Translation failed'); return data; });
      const card = button.closest('.country-article');
      card.querySelector('h2').textContent = result.translation.translated_headline;
      const summary = card.querySelector('p'); if (summary) summary.textContent = result.translation.translated_summary;
      button.textContent = 'مترجم آليًا'; button.classList.add('is-translated');
    } catch (error) { console.error('[mirsad translation]', error); button.disabled = false; button.textContent = 'إعادة المحاولة'; }
  };

  async function loadCountry() {
    if (!client || !slug) { setStatus('رابط الدولة غير صالح.'); return; }
    const { data: country, error: countryError } = await client.from('arab_countries').select('id,name_ar,name_en,slug,flag_code').eq('slug', slug).eq('is_active', true).maybeSingle();
    if (countryError || !country) { setStatus('تعذر العثور على الدولة.'); return; }
    document.title = `أخبار ${country.name_ar} — مِرصاد`;
    document.getElementById('countryTitle').textContent = `أخبار ${country.name_ar}`;
    document.getElementById('countrySubtitle').textContent = `${country.name_en} — تغطية محلية من ثلاثة مصادر منتقاة`;
    const [{ data: sources, error: sourceError }, { data: articles, error: articleError }] = await Promise.all([
      client.from('country_news_sources').select('source_name,source_type,priority,source_url').eq('country_id', country.id).eq('is_active', true).order('priority').limit(3),
      client.from('country_news_articles').select('id,source_id,source_url,headline,summary,category,published_at,importance_score,confidence_score,language,country_news_sources(source_key,source_name,source_url)').eq('country_id', country.id).eq('is_published', true).order('published_at', { ascending: false, nullsFirst: false }).limit(100)
    ]);
    if (sourceError || articleError) { console.error('[mirsad country]', sourceError || articleError); setStatus('تعذر تحميل أخبار الدولة حاليًا.'); return; }
    document.getElementById('sourceList').innerHTML = (sources || []).map((source) => `<a class="source-chip" href="${esc(source.source_url)}" target="_blank" rel="noopener noreferrer">${esc(source.source_name)}</a>`).join('');
    const grid = document.getElementById('articleGrid');
    if (!articles?.length) { grid.innerHTML = ''; document.getElementById('emptyState').hidden = false; setStatus('لا توجد بطاقات منشورة لهذه الدولة حاليًا.'); return; }
    grid.innerHTML = articles.map((article) => {
      const source = Array.isArray(article.country_news_sources) ? article.country_news_sources[0] : article.country_news_sources;
      return `<article class="country-article" data-article-id="${esc(article.id)}"><div class="country-article__meta"><span>${esc(source?.source_name || 'مصدر غير محدد')}</span><span>${foreignLanguage(article.language, source?.source_key) ? 'لغة أجنبية' : esc(article.category || 'عام')}</span></div><h2>${esc(article.headline)}</h2><p>${esc(article.summary)}</p>${translationButton({ ...article, country_news_sources: source })}<div class="country-translation-note" aria-live="polite">${foreignLanguage(article.language, source?.source_key) ? 'الترجمة عند الطلب' : ''}</div><time class="country-article__time" datetime="${esc(article.published_at || '')}">${esc(formatTime(article.published_at))}</time></article>`;
    }).join('');
    grid.querySelectorAll('.country-translate').forEach((button) => button.addEventListener('click', () => translateArticle(button)));
    setStatus(`${articles.length} خبرًا منشورًا`);
  }
  loadCountry();
})();
