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

  function showGuestAccessNotice() {
    let notice = document.getElementById('newsPaginationGuestNotice');
    if (!notice) {
      const style = document.createElement('style');
      style.textContent = '.news-pagination__guest-notice{position:fixed;left:16px;right:16px;bottom:16px;z-index:5600;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid rgba(201,162,39,.5);border-radius:12px;background:rgba(16,21,28,.97);color:var(--text,#f2eee6);box-shadow:0 10px 30px rgba(0,0,0,.3);font:600 12px/1.5 var(--font-sans,inherit)}.news-pagination__guest-notice button{border:1px solid var(--gold,#c9a227);border-radius:999px;padding:7px 12px;background:rgba(201,162,39,.12);color:var(--gold,#c9a227);font:inherit;white-space:nowrap;cursor:pointer}';
      document.head.appendChild(style);
      notice = document.createElement('div');
      notice.id = 'newsPaginationGuestNotice';
      notice.className = 'news-pagination__guest-notice';
      const message = document.createElement('span');
      message.textContent = 'تسجيل الدخول مطلوب لاستخدام عرض المزيد أو عرض الكل.';
      notice.appendChild(message);
      const login = document.createElement('button');
      login.type = 'button';
      login.textContent = 'تسجيل الدخول';
      login.addEventListener('click', () => document.getElementById('mirsadGuestExit')?.click());
      notice.appendChild(login);
      document.body.appendChild(notice);
    }
    notice.hidden = false;
    clearTimeout(showGuestAccessNotice.timer);
    showGuestAccessNotice.timer = setTimeout(() => { notice.hidden = true; }, 5000);
  }

  function isGuestVisitor() {
    try { return localStorage.getItem('mirsad.guest.v1') === '1'; } catch { return false; }
  }

  async function consume(kind) {
    if (busy || !window.mirsadViewAccess) return false;
    if (isGuestVisitor()) { status.textContent = 'تسجيل الدخول مطلوب'; showGuestAccessNotice(); return false; }
    busy = true;
    moreButton.disabled = true;
    allButton.disabled = true;
    status.textContent = 'جارٍ التحقق…';
    const result = await window.mirsadViewAccess.consume(kind);
    busy = false;
    moreButton.disabled = false;
    allButton.disabled = false;
    if (!result?.allowed) { if (result?.error?.message === 'not_authenticated') { status.textContent = 'تسجيل الدخول مطلوب'; showGuestAccessNotice(); } else { status.textContent = 'لا توجد فتحات كافية'; } return false; }
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
    shown = 400;
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
