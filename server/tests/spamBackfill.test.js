import assert from 'node:assert/strict';
import { isGmailMessageId } from '../gmail/fetchMessages.js';

assert.equal(isGmailMessageId('CAASBz5I1Q3M8iJjFQ'), true, 'accepts Gmail-style IDs');
assert.equal(isGmailMessageId('3582553773'), false, 'rejects numeric WhatsApp IDs');
assert.equal(isGmailMessageId(''), false, 'rejects empty IDs');

console.log('spam backfill ID validation tests passed');
