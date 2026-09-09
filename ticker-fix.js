(() => {
  'use strict';

  const track = document.getElementById('tickerTrack');
  if (!track) return;

  const SPEED = 42;
  const GAP = 48;
  const PAD = 24;
  let raf = 0;
  let last = performance.now();
  let x = 0;
  let cycleWidth = 0;
  let itemsSignature = '';
  let sourceItems = [];
  let syncFrame = 0;
  let resizeFrame = 0;
  let observer = null;
  let rebuilding = false;

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const signature = (items) => items.map((el) => el.textContent || '').join('\u0001');

  const buildGroup = (items) => {
    const group = document.createElement('div');
    group.className = 'mirsad-ticker-group';
    group.dir = 'rtl';
    Object.assign(group.style, {
      display: 'flex',
      flex: '0 0 auto',
      alignItems: 'center',
      width: 'max-content',
      gap: `${GAP}px`,
      padding: `10px ${PAD}px`,
      whiteSpace: 'nowrap',
    });
    for (const item of items) {
      const clone = item.cloneNode(true);
      clone.style.cssText += ';flex:0 0 auto;direction:rtl;';
      group.appendChild(clone);
    }
    return group;
  };

  const apply = () => {
    const rail = track.firstElementChild;
    if (rail && cycleWidth > 0) rail.style.transform = `translate3d(${-x}px,0,0)`;
  };

  const tick = (now) => {
    const dt = Math.min(100, Math.max(0, now - last));
    last = now;
    if (cycleWidth > 0) {
      x += (dt / 1000) * SPEED;
      if (x >= cycleWidth) x -= cycleWidth;
      apply();
    }
    raf = requestAnimationFrame(tick);
  };

  const start = () => {
    stop();
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  const rebuild = (items, preserveProgress) => {
    if (!items.length || rebuilding) return;
    rebuilding = true;
    if (observer) observer.disconnect();
    stop();

    const oldWidth = cycleWidth;
    const progress = preserveProgress && oldWidth > 0 ? (x % oldWidth) / oldWidth : 0;

    const rail = document.createElement('div');
    rail.className = 'mirsad-ticker-rail';
    Object.assign(rail.style, {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      width: 'max-content',
      gap: '0',
      direction: 'ltr',
      willChange: 'transform',
      transform: 'translate3d(0,0,0)',
    });

    rail.appendChild(buildGroup(items));
    rail.appendChild(buildGroup(items));

    track.style.setProperty('animation', 'none', 'important');
    track.style.setProperty('transform', 'none', 'important');
    track.style.setProperty('direction', 'ltr', 'important');
    track.style.setProperty('display', 'block', 'important');
    track.style.setProperty('width', '100%', 'important');
    track.style.setProperty('overflow', 'hidden', 'important');
    track.style.setProperty('padding', '0', 'important');
    track.style.setProperty('margin', '0', 'important');
    track.replaceChildren(rail);

    const groups = [...rail.children];
    cycleWidth = groups.length === 2 ? groups[0].getBoundingClientRect().width + GAP : 0;
    x = preserveProgress && cycleWidth > 0 ? progress * cycleWidth : 0;
    apply();

    sourceItems = items.map((item) => item.cloneNode(true));
    itemsSignature = signature(sourceItems);
    rebuilding = false;

    if (observer) observer.observe(track, { childList: true, subtree: false });
    start();
  };

  const sync = () => {
    syncFrame = 0;
    if (rebuilding) return;

    const rail = track.querySelector('.mirsad-ticker-rail');
    const items = rail
      ? sourceItems
      : [...track.children].filter((el) => el.classList?.contains('ticker-strip__item'));
    if (!items.length) return;

    const next = signature(items);
    if (rail && next === itemsSignature) return;
    rebuild(items.map((item) => item.cloneNode(true)), Boolean(rail));
  };

  observer = new MutationObserver(() => {
    if (syncFrame) cancelAnimationFrame(syncFrame);
    syncFrame = requestAnimationFrame(sync);
  });

  const boot = [...track.children].filter((el) => el.classList?.contains('ticker-strip__item'));
  if (boot.length) rebuild(boot, false);
  observer.observe(track, { childList: true, subtree: false });

  window.addEventListener('resize', () => {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      const rail = track.querySelector('.mirsad-ticker-rail');
      const groups = rail ? [...rail.children] : [];
      if (groups.length !== 2) return;
      const oldWidth = cycleWidth;
      const progress = oldWidth > 0 ? (x % oldWidth) / oldWidth : 0;
      cycleWidth = groups[0].getBoundingClientRect().width + GAP;
      x = cycleWidth > 0 ? progress * cycleWidth : 0;
      apply();
      last = performance.now();
    });
  });
})();