(() => {
  'use strict';

  const noticeMarkup = `
    <div class="mirsad-analysis__notice" role="note">
      <span class="mirsad-analysis__ai-icon" aria-hidden="true">
        <svg viewBox="0 0 32 32" focusable="false"><path d="M16 3.5l2.25 7.1a4.5 4.5 0 0 0 3.15 3.15L28.5 16l-7.1 2.25a4.5 4.5 0 0 0-3.15 3.15L16 28.5l-2.25-7.1a4.5 4.5 0 0 0-3.15-3.15L3.5 16l7.1-2.25a4.5 4.5 0 0 0 3.15-3.15L16 3.5Z"/><path d="M25.5 4.5v5M23 7h5M7 23v4M5 25h4"/></svg>
      </span>
      <span>هذا الملخص أُعدّ بواسطة الذكاء الاصطناعي. لتفاصيل أدق، يُرجى الانتقال إلى المصدر الأصلي.</span>
    </div>`;

  function addNotice(card) {
    if (!card || card.querySelector('.mirsad-analysis__notice')) return;
    const claim = card.querySelector('.mirsad-analysis__claim');
    if (!claim) return;
    claim.insertAdjacentHTML('afterend', noticeMarkup);
  }

  const observer = new MutationObserver(() => {
    addNotice(document.querySelector('.mirsad-analysis'));
  });
  observer.observe(document.body, { childList: true, subtree: true });
  addNotice(document.querySelector('.mirsad-analysis'));
})();
