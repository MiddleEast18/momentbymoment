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
  let sourceItems = [];

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const getSourceItems = () => {
    const inner = track.querySelector(`.${INNER_CLASS}`);
    if (inner) return sourceItems;
    return [...track.children].filter((el) => el.classList?.contains('ticker-strip__item'));
  };

  const signatureOf = (items) => items.map((el) => el.textContent || '').join('\u0001');

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

    for (const item of items) {
      const clone = item.cloneNode(true);
      clone.style.direction = 'rtl';
      clone.style.flex = '0 0 auto';
      group.appendChild(clone);
    }
    return group;
  };

  const measure = (inner) => {
    const groups = inner.querySelectorAll(`.${GROUP_CLASS}`);
    if (groups.length < 2) return 0;
    const first = groups[0].getBoundingClientRect();
    const second = groups[1].getBoundingClientRect();
    return Math.abs(second.left - first.left);
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
      if (distance >= cycleWidth) distance -= cycleWidth;
      apply();
    }
    raf = requestAnimationFrame(animate);
  };

  const start = () => {
    stop();
    lastTime = performance.now();
    raf = requestAnimationFrame(animate);
  };

  const rebuild = (items, preserveProgress) => {
    if (!items.length || rebuilding) return;
    rebuilding = true;
    if (observer) observer.disconnect();
    stop();

    const previousWidth = cycleWidth;
    const previousProgress = preserveProgress && previousWidth > 0
      ? (distance % previousWidth) / previousWidth
      : 0;

    const inner = document.createElement('div');
    inner.className = INNER_CLASS;
    inner.style.cssText = [
      'display:flex',
      'width:max-content',
      'gap:0',
      'direction:ltr',
      'will-change:transform',
      'transform:translate3d(0,0,0)',
    ].join(';');

    inner.appendChild(createGroup(items));
    inner.appendChild(createGroup(items));

    track.style.animation = 'none';
    track.style.padding = '0';
    track.style.margin = '0';
    track.style.gap = '0';
    track.style.width = 'max-content';
    track.style.direction = 'ltr';
    track.style.overflow = 'visible';
    track.replaceChildren(inner);

    cycleWidth = measure(inner);
    distance = preserveProgress && cycleWidth > 0 ? previousProgress * cycleWidth : 0;
    apply();

    sourceItems = items.map((item) => item.cloneNode(true));
    sourceSignature = signatureOf(sourceItems);
    rebuilding = false;

    if (observer) observer.observe(track, { childList: true, subtree: false });
    start();
  };

  const sync = () => {
    syncFrame = 0;
    if (rebuilding) return;

    const items = getSourceItems();
    if (!items.length) return;

    const nextSignature = signatureOf(items);
    const hasLoop = Boolean(track.querySelector(`.${INNER_CLASS}`));
    if (hasLoop && nextSignature === sourceSignature) return;

    const preserve = hasLoop;
    const nextItems = items.map((item) => item.cloneNode(true));
    rebuild(nextItems, preserve);
  };

  observer = new MutationObserver(() => {
    if (syncFrame) cancelAnimationFrame(syncFrame);
    syncFrame = requestAnimationFrame(sync);
  });

  const bootItems = [...track.children].filter((el) => el.classList?.contains('ticker-strip__item'));
  if (bootItems.length) rebuild(bootItems, false);
  observer.observe(track, { childList: true, subtree: false });

  window.addEventListener('resize', () => {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      const inner = track.querySelector(`.${INNER_CLASS}`);
      if (!inner) return;
      const oldWidth = cycleWidth;
      const progress = oldWidth > 0 ? (distance % oldWidth) / oldWidth : 0;
      cycleWidth = measure(inner);
      distance = cycleWidth > 0 ? progress * cycleWidth : 0;
      apply();
      lastTime = performance.now();
    });
  });
})();
