const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'archive.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'archive-chat-20261015-v23.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'archive-chat-20261015-v16.css'), 'utf8');

test('the pending indicator stays animated and reports elapsed time after the five stage sequence', () => {
  assert.match(html, /archive-chat-20261015-v23\.js/);
  assert.match(html, /archive-chat-20261015-v16\.css/);
  assert.match(html, /reader-settings\.js\?v=202610050820/);
  assert.match(js, /className = 'archive-pending__elapsed'/);
  assert.match(js, /setInterval\(\(\) => \{[\s\S]*?elapsed\.textContent/);
  assert.match(js, /if \(step >= steps\.length - 1\) return;/);
  assert.match(js, /clearInterval\(timer\); clearInterval\(elapsedTimer\)/);
  assert.match(css, /\.archive-pending__elapsed/);
});

test('a stalled archive request fails with a recoverable same-request retry rather than spinning indefinitely', () => {
  assert.match(js, /AbortSignal\.timeout\(100000\)/);
  assert.match(js, /أعد المحاولة بالسؤال نفسه/);
  assert.match(js, /لتجنب تكرار الخصم/);
});
