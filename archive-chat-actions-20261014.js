(function (root) {
  'use strict';

  function foldLabel(value) {
    return String(value || '')
      .toLocaleLowerCase('ar')
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }

  function taskTypeForSuggestion(value) {
    const label = foldLabel(value);
    const types = {
      'لخص': 'summarize',
      'summarize': 'summarize',
      'حلل': 'analyze',
      'analyze': 'analyze',
      'الجهات المذكوره': 'entities',
      'who is mentioned': 'entities',
      'بطاقه مرتبطه': 'related',
      'related card': 'related',
      'بطاقه اخري': 'another',
      'another card': 'another',
    };
    return types[label] || null;
  }

  function shouldShowArticle(taskType, articleId, shownIds, restoring = false) {
    if (taskType && taskType !== 'related' && taskType !== 'another') return false;
    const id = String(articleId || '');
    return restoring || !id || !Array.isArray(shownIds) || !shownIds.includes(id);
  }

  function shouldShowBriefing(taskType) {
    return !taskType || taskType === 'analyze';
  }

  function mustSettlePendingCommit(retryRequest, query) {
    return !!retryRequest && retryRequest.phase === 'commit' && retryRequest.query !== query;
  }

  function hasPendingCommit(retryRequest) {
    return !!retryRequest && retryRequest.phase === 'commit';
  }

  const api = Object.freeze({ taskTypeForSuggestion, shouldShowArticle, shouldShowBriefing, mustSettlePendingCommit, hasPendingCommit });
  root.MirsadArchiveActions = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
