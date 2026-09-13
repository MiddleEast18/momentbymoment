(() => {
  'use strict';

  const track = document.getElementById('tickerTrack');
  if (!track) return;

  const SUPABASE_URL = 'https://dndlkenyfymlrjnslyzb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx';
  const SPEED = 42;
  const GAP = 48;
  const PAD = 24;
  const MAX_ITEMS = 4;
  const POLL_MS = 30 * 1000;

  let raf = 0;
  let pollTimer = 0;
  let last = performance.now();
  let x = 0;
  let cycleWidth = 0;
  let currentItems = [];
  let currentSignature = '';
  let rebuilding = false;
  let syncFrame = 0;
  let resizeFrame = 0;
  let observer = null;

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const normalize = (value) => MirsadText.search(value);

  const signature = (items) => items.map((item) => normalize(item.headline)).join('\u0001');

  const makeItem = (headline) => {
    const span = document.createElement('span');
    span.className = 'ticker-strip__item mirsad-ticker-item';
    span.textContent = headline;
    span.style.cssText = 'flex:0 0 auto;direction:rtl;';
    return span;
  };

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
    for (const item of items) group.appendChild(makeItem(item.headline));
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

  const rebuild = (items, preserveProgress = true) => {
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

    const firstGroup = buildGroup(items);
    rail.appendChild(firstGroup);
    track.replaceChildren(rail);

    cycleWidth = firstGroup.getBoundingClientRect().width;
    const viewportWidth = Math.max(track.clientWidth, window.innerWidth, 1);
    const requiredWidth = viewportWidth + cycleWidth * 2;
    let guard = 0;
    while (rail.scrollWidth < requiredWidth && guard < 32) {
      rail.appendChild(buildGroup(items));
      guard += 1;
    }

    x = preserveProgress && cycleWidth > 0 ? progress * cycleWidth : 0;
    apply();
    rebuilding = false;
    if (observer) observer.observe(track, { childList: true, subtree: false });
    start();
  };

  const setItems = (items, preserveProgress = true) => {
    const clean = [];
    const seen = new Set();
    for (const item of items) {
      const headline = MirsadText.normalize(item?.headline || '');
      const key = normalize(headline);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      clean.push({ headline, published_at: item.published_at || null });
      if (clean.length >= MAX_ITEMS) break;
    }
    if (!clean.length) return;
    const nextSignature = signature(clean);
    currentItems = clean;
    if (nextSignature === currentSignature && track.querySelector('.mirsad-ticker-rail')) return;
    currentSignature = nextSignature;
    rebuild(currentItems, preserveProgress);
  };

  const readDomFallback = () => [...track.children]
    .filter((el) => el.classList?.contains('ticker-strip__item'))
    .map((el) => ({ headline: (el.textContent || '').trim() }))
    .filter((item) => item.headline);

  const fetchLatestUrgent = async () => {
    const base = `${SUPABASE_URL}/rest/v1/news_articles`;
    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    };

    const fetchRows = async (url) => {
      const response = await fetch(url, { headers, cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    };

    try {
      const params = new URLSearchParams({
        select: 'headline,published_at,updated_at,importance_score',
        is_pending_verification: 'eq.false',
        headline: 'not.is.null',
        order: 'published_at.desc.nullslast,updated_at.desc.nullslast',
        limit: String(MAX_ITEMS),
      });
      params.set('importance_score', 'gte.45');
      let rows = await fetchRows(`${base}?${params.toString()}`);

      if (rows.length < MAX_ITEMS) {
        const fallbackParams = new URLSearchParams({
          select: 'headline,published_at,updated_at,importance_score',
          is_pending_verification: 'eq.false',
          headline: 'not.is.null',
          order: 'published_at.desc.nullslast,updated_at.desc.nullslast',
          limit: String(MAX_ITEMS * 2),
        });
        rows = await fetchRows(`${base}?${fallbackParams.toString()}`);
      }

      rows.sort((a, b) => new Date(b.published_at || b.updated_at || 0) - new Date(a.published_at || a.updated_at || 0));
      setItems(rows, true);
    } catch (error) {
      console.error('[mirsad ticker] latest urgent fetch failed', error);
      if (!currentItems.length) {
        const fallback = readDomFallback();
        if (fallback.length) setItems(fallback.slice(0, MAX_ITEMS), false);
      }
    }
  };

  const scheduleFetch = () => {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = window.setTimeout(async () => {
      await fetchLatestUrgent();
      scheduleFetch();
    }, POLL_MS);
  };

  observer = new MutationObserver(() => {
    if (syncFrame) cancelAnimationFrame(syncFrame);
    syncFrame = requestAnimationFrame(() => {
      syncFrame = 0;
      if (rebuilding || !currentItems.length) return;
      rebuild(currentItems, true);
    });
  });

  const initial = readDomFallback();
  if (initial.length) setItems(initial.slice(0, MAX_ITEMS), false);
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

  fetchLatestUrgent();
  scheduleFetch();
})();
