(() => {
  'use strict';

  // Some feeds contain HTML entities as literal text (for example &laquo; and &raquo;).
  // Decode those entities only at the final display layer so the stored news data and
  // ingestion pipeline remain untouched.
  const SELECTORS = '.card__headline, .card__summary, .card__evidence, .card__source, .ticker-strip__item';

  function decodeEntities(value) {
    const source = String(value ?? '');
    if (!source.includes('&')) return source;
    const textarea = document.createElement('textarea');
    textarea.innerHTML = source;
    return textarea.value;
  }

  function fixElement(element) {
    if (!(element instanceof Element) || !element.matches(SELECTORS)) return;
    const decoded = decodeEntities(element.textContent);
    if (decoded !== element.textContent) element.textContent = decoded;
  }

  function fix(root = document) {
    if (root instanceof Element) fixElement(root);
    root.querySelectorAll?.(SELECTORS).forEach(fixElement);
  }

  fix();

  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        fixElement(mutation.target.parentElement);
      } else {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) fix(node);
        });
      }
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
})();
