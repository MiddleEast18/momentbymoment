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
  let syncFrame = 0;
  let resizeFrame = 0;
  let observer = null;
  let rebuilding = false;
  let currentSignature = '';

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const signature = (items) => items.map((el) => (el.textContent || '').trim()).join('\u0001');

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
      clone.classList.add('mirsad-ticker-item');
      clone.style.cssText += ';flex:0 0 auto;direction:rtl;';
      group.appendChild(clone);
    }
    return group;
  };

  const apply = () => {
    const rail = track.firstElementChild;
    if (rail && cycleWidth > 0) {
      // Move continuously to the left; the identical group is already waiting on the right.
      rail.style.transform = `translate3d(${-x}px,0,0)`;
    }
  };

  const tick = (now) => {
    const dt = Math.min(100, Math.max(0, now - last));
    last = now;

    if (cycleWidth > 0) {
      x += (dt / 1000) * SPEED;
      if (x >= cycleWidth) x %= cycleWidth;
      apply();
    }

    raf = requestAnimationFrame(tick);
  };

  const start = () => {
    stop();
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  const rebuild = (items, preserveProgress = false) => {
    if (!items.length || rebuilding) return;
    rebuilding = true;
    if (observer) observer.disconnect();
    stop();

    const oldWidth = cycleWidth;
    const progress = preserveProgress && oldWidth > 0 ? (x % oldWidth) / oldWidth : 0;

    track.style.setProperty('animation', 'none', 'important');
    track.style.setProperty('transform', 'none', 'important');
    track.style.setProperty('direction', 'ltr', 'important');
    track.style.setProperty('display', 'block', 'important');
    track.style.setProperty('width', 'auto', 'important');
    track.style.setProperty('min-width', '0', 'important');
    track.style.setProperty('overflow', 'hidden', 'important');
    track.style.setProperty('padding', '0', 'important');
    track.style.setProperty('margin', '0', 'important');
    track.style.setProperty('flex', '1 1 auto', 'important');

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

    // First group establishes the exact loop distance. There is intentionally NO gap
    // between groups, so the second copy starts exactly where the first copy ends.
    const firstGroup = buildGroup(items);
    rail.appendChild(firstGroup);
    track.replaceChildren(rail);

    cycleWidth = firstGroup.getBoundingClientRect().width;

    // Repeat enough identical groups to cover the entire visible viewport, even when
    // there is only one short headline. This prevents the ticker from ever becoming blank.
    const viewportWidth = Math.max(track.clientWidth, window.innerWidth, 1);
    const requiredWidth = viewportWidth + cycleWidth * 2;
    let guard = 0;
    while (rail.scrollWidth < requiredWidth && guard < 32) {
      rail.appendChild(buildGroup(items));
      guard += 1;
    }

    x = preserveProgress && cycleWidth > 0 ? progress * cycleWidth : 0;
    apply();
    currentSignature = signature(items);
    rebuilding = false;

    if (observer) observer.observe(track, { childList: true, subtree: false });
    start();
  };

  const sync = () => {
    syncFrame = 0;
    if (rebuilding) return;

    // app.js replaces tickerTrack contents when news changes. Always read the fresh
    // direct children before the rail is rebuilt, never the old cloned rail.
    const directItems = [...track.children].filter((el) => el.classList?.contains('ticker-strip__item'));
    if (!directItems.length) return;

    const nextSignature = signature(directItems);
    if (nextSignature === currentSignature && track.firstElementChild?.classList?.contains('mirsad-ticker-rail')) return;

    rebuild(directItems, Boolean(currentSignature));
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
      const firstGroup = rail?.firstElementChild;
      if (!rail || !firstGroup) return;

      const oldWidth = cycleWidth;
      const progress = oldWidth > 0 ? (x % oldWidth) / oldWidth : 0;
      cycleWidth = firstGroup.getBoundingClientRect().width;
      x = cycleWidth > 0 ? progress * cycleWidth : 0;
      apply();
      last = performance.now();
    });
  });
})();
