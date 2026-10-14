const test = require('node:test');
const assert = require('node:assert/strict');
const {
  taskTypeForSuggestion,
  shouldShowArticle,
  shouldShowBriefing,
  mustSettlePendingCommit,
  hasPendingCommit,
  hasUnsettledRequest,
  isValidChatChargeReceipt,
} = require('../archive-chat-actions-20261014.js');

test('task suggestions map to task types in Arabic and English', () => {
  assert.equal(taskTypeForSuggestion('لخّص'), 'summarize');
  assert.equal(taskTypeForSuggestion('حلّل'), 'analyze');
  assert.equal(taskTypeForSuggestion('الجهات المذكورة'), 'entities');
  assert.equal(taskTypeForSuggestion('بطاقة مرتبطة'), 'related');
  assert.equal(taskTypeForSuggestion('بطاقة أخرى'), 'another');
  assert.equal(taskTypeForSuggestion('Another card'), 'another');
  assert.equal(taskTypeForSuggestion('اكتب خبرًا جديدًا'), null);
});

test('pending charge blocks a different query but not its own idempotent retry', () => {
  const pending = { query: 'لخّص الخبر', id: 'req-1', phase: 'commit' };
  assert.equal(hasPendingCommit(pending), true);
  assert.equal(mustSettlePendingCommit(pending, 'سؤال جديد'), true);
  assert.equal(mustSettlePendingCommit(pending, 'لخّص الخبر'), false);
  assert.equal(mustSettlePendingCommit({ query: 'سؤال', id: 'req-2' }, 'سؤال جديد'), false);
  assert.equal(hasPendingCommit(null), false);
});

test('any unresolved archive request blocks clearing until it is recovered', () => {
  assert.equal(hasUnsettledRequest({ query: 'سؤال', id: 'req-1' }), true);
  assert.equal(hasUnsettledRequest({ query: 'سؤال', id: 'req-1', phase: 'commit' }), true);
  assert.equal(hasUnsettledRequest(null), false);
  assert.equal(hasUnsettledRequest({ query: 'سؤال' }), false);
});

test('chat charge receipts accept only finalized 50-unlock or idempotent zero-unlock charges', () => {
  const receipt = (charged, unlimited = false) => ({
    finalized: true,
    unlocks: { charged, remaining: 250, unlimited, operations: ['archive_chat'] },
  });
  assert.equal(isValidChatChargeReceipt(receipt(50)), true);
  assert.equal(isValidChatChargeReceipt(receipt(0)), true);
  assert.equal(isValidChatChargeReceipt(receipt(0, true)), true);
  assert.equal(isValidChatChargeReceipt(receipt(100)), false);
  assert.equal(isValidChatChargeReceipt({ ...receipt(50), finalized: false }), false);
  assert.equal(isValidChatChargeReceipt({ finalized: true, unlocks: { charged: 50, remaining: 2, operations: ['article_unlock'] } }), false);
});

test('summarize and analyze do not repeat the article card', () => {
  assert.equal(shouldShowArticle('summarize', 'a1', []), false);
  assert.equal(shouldShowArticle('analyze', 'a1', []), false);
  assert.equal(shouldShowArticle('entities', 'a1', []), false);
  assert.equal(shouldShowArticle(null, 'a1', []), true);
  assert.equal(shouldShowArticle('related', 'a2', ['a1']), true);
  assert.equal(shouldShowArticle('another', 'a1', ['a1']), false);
  assert.equal(shouldShowArticle(null, 'a1', ['a1'], true), true);
});

test('summarize shows its summary only; analyze may show structured analysis', () => {
  assert.equal(shouldShowBriefing('summarize'), false);
  assert.equal(shouldShowBriefing('analyze'), true);
  assert.equal(shouldShowBriefing(null), true);
});
