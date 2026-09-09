(() => {
  const track = document.getElementById('tickerTrack');
  if (!track) return;
  let raf = 0;
  let last = performance.now();
  let offset = 0;
  const speed = 42;

  const tick = (now) => {
    const half = track.scrollWidth / 2;
    if (half > 0) {
      offset -= ((now - last) / 1000) * speed;
      if (-offset >= half) offset += half;
      track.style.transform = `translate3d(${offset}px,0,0)`;
    }
    last = now;
    raf = requestAnimationFrame(tick);
  };

  track.style.animation = 'none';
  const observer = new MutationObserver(() => {
    track.style.animation = 'none';
    if (raf) cancelAnimationFrame(raf);
    last = performance.now();
    raf = requestAnimationFrame(tick);
  });
  observer.observe(track, { childList: true });
  window.addEventListener('resize', () => { last = performance.now(); });
  raf = requestAnimationFrame(tick);
})();