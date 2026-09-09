(() => {
  'use strict';

  const PAGE_SIZE = 5;
  const grid = document.getElementById('newsGrid');
  const emptyState = document.getElementById('emptyState');
  if (!grid) return;

  const controls = document.createElement('div');
  controls.className = 'news-pagination';
  controls.hidden = true;
  controls.setAttribute('aria-label', 'خيارات عرض الأخبار');
  controls.innerHTML = `
    <button class="news-pagination__button news-pagination__button--primary" type="button" data-action="more">عرض المزيد</button>
    <button class="news-pagination__button" type="button" data-action="all">عرض الكل</button>
  `;
  grid.insertAdjacentElement('afterend', controls);

  const moreButton = controls.querySelector('[data-action="more"]');
  const allButton = controls.querySelector('[data-action="all"]');
  let shown = PAGE_SIZE;
  let signature = '';
  let previousIds = [];
  let showAll = false;

  function cards() {
    return [...grid.querySelectorAll(':scope > .card')];
  }

  function currentIds() {
    return cards().map((card) => card.dataset.id || '');
  }

  function apply() {
    const list = cards();
    const total = list.length;
    if (!total) {
      controls.hidden = true;
      signature = '';
      previousIds = [];
      return;
    }

    const limit = showAll ? total : Math.min(shown, total);
    list.forEach((card, index) => { card.hidden = index >= limit; });

    controls.hidden = total <= PAGE_SIZE && !showAll;
    if (showAll || limit >= total) {
      moreButton.hidden = true;
      allButton.hidden = true;
    } else {
      moreButton.hidden = false;
      allButton.hidden = false;
    }

    signature = list.map((card) => `${card.dataset.id || ''}:${card.hidden ? 1 : 0}`).join('|');
    previousIds = list.map((card) => card.dataset.id || '');
  }

  function reconcile() {
    const ids = currentIds();
    if (!ids.length) {
      apply();
      return;
    }

    if (!previousIds.length) {
      shown = PAGE_SIZE;
      showAll = false;
    } else {
      const previousSet = new Set(previousIds.filter(Boolean));
      const shared = ids.filter((id) => id && previousSet.has(id)).length;
      const overlap = shared / Math.max(1, Math.min(previousIds.length, ids.length));
      const delta = Math.abs(ids.length - previousIds.length);
      if (overlap < 0.45 && delta > 2) {
        shown = PAGE_SIZE;
        showAll = false;
      }
    }
    apply();
  }

  moreButton.addEventListener('click', () => {
    shown += PAGE_SIZE;
    showAll = false;
    apply();
  });

  allButton.addEventListener('click', () => {
    showAll = true;
    apply();
  });

  const observer = new MutationObserver(() => {
    requestAnimationFrame(reconcile);
  });
  observer.observe(grid, { childList: true });

  requestAnimationFrame(reconcile);
})();
