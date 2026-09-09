(() => {
  'use strict';

  const trigger = document.getElementById('sortBox');
  const sheet = document.getElementById('sortSheet');
  if (!trigger || !sheet) return;

  const panel = sheet.querySelector('.sort-sheet__panel');
  const options = [...sheet.querySelectorAll('[data-sort-option]')];
  const labels = { priority: 'الأولوية', latest: 'الأحدث', updates: 'الأكثر تحديثًا' };
  let lastFocus = null;

  const syncOptions = () => {
    const value = trigger.value || 'priority';
    trigger.textContent = labels[value] || labels.priority;
    options.forEach((option) => {
      option.setAttribute('aria-checked', String(option.dataset.sortOption === value));
    });
  };

  const open = () => {
    lastFocus = document.activeElement;
    syncOptions();
    sheet.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.body.classList.add('sort-sheet-open');
    requestAnimationFrame(() => panel?.focus());
  };

  const close = () => {
    sheet.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('sort-sheet-open');
    lastFocus?.focus?.();
  };

  trigger.addEventListener('click', open);

  options.forEach((option) => {
    option.addEventListener('click', () => {
      const value = option.dataset.sortOption;
      if (!value) return;
      trigger.value = value;
      trigger.dispatchEvent(new Event('change', { bubbles: true }));
      syncOptions();
      close();
    });
  });

  sheet.addEventListener('click', (event) => {
    if (event.target.closest('[data-sort-close]')) close();
  });

  document.addEventListener('keydown', (event) => {
    if (sheet.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });

  syncOptions();
})();
