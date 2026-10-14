const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'archive.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'archive-chat-20261014-v9.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'archive-chat-20261014-v9.css'), 'utf8');

test('archive welcome replaces the fixed suggestion list with the radar mark', () => {
  assert.match(html, /archive-welcome__radar/);
  assert.match(html, /archive-welcome__sweep/);
  assert.match(html, /اسأل مرصاد عمّا نُشر في الأرشيف/);
  assert.doesNotMatch(html, /class="archive-suggestions"/);
  assert.doesNotMatch(html, /class="archive-suggestion"/);
});

test('example button fills an editable query but does not submit it', () => {
  assert.match(html, /id="archiveExample"/);
  assert.match(js, /getElementById\('archiveExample'\)\?\.addEventListener\('click'/);
  assert.match(js, /input\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(js, /querySelectorAll\('\.archive-suggestion'\)/);
});

test('radar motion is subtle, mobile-sized, and disabled for reduced-motion preference', () => {
  assert.match(css, /archive-radar-rotate 8s linear infinite/);
  assert.match(css, /archive-radar-pulse 2\.4s ease-out infinite/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?archive-welcome__sweep[\s\S]*?animation: none/);
});
