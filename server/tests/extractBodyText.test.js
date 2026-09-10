// Pure-function test for Gmail full-body extraction (`extractBodyText` in
// ../gmail/fetchMessages.js). No credentials/network needed — the payload
// shapes mimic what the Gmail API returns for `format: 'full'`.
// Run with: node server/tests/extractBodyText.test.js
import assert from 'node:assert/strict';
import { extractBodyText } from '../gmail/fetchMessages.js';

// Mirror Gmail's base64url encoding (URL-safe alphabet, no padding).
const b64url = (s) =>
  Buffer.from(s, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const collapse = (s) => s.replace(/\s+/g, ' ');

async function run() {
  // 1. Top-level text/plain part (simple messages have no `parts`).
  const plain = extractBodyText({ mimeType: 'text/plain', body: { data: b64url('Hello world') } });
  assert.equal(plain, 'Hello world');

  // 2. multipart/alternative with BOTH plain and html → prefer text/plain.
  const alt = extractBodyText({
    mimeType: 'multipart/alternative',
    parts: [
      { mimeType: 'text/plain', body: { data: b64url('Plain body line') } },
      { mimeType: 'text/html', body: { data: b64url('<p>HTML <b>body</b></p>') } },
    ],
  });
  assert.equal(alt, 'Plain body line');

  // 3. HTML-only body → tags stripped, block tags → newlines, entities decoded.
  const htmlOnly = extractBodyText({
    mimeType: 'multipart/alternative',
    parts: [
      { mimeType: 'text/html', body: { data: b64url('<div>Hello <b>there</b> &amp; welcome<br>next line</div>') } },
    ],
  });
  assert.ok(collapse(htmlOnly).includes('Hello there & welcome'), `got: ${htmlOnly}`);
  assert.ok(collapse(htmlOnly).includes('next line'), `got: ${htmlOnly}`);

  // 4. Nested multipart/mixed (e.g. with attachments) → recursion finds text.
  const mixed = extractBodyText({
    mimeType: 'multipart/mixed',
    parts: [
      {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: b64url('Deep plain') } },
          { mimeType: 'text/html', body: { data: b64url('<p>Deep html</p>') } },
        ],
      },
      { mimeType: 'application/pdf', filename: 'x.pdf', body: { data: b64url('junk') } },
    ],
  });
  assert.equal(mixed, 'Deep plain');

  // 5. Garbage/empty inputs → ''
  assert.equal(extractBodyText(undefined), '');
  assert.equal(extractBodyText(null), '');
  assert.equal(extractBodyText({}), '');
  assert.equal(extractBodyText({ mimeType: 'multipart/mixed', parts: [] }), '');

  console.log('extractBodyText test passed');
}

run();