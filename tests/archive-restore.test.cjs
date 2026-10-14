const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'archive.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'archive-chat-20261015-v18.js'), 'utf8');

test('an interrupted saved archive question is resumed after restoration', () => {
  assert.match(html, /archive-chat-20261015-v18\.js/);
  assert.match(js, /function resumeInterruptedRequest\(\)/);
  assert.match(js, /const retry = state\.retryRequest;/);
  assert.match(js, /void submitQuestion\(retry\.query, retry\.taskType \|\| null\)/);
  assert.match(js, /restore\(\);\s*resumeInterruptedRequest\(\);/);
});

test('the resumed request reuses its saved id so the charge is not duplicated', () => {
  assert.match(js, /const requestId = state\.retryRequest\?\.query === query \? state\.retryRequest\.id : newRequestId\(\);/);
  assert.match(js, /Reuse the saved request ID[\s\S]*idempotent/);
});
