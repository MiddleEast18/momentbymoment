(() => {
  'use strict';

  const decodeEntities = (value) => {
    let current = String(value ?? '');
    for (let pass = 0; pass < 4; pass += 1) {
      const parsed = new DOMParser().parseFromString(`<body>${current}</body>`, 'text/html');
      const decoded = parsed.body?.textContent ?? current;
      if (decoded === current) break;
      current = decoded;
    }
    return current;
  };

  const normalize = (value) => {
    let text = String(value ?? '').replace(/\u0000/g, '');
    text = text
      .replace(/<\/?br\s*>/gi, '\n')
      .replace(/<(?:p|div|li|h[1-6]|blockquote|section|article)(?:\s[^>]*)?>/gi, '\n')
      .replace(/<\/(?:p|div|li|h[1-6]|blockquote|section|article)\s*>/gi, '\n')
      .replace(/<[^>]*>/g, '');
    text = decodeEntities(text)
      .replace(/<\/?br\s*>/gi, '\n')
      .replace(/<(?:p|div|li|h[1-6]|blockquote|section|article)(?:\s[^>]*)?>/gi, '\n')
      .replace(/<\/(?:p|div|li|h[1-6]|blockquote|section|article)\s*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return text;
  };

  const search = (value) => normalize(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670\u0610-\u061A\u06D6-\u06ED]/g, '')
    .replace(/[أإآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();

  window.MirsadText = Object.freeze({ normalize, search, decodeEntities });
})();
