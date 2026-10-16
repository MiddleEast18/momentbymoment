const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'archive.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'archive-chat-20261015-v17.css'), 'utf8');

test('archive navigation controls and memory kicker use branded inline SVG icons', () => {
  assert.match(html, /archive-back__icon[\s\S]*?<svg[^>]*viewBox="0 0 24 24"/);
  assert.match(html, /archive-history-toggle__icon[\s\S]*?<svg[^>]*viewBox="0 0 24 24"/);
  assert.match(html, /archive-history-toggle__chevron[\s\S]*?<svg/);
  assert.match(html, /archive-kicker__brain[\s\S]*?<svg[^>]*viewBox="0 0 28 26"/);
  assert.doesNotMatch(html, /archive-kicker__dot/);
  assert.match(css, /archive-history-toggle:hover[\s\S]*?box-shadow/);
  assert.match(css, /archive-kicker__brain-fold/);
});
