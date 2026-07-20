import assert from 'node:assert/strict';
import { matchWatchlistEntry } from '../watchlistMatcher.js';

const cases = [
  {
    name: 'matches exact email for gmail scope',
    message: { source: 'gmail', from: 'sarah@example.com', content: 'Hello', timestamp: new Date('2024-01-01') },
    entries: [{ type: 'email', platform: 'gmail', value: 'sarah@example.com' }],
    expected: true,
  },
  {
    name: 'matches keyword case-insensitively',
    message: { source: 'gmail', from: 'someone@example.com', content: 'We need urgent review', timestamp: new Date('2024-01-01') },
    entries: [{ type: 'keyword', platform: 'all', value: 'URGENT' }],
    expected: true,
  },
  {
    name: 'does not match different platform',
    message: { source: 'gmail', from: 'someone@example.com', content: 'Hello', timestamp: new Date('2024-01-01') },
    entries: [{ type: 'email', platform: 'discord', value: 'someone@example.com' }],
    expected: false,
  },
];

for (const testCase of cases) {
  const result = matchWatchlistEntry(testCase.message, testCase.entries);
  assert.equal(result.matched, testCase.expected, testCase.name);
}

console.log('watchlistMatcher tests passed');
