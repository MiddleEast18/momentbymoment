(() => {
  'use strict';
  const SUPABASE_URL = 'https://dndlkenyfymlrjnslyzb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx';
  const client = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&', '<': '<', '>': '>', "'": '&#39;', '"': '"' }[char]));
  const formatDate = (value) => value ? new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
  const setStatus = (text) => { if ($('systemMailStatus')) $('systemMailStatus').textContent = text; };
  const setDeveloperResult = (text, error = false) => { if ($('developerResult')) { $('developerResult').textContent = text; $('developerResult').style.color = error ? '#e5a28e' : ''; } };
  const recipientLabel = (row) => {
    const name = (row.display_name || row.username || '').trim();
    const email = (row.email || '').trim();
    const balance = Number(row.unlock_balance || 0);
    if (name && email) return `${name} — ${email} · ${balance} فتحة`;
    return `${name || email || row.user_id} · ${balance} فتحة`;
  };
  const selectRoots = () => [...document.querySelectorAll('[data-mirsad-select]')];
  const closeMirsadSelect = (root) => { if (!root) return; root.classList.remove('is-open'); const menu = root.querySelector('.mirsad-select__menu'); const trigger = root.querySelector('.mirsad-select__trigger'); if (menu) menu.hidden = true; if (trigger) trigger.setAttribute('aria-expanded', 'false'); };
  const renderMirsadSelect = (root) => {
    const select = root?.querySelector('.mirsad-select__native');
    const menu = root?.querySelector('.mirsad-select__menu');
    const label = root?.querySelector('[data-mirsad-select-label]');
    if (!select || !menu || !label) return;
    menu.replaceChildren();
    [...select.options].forEach((option) => {
      const item = document.createElement('button');
      item.type = 'button'; item.setAttribute('role', 'option'); item.dataset.value = option.value;
      item.setAttribute('aria-selected', option.selected ? 'true' : 'false'); item.textContent = option.textContent;
      item.addEventListener('click', () => { select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); closeMirsadSelect(root); renderMirsadSelect(root); });
      menu.appendChild(item);
    });
    label.textContent = select.selectedOptions[0]?.textContent || 'اختر الحساب';
  };
  const initMirsadSelect = (root) => {
    if (!root || root.dataset.mirsadSelectReady === 'true') return;
    const trigger = root.querySelector('.mirsad-select__trigger');
    const select = root.querySelector('.mirsad-select__native');
    const menu = root.querySelector('.mirsad-select__menu');
    if (!trigger || !select || !menu) return;
    root.dataset.mirsadSelectReady = 'true';
    trigger.addEventListener('click', () => { const open = !root.classList.contains('is-open'); selectRoots().forEach(closeMirsadSelect); if (open) { root.classList.add('is-open'); menu.hidden = false; trigger.setAttribute('aria-expanded', 'true'); menu.querySelector('button[aria-selected="true"]')?.focus(); } });
    trigger.addEventListener('keydown', (event) => { if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') { event.preventDefault(); trigger.click(); } if (event.key === 'Escape') closeMirsadSelect(root); });
    select.addEventListener('change', () => renderMirsadSelect(root));
    renderMirsadSelect(root);
  };
  document.querySelectorAll('[data-mirsad-select]').forEach(initMirsadSelect);
  document.addEventListener('click', (event) => { if (!event.target.closest('[data-mirsad-select]')) selectRoots().forEach(closeMirsadSelect); });

  let booted = false;
  let bootInFlight = null;
  let recipients = [];
  let namesById = {};

  async function loadMessages() {
    const { data, error } = await client.rpc('list_system_messages', { p_limit: 100, p_offset: 0 });
    if (error) throw error;
    const list = $('systemMessages');
    if (!data?.length) { list.innerHTML = '<div class="empty-state">لا توجد رسائل نظام حاليًا.</div>'; setStatus('لا توجد رسائل جديدة.'); return; }
    list.innerHTML = data.map((message) => `<article class="system-message ${message.read_at ? '' : 'is-unread'}" data-message-id="${escapeHtml(message.id)}"><div class="system-message__meta"><span>${escapeHtml(message.message_type === 'reward' ? 'مكافأة' : 'إشعار نظام')}</span><time>${escapeHtml(formatDate(message.created_at))}</time></div><h2 class="system-message__title">${escapeHtml(message.title)}</h2><p class="system-message__body">${escapeHtml(message.body)}</p>${message.read_at ? '' : '<button class="system-message__action" type="button" data-read>تحديد كمقروء</button>'}</article>`).join('');
    list.querySelectorAll('[data-read]').forEach((button) => button.addEventListener('click', async () => {
      const card = button.closest('[data-message-id]'); button.disabled = true;
      const { error: readError } = await client.rpc('mark_system_message_read', { p_message_id: card.dataset.messageId });
      if (!readError) { card.classList.remove('is-unread'); button.remove(); }
      else button.disabled = false;
    }));
    setStatus(`${data.length} رسالة في بريد النظام.`);
  }

  function renderRecipientOptions(filter = '') {
    const select = $('rewardRecipient');
    const query = filter.trim().toLowerCase();
    const rows = recipients.filter((row) => {
      if (!query) return true;
      return recipientLabel(row).toLowerCase().includes(query) || String(row.email || '').toLowerCase().includes(query);
    });
    const current = select.value;
    select.innerHTML = ['<option value="">اختر الحساب</option>', ...rows.map((row) => `<option value="${escapeHtml(row.user_id)}">${escapeHtml(recipientLabel(row))}</option>`)].join('');
    if (current && [...select.options].some((option) => option.value === current)) select.value = current;
    renderMirsadSelect(select.closest('[data-mirsad-select]'));
  }

  function renderOwnerStats() {
    const low = recipients.filter((row) => Number(row.unlock_balance || 0) < 50).length;
    const total = recipients.reduce((sum, row) => sum + Number(row.unlock_balance || 0), 0);
    $('ownerStats').hidden = false;
    $('ownerStats').innerHTML = `<div class="owner-stat"><span>حسابات عادية</span><strong>${recipients.length}</strong></div><div class="owner-stat"><span>رصيد منخفض</span><strong>${low}</strong></div><div class="owner-stat"><span>مجموع الفتحات</span><strong>${total}</strong></div>`;
  }

  function renderAccountsTable() {
    if (!recipients.length) { $('accountsTable').innerHTML = '<div class="empty-state">لا توجد حسابات عادية بعد.</div>'; return; }
    $('accountsTable').innerHTML = `<div class="accounts-table"><div class="accounts-table__row"><span>الحساب</span><span>البريد</span><span>الرصيد</span></div>${recipients.map((row) => `<div class="accounts-table__row"><b>${escapeHtml(row.display_name || row.username || 'بدون اسم')}</b><span>${escapeHtml(row.email || '—')}</span><strong>${escapeHtml(row.unlock_balance ?? 0)}</strong></div>`).join('')}</div>`;
  }

  async function loadRewardHistory() {
    const { data: history, error: historyError } = await client.from('system_reward_operations').select('id,recipient_user_id,amount,reward_type,reason,created_at').order('created_at', { ascending: false }).limit(20);
    if (historyError) { $('rewardHistory').innerHTML = '<div class="empty-state">تعذر تحميل السجل.</div>'; return; }
    $('rewardHistory').innerHTML = history?.length ? history.map((row) => `<div class="reward-row"><span>${escapeHtml(namesById[row.recipient_user_id] || row.recipient_user_id)}</span><span>${escapeHtml(row.reason)}</span><strong>${escapeHtml(row.amount)} فتحة</strong><time>${escapeHtml(formatDate(row.created_at))}</time></div>`).join('') : '<div class="empty-state">لا توجد عمليات منح بعد.</div>';
  }

  async function refreshOwnerData() {
    const { data, error } = await client.rpc('list_system_reward_recipients');
    if (error) { setDeveloperResult('تعذر تحميل الحسابات العادية.', true); return; }
    recipients = data || [];
    namesById = Object.fromEntries(recipients.map((row) => [row.user_id, row.display_name || row.email || row.user_id]));
    renderRecipientOptions($('recipientSearch').value || '');
    renderOwnerStats();
    renderAccountsTable();
    await loadRewardHistory();
  }

  async function sendReward() {
    const recipient = $('rewardRecipient').value;
    const amount = Number($('rewardAmount').value);
    const reason = $('rewardReason').value.trim();
    const periodStart = $('periodStart').value || null;
    const periodEnd = $('periodEnd').value || null;
    if (!recipient || !Number.isInteger(amount) || amount < 1 || amount > 100000 || !reason) { setDeveloperResult('أدخل الحساب وعدد الفتحات والسبب.', true); return; }
    if (periodStart && periodEnd && periodStart > periodEnd) { setDeveloperResult('الفترة الزمنية غير صحيحة.', true); return; }
    const label = $('rewardRecipient').selectedOptions[0]?.textContent || recipient;
    if (!window.confirm(`تأكيد منح ${amount} فتحة إلى:\n${label}\nالسبب: ${reason}`)) return;
    const button = $('sendReward'); button.disabled = true; setDeveloperResult('جارٍ تنفيذ العملية…');
    const { data, error } = await client.rpc('send_system_reward', {
      p_recipient_user_id: recipient,
      p_amount: amount,
      p_reason: reason,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_reward_type: 'unlock',
      p_request_id: crypto.randomUUID()
    });
    button.disabled = false;
    if (error) { setDeveloperResult(`تعذر الإرسال: ${error.message}`, true); return; }
    const row = Array.isArray(data) ? data[0] : data;
    const remaining = row?.remaining_unlocks;
    setDeveloperResult(row?.duplicate ? 'هذه العملية سُجّلت للتو ولم تُكرر.' : `تم منح ${amount} فتحة. رصيد المستلم الآن: ${remaining ?? '—'}.`);
    $('rewardAmount').value = '';
    $('rewardReason').value = '';
    await refreshOwnerData();
  }

  async function loadOwnerPanel() {
    const { data: allowed, error } = await client.rpc('is_system_developer');
    if (error || !allowed) return false;
    document.title = 'مالك النظام — مِرصاد';
    $('pageTitle').textContent = 'مالك النظام';
    $('pageIntro').textContent = 'حسابك كمالك للنظام لا يحتاج بريدًا ولا فتحات. هذه اللوحة تمنح فتحات القراءة للحسابات العادية فقط، من غير المساس بأخبار الموقع أو الاستيعاب.';
    $('pageBack').textContent = 'لوحة التحكم';
    $('pageBack').href = 'settings.html';
    $('inboxBlock').classList.add('is-hidden');
    $('developerPanel').classList.add('is-visible');
    setStatus('لوحة المالك جاهزة لمنح الفتحات للحسابات العادية.');
    $('recipientSearch').addEventListener('input', () => renderRecipientOptions($('recipientSearch').value));
    if ($('sendReward').dataset.bound !== 'true') {
      $('sendReward').dataset.bound = 'true';
      $('sendReward').addEventListener('click', sendReward);
    }
    await refreshOwnerData();
    return true;
  }

  async function boot() {
    if (booted) return;
    if (bootInFlight) return bootInFlight;
    bootInFlight = (async () => {
      if (!client) { setStatus('تعذر الاتصال بخدمة النظام.'); return; }
      const { data: sessionData } = await client.auth.getSession();
      if (!sessionData?.session?.user) return;
      try {
        const owner = await loadOwnerPanel();
        if (!owner) await loadMessages();
        booted = true;
      } catch (error) {
        console.error('[mirsad system owner]', error);
        setStatus('تعذر تحميل الصفحة حاليًا.');
      }
    })();
    try { await bootInFlight; } finally { bootInFlight = null; }
  }
  window.addEventListener('mirsad:authenticated', boot);
  window.setTimeout(boot, 1200);
})();
