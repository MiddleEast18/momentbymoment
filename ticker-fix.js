(() => {
  const track = document.getElementById('tickerTrack');
  if (!track) return;

  let raf = 0;
  let last = performance.now();
  let offset = 0;
  let loopWidth = 0;
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
      if (-offset >= loopWidth) offset += loopWidth;
      track.style.transform = `translate3d(${offset}px,0,0)`;
    }

    raf = requestAnimationFrame(tick);
  };

  const restart = () => {
    if (raf) cancelAnimationFrame(raf);
    offset = 0;
    measure();
    track.style.transform = 'translate3d(0,0,0)';
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  const observer = new MutationObserver(() => restart());
  observer.observe(track, { childList: true });
  window.addEventListener('resize', () => {
    const previous = loopWidth;
    measure();
    if (previous !== loopWidth) {
      offset = loopWidth > 0 ? offset % loopWidth : 0;
    }
    last = performance.now();
  });

  restart();
})();
