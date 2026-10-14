(() => {
  'use strict';

  const SUPABASE_URL = 'https://dndlkenyfymlrjnslyzb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx';
  const CHAT_URL = `${SUPABASE_URL}/functions/v1/mirsad-archive-chat`;
  const supabase = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
  });
  const STORE_KEY = 'marsad-archive-chat-v1';
  const CATEGORY_LABELS = { Politics: 'سياسة', Economy: 'اقتصاد', Tech: 'تقنية', Society: 'مجتمع', Sports: 'رياضة' };
  const CATEGORY_COLORS = { Politics: '#8b7bc7', Economy: '#c9a227', Tech: '#4f9dde', Society: '#b8794a', Sports: '#4fa8a0' };
  const TASK_TYPES = ['summarize', 'analyze', 'entities', 'related', 'another'];
  const EXAMPLE_QUESTIONS = ['ما الأخبار المتعلقة ببيروت؟', 'ابحث عن خبر الزلزال في تركيا', 'أخبار الطاقة في السعودية'];
  let exampleIndex = 0;
  const LABELS = {
    ar: { event: 'الحدث', context: 'السياق', parties: 'الأطراف', significance: 'الدلالة', outcomes: 'النتائج المحتملة' },
    en: { event: 'Event', context: 'Context', parties: 'Parties', significance: 'Significance', outcomes: 'Possible implications' },
  };
  const form = document.getElementById('archiveForm');
  const input = document.getElementById('archivePrompt');
  const sendButton = document.getElementById('archiveSend');
  const conversation = document.getElementById('conversation');
  const welcome = document.getElementById('welcomeState');
  const messageTemplate = document.getElementById('archiveMessageTemplate');
  const userTemplate = document.getElementById('archiveUserMessageTemplate');
  const cardTemplate = document.getElementById('archiveCardTemplate');
  const state = { history: [], shownIds: [], activeId: '', searchQuery: '', transcript: [], retryRequest: null };
  const openingArticles = new Set();
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
        retryRequest: state.retryRequest,
      }));
    } catch { /* private mode */ }
  }

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
    card.addEventListener('click', (event) => { void openArchiveArticle(event, article); });
    return card;
  }

  async function authorizationHeaders() {
    if (!supabase) throw new Error('تعذر تهيئة تسجيل الدخول. أعد تحميل الصفحة.');
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.access_token) throw new Error('سجّل الدخول أولًا لاستخدام الأرشيف وخصم الفتحات.');
    return { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${data.session.access_token}` };
  }

  async function openArchiveArticle(event, article) {
    event.preventDefault();
    const href = safeHttpUrl(article.source_url);
    const articleId = String(article.id || '');
    if (!href || !articleId || busy || openingArticles.has(articleId)) return;
    openingArticles.add(articleId);
    const card = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    card?.setAttribute('aria-busy', 'true');
    let tab = null;
    try {
      tab = window.open('about:blank', '_blank');
      if (tab) tab.opener = null;
      const response = await fetch(CHAT_URL, {
        method: 'POST',
        headers: await authorizationHeaders(),
        body: JSON.stringify({ action: 'open', article_id: articleId }),
        signal: AbortSignal.timeout(15000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(normalize(payload.error) || 'تعذر فتح الخبر.');
      showBalance(payload);
      if (tab) tab.location.href = href;
      else window.location.assign(href);
    } catch (error) {
      if (tab) tab.close();
      const entry = { role: 'assistant', text: error.message || 'تعذر فتح الخبر.', error: true };
      appendEntry(entry);
      remember(entry);
    } finally {
      openingArticles.delete(articleId);
      card?.removeAttribute('aria-busy');
    }
  }

  function renderBrief(node, briefing, lang) {
    const box = node.querySelector('.archive-brief');
    const labels = LABELS[lang] || LABELS.ar;
    const rows = ['event', 'context', 'parties', 'significance', 'outcomes'];
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
      const normalized = value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
      if ([...box.querySelectorAll('.archive-brief__row span:last-child')].some((item) => item.textContent.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim() === normalized)) continue;
      const name = document.createElement('span');
      name.className = 'archive-brief__label';
      name.textContent = labels[key];
      const text = document.createElement('span');
      text.textContent = value;
      row.append(name, text);
      box.appendChild(row);
      count += 1;
    }
    if (!count) {
      box.hidden = true;
      return;
    }
    const details = document.createElement('details');
    details.className = 'archive-brief__details';
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = lang === 'en' ? 'Detailed reading' : 'القراءة المفصلة';
    details.append(summary, ...[...box.childNodes]);
    box.replaceChildren(details);
    box.hidden = false;
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
      button.addEventListener('click', () => {
        const task = window.MirsadArchiveActions?.taskTypeForSuggestion(text) || null;
        void submitQuestion(text, task);
      });
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
        const note = document.createElement('p');
        note.className = 'archive-card-note';
        note.textContent = entry.lang === 'en'
          ? 'Opening the source costs 2 unlocks, including repeat opens.'
          : 'فتح المصدر يخصم فتحتين، بما في ذلك إعادة فتح الخبر نفسه.';
        results.appendChild(note);
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
    syncClear();
  }

  function syncClear() {
    const button = document.getElementById('archiveClear');
    if (!button) return;
    const hasChat = state.transcript.length > 0 || !!conversation.querySelector('.archive-message');
    button.hidden = !hasChat;
    button.disabled = busy || !!window.MirsadArchiveActions?.hasPendingCommit(state.retryRequest);
  }

  function clearConversation() {
    if (busy) return;
    if (window.MirsadArchiveActions?.hasPendingCommit(state.retryRequest)) {
      const notice = { role: 'assistant', text: 'أكمل تأكيد خصم الرد السابق أولًا؛ لم تُحذف المحادثة أو حالة الخصم.', error: true };
      appendEntry(notice);
      remember(notice);
      return;
    }
    if (!state.transcript.length && !conversation.querySelector('.archive-message')) return;
    if (!window.confirm('حذف هذه المحادثة؟ سيُمسح الحوار من هذه الجلسة ولا يمكن التراجع.')) return;
    state.history = [];
    state.shownIds = [];
    state.activeId = '';
    state.searchQuery = '';
    state.transcript = [];
    state.retryRequest = null;
    conversation.querySelectorAll('.archive-message').forEach((node) => node.remove());
    welcome.hidden = false;
    input.value = '';
    input.style.height = 'auto';
    try { sessionStorage.removeItem(STORE_KEY); } catch { /* private mode */ }
    syncClear();
    input.focus({ preventScroll: true });
  }

  function showBalance(payload) {
    const text = document.getElementById('archiveHintText');
    if (!text || !payload) return;
    const account = payload.unlocks && typeof payload.unlocks === 'object' ? payload.unlocks : payload;
    text.replaceChildren();
    const remaining = account.remaining ?? account.remaining_unlocks ?? payload.remaining_unlocks ?? payload.remaining;
    if (account.unlimited === true || payload.unlimited === true || payload.unlimited_unlocks === true) text.textContent = 'رصيد الفتحات غير محدود';
    else if (remaining != null && Number.isFinite(Number(remaining))) text.textContent = `المتبقي ${remaining} فتحة`;
  }

  function startPending() {
    const node = appendEntry({ role: 'assistant', text: 'أفهم السؤال وسياق المحادثة…' });
    node.classList.add('is-pending');
    const textNode = node.querySelector('.archive-message__text');
    const lines = ['أفهم السؤال وسياق المحادثة…', 'أجلب أقرب أخبار الأرشيف…', 'أصوغ الرد ثم أراجعه…'];
    let step = 0;
    const timer = setInterval(() => {
      step = Math.min(step + 1, lines.length - 1);
      textNode.textContent = lines[step];
    }, 4200);
    return { node, stop() { clearInterval(timer); } };
  }

  async function refreshAccess() {
    const text = document.getElementById('archiveHintText');
    if (!text || !supabase) return;
    const { data } = await supabase.auth.getSession().catch(() => ({ data: null }));
    if (data?.session) return;
    text.replaceChildren();
    const link = document.createElement('a');
    link.href = 'profile.html';
    link.textContent = 'سجّل الدخول لاستخدام الأرشيف';
    text.append(link);
  }

  function newRequestId() {
    if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  async function search(query, requestId, taskType = null) {
    const response = await fetch(CHAT_URL, {
      method: 'POST',
      headers: await authorizationHeaders(),
      body: JSON.stringify({
        query,
        history: state.history.slice(-8),
        shown_ids: state.shownIds.slice(-40),
        active_article_id: state.activeId,
        search_query: state.searchQuery,
        request_id: requestId,
        ...(taskType ? { task_type: taskType } : {}),
      }),
      signal: AbortSignal.timeout(180000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(normalize(payload.error) || 'حدث خطأ أثناء معالجة الأرشيف. لم يتم خصم أي فتحة.');
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function commitChatCharge(requestId) {
    const response = await fetch(CHAT_URL, {
      method: 'POST',
      headers: await authorizationHeaders(),
      body: JSON.stringify({ action: 'commit_chat', request_id: requestId }),
      signal: AbortSignal.timeout(20000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(normalize(payload.error) || 'تعذر تأكيد خصم رد الأرشيف. أعد المحاولة.');
    return payload;
  }

  async function submitQuestion(rawQuestion, taskType = null) {
    const query = normalize(rawQuestion).slice(0, 500);
    if (!query || busy) return;
    taskType = TASK_TYPES.includes(taskType) ? taskType : null;
    try {
      await authorizationHeaders();
    } catch (error) {
      welcome.hidden = true;
      appendEntry({ role: 'assistant', text: error.message || 'سجّل الدخول أولًا.', error: true });
      refreshAccess();
      return;
    }
    const mustSettle = window.MirsadArchiveActions?.mustSettlePendingCommit(state.retryRequest, query)
      ?? (state.retryRequest?.phase === 'commit' && state.retryRequest.query !== query);
    if (mustSettle) {
      setBusy(true);
      try {
        const result = await commitChatCharge(state.retryRequest.id);
        state.retryRequest = null;
        persist();
        showBalance(result);
      } catch (error) {
        const notice = { role: 'assistant', text: `${error.message || 'تعذر تأكيد خصم الرد السابق.'} لم يُرسل السؤال الجديد؛ أعد المحاولة بعد تأكيد الخصم السابق.`, error: true };
        appendEntry(notice);
        remember(notice);
        return;
      } finally {
        setBusy(false);
      }
    }
    if (state.retryRequest?.query === query && state.retryRequest.phase === 'commit') {
      setBusy(true);
      try {
        const result = await commitChatCharge(state.retryRequest.id);
        state.retryRequest = null;
        persist();
        showBalance(result);
        input.value = '';
        input.style.height = 'auto';
      } catch (error) {
        const entry = { role: 'assistant', text: error.message || 'تعذر تأكيد خصم رد الأرشيف. أعد المحاولة.', error: true };
        appendEntry(entry);
        remember(entry);
        persist();
      } finally {
        setBusy(false);
        input.focus({ preventScroll: true });
      }
      return;
    }
    const retryingReply = state.retryRequest?.query === query;
    const effectiveTask = retryingReply ? (state.retryRequest.taskType || taskType) : taskType;
    welcome.hidden = true;
    if (!retryingReply) {
      appendEntry({ role: 'user', text: query });
      remember({ role: 'user', text: query });
      state.history.push({ role: 'user', content: query });
    }
    input.value = '';
    input.style.height = 'auto';
    setBusy(true);
    const requestId = state.retryRequest?.query === query ? state.retryRequest.id : newRequestId();
    state.retryRequest = { query, id: requestId, ...(effectiveTask ? { taskType: effectiveTask } : {}) };
    persist();
    const pending = startPending();
    try {
      const result = await search(query, requestId, effectiveTask);
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
      pending.stop();
      pending.node.remove();
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
      state.retryRequest = result.charge_pending
        ? { query, id: String(result.request_id || requestId), phase: 'commit' }
        : null;
      persist();
      if (result.charge_pending) {
        try {
          const charge = await commitChatCharge(state.retryRequest.id);
          state.retryRequest = null;
          persist();
          showBalance(charge);
        } catch (chargeError) {
          const notice = { role: 'assistant', text: chargeError.message || 'تم الرد، لكن تعذر تأكيد خصم 50 فتحة. أعد إرسال السؤال نفسه لإكمال التحديث.', error: true };
          appendEntry(notice);
          remember(notice);
          persist();
        }
      }
    } catch (error) {
      pending.stop();
      pending.node.remove();
      const message = error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? 'تأخر الرد من خدمة الأرشيف. انتظر قليلًا قبل إعادة المحاولة حتى لا يتكرر الطلب.'
        : (error.message || 'تعذر إكمال طلب الأرشيف. حاول مرة أخرى بعد قليل.');
      const entry = { role: 'assistant', text: message, error: true };
      state.retryRequest = { query, id: requestId, ...(effectiveTask ? { taskType: effectiveTask } : {}) };
      appendEntry(entry);
      remember(entry);
      persist();
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
      const retry = saved.retryRequest;
      state.retryRequest = retry && typeof retry.query === 'string' && typeof retry.id === 'string'
        ? {
          query: retry.query.slice(0, 500), id: retry.id.slice(0, 80),
          ...(retry.phase === 'commit' ? { phase: 'commit' } : {}),
          ...(TASK_TYPES.includes(retry.taskType) ? { taskType: retry.taskType } : {}),
        }
        : null;
      state.transcript = saved.transcript.slice(-24);
      if (!state.transcript.length) return;
      welcome.hidden = true;
      for (const entry of state.transcript) appendEntry(entry);
      syncClear();
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
  document.getElementById('archiveClear')?.addEventListener('click', clearConversation);
  document.getElementById('archiveExample')?.addEventListener('click', () => {
    input.value = EXAMPLE_QUESTIONS[exampleIndex % EXAMPLE_QUESTIONS.length];
    exampleIndex++;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus({ preventScroll: true });
  });
  restore();
  refreshAccess();
})();
