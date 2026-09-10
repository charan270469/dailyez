// Verifies the Gmail sync overlap guard (gmailSyncInFlight in fetchMessages.js):
// while one sync is in flight a second concurrent sync call must be skipped and
// reported as `{ skipped: true, reason: 'already-in-progress' }` instead of
// overlapping; once the in-flight sync settles, the guard must be released so
// the next call proceeds normally. No Gmail credentials or MongoDB are needed —
// the skip decision happens before any network I/O, and the in-flight call is
// allowed to fail on the missing Mongo/Gmail setup.
import assert from 'node:assert/strict';

// Force the no-Mongo path so the in-flight sync settles fast and deterministically
// even when a real MONGODB_URI exists in .env. Static imports are hoisted before
// this assignment runs, so the module is loaded dynamically AFTER the override.
process.env.MONGODB_URI = '';

async function run() {
  const { fetchAndStoreGmailMessages } = await import('../gmail/fetchMessages.js');

  // Start sync #1 with a dummy OAuth client — it takes the lock and then fails
  // later on the missing Mongo/Gmail setup. The guard check and flag set happen
  // synchronously, so the second call below is guaranteed to see the flag.
  const first = fetchAndStoreGmailMessages(50, {});

  // Sync #2 fires while #1 is still in flight: it must be skipped, not overlapped.
  const second = await fetchAndStoreGmailMessages(50, {});
  assert.equal(second.skipped, true, 'second concurrent sync must be skipped');
  assert.equal(second.reason, 'already-in-progress', 'skip is reported with its reason');
  assert.equal(second.count, 0, 'skipped sync reports zero work done');

  // Let the in-flight sync settle (it fails on credentials — expected here).
  try {
    await first;
  } catch {
    // Expected: no Mongo/Gmail setup in this test process.
  }

  // After settling, the flag must be released: the next call must NOT be skipped.
  // It proceeds past the guard and then fails on credentials, which is exactly
  // what we want to observe.
  let guardReleased = false;
  try {
    const third = await fetchAndStoreGmailMessages(50, {});
    guardReleased = !third.skipped;
  } catch {
    guardReleased = true;
  }
  assert.ok(guardReleased, 'in-flight flag is cleared once the sync settles');

  console.log('syncOverlap tests passed');
}

run();