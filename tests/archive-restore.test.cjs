const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'archive.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'archive-chat-20261015-v21.js'), 'utf8');

test('an interrupted saved archive question is resumed after restoration', () => {
  assert.match(html, /archive-chat-20261015-v21\.js/);
  assert.match(js, /function resumeInterruptedRequest\(\)/);
  assert.match(js, /const retry = state\.retryRequest;/);
  assert.match(js, /void submitQuestion\(retry\.query, retry\.taskType \|\| null\)/);
  assert.match(js, /function restoreChat\(chat\)/);
  assert.match(js, /renderChatHistory\(\);\s*resumeInterruptedRequest\(\);/);
});

test('the resumed request reuses its saved id so the charge is not duplicated', () => {
  assert.match(js, /const requestId = state\.retryRequest\?\.query === query \? state\.retryRequest\.id : newRequestId\(\);/);
  assert.match(js, /Reuse the saved request ID[\s\S]*idempotent/);
});

test('archive chat persistence is namespaced by account and reset on auth changes', () => {
  assert.match(js, /archiveChatStorageKey\(userId\)/);
  assert.match(js, /localStorage\.setItem\(storeKey/);
  assert.match(js, /localStorage\.getItem\(storeKey/);
  assert.match(js, /event === 'SIGNED_OUT'\) activateAccount\(null, true\)/);
  assert.match(js, /event === 'SIGNED_IN'\) activateAccount\(session\?\.user\?\.id \|\| null\)/);
  assert.match(js, /async function refreshArchiveSession\(\)[\s\S]*?supabase\.auth\.getSession\(\)[\s\S]*?observedEpoch !== contextEpoch/);
  assert.match(js, /archiveHistoryToggle[\s\S]*?void refreshArchiveSession\(\)/);
  assert.match(js, /void refreshArchiveSession\(\);\s*void refreshAccess\(\);/);
  assert.match(js, /requestEpoch !== contextEpoch/);
});

test('entering the archive starts a fresh chat while old chats are stored and sorted independently', () => {
  assert.match(js, /function startNewConversation\(\)/);
  assert.match(js, /function loadChatList\(\)/);
  assert.match(js, /localStorage\.setItem\(storeKey/);
  assert.match(js, /MAX_SAVED_CHATS = 50/);
  assert.match(js, /\.sort\(\(a, b\) => Number\(b\.updatedAt \|\| 0\) - Number\(a\.updatedAt \|\| 0\)\)/);
  assert.match(js, /event === 'INITIAL_SESSION'\) activateAccount\(session\?\.user\?\.id \|\| null, true\)/);
});
