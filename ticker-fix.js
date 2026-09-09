(() => {
  'use strict';

  const track = document.getElementById('tickerTrack');
  if (!track) return;

  const SPEED = 42;
  let raf = 0;
  let last = performance.now();
  let position = 0;
  let cycleWidth = 0;
  let sourceSignature = '';
  let rebuilding = false;
  let resizeFrame = 0;
  let syncFrame = 0;
  let observer = null;
  let sourceNodes = [];

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const getSignature = (nodes) => nodes.map((n) => n.textContent || '').join('\u0001');

  const makeSequence = (nodes) => {
    const seq = document.createElement('div');
    seq.className = 'mirsad-ticker-sequence';
    seq.dir = 'rtl';
    Object.assign(seq.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '48px',
      width: 'max-content',
      flex: '0 0 auto',
      padding: '10px 24px',
      whiteSpace: 'nowrap',
    });
    for (const node of nodes) {
      const clone = node.cloneNode(true);
      clone.style.flex = '0 0 auto';
      clone.style.direction = 'rtl';
      seq.appendChild(clone);
    }
    return seq;
  };

  const render = (nodes, preserve) => {
    if (rebuilding || !nodes.length) return;
    rebuilding = true;
    if (observer) observer.disconnect();
    stop();

    const oldWidth = cycleWidth;
    const oldProgress = oldWidth > 0 ? (position % oldWidth) / oldWidth : 0;

    const viewport = document.createElement('div');
    viewport.className = 'mirsad-ticker-viewport';
    Object.assign(viewport.style, {
      display: 'flex',
      width: 'max-content',
      gap: '0',
      direction: 'ltr',
      willChange: 'transform',
      transform: 'translate3d(0,0,0)',
    });

    viewport.appendChild(makeSequence(nodes));
    viewport.appendChild(makeSequence(nodes));

    track.style.setProperty('animation', 'none', 'important');
    track.style.setProperty('transform', 'none', 'important');
    track.style.display = 'flex';
    track.style.width = 'max-content';
    track.style.padding = '0';
    track.style.gap = '0';
    track.style.direction = 'ltr';
    track.replaceChildren(viewport);

    const groups = [...viewport.children];
    cycleWidth = groups.length === 2
      ? Math.abs(groups[1].getBoundingClientRect().left - groups[0].getBoundingClientRect().left)
      : 0;

    position = preserve && cycleWidth > 0 ? oldProgress * cycleWidth : 0;
    viewport.style.transform = `translate3d(${-position}px,0,0)`;

    sourceNodes = nodes.map((n) => n.cloneNode(true));
    sourceSignature = getSignature(sourceNodes);
    rebuilding = false;

    if (observer) observer.observe(track, { childList: true, subtree: false });
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  const tick = (now) => {
    const dt = Math.min(100, Math.max(0, now - last));
    last = now;
    const viewport = track.firstElementChild;
    if (viewport && cycleWidth > 0) {
      position += dt / 1000 * SPEED;
      if (position >= cycleWidth) position -= cycleWidth;
      viewport.style.transform = `translate3d(${-position}px,0,0)`;
    }
    raf = requestAnimationFrame(tick);
  };

  const sync = () => {
    syncFrame = 0;
    if (rebuilding) return;
    const candidates = track.querySelector('.mirsad-ticker-viewport')
      ? sourceNodes
      : [...track.children].filter((n) => n.classList?.contains('ticker-strip__item'));
    if (!candidates.length) return;
    const signature = getSignature(candidates);
    if (track.querySelector('.mirsad-ticker-viewport') && signature === sourceSignature) return;
    render(candidates, Boolean(track.querySelector('.mirsad-ticker-viewport')));
  };

  observer = new MutationObserver(() => {
    if (syncFrame) cancelAnimationFrame(syncFrame);
    syncFrame = requestAnimationFrame(sync);
  });

  const boot = [...track.children].filter((n) => n.classList?.contains('ticker-strip__item'));
  if (boot.length) render(boot, false);
  observer.observe(track, { childList: true, subtree: false });

  window.addEventListener('resize', () => {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      const viewport = track.querySelector('.mirsad-ticker-viewport');
      if (!viewport) return;
      const oldWidth = cycleWidth;
      const progress = oldWidth > 0 ? (position % oldWidth) / oldWidth : 0;
      const groups = [...viewport.children];
      cycleWidth = groups.length === 2
        ? Math.abs(groups[1].getBoundingClientRect().left - groups[0].getBoundingClientRect().left)
        : 0;
      position = cycleWidth > 0 ? progress * cycleWidth : 0;
      viewport.style.transform = `translate3d(${-position}px,0,0)`;
      last = performance.now();
    });
  });
})();