const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'archive.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'archive-chat-20261015-v16.css'), 'utf8');
const sharedSettings = fs.readFileSync(path.join(root, 'reader-settings.js'), 'utf8');

test('archive loads the shared local reading settings engine and stylesheet', () => {
  assert.match(html, /reader-settings\.css\?v=202610050820/);
  assert.match(html, /reader-settings\.js\?v=202610050820/);
  assert.match(html, /archive-chat-20261015-v16\.css/);
  assert.match(sharedSettings, /localStorage\.getItem\(KEY\)/);
  assert.match(sharedSettings, /mirsad-reader-settings-sync/);
});

test('archive preferences affect archive components without adding rules to shared settings files', () => {
  assert.match(css, /html\[data-rs-font="kufi"\] \.archive-chat-page/);
  assert.match(css, /html\[data-rs-scale\] \.archive-message__text/);
  assert.match(css, /html\[data-rs-density="compact"\] \.archive-composer/);
  assert.match(css, /html\[data-rs-width="narrow"\] \.archive-main/);
  assert.match(css, /html\[data-rs-radius="round"\] \.archive-history__item/);
  assert.match(css, /html\[data-rs-touch="large"\] \.archive-send/);
  assert.match(css, /html\[data-rs-motion="reduce"\] \.archive-message/);
});
