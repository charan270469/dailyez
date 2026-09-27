// Pure helpers for GET /api/messages/inbox pagination (limit + timestamp
// cursor). Kept here so server/tests/inboxPagination.test.js can check the
// contract without booting Express or Mongo.
export function parseInboxPageParams(query = {}) {
  const limit = Math.min(Math.max(parseInt(String(query.limit ?? '20'), 10) || 20, 1), 100);
  const cursorTime = query.cursor ? new Date(String(query.cursor)).getTime() : NaN;
  const source = String(query.source || '').toLowerCase();
  return {
    limit,
    cursorTime,
    sourceFilter: source === 'gmail' || source === 'whatsapp' ? source : '',
    keywordOnly: query.keywordMatched === 'true',
  };
}

// Slice one page from timestamp-desc raw docs fetched with limit+1; the cursor
// is the OLDEST raw doc's timestamp (not the oldest card's) so grouped/merged
// cards can never skip raw messages that collapsed into an earlier card.
export function sliceInboxPage(sortedDocs, limit) {
  const pageMessages = (sortedDocs || []).slice(0, limit);
  const hasMoreRaw = (sortedDocs || []).length > pageMessages.length;
  const oldestRaw = pageMessages.length > 0 ? pageMessages[pageMessages.length - 1] : null;
  const oldestRawTime = oldestRaw ? new Date(oldestRaw.timestamp || oldestRaw.createdAt || 0).getTime() : NaN;
  return {
    pageMessages,
    nextCursor: hasMoreRaw && !Number.isNaN(oldestRawTime) ? new Date(oldestRawTime).toISOString() : null,
  };
}
