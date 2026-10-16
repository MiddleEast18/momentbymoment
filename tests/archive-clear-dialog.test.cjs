const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'archive.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'archive-chat-20261015-v22.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'archive-chat-20261015-v15.css'), 'utf8');

test('archive clear uses an accessible Mirsad-branded dialog instead of a browser alert', () => {
  assert.match(html, /<dialog[^>]+id="archiveClearDialog"/);
  assert.match(html, /aria-labelledby="archiveClearTitle"/);
  assert.match(html, /aria-describedby="archiveClearDescription"/);
  assert.match(html, /مسح محادثة الأرشيف\؟/);
  assert.match(html, /إبقاء المحادثة/);
  assert.match(html, /archive-chat-20261015-v15\.css/);
  assert.doesNotMatch(js, /window\.confirm\(/);
  assert.match(js, /returnValue === 'clear'/);
  assert.match(html, /لا يغيّر رصيد الفتحات ولا يمسّ سجل الخصم/);
});

test('clearing is blocked until every unresolved charge request is safely retried', () => {
  assert.match(js, /hasUnsettledRequest\(state\.retryRequest\)/);
  assert.match(js, /أكمل أو أعد محاولة الرد غير المحسوم أولًا/);
  assert.match(js, /isValidChatChargeReceipt\(payload\)/);
  assert.match(js, /احتُفظ بالطلب لإعادة التحقق دون إنشاء خصم جديد/);
  assert.match(js, /const previousChats = chats;[\s\S]*?if \(storeKey && !saveChatList\(\)\)[\s\S]*?chats = previousChats;[\s\S]*?تعذر حفظ حذف المحادثة/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
