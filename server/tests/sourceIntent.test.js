// Unit tests for signal entity parsing and source-domain matching, using node:assert.
import assert from 'node:assert/strict';
import { parseSignalEntity, normalizeEntityName, extractDomainKeywords } from '../agents/parseSignalEntity.js';
import { matchSourceSignal } from '../agents/matchSourceIntent.js';

// ─── parseSignalEntity ───
{
  const r = parseSignalEntity('emails from ICFAI Foundation for Higher Education');
  assert.equal(r.isSenderIntent, true, 'detects sender intent');
  assert.ok(r.entityName.includes('ICFAI'), 'extracts ICFAI');
}
{
  const r = parseSignalEntity('notify me when I get an interview invite');
  assert.equal(r.isSenderIntent, false, 'event intent is not sender intent');
  assert.equal(r.entityName, null, 'no entity for event');
}

// ─── normalizeEntityName / extractDomainKeywords ───
assert.equal(normalizeEntityName('  ICFAI   Foundation  '), 'icfai foundation');
assert.deepEqual(extractDomainKeywords('ICFAI Foundation for Higher Education'), ['icfai']);

// ─── matchSourceSignal ───
const source = { isSenderIntent: true, entityName: 'ICFAI Foundation for Higher Education' };

// Matches on domain keyword
assert.equal(
  matchSourceSignal({ from: 'ICFAI <noreply@icfaiuniversity.in>' }, source).matched,
  true,
  'matches domain containing entity keyword'
);

// Matches on display name
assert.equal(
  matchSourceSignal({ from: 'ICFAI Foundation for Higher Education <noreply@ifheindia.org>' }, source).matched,
  true,
  'matches display name'
);

// Third-party veto
assert.equal(
  matchSourceSignal({ from: 'Internshala <x@internshala.com>' }, source).matched,
  false,
  'vetoes third-party senders'
);

// Non-source signal short-circuits
assert.equal(
  matchSourceSignal({ from: 'a@b.com' }, { isSenderIntent: false, entityName: null }).matched,
  false,
  'non-source signal does not match'
);

console.log('sourceIntent tests passed');
