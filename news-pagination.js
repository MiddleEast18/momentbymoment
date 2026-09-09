(() => {
  'use strict';

  const INITIAL_COUNT = 7;
  const MORE_COUNT = 5;
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
  let shown = INITIAL_COUNT;
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
      previousIds = [];
      return;
    }

    const limit = showAll ? total : Math.min(shown, total);
    list.forEach((card, index) => {
      card.hidden = index >= limit;
    });

    const canExpand = !showAll && limit < total;
    controls.hidden = total <= INITIAL_COUNT;
    moreButton.hidden = !canExpand;
    allButton.hidden = !canExpand;

    previousIds = list.map((card) => card.dataset.id || '');
  }

  function reconcile() {
    const ids = currentIds();
    if (!ids.length) {
      apply();
      return;
    }

    if (!previousIds.length) {
      shown = INITIAL_COUNT;
      showAll = false;
    } else {
      const previousSet = new Set(previousIds.filter(Boolean));
      const shared = ids.filter((id) => id && previousSet.has(id)).length;
      const overlap = shared / Math.max(1, Math.min(previousIds.length, ids.length));
      const delta = Math.abs(ids.length - previousIds.length);
      if (overlap < 0.45 && delta > 2) {
        shown = INITIAL_COUNT;
        showAll = false;
      }
    }
    apply();
  }

  moreButton.addEventListener('click', () => {
    shown += MORE_COUNT;
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
