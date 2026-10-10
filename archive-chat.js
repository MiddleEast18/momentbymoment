(() => {
  'use strict';

  const SUPABASE_URL = 'https://dndlkenyfymlrjnslyzb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx';
  const CHAT_URL = `${SUPABASE_URL}/functions/v1/mirsad-archive-chat`;
  const STORE_KEY = 'marsad-archive-chat-v1';
  const CATEGORY_LABELS = { Politics: 'سياسة', Economy: 'اقتصاد', Tech: 'تقنية', Society: 'مجتمع', Sports: 'رياضة' };
  const CATEGORY_COLORS = { Politics: '#8b7bc7', Economy: '#c9a227', Tech: '#4f9dde', Society: '#b8794a', Sports: '#4fa8a0' };
  const LABELS = {
    ar: { event: 'الحدث', context: 'السياق والأطراف', significance: 'الدلالات', outcomes: 'النتائج المحتملة', analysis: 'التحليل' },
    en: { event: 'Event', context: 'Context and parties', significance: 'Significance', outcomes: 'Possible outcomes', analysis: 'Analysis' },
  };
  const form = document.getElementById('archiveForm');
  const input = document.getElementById('archivePrompt');
  const sendButton = document.getElementById('archiveSend');
  const conversation = document.getElementById('conversation');
  const welcome = document.getElementById('welcomeState');
  const messageTemplate = document.getElementById('archiveMessageTemplate');
  const userTemplate = document.getElementById('archiveUserMessageTemplate');
  const cardTemplate = document.getElementById('archiveCardTemplate');
  const authClient = window.supabase?.createClient ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }) : null;
  const state = { history: [], shownIds: [], activeId: '', searchQuery: '', transcript: [] };
  let busy = false;

  function normalize(value) {
    return String(value ?? '')
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&(?:#\d+|#x[\da-f]+|[a-z]{2,12});/gi, ' ')
      .replace(/\b(ignore (?:all |any |previous |prior )?instructions|disregard (?:the |all )?rules|system prompt|you are now)\b/gi, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function persist() {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({
        history: state.history.slice(-8),
        shownIds: state.shownIds.slice(-40),
        activeId: state.activeId,
        searchQuery: state.searchQuery,
        transcript: state.transcript.slice(-24),
      }));
    } catch { /* private mode */ }
  }

  async function authHeaders() { const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY }; try { const session = authClient ? (await authClient.auth.getSession()).data.session : null; if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`; } catch {} return headers; }
  async function chargeOpen(articleId) { const response = await fetch(CHAT_URL, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ operation: 'archive_open', article_id: articleId }), signal: AbortSignal.timeout(15000) }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(normalize(payload.error) || 'تعذر فتح المصدر الآن.'); return payload; }
  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch { return ''; }
  }

  const relativeTime = new Intl.RelativeTimeFormat('ar', { numeric: 'auto' });
  function formatTime(value) {
    const timestamp = new Date(value || 0).getTime();
    if (!Number.isFinite(timestamp) || timestamp <= 0) return 'وقت غير محدد';
    const minutes = Math.round((timestamp - Date.now()) / 60000);
    if (Math.abs(minutes) < 60) return relativeTime.format(minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return relativeTime.format(hours, 'hour');
    return relativeTime.format(Math.round(hours / 24), 'day');
  }

  function importanceTier(score) {
    return Math.min(5, Math.max(1, Math.ceil(Number(score || 0) / 20)));
  }

  function renderCard(article) {
    const card = cardTemplate.content.firstElementChild.cloneNode(true);
    const href = safeHttpUrl(article.source_url);
    if (href) card.href = href;
    else {
      card.removeAttribute('href');
      card.removeAttribute('target');
      card.setAttribute('aria-disabled', 'true');
    }
    card.className = 'card archive-result-card';
    card.dataset.id = String(article.id || '');
    card.dataset.sentiment = article.sentiment || 'Neutral';
    card.dataset.tier = String(importanceTier(article.importance_score));
    card.querySelector('.card__category').textContent = normalize(CATEGORY_LABELS[article.category] || article.category || 'عام');
    card.querySelector('.card__dot').style.background = CATEGORY_COLORS[article.category] || '#888';
    card.querySelector('.card__source').textContent = normalize(article.source_name || 'مصدر');
    card.querySelector('.card__headline').textContent = normalize(article.headline || '');
    card.querySelector('.card__summary').textContent = normalize(article.summary || '');
    card.querySelector('.card__confidence').textContent = `ثقة ${Math.round(Number(article.confidence_score ?? 0))}%`;
    const evidence = [];
    if (article.claim_digest) {
      const claim = typeof article.claim_digest === 'string' ? article.claim_digest : article.claim_digest.main_claim;
      if (claim) evidence.push(normalize(claim));
    }
    card.querySelector('.card__evidence').textContent = evidence.join(' · ');
    const updateBadge = card.querySelector('.card__update-badge');
    updateBadge.hidden = Number(article.update_count || 0) <= 0;
    if (!updateBadge.hidden) updateBadge.textContent = `+${article.update_count} تحديث`;
    card.querySelector('.card__verification-badge').hidden = true;
    const time = card.querySelector('.card__time');
    time.textContent = formatTime(article.published_at);
    time.dateTime = article.published_at || '';
    card.setAttribute('aria-label', `فتح المصدر: ${normalize(article.headline || '')}`);
    if (href && article.id) card.addEventListener('click', async (event) => { event.preventDefault(); try { await chargeOpen(String(article.id)); window.open(href, '_blank', 'noopener,noreferrer'); } catch (error) { window.alert(error.message || 'تعذر فتح المصدر.'); } });
    return card;
  }

  function renderBrief(node, briefing, lang) {
    const box = node.querySelector('.archive-brief');
    const labels = LABELS[lang] || LABELS.ar;
    const rows = ['event', 'context', 'significance', 'outcomes', 'analysis'];
    box.replaceChildren();
    if (!briefing || typeof briefing !== 'object') {
      box.hidden = true;
      return;
    }
    let count = 0;
    for (const key of rows) {
      const value = normalize(briefing[key] || '');
      if (!value) continue;
      const row = document.createElement('p');
      row.className = 'archive-brief__row';
      const name = document.createElement('span');
      name.className = 'archive-brief__label';
      name.textContent = labels[key];
      const text = document.createElement('span');
      text.textContent = value;
      row.append(name, text);
      box.appendChild(row);
      count += 1;
    }
    box.hidden = count === 0;
  }

  function renderActions(node, items) {
    const box = node.querySelector('.archive-actions');
    box.replaceChildren();
    const list = Array.isArray(items) ? items.slice(0, 5) : [];
    if (!list.length) {
      box.hidden = true;
      return;
    }
    for (const label of list) {
      const text = normalize(label).slice(0, 40);
      if (!text) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'archive-action';
      button.textContent = text;
      button.addEventListener('click', () => { void submitQuestion(text); });
      box.appendChild(button);
    }
    box.hidden = !box.childElementCount;
  }

  function appendEntry(entry) {
    const role = entry.role === 'user' ? 'user' : 'assistant';
    const node = (role === 'user' ? userTemplate : messageTemplate).content.firstElementChild.cloneNode(true);
    const textNode = node.querySelector('.archive-message__text');
    textNode.textContent = normalize(entry.text || '');
    if (entry.error) textNode.classList.add('archive-error');
    if (role !== 'user') {
      const cards = Array.isArray(entry.articles) ? entry.articles.slice(0, 1) : [];
      const results = node.querySelector('.archive-message__results');
      if (cards.length) {
        results.hidden = false;
        results.appendChild(renderCard(cards[0]));
      }
      renderBrief(node, entry.briefing, entry.lang || 'ar');
      renderActions(node, entry.suggestions);
    }
    conversation.appendChild(node);
    return node;
  }

  function remember(entry) {
    state.transcript.push(entry);
    if (state.transcript.length > 24) state.transcript.splice(0, state.transcript.length - 24);
    persist();
  }

  function setBusy(value) {
    busy = value;
    sendButton.disabled = value;
    sendButton.classList.toggle('is-loading', value);
    sendButton.setAttribute('aria-busy', value ? 'true' : 'false');
    input.disabled = value;
  }

  async function search(query) {
    const response = await fetch(CHAT_URL, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({
        query,
        history: state.history.slice(-8),
        shown_ids: state.shownIds.slice(-40),
        active_article_id: state.activeId,
        search_query: state.searchQuery,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(normalize(payload.error) || 'تعذر تنفيذ البحث الآن. حاول مرة أخرى بعد قليل.');
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function submitQuestion(rawQuestion) {
    const query = normalize(rawQuestion).slice(0, 500);
    if (!query || busy) return;
    welcome.hidden = true;
    appendEntry({ role: 'user', text: query });
    remember({ role: 'user', text: query });
    state.history.push({ role: 'user', content: query });
    input.value = '';
    input.style.height = 'auto';
    setBusy(true);
    const pending = appendEntry({ role: 'assistant', text: 'أراجع الكلام…' });
    try {
      const result = await search(query);
      const answer = normalize(result.reply || 'تم.');
      const articles = Array.isArray(result.articles) ? result.articles.slice(0, 1) : [];
      const entry = {
        role: 'assistant',
        text: answer,
        briefing: result.briefing || null,
        articles,
        suggestions: result.suggestions || [],
        lang: result.lang || 'ar',
      };
      pending.remove();
      const node = appendEntry(entry);
      node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      remember(entry);
      if (result.search_query) state.searchQuery = normalize(result.search_query).slice(0, 180);
      if (result.active_article_id) state.activeId = String(result.active_article_id);
      if (articles[0]?.id) {
        const id = String(articles[0].id);
        if (!state.shownIds.includes(id)) state.shownIds.push(id);
        state.activeId = id;
      }
      state.history.push({
        role: 'assistant',
        content: answer,
        article_ids: state.shownIds.slice(-12),
        search_query: state.searchQuery,
        active_article_id: state.activeId,
      });
      if (state.history.length > 8) state.history.splice(0, state.history.length - 8);
      persist();
    } catch (error) {
      pending.remove();
      const entry = { role: 'assistant', text: error.message || 'تعذر البحث الآن.', error: true };
      appendEntry(entry);
      remember(entry);
    } finally {
      setBusy(false);
      input.focus({ preventScroll: true });
    }
  }

  function restore() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
      if (!saved || !Array.isArray(saved.transcript)) return;
      state.history = Array.isArray(saved.history) ? saved.history.slice(-8) : [];
      state.shownIds = Array.isArray(saved.shownIds) ? saved.shownIds.slice(-40).map(String) : [];
      state.activeId = String(saved.activeId || '');
      state.searchQuery = String(saved.searchQuery || '');
      state.transcript = saved.transcript.slice(-24);
      if (!state.transcript.length) return;
      welcome.hidden = true;
      for (const entry of state.transcript) appendEntry(entry);
    } catch { /* ignore broken storage */ }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitQuestion(input.value);
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  document.querySelectorAll('.archive-suggestion').forEach((button) => {
    button.addEventListener('click', () => {
      input.value = button.textContent.trim();
      form.requestSubmit();
    });
  });
  restore();
})();
