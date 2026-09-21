(() => {
  'use strict';
  if (!('ontouchstart' in window)) return;

  const THRESHOLD = 72;
  const MAX_PULL = 112;
  const ACTIVATE = 12;
  const TOP_SLACK = 1;
  const MOVE_OPTS = { passive: false, capture: true };

  let startX = 0;
  let startY = 0;
  let pulling = false;
  let tracking = false;
  let refreshing = false;
  let pullDistance = 0;
  let pendingDistance = 0;
  let moveBound = false;
  let indicator;
  let icon;
  let label;
  let renderFrame = 0;

  function pageScrollTop() {
    const se = document.scrollingElement;
    return window.scrollY || se?.scrollTop || document.documentElement.scrollTop || document.body.scrollTop || 0;
  }

  function isAtPageTop() {
    return pageScrollTop() <= TOP_SLACK;
  }

  function isExcluded(target) {
    return Boolean(target?.closest?.('input, textarea, select, button, a, [role="button"], [role="dialog"], .featured-rail, .control-bar__filters, .ticker-strip__track, .mirsad-reader, .mirsad-reader-backdrop, .mirsad-auth-gate, .mirsad-user-dropdown, .mirsad-onboarding-backdrop, .wheel, [data-sort-close]'));
  }

  function hasScrolledAncestor(target) {
    let el = target instanceof Element ? target : target?.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.scrollTop > TOP_SLACK) return true;
      el = el.parentElement;
    }
    return false;
  }

  function ensureIndicator() {
    if (indicator) return;
    const style = document.createElement('style');
    style.textContent = `
      .mirsad-pull-refresh{position:fixed;top:10px;left:50%;z-index:7000;width:38px;height:38px;display:grid;place-items:center;border:1px solid rgba(201,162,39,.62);border-radius:50%;background:rgba(16,21,28,.96);color:var(--gold,#c9a227);box-shadow:0 7px 22px rgba(0,0,0,.3);opacity:0;transform:translate3d(-50%,-58px,0) scale(.82);pointer-events:none;transition:opacity .16s ease}
      .mirsad-pull-refresh.is-visible{opacity:1}
      .mirsad-pull-refresh.is-armed{will-change:transform}
      .mirsad-pull-refresh.is-refreshing svg{animation:mirsad-pull-spin .75s linear infinite}
      .mirsad-pull-refresh svg{width:19px;height:19px;display:block;transform-origin:center}
      .mirsad-pull-refresh__label{position:absolute;top:42px;left:50%;width:max-content;max-width:calc(100vw - 32px);padding:4px 8px;border:1px solid rgba(201,162,39,.28);border-radius:999px;background:rgba(16,21,28,.94);font:500 9px/1.4 var(--font-body,inherit);color:var(--text-dim,#9aa4b3);transform:translateX(-50%);white-space:nowrap}
      @keyframes mirsad-pull-spin{to{transform:rotate(360deg)}}
      @media(prefers-reduced-motion:reduce){.mirsad-pull-refresh{transition:none}.mirsad-pull-refresh.is-refreshing svg{animation:none}}
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

  function bindMove() {
    if (moveBound) return;
    document.addEventListener('touchmove', onMove, MOVE_OPTS);
    moveBound = true;
  }

  function unbindMove() {
    if (!moveBound) return;
    document.removeEventListener('touchmove', onMove, MOVE_OPTS);
    moveBound = false;
  }

  function reset() {
    unbindMove();
    if (renderFrame) {
      cancelAnimationFrame(renderFrame);
      renderFrame = 0;
    }
    if (indicator) {
      indicator.classList.remove('is-visible', 'is-refreshing', 'is-armed');
      indicator.style.transform = '';
      if (icon) icon.style.transform = '';
      if (label) label.textContent = 'اسحب للتحديث';
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
    indicator.classList.add('is-visible', 'is-armed');
    indicator.style.transform = `translate3d(-50%, ${Math.max(0, distance - 58)}px, 0) scale(${.82 + progress * .18})`;
    icon.style.transform = `rotate(${progress * 300}deg)`;
    const next = progress >= 1 ? 'اترك للتحديث' : 'اسحب للتحديث';
    if (label.textContent !== next) label.textContent = next;
  }

  function onStart(event) {
    if (refreshing || event.touches.length !== 1 || !isAtPageTop() || isExcluded(event.target) || hasScrolledAncestor(event.target)) return;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    tracking = true;
    pulling = false;
    pullDistance = 0;
    bindMove();
  }

  function onMove(event) {
    if (!tracking || refreshing || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (!pulling) {
      if (absY < ACTIVATE && absX < ACTIVATE) return;
      if (dy <= 0 || absX > absY || !isAtPageTop()) {
        reset();
        return;
      }
      pulling = true;
      ensureIndicator();
    } else if (dy <= 0 || absX > absY * 1.6 || !isAtPageTop()) {
      reset();
      return;
    }

    const distance = Math.min(MAX_PULL, dy * .58);
    pullDistance = distance;
    pendingDistance = distance;
    if (!renderFrame) renderFrame = requestAnimationFrame(() => renderPull(pendingDistance));
    event.preventDefault();
  }

  function onEnd() {
    if (!tracking) return;
    unbindMove();
    if (!pulling || pullDistance < THRESHOLD) {
      reset();
      return;
    }
    if (refreshing) return;
    refreshing = true;
    tracking = false;
    pulling = false;
    ensureIndicator();
    if (icon) icon.style.transform = '';
    indicator.classList.remove('is-armed');
    indicator.classList.add('is-refreshing', 'is-visible');
    indicator.style.transform = 'translate3d(-50%, 0, 0) scale(1)';
    label.textContent = 'جارٍ التحديث';
    setTimeout(() => window.location.reload(), 220);
  }

  document.addEventListener('touchstart', onStart, { passive: true, capture: true });
  document.addEventListener('touchend', onEnd, { passive: true, capture: true });
  document.addEventListener('touchcancel', reset, { passive: true, capture: true });

  if (document.body) ensureIndicator();
  else document.addEventListener('DOMContentLoaded', ensureIndicator, { once: true });
})();
