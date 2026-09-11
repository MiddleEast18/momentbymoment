(() => {
  'use strict';

  const trigger = document.getElementById('sortBox');
  const sheet = document.getElementById('sortSheet');
  if (!trigger || !sheet) return;

  const panel = sheet.querySelector('.sort-sheet__panel');
  const options = [...sheet.querySelectorAll('[data-sort-option]')];
  const labels = { priority: 'الأولوية', latest: 'الأحدث', updates: 'الأكثر تحديثًا' };
  let lastFocus = null;

  const currentValue = () => {
    const value = trigger.matches('select') ? trigger.value : trigger.dataset.sortMode;
    return ['priority', 'latest', 'updates'].includes(value) ? value : 'priority';
  };

  const syncOptions = () => {
    const value = currentValue();
    trigger.textContent = labels[value];
    trigger.dataset.sortMode = value;
    trigger.setAttribute('aria-label', `ترتيب الأخبار: ${labels[value]}`);
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
      if (!['priority', 'latest', 'updates'].includes(value)) return;
      trigger.dataset.sortMode = value;
      trigger.dispatchEvent(new Event('change', { bubbles: true }));
      trigger.dispatchEvent(new CustomEvent('sortchange', { bubbles: true, detail: { value } }));
      syncOptions();
      close();
    });
  });

  sheet.addEventListener('click', (event) => {
    if (event.target.closest('[data-sort-close]')) close();
  });

  // Category changes are a filter state change, not a card animation state.
  // Cancel any FLIP animation started by app.js during the same click event,
  // so an existing card cannot briefly fly from its previous position.
  const categoryFiltersEl = document.getElementById('categoryFilters');
  categoryFiltersEl?.addEventListener('click', () => {
    requestAnimationFrame(() => {
      document.querySelectorAll('#newsGrid .card').forEach((card) => {
        card.getAnimations().forEach((animation) => animation.cancel());
        card.style.transform = '';
        card.style.opacity = '';
      });
    });
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
