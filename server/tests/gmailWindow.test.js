import assert from 'node:assert/strict';

process.env.GMAIL_FETCH_WINDOW_DAYS = '90';

const { gmailFetchQuery, gmailHistoryCutoff, gmailHistoryFilter } = await import('../gmail/fetchMessages.js');

const now = new Date('2026-10-10T10:12:19.410Z');
const expectedCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
assert.equal(gmailHistoryCutoff(now).toISOString(), expectedCutoff.toISOString());
assert.equal(
  gmailFetchQuery(now),
  `after:${Math.floor(expectedCutoff.getTime() / 1000)}`,
  'Gmail search uses the exact 30-day timestamp cutoff',
);

const queryFilter = gmailHistoryFilter(now);
assert.equal(queryFilter.$and.length, 2, 'Gmail cutoff applies to source and platform identifiers');
for (const condition of queryFilter.$and) {
  const branches = condition.$or;
  assert.equal(branches.length, 2);
  assert.equal(branches[1].timestamp.$gte.toISOString(), expectedCutoff.toISOString());
}

console.log('gmailWindow tests passed');
