const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadEngine(stored) {
  const store = new Map();
  if (stored != null) store.set('mirsad.readerSettings.v1', stored);
  const attrs = {};
  const listeners = {};
  const context = {
    document: {
      documentElement: {
        setAttribute(name, value) { attrs[name] = String(value); },
        removeAttribute(name) { delete attrs[name]; },
        getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; }
      },
      addEventListener() {}
    },
    localStorage: {
      getItem(key) { return store.has(key) ? store.get(key) : null; },
      setItem(key, value) { store.set(key, String(value)); }
    },
    window: null,
    matchMedia() { return { matches: false }; }
  };
  context.window = context;
  context.window.addEventListener = (name, fn) => {
    (listeners[name] ||= []).push(fn);
  };
  context.window.dispatchEvent = (event) => {
    (listeners[event.type] || []).forEach((fn) => fn(event));
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'reader-settings.js'), 'utf8'), context);
  return { RS: context.window.MirsadReaderSettings, attrs, store, listeners };
}

test('partial import merges onto the current preset and ignores account keys', () => {
  const night = { preset: 'night', scale: 100, leading: 'roomy', track: 'off', lines: 3, font: 'kufi', density: 'regular', width: 'board', chrome: 'quiet', radius: 'round', touch: 'regular', badges: 'show', contrast: 'standard', gold: 'soft', motion: 'reduce' };
  const { RS } = loadEngine(JSON.stringify(night));
  const current = RS.read();
  const result = RS.merge(current, { scale: 110, unlock_balance: 999, preferences: { theme: 'hack' } });
  assert.equal(result.ok, true);
  assert.equal(result.value.scale, 110);
  assert.equal(result.value.font, 'kufi');
  assert.equal(result.value.motion, 'reduce');
  assert.equal(result.value.gold, 'soft');
  assert.equal(result.value.preset, 'custom');
  assert.equal('unlock_balance' in result.value, false);
});

test('a named preset file replaces the bundle, and a bad value does not wipe the rest', () => {
  const { RS } = loadEngine(null);
  const onlyPreset = RS.merge(RS.read(), { preset: 'calm' });
  assert.equal(onlyPreset.ok, true);
  assert.equal(onlyPreset.value.preset, 'calm');
  assert.equal(onlyPreset.value.badges, 'hide');

  const wrapped = RS.merge(onlyPreset.value, RS.transport({ ...onlyPreset.value, scale: 125 }));
  assert.equal(wrapped.ok, true);
  assert.equal(wrapped.value.scale, 125);
  assert.equal(wrapped.value.badges, 'hide');

  const rejected = RS.merge(onlyPreset.value, { scale: 80, font: 'comic' });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.value.font, 'kufi');
  assert.equal(rejected.value.badges, 'hide');
  assert.equal(rejected.value.preset, 'calm');
});

test('scale and contrast locks change what is shown without erasing the stored choice', () => {
  const { RS, attrs } = loadEngine(null);
  const held = RS.write({ scale: 120, density: 'compact', contrast: 'high', gold: 'soft' });
  assert.equal(held.density, 'compact');
  assert.equal(held.gold, 'soft');
  const view = RS.effective(held);
  assert.equal(view.density, 'relaxed');
  assert.equal(view.gold, 'standard');
  assert.equal(attrs['data-rs-density'], 'relaxed');
  assert.equal(attrs['data-rs-gold'], undefined);
  assert.equal(RS.locks(held).length, 2);
  assert.equal(RS.links(RS.write(RS.presets.marsad)).some((note) => note.startsWith('لا قيد نشط')), true);
});

test('system motion follows the device and full motion does not', () => {
  const ticker = fs.readFileSync(path.join(root, 'ticker-fix.js'), 'utf8');
  const settings = fs.readFileSync(path.join(root, 'settings.html'), 'utf8');
  assert.match(ticker, /motion === 'reduce'/);
  assert.match(ticker, /motion === 'full'/);
  assert.match(ticker, /prefers-reduced-motion: reduce/);
  assert.match(ticker, /mirsad-reader-settings-sync/);
  assert.match(settings, /RS\.merge\(state, parsed\)/);
  assert.match(settings, /RS\.transport\(state\)/);
  assert.match(settings, /RS\.locks\(state\)/);
  assert.match(settings, /setTimeout\(function \(\) \{ URL\.revokeObjectURL\(url\); \}, 1500\)/);
  assert.match(settings, /-webkit-line-clamp: 3/);
});
