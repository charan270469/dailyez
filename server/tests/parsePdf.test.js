// Standalone harness for the Gemini PDF extractor (server/agents/parsePdfAttachment.js).
// Independent of any ingestion flow — loads one PDF from disk and runs it
// through extractPdfContent directly.
// Run with: node server/tests/parsePdf.test.js <path-to-resume.pdf>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

// Stub network: unit-test the pure normalizer shape without spending a Gemini call.
{
  const { normalizePdfExtraction } = await import('../agents/parsePdfAttachment.js');

  const good = normalizePdfExtraction(
    JSON.stringify({
      text: 'Jane Doe\nSenior Engineer at Acme',
      isResume: true,
      name: 'Jane Doe',
      skills: ['Node.js', ' ', 42],
      recentRole: 'Senior Engineer',
      recentCompany: 'Acme',
    })
  );
  assert.equal(good.name, 'Jane Doe');
  assert.deepEqual(good.skills, ['Node.js']);
  assert.equal(good.recentCompany, 'Acme');

  assert.equal(normalizePdfExtraction('not json'), null);
  assert.equal(normalizePdfExtraction('```json\n{"text":"x"}\n```').text, 'x');
  assert.equal(normalizePdfExtraction(JSON.stringify({ text: '  ' })), null);
  assert.equal(normalizePdfExtraction(JSON.stringify({ nope: 1 })), null);
}

// extractPdfContent never throws on bad input (no network touched).
{
  const { extractPdfContent } = await import('../agents/parsePdfAttachment.js');
  assert.equal(await extractPdfContent(null), null);
  assert.equal(await extractPdfContent(Buffer.alloc(0)), null);
  assert.equal(await extractPdfContent(Buffer.from('hello, not a pdf')), null);
}

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.log('parsePdf unit checks passed (no PDF given — live check skipped).');
  console.log('Usage: node server/tests/parsePdf.test.js <path-to-resume.pdf>');
  process.exit(0);
}

const resolved = path.resolve(pdfPath);
if (!fs.existsSync(resolved)) {
  console.error(`[parsePdf.test] PDF not found: ${resolved}`);
  process.exit(1);
}

const { extractPdfContent } = await import('../agents/parsePdfAttachment.js');
const result = await extractPdfContent(fs.readFileSync(resolved));
if (result === null) {
  console.error('[parsePdf.test] FAILED: extractor returned null (see [parsePdf] log above)');
  process.exit(1);
}

assert.ok(result.text.length > 50, 'expected non-trivial extracted text');
console.log(`--- text chars: ${result.text.length} ---`);
console.log(result.text.slice(0, 800));
console.log('--- structured ---');
console.log(JSON.stringify({ isResume: result.isResume, name: result.name, skills: result.skills, recentRole: result.recentRole, recentCompany: result.recentCompany }, null, 2));
console.log('parsePdf live check passed');
