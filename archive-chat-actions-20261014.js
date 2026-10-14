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

  function hasUnsettledRequest(retryRequest) {
    return !!retryRequest && typeof retryRequest.id === 'string' && retryRequest.id.length > 0;
  }

  function isValidChatChargeReceipt(payload) {
    const unlocks = payload?.unlocks;
    if (payload?.finalized !== true || !unlocks || typeof unlocks !== 'object' || Array.isArray(unlocks)) return false;
    const charged = Number(unlocks.charged);
    const remaining = Number(unlocks.remaining);
    return (unlocks.unlimited === true || unlocks.unlimited === false)
      && Number.isSafeInteger(charged) && (charged === 0 || charged === 50)
      && Number.isSafeInteger(remaining) && remaining >= 0
      && Array.isArray(unlocks.operations) && unlocks.operations.includes('archive_chat')
      && (!unlocks.unlimited || charged === 0);
  }

  const api = Object.freeze({ taskTypeForSuggestion, shouldShowArticle, shouldShowBriefing, mustSettlePendingCommit, hasPendingCommit, hasUnsettledRequest, isValidChatChargeReceipt });
  root.MirsadArchiveActions = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
