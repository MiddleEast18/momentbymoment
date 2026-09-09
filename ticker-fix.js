(() => {
  'use strict';

  const track = document.getElementById('tickerTrack');
  if (!track) return;

  const SPEED = 42;
  const GAP = 48;
  const PADDING = 24;
  const GROUP_CLASS = 'ticker-loop-group';
  const INNER_CLASS = 'ticker-loop-inner';

  let raf = 0;
  let observer = null;
  let syncFrame = 0;
  let resizeFrame = 0;
  let cycleWidth = 0;
  let distance = 0;
  let lastTime = performance.now();
  let sourceSignature = '';
  let rebuilding = false;

  const getSourceItems = () => [...track.children]
    .filter((el) => el.classList?.contains('ticker-strip__item'));

  const getSignature = (items) => items.map((el) => el.textContent || '').join('\u0001');

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const apply = () => {
    const inner = track.querySelector(`.${INNER_CLASS}`);
    if (!inner || cycleWidth <= 0) return;
    inner.style.transform = `translate3d(${-distance}px,0,0)`;
  };

  const animate = (now) => {
    const delta = Math.min(100, Math.max(0, now - lastTime));
    lastTime = now;

    if (cycleWidth > 0) {
      distance += (delta / 1000) * SPEED;
      if (distance >= cycleWidth) distance %= cycleWidth;
      apply();
    }

    raf = requestAnimationFrame(animate);
  };

  const start = () => {
    stop();
    lastTime = performance.now();
    raf = requestAnimationFrame(animate);
  };

  const measure = (inner) => {
    const groups = inner.querySelectorAll(`.${GROUP_CLASS}`);
    if (groups.length < 2) return 0;
    const a = groups[0].getBoundingClientRect();
    const b = groups[1].getBoundingClientRect();
    return Math.max(0, b.left - a.left);
  };

  const createGroup = (items) => {
    const group = document.createElement('div');
    group.className = GROUP_CLASS;
    group.style.cssText = [
      'display:flex',
      'align-items:center',
      `gap:${GAP}px`,
      'width:max-content',
      'flex:0 0 auto',
      'direction:rtl',
      `padding:10px ${PADDING}px`,
      'white-space:nowrap',
    ].join(';');

    items.forEach((item) => {
      const clone = item.cloneNode(true);
      clone.style.direction = 'rtl';
      group.appendChild(clone);
    });

    return group;
  };

  const rebuild = (items, preserveProgress) => {
    if (rebuilding || !items.length) return;
    rebuilding = true;

    if (observer) observer.disconnect();
    stop();

    const previousWidth = cycleWidth;
    const previousProgress = previousWidth > 0
      ? distance / previousWidth
      : 0;

    const inner = document.createElement('div');
    inner.className = INNER_CLASS;
    inner.style.cssText = [
      'display:flex',
      'width:max-content',
      `gap:${GAP}px`,
      'direction:ltr',
      'will-change:transform',
    ].join(';');

    // Two identical groups are the actual loop. The end of group 1 is
    // followed by the beginning of group 2, so resetting from -cycleWidth to
    // 0 is visually identical and cannot create a blank interval.
    inner.appendChild(createGroup(items));
    inner.appendChild(createGroup(items));

    track.style.animation = 'none';
    track.style.padding = '0';
    track.style.gap = '0';
    track.style.width = 'max-content';
    track.style.direction = 'ltr';
    track.replaceChildren(inner);

    cycleWidth = measure(inner);
    distance = preserveProgress && cycleWidth > 0
      ? (previousProgress % 1) * cycleWidth
      : 0;

    apply();
    rebuilding = false;

    if (observer) observer.observe(track, { childList: true });
    start();
  };

  const sync = () => {
    syncFrame = 0;
    if (rebuilding) return;

    const items = getSourceItems();
    if (!items.length) return;

    const nextSignature = getSignature(items);
    if (nextSignature === sourceSignature && track.querySelector(`.${INNER_CLASS}`)) return;

    sourceSignature = nextSignature;
    rebuild(items, Boolean(track.querySelector(`.${INNER_CLASS}`)));
  };

  observer = new MutationObserver(() => {
    // App.js rebuilds the ticker with several DOM mutations in one render.
    // Debounce them so we rebuild once, only after the complete item set exists.
    if (syncFrame) cancelAnimationFrame(syncFrame);
    syncFrame = requestAnimationFrame(sync);
  });

  const boot = getSourceItems();
  sourceSignature = getSignature(boot);
  if (boot.length) rebuild(boot, false);
  observer.observe(track, { childList: true });

  window.addEventListener('resize', () => {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      const inner = track.querySelector(`.${INNER_CLASS}`);
      if (!inner) return;
      const oldWidth = cycleWidth;
      const progress = oldWidth > 0 ? distance / oldWidth : 0;
      cycleWidth = measure(inner);
      distance = cycleWidth > 0 ? progress * cycleWidth : 0;
      apply();
      lastTime = performance.now();
    });
  });
})();
