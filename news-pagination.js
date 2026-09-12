(() => {
  'use strict';

  const INITIAL_COUNT = 7;
  const MORE_COUNT = 5;
  const grid = document.getElementById('newsGrid');
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
  const status = document.createElement('span');
  status.className = 'news-pagination__status';
  status.setAttribute('role', 'status');
  controls.appendChild(status);
  let shown = INITIAL_COUNT;
  let showAll = false;
  let reconcileQueued = false;
  let busy = false;

  function cards() {
    return [...grid.querySelectorAll(':scope > .card')];
  }

  function apply() {
    const list = cards();
    const total = list.length;
    if (!total) {
      controls.hidden = true;
      return;
    }

    const limit = showAll ? total : Math.min(shown, total);
    list.forEach((card, index) => {
      const isHidden = index >= limit;
      card.classList.toggle('is-pagination-hidden', isHidden);
      card.setAttribute('aria-hidden', isHidden ? 'true' : 'false');
      card.tabIndex = isHidden ? -1 : 0;
    });

    const canExpand = !showAll && limit < total;
    controls.hidden = !canExpand;
    moreButton.hidden = !canExpand;
    allButton.hidden = !canExpand;
  }

  function scheduleApply() {
    if (reconcileQueued) return;
    reconcileQueued = true;
    requestAnimationFrame(() => {
      reconcileQueued = false;
      apply();
    });
  }

  async function consume(kind) {
    if (busy || !window.mirsadViewAccess) return false;
    busy = true;
    moreButton.disabled = true;
    allButton.disabled = true;
    status.textContent = 'جارٍ التحقق…';
    const result = await window.mirsadViewAccess.consume(kind);
    busy = false;
    moreButton.disabled = false;
    allButton.disabled = false;
    if (!result.allowed) { status.textContent = result.error?.message === 'not_authenticated' ? 'سجّل الدخول لاستخدام الفتحات' : 'لا توجد فتحات كافية'; return false; }
    const threshold = Number(result.threshold || (kind === 'more' ? 10 : 100));
    const newCount = Number(result.new_count || 0);
    status.textContent = result.charged
      ? `تم خصم ${kind === 'more' ? 5 : 100} فتحات`
      : `الاستخدام مجاني — ${newCount}/${threshold} أخبار جديدة`;
    return true;
  }

  moreButton.addEventListener('click', async () => {
    if (!(await consume('more'))) return;
    shown += MORE_COUNT;
    showAll = false;
    apply();
    window.scrollBy({ top: 1, behavior: 'instant' });
  });

  allButton.addEventListener('click', async () => {
    if (!(await consume('all'))) return;
    showAll = true;
    apply();
  });

  document.addEventListener('input', (event) => {
    if (event.target?.id === 'searchBox') {
      shown = INITIAL_COUNT;
      showAll = false;
      scheduleApply();
    }
  }, true);

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target?.closest?.('#categoryFilters [data-category], #sortSheet [data-sort-option]')) {
      shown = INITIAL_COUNT;
      showAll = false;
      scheduleApply();
    }
  }, true);

  const observer = new MutationObserver(scheduleApply);
  observer.observe(grid, { childList: true });
  scheduleApply();
})();
