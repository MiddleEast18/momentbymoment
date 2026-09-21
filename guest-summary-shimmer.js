(() => {
  'use strict';
  const GUEST_KEY = 'mirsad.guest.v1';
  const MAX_LINES = 3;
  const isGuest = () => {
    try { return localStorage.getItem(GUEST_KEY) === '1'; } catch { return false; }
  };

  const textNodeOf = (summary) => {
    for (const node of summary.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && String(node.data || '').trim()) return node;
    }
    return null;
  };

  const lineHeightOf = (el) => {
    const raw = getComputedStyle(el).lineHeight;
    const num = parseFloat(raw);
    if (Number.isFinite(num) && raw.endsWith('px')) return num;
    const font = parseFloat(getComputedStyle(el).fontSize) || 13.5;
    return font * (Number.isFinite(num) ? num : 1.65);
  };

  const measureLineWidths = (summary) => {
    const node = textNodeOf(summary);
    if (!node) return [];
    const box = summary.getBoundingClientRect();
    if (box.width < 4 || box.height < 4) return [];
    const range = document.createRange();
    range.selectNodeContents(node);
    let rects = Array.from(range.getClientRects()).filter((r) => r.width >= 1 && r.height >= 1);
    if (!rects.length) {
      const collected = [];
      const len = node.data.length;
      for (let i = 0; i < len; i += 1) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const ch = range.getClientRects()[0];
        if (!ch || ch.width < 0.2) continue;
        const top = Math.round(ch.top);
        const line = collected.find((item) => Math.abs(item.top - top) <= 1);
        if (line) {
          line.left = Math.min(line.left, ch.left);
          line.right = Math.max(line.right, ch.right);
        } else if (collected.length < MAX_LINES) {
          collected.push({ top, left: ch.left, right: ch.right });
        } else break;
      }
      rects = collected.map((item) => ({ width: item.right - item.left, top: item.top, height: item.right }));
    }
    const unique = [];
    for (const rect of rects) {
      const top = Math.round(rect.top || 0);
      if (unique.some((item) => Math.abs((item.top || 0) - top) <= 1)) continue;
      unique.push(rect);
      if (unique.length >= MAX_LINES) break;
    }
    return unique.slice(0, MAX_LINES).map((rect) => Math.min(box.width, Math.max(8, rect.width)));
  };

  const ensureSlot = (summary) => {
    const parent = summary.parentElement;
    if (!parent) return null;
    if (parent.classList.contains('card__summary-slot')) return parent;
    const slot = document.createElement('div');
    slot.className = 'card__summary-slot';
    parent.insertBefore(slot, summary);
    slot.appendChild(summary);
    return slot;
  };

  const ensureMask = (slot) => {
    let mask = slot.querySelector(':scope > .card__summary-mask');
    if (!mask) {
      mask = document.createElement('span');
      mask.className = 'card__summary-mask';
      mask.setAttribute('aria-hidden', 'true');
      slot.appendChild(mask);
    }
    return mask;
  };

  const paintBars = (summary) => {
    const slot = ensureSlot(summary);
    if (!slot) return;
    if (!isGuest()) {
      summary.removeAttribute('aria-hidden');
      slot.querySelector(':scope > .card__summary-mask')?.remove();
      return;
    }
    summary.setAttribute('aria-hidden', 'true');
    const widths = measureLineWidths(summary);
    const mask = ensureMask(slot);
    const lineHeight = lineHeightOf(summary);
    const barHeight = Math.max(6, lineHeight * 0.52);
    const fontSize = parseFloat(getComputedStyle(summary).fontSize) || 13.5;
    if (!widths.length) {
      mask.replaceChildren();
      return;
    }
    const existing = mask.children;
    while (existing.length > widths.length) mask.removeChild(mask.lastElementChild);
    widths.forEach((width, index) => {
      let bar = existing[index];
      if (!bar) {
        bar = document.createElement('span');
        bar.className = 'card__summary-bar';
        mask.appendChild(bar);
      }
      bar.style.top = `${(index * lineHeight) + ((lineHeight - barHeight) / 2)}px`;
      bar.style.height = `${barHeight}px`;
      bar.style.width = `${width}px`;
      bar.style.fontSize = `${fontSize}px`;
    });
  };

  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const summary = entry.target.classList?.contains('card__summary')
        ? entry.target
        : entry.target.querySelector?.('.card__summary');
      if (summary) paintBars(summary);
    }
  });

  const watched = new WeakSet();
  const watchSummary = (summary) => {
    if (!summary) return;
    if (!isGuest()) {
      summary.removeAttribute('aria-hidden');
      summary.parentElement?.querySelector(':scope > .card__summary-mask')?.remove();
      return;
    }
    if (!watched.has(summary)) {
      watched.add(summary);
      resizeObserver.observe(summary);
    }
    paintBars(summary);
  };

  const scan = () => {
    document.body.classList.toggle('mirsad-guest-view', isGuest());
    document.querySelectorAll('.card .card__summary').forEach(watchSummary);
    if (!isGuest()) {
      document.querySelectorAll('.card__summary-mask').forEach((mask) => mask.remove());
      document.querySelectorAll('.card .card__summary').forEach((summary) => summary.removeAttribute('aria-hidden'));
    }
  };

  const mo = new MutationObserver((mutations) => {
    let needed = false;
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        const el = mutation.target.parentElement;
        if (el?.classList?.contains('card__summary')) paintBars(el);
        continue;
      }
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        if (node.matches?.('.card, .card__summary')) needed = true;
        if (node.querySelector?.('.card__summary')) needed = true;
      });
    }
    if (needed) scan();
  });

  const start = () => {
    scan();
    const roots = [document.getElementById('newsGrid'), document.getElementById('featuredRail'), document.body].filter(Boolean);
    roots.forEach((root) => mo.observe(root, { childList: true, subtree: true, characterData: true }));
  };

  window.addEventListener('mirsad:authenticated', scan);
  window.addEventListener('storage', (event) => { if (event.key === GUEST_KEY) scan(); });
  document.addEventListener('click', (event) => {
    if (event.target.closest?.('#mirsadGuest, #mirsadGuestExit, .mirsad-guest-lock-toast__button')) {
      setTimeout(scan, 0);
    }
  }, true);
  window.addEventListener('resize', () => {
    document.querySelectorAll('body.mirsad-guest-view .card .card__summary').forEach(paintBars);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
