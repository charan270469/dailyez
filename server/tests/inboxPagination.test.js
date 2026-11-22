// Paged All Inbox contract: limit defaults to 20 (clamped 1..100), cursor is
// the last message's timestamp (new pages query timestamp < cursor so newly
// arrived mail never shifts pages), and the cursor always comes from the
// oldest RAW doc — not the oldest card — so WhatsApp grouping can never skip.
import assert from 'node:assert/strict';

import { parseInboxPageParams, sliceInboxPage } from '../inboxPagination.js';

function docs(count, startMinutesAgo) {
  return Array.from({ length: count }, (_, i) => ({
    _id: 'm' + (i + 1),
    timestamp: new Date(Date.now() - (startMinutesAgo + i) * 60_000).toISOString(),
  }));
}

const params = parseInboxPageParams({});
assert.equal(params.limit, 20, 'default limit is 20');
assert.equal(parseInboxPageParams({ limit: '5' }).limit, 5, 'explicit limit honored');
assert.equal(parseInboxPageParams({ limit: '500' }).limit, 100, 'limit clamped at 100');
assert.equal(parseInboxPageParams({ source: 'Gmail' }).sourceFilter, 'gmail', 'source lowercased');
assert.equal(parseInboxPageParams({ source: 'all' }).sourceFilter, '', 'unknown source ignored');
assert.equal(parseInboxPageParams({ keywordMatched: 'true' }).keywordOnly, true, 'keyword toggle parsed');
assert.ok(Number.isNaN(parseInboxPageParams({}).cursorTime), 'no cursor on first page');

// 25 docs, limit 20 + 1 probe: first page ends with a cursor, second exhausts.
const all = docs(25, 1);
const first = sliceInboxPage(all.slice(0, 21), 20);
assert.equal(first.pageMessages.length, 20, 'first page holds 20');
assert.ok(first.nextCursor, 'first page reports nextCursor');
assert.equal(
  first.nextCursor,
  new Date(first.pageMessages[19].timestamp).toISOString(),
  'cursor is the oldest RAW doc timestamp',
);
const second = sliceInboxPage(
  all.filter((d) => new Date(d.timestamp).getTime() < new Date(first.nextCursor).getTime()).slice(0, 21),
  20,
);
assert.equal(second.pageMessages.length, 5, 'second page holds the rest');
assert.equal(second.nextCursor, null, 'exhausted pages report null cursor');

console.log('inboxPagination tests passed');
