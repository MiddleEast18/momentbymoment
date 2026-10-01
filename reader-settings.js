(() => {
  'use strict';
  var KEY = 'mirsad.readerSettings.v1';
  var defaults = {
    preset: 'marsad',
    scale: 100,
    leading: 'normal',
    track: 'off',
    lines: 3,
    font: 'plex',
    density: 'regular',
    width: 'board',
    chrome: 'full',
    radius: 'soft',
    touch: 'regular',
    badges: 'show',
    contrast: 'standard',
    gold: 'standard',
    motion: 'system'
  };
  var presets = {
    marsad: { preset: 'marsad', scale: 100, leading: 'normal', track: 'off', lines: 3, font: 'plex', density: 'regular', width: 'board', chrome: 'full', radius: 'soft', touch: 'regular', badges: 'show', contrast: 'standard', gold: 'standard', motion: 'system' },
    night: { preset: 'night', scale: 100, leading: 'roomy', track: 'off', lines: 3, font: 'kufi', density: 'regular', width: 'board', chrome: 'quiet', radius: 'round', touch: 'regular', badges: 'show', contrast: 'standard', gold: 'soft', motion: 'reduce' },
    focus: { preset: 'focus', scale: 105, leading: 'normal', track: 'off', lines: 4, font: 'plex', density: 'relaxed', width: 'narrow', chrome: 'quiet', radius: 'soft', touch: 'regular', badges: 'show', contrast: 'standard', gold: 'standard', motion: 'system' },
    large: { preset: 'large', scale: 120, leading: 'roomy', track: 'off', lines: 4, font: 'kufi', density: 'relaxed', width: 'board', chrome: 'full', radius: 'round', touch: 'large', badges: 'show', contrast: 'high', gold: 'standard', motion: 'system' },
    calm: { preset: 'calm', scale: 100, leading: 'roomy', track: 'wide', lines: 3, font: 'kufi', density: 'relaxed', width: 'narrow', chrome: 'quiet', radius: 'round', touch: 'regular', badges: 'hide', contrast: 'standard', gold: 'soft', motion: 'reduce' }
  };
  var scales = [90, 95, 100, 105, 110, 115, 120, 125];
  function pick(raw) {
    var next = Object.assign({}, defaults);
    if (!raw || typeof raw !== 'object') return next;
    Object.keys(defaults).forEach(function (key) {
      if (raw[key] != null) next[key] = raw[key];
    });
    return next;
  }
  function normalize(raw) {
    var next = pick(raw);
    next.scale = scales.indexOf(Number(next.scale)) >= 0 ? Number(next.scale) : 100;
    next.leading = ['tight', 'normal', 'roomy'].indexOf(next.leading) >= 0 ? next.leading : 'normal';
    next.track = next.track === 'wide' ? 'wide' : 'off';
    next.lines = [2, 3, 4].indexOf(Number(next.lines)) >= 0 ? Number(next.lines) : 3;
    next.font = next.font === 'kufi' ? 'kufi' : 'plex';
    next.density = ['compact', 'regular', 'relaxed'].indexOf(next.density) >= 0 ? next.density : 'regular';
    next.width = next.width === 'narrow' ? 'narrow' : 'board';
    next.chrome = next.chrome === 'quiet' ? 'quiet' : 'full';
    next.radius = ['sharp', 'soft', 'round'].indexOf(next.radius) >= 0 ? next.radius : 'soft';
    next.touch = next.touch === 'large' ? 'large' : 'regular';
    next.badges = next.badges === 'hide' ? 'hide' : 'show';
    next.contrast = next.contrast === 'high' ? 'high' : 'standard';
    next.gold = next.gold === 'soft' ? 'soft' : 'standard';
    next.motion = ['system', 'reduce', 'full'].indexOf(next.motion) >= 0 ? next.motion : 'system';
    if (next.scale >= 120 && next.density === 'compact') next.density = 'relaxed';
    if (next.contrast === 'high') next.gold = 'standard';
    return next;
  }
  function signature(value) {
    return ['scale', 'leading', 'track', 'lines', 'font', 'density', 'width', 'chrome', 'radius', 'touch', 'badges', 'contrast', 'gold', 'motion'].map(function (key) { return value[key]; }).join('|');
  }
  function matchPreset(value) {
    var current = signature(value);
    var name = 'custom';
    Object.keys(presets).forEach(function (key) {
      if (signature(presets[key]) === current) name = key;
    });
    value.preset = name;
    return value;
  }
  function read() {
    try {
      return matchPreset(normalize(JSON.parse(localStorage.getItem(KEY) || 'null')));
    } catch (error) {
      return matchPreset(normalize(defaults));
    }
  }
  function write(raw) {
    var next = matchPreset(normalize(raw));
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (error) {}
    apply(next);
    return next;
  }
  function attr(name, value, skip) {
    if (value == null || value === skip) document.documentElement.removeAttribute(name);
    else document.documentElement.setAttribute(name, String(value));
  }
  function apply(raw) {
    var next = normalize(raw);
    attr('data-rs-scale', next.scale, 100);
    attr('data-rs-leading', next.leading, 'normal');
    attr('data-rs-track', next.track, 'off');
    attr('data-rs-lines', next.lines, 3);
    attr('data-rs-font', next.font, 'plex');
    attr('data-rs-density', next.density, 'regular');
    attr('data-rs-width', next.width, 'board');
    attr('data-rs-chrome', next.chrome, 'full');
    attr('data-rs-radius', next.radius, 'soft');
    attr('data-rs-touch', next.touch, 'regular');
    attr('data-rs-badges', next.badges, 'show');
    attr('data-rs-contrast', next.contrast, 'standard');
    attr('data-rs-gold', next.gold, 'standard');
    attr('data-rs-motion', next.motion, 'system');
  }
  function links(raw) {
    var next = normalize(raw);
    var notes = [];
    if (next.scale >= 120) notes.push('التكبير ' + next.scale + ' يمنع الكثافة المضغوطة، لأن الخط الكبير مع البطاقات الضيقة يقص العنوان. الكثافة تبقى مريحة أو عادية.');
    if (next.contrast === 'high') notes.push('التباين العالي يثبت اللون الذهبي على درجته الأصلية حتى تبقى الحدود والأزرار واضحة.');
    if (next.motion === 'reduce' && next.chrome === 'quiet') notes.push('تقليل الحركة مع اللوحة الهادئة يوقف النبض ويخفي شريط المؤشرات، ويُبقي الأخبار كما هي.');
    if (next.font === 'kufi' && next.track === 'wide') notes.push('الخط الكوفي مع التباعد الواسع يبطئ المسح ويناسب القراءة المتأنية لا تصفح العناوين السريع.');
    if (next.lines === 2 && next.density === 'compact') notes.push('سطران مع كثافة مضغوطة وضع مسح سريع: سياق العنوان أقل، واللوحة تعرض عدداً أكبر في الشاشة.');
    if (next.width === 'narrow' && next.chrome === 'quiet') notes.push('عرض القراءة مع إخفاء المؤشرات يركّز العين على البطاقات دون أرقام اللوحة.');
    if (next.badges === 'hide') notes.push('إخفاء الشارات يخفي علامة التحديث وعلامة المراجعة عن العين فقط، ولا يغيّر حالة الخبر.');
    if (!notes.length) notes.push('الإعدادات الحالية متوافقة، ولا يوجد قيد يغيّر اختياراً آخر.');
    return notes;
  }
  apply(read());
  window.MirsadReaderSettings = { KEY: KEY, defaults: defaults, presets: presets, scales: scales, read: read, write: write, normalize: normalize, apply: apply, links: links };
})();
