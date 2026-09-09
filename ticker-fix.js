(() => {
  const track = document.getElementById('tickerTrack');
  if (!track) return;

  let raf = 0;
  let last = performance.now();
  let offset = 0;
  let loopWidth = 0;
  let restarting = false;
  const speed = 42;

  const measure = () => {
    track.style.animation = 'none';
    track.style.direction = 'ltr';
    track.querySelectorAll('.ticker-strip__item').forEach((item) => {
      item.style.direction = 'rtl';
    });

    const children = [...track.children];
    const half = Math.floor(children.length / 2);
    loopWidth = half > 0 && children[half]
      ? Math.max(0, children[half].offsetLeft - children[0].offsetLeft)
      : 0;
  };

  const tick = (now) => {
    const delta = Math.min(100, Math.max(0, now - last));
    last = now;

    if (loopWidth > 0) {
      offset -= (delta / 1000) * speed;
      while (-offset >= loopWidth) offset += loopWidth;
      while (offset > 0) offset -= loopWidth;
      track.style.transform = `translate3d(${offset}px,0,0)`;
    }

    raf = requestAnimationFrame(tick);
  };

  const start = (preserveOffset = false) => {
    if (restarting) return;
    restarting = true;
    if (raf) cancelAnimationFrame(raf);

    const previousWidth = loopWidth;
    measure();

    if (!preserveOffset || previousWidth <= 0 || loopWidth <= 0) {
      offset = 0;
    } else {
      offset = ((offset % loopWidth) + loopWidth) % loopWidth;
      offset = -offset;
    }

    track.style.transform = `translate3d(${offset}px,0,0)`;
    last = performance.now();
    raf = requestAnimationFrame(tick);
    requestAnimationFrame(() => {
      restarting = false;
    });
  };

  const observer = new MutationObserver(() => {
    // Rebuild the measurement after ticker content changes, but restart from
    // the equivalent loop position so a Realtime update cannot create a gap.
    start(true);
  });
  observer.observe(track, { childList: true });

  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      start(true);
    });
  });

  start(false);
})();
