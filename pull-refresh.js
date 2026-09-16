(() => {
  'use strict';
  if (!('ontouchstart' in window)) return;

  const THRESHOLD = 72;
  const MAX_PULL = 112;
  let startX = 0;
  let startY = 0;
  let pulling = false;
  let tracking = false;
  let refreshing = false;
  let pullDistance = 0;
  let indicator;
  let icon;
  let label;
  let renderFrame = 0;
  let pendingDistance = 0;

  function ensureIndicator() {
    if (indicator) return;
    const style = document.createElement('style');
    style.textContent = `
      .mirsad-pull-refresh{position:fixed;top:10px;left:50%;z-index:7000;width:38px;height:38px;display:grid;place-items:center;border:1px solid rgba(201,162,39,.62);border-radius:50%;background:rgba(16,21,28,.96);color:var(--gold,#c9a227);box-shadow:0 7px 22px rgba(0,0,0,.3);opacity:0;transform:translate(-50%,-58px) scale(.82);pointer-events:none;transition:opacity .16s ease,transform .16s ease}
      .mirsad-pull-refresh.is-visible{opacity:1;transform:translate(-50%,0) scale(1)}
      .mirsad-pull-refresh.is-refreshing svg{animation:mirsad-pull-spin .75s linear infinite}
      .mirsad-pull-refresh svg{width:19px;height:19px;display:block}
      .mirsad-pull-refresh__label{position:absolute;top:42px;left:50%;width:max-content;max-width:calc(100vw - 32px);padding:4px 8px;border:1px solid rgba(201,162,39,.28);border-radius:999px;background:rgba(16,21,28,.94);font:500 9px/1.4 var(--font-body,inherit);color:var(--text-dim,#9aa4b3);transform:translateX(-50%);white-space:nowrap}
      @keyframes mirsad-pull-spin{to{transform:rotate(360deg)}}
      @media(prefers-reduced-motion:reduce){.mirsad-pull-refresh,.mirsad-pull-refresh.is-visible{transition:none}.mirsad-pull-refresh.is-refreshing svg{animation:none}}
    `;
    document.head.appendChild(style);
    indicator = document.createElement('aside');
    indicator.className = 'mirsad-pull-refresh';
    indicator.setAttribute('aria-live', 'polite');
    indicator.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.65" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M20 5v6h-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="2" fill="currentColor" opacity=".75"/></svg><span class="mirsad-pull-refresh__label">اسحب للتحديث</span>';
    document.body.appendChild(indicator);
    icon = indicator.querySelector('svg');
    label = indicator.querySelector('.mirsad-pull-refresh__label');
  }

  function isExcluded(target) {
    return target?.closest?.('input, textarea, select, button, a, [role="button"], .featured-rail, .control-bar__filters, .ticker-strip__track, [data-sort-close]');
  }

  function reset() {
    if (renderFrame) { cancelAnimationFrame(renderFrame); renderFrame = 0; }
    if (indicator) {
      indicator.classList.remove('is-visible', 'is-refreshing');
      indicator.style.transform = '';
      label.textContent = 'اسحب للتحديث';
    }
    pullDistance = 0;
    pendingDistance = 0;
    pulling = false;
    tracking = false;
  }

  function renderPull(distance) {
    renderFrame = 0;
    if (!indicator || !pulling) return;
    const progress = Math.min(1, distance / THRESHOLD);
    indicator.classList.add('is-visible');
    indicator.style.transform = `translate(-50%, ${Math.max(0, distance - 58)}px) scale(${.82 + progress * .18})`;
    icon.style.transform = `rotate(${progress * 300}deg)`;
    label.textContent = progress >= 1 ? 'اترك للتحديث' : 'اسحب للتحديث';
  }

  document.addEventListener('touchstart', (event) => {
    if (refreshing || event.touches.length !== 1 || window.scrollY > 0 || isExcluded(event.target)) return;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    tracking = true;
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (!tracking || refreshing || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || window.scrollY > 0) { if (dy < 0 || Math.abs(dx) > Math.abs(dy)) reset(); return; }
    ensureIndicator();
    pulling = true;
    const distance = Math.min(MAX_PULL, dy * .58);
    pullDistance = distance;
    pendingDistance = distance;
    if (!renderFrame) renderFrame = requestAnimationFrame(() => renderPull(pendingDistance));
    event.preventDefault();
  }, { passive: false });

  document.addEventListener('touchend', () => {
    if (!tracking) return;
    if (!pulling) { reset(); return; }
    const ready = pullDistance >= THRESHOLD;
    if (!ready) { reset(); return; }
    refreshing = true;
    indicator.classList.add('is-refreshing', 'is-visible');
    indicator.style.transform = 'translate(-50%, 0) scale(1)';
    label.textContent = 'جارٍ التحديث';
    setTimeout(() => window.location.reload(), 220);
  }, { passive: true });

  document.addEventListener('touchcancel', reset, { passive: true });
})();
