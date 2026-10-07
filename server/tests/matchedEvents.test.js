// Minimal runnable check for the live matched-message push hub
// (server/matchedEvents.js). No frameworks, no network.
import assert from 'node:assert/strict';

const { addMatchedClient, removeMatchedClient, broadcastMatchedMessage } =
  await import('../matchedEvents.js');

// One fake SSE client captures written payloads.
const writes = [];
const fakeRes = { write: (chunk) => writes.push(String(chunk)) };
addMatchedClient(fakeRes);
broadcastMatchedMessage({ id: 'm1', matched: true });
assert.equal(writes.length, 1);
assert.ok(writes[0].startsWith('event: message:matched\n'));
assert.ok(writes[0].includes('"id":"m1"'));

// Removed clients get nothing; broadcast with zero clients is a no-op.
removeMatchedClient(fakeRes);
broadcastMatchedMessage({ id: 'm2', matched: true });
assert.equal(writes.length, 1);

// A throwing client is dropped, never wedges the hub.
addMatchedClient({ write: () => { throw new Error('dead'); } });
broadcastMatchedMessage({ id: 'm3', matched: true });

console.log('matched events hub tests passed');
