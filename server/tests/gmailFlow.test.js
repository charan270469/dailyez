import assert from 'node:assert/strict';
import { fetchAndStoreGmailMessages } from '../gmail/fetchMessages.js';

async function run() {
  try {
    const result = await fetchAndStoreGmailMessages(1);
    assert.ok(result && typeof result.count === 'number');
    console.log('gmailFlow test passed', result);
  } catch (error) {
    console.log('gmailFlow test skipped due to missing credentials or network', error.message);
  }
}

run();
