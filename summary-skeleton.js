(() => {
  'use strict';

  const FIRST_VISIBLE_LINE = 1;
  const MAX_SUMMARY_LINES = 3;
  const BAR_HEIGHT_RATIO = 0.38;
  const LINE_EPSILON = 1.5;
  const observed = new WeakSet();
  const resizeObserver = 'ResizeObserver' in window ? new ResizeObserver((entries) => {
    entries.forEach(({ target }) => updateSkeleton(target));
  }) : null;

  function lineGroups(summary) {
    const text = summary.firstChild;
    if (!text || !text.textContent.trim()) return [];
    const range = document.createRange();
    range.selectNodeContents(text);
    const rects = [...range.getClientRects()];
    const summaryRect = summary.getBoundingClientRect();
    const computed = getComputedStyle(summary);
    const lineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.65;
    const visibleBottom = summaryRect.top + summary.clientHeight + LINE_EPSILON;
    const groups = [];

    for (const rect of rects) {
      if (rect.bottom <= summaryRect.top + LINE_EPSILON || rect.top >= visibleBottom) continue;
      const top = rect.top - summaryRect.top;
      let group = groups.find((item) => Math.abs(item.top - top) <= LINE_EPSILON);
      if (!group) {
        group = { top, width: 0 };
        groups.push(group);
      }
      group.width += rect.width;
    }

    return groups
      .sort((a, b) => a.top - b.top)
      .slice(0, MAX_SUMMARY_LINES)
      .map((group) => ({
        top: Math.max(0, group.top),
        width: Math.max(0, Math.min(summaryRect.width, group.width)),
        lineHeight,
      }));
  }

  function barLayer(width, top, height) {
    const widthPercent = Math.max(14, Math.min(96, (width * 100)));
    const highlight = Math.min(6, 3.5 + widthPercent / 100);
    const shade = Math.max(3, highlight - 2);
    return {
      image: `linear-gradient(90deg, color-mix(in srgb, var(--panel), white ${shade}%), color-mix(in srgb, var(--panel), white ${highlight}%), color-mix(in srgb, var(--panel), white ${shade}%))`,
      size: `${widthPercent.toFixed(2)}% ${height.toFixed(2)}px`,
      position: `100% ${Math.max(0, top).toFixed(2)}px`,
    };
  }

  function updateSkeleton(summary) {
    if (!summary || !summary.isConnected) return;
    if (document.body.classList.contains('mirsad-admin-view')) {
      summary.style.setProperty('--summary-skeleton-display', 'none');
      return;
    }

    const groups = lineGroups(summary);
    const hidden = groups.slice(FIRST_VISIBLE_LINE);
    if (!hidden.length) {
      summary.style.setProperty('--summary-skeleton-display', 'none');
      summary.style.removeProperty('--summary-skeleton-image');
      summary.style.removeProperty('--summary-skeleton-size');
      summary.style.removeProperty('--summary-skeleton-position');
      return;
    }

    const lineHeight = hidden[0].lineHeight;
    const barHeight = Math.max(3, lineHeight * BAR_HEIGHT_RATIO);
    const bars = hidden.map((group) => barLayer(group.width / summary.getBoundingClientRect().width, group.top - lineHeight, barHeight));
    summary.style.setProperty('--summary-skeleton-display', 'block');
    summary.style.setProperty('--summary-skeleton-image', `${bars.map((bar) => bar.image).join(',')}, linear-gradient(var(--panel), var(--panel))`);
    summary.style.setProperty('--summary-skeleton-size', `${bars.map((bar) => bar.size).join(',')}, 100% 100%`);
    summary.style.setProperty('--summary-skeleton-position', `${bars.map((bar) => bar.position).join(',')}, 0 0`);
  }

  function observeSummary(summary) {
    if (observed.has(summary)) return;
    observed.add(summary);
    resizeObserver?.observe(summary);
    updateSkeleton(summary);
  }

  function scan(root = document) {
    root.querySelectorAll?.('.card__summary').forEach(observeSummary);
    if (root.matches?.('.card__summary')) observeSummary(root);
  }

  scan();
  new MutationObserver((records) => {
    records.forEach((record) => record.addedNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) scan(node);
    }));
  }).observe(document.body, { childList: true, subtree: true });
  window.mirsadSummarySkeleton = { refresh: () => scan() };
})();
