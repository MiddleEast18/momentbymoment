const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'archive.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'archive-chat-20261015-v23.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'archive-chat-20261015-v16.css'), 'utf8');

test('the history control sits beneath the live link and opens an accessible closable dialog', () => {
  assert.match(html, /archive-header__left[\s\S]*?archive-back[\s\S]*?archiveHistoryToggle/);
  assert.match(html, /<dialog class="archive-history-dialog" id="archiveHistoryDialog"/);
  assert.match(html, /archiveHistoryClose/);
  assert.match(html, /archiveHistoryList/);
  assert.match(js, /archiveHistoryToggle[\s\S]*?historyDialog\.showModal\(\)/);
  assert.match(js, /archiveHistoryClose[\s\S]*?historyDialog\?\.close\(\)/);
});

test('the account archive opens a new chat, while saved chats remain independently selectable and newest-first', () => {
  assert.match(html, /archive-chat-20261015-v23\.js/);
  assert.match(html, /archive-chat-20261015-v16\.css/);
  assert.match(js, /function startNewConversation\(\)/);
  assert.match(js, /function openSavedChat\(chatId\)/);
  assert.match(js, /localStorage\.setItem\(storeKey/);
  assert.match(js, /\.sort\(\(a, b\) => Number\(b\.updatedAt \|\| 0\) - Number\(a\.updatedAt \|\| 0\)\)/);
  assert.match(js, /archiveHistoryNew[\s\S]*?startNewConversation\(\)/);
});

test('the clear-chat action is centered in the header and removes only the active chat record', () => {
  assert.match(css, /\.archive-clear\s*\{[^}]*left:\s*50%[^}]*transform:\s*translate\(-50%,\s*-50%\)/);
  assert.match(js, /chats = chats\.filter\(\(chat\) => chat\.id !== activeChatId\)/);
  assert.match(html, /لن تتأثر الدردشات الأخرى/);
});
