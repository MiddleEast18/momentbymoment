(() => {
  'use strict';
  const SUPABASE_URL = 'https://dndlkenyfymlrjnslyzb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx';
  const client = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const formatDate = (value) => value ? new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
  const setStatus = (text) => { if ($('systemMailStatus')) $('systemMailStatus').textContent = text; };
  const setDeveloperResult = (text, error = false) => { if ($('developerResult')) { $('developerResult').textContent = text; $('developerResult').style.color = error ? '#e5a28e' : ''; } };

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

  async function loadDeveloperPanel(user) {
    const { data: allowed, error } = await client.rpc('is_system_developer', { p_user_id: user.id });
    if (error || !allowed) return;
    $('developerPanel').classList.add('is-visible');
    const { data: recipients, error: recipientError } = await client.rpc('list_system_reward_recipients');
    if (recipientError) { setDeveloperResult('تعذر تحميل الحسابات.', true); return; }
    $('rewardRecipient').innerHTML = (recipients || []).map((recipient) => `<option value="${escapeHtml(recipient.user_id)}">${escapeHtml(recipient.email || recipient.user_id)}</option>`).join('');
    const { data: history, error: historyError } = await client.from('system_reward_operations').select('id,recipient_user_id,amount,reward_type,reason,created_at').order('created_at', { ascending: false }).limit(20);
    if (!historyError) $('rewardHistory').innerHTML = history?.length ? history.map((row) => `<div class="reward-row"><span>${escapeHtml(row.reason)}</span><strong>${escapeHtml(row.amount)} ${row.reward_type === 'unlock' ? 'فتحة' : row.reward_type === 'points' ? 'نقطة' : 'يوم'}</strong><time>${escapeHtml(formatDate(row.created_at))}</time></div>`).join('') : '<div class="empty-state">لا توجد عمليات مكافأة بعد.</div>';
    $('sendReward').addEventListener('click', () => sendReward(user));
  }

  async function sendReward(user) {
    const recipient = $('rewardRecipient').value;
    const amount = Number($('rewardAmount').value);
    const reason = $('rewardReason').value.trim();
    const rewardType = $('rewardType').value;
    const periodStart = $('periodStart').value || null;
    const periodEnd = $('periodEnd').value || null;
    if (!recipient || !Number.isInteger(amount) || amount < 1 || amount > 100000 || !reason) { setDeveloperResult('أدخل الحساب والقيمة والسبب.', true); return; }
    if (periodStart && periodEnd && periodStart > periodEnd) { setDeveloperResult('الفترة الزمنية غير صحيحة.', true); return; }
    const label = $('rewardRecipient').selectedOptions[0]?.textContent || recipient;
    if (!window.confirm(`تأكيد إرسال ${amount} إلى ${label}؟\nالسبب: ${reason}\nلا يمكن تكرار العملية نفسها بعد نجاحها.`)) return;
    const button = $('sendReward'); button.disabled = true; setDeveloperResult('جارٍ تنفيذ العملية الذرية…');
    const requestId = crypto.randomUUID();
    const { data, error } = await client.rpc('send_system_reward', { p_recipient_user_id: recipient, p_amount: amount, p_reason: reason, p_period_start: periodStart, p_period_end: periodEnd, p_reward_type: rewardType, p_request_id: requestId });
    button.disabled = false;
    if (error) { setDeveloperResult(`تعذر الإرسال: ${error.message}`, true); return; }
    setDeveloperResult(data?.[0]?.duplicate ? 'هذه العملية موجودة مسبقًا ولم تُكرر.' : 'تم إرسال المكافأة وإنشاء رسالة النظام.');
    $('rewardAmount').value = ''; $('rewardReason').value = ''; await loadMessages();
  }

  async function boot() {
    if (!client) { setStatus('تعذر الاتصال بخدمة النظام.'); return; }
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData?.session?.user) return;
    try { await loadMessages(); await loadDeveloperPanel(sessionData.session.user); } catch (error) { console.error('[mirsad system mail]', error); setStatus('تعذر تحميل بريد النظام حاليًا.'); }
  }
  window.addEventListener('mirsad:authenticated', boot, { once: true });
  window.setTimeout(boot, 1200);
})();
