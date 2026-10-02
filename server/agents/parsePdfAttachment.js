// Standalone PDF extraction via Gemini — wired into Gmail ingestion
// (server/gmail/fetchMessages.js) on an opt-in basis.
// Testable on its own: `node server/tests/parsePdf.test.js <resume.pdf>`.
//
// Uses gemini-2.0-flash-lite specifically (NOT any 2.5-line model — those have
// a far lower daily request ceiling and the 2.5 line is being deprecated).
import { GoogleGenAI } from '@google/genai';
import { noteGeminiCall, GEMINI_SOURCE_PDF_PARSE } from './geminiBudget.js';

const MODEL = 'gemini-2.0-flash-lite';

// ponytail: naive inline upload caps out at ~20MB; larger PDFs need the Files
// API upload-then-reference flow instead of inline_data.
const MAX_PDF_BYTES = 20 * 1024 * 1024;

const PROMPT = `Extract this PDF document.
Return STRICT JSON only (no markdown fences, no other text) with exactly these keys:
{
  "text": "the full plain-text content of the document",
  "isResume": true/false (whether the document looks like a resume/CV),
  "name": "candidate full name, or null when not a resume / not found",
  "skills": ["key skills, or [] when not a resume / none found"],
  "recentRole": "most recent job title, or null",
  "recentCompany": "most recent employer, or null"
}`;

/**
 * Normalizes raw model output into the canonical shape. Pure (no network) so
 * it is unit-testable. Returns null when the response is not usable JSON.
 */
export function normalizePdfExtraction(raw) {
  if (typeof raw !== 'string') return null;
  let cleaned = raw.trim();
  // Tolerate markdown fences even though the prompt forbids them.
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
  if (!text) return null;
  const strOrNull = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const strArr = (v) =>
    Array.isArray(v)
      ? v.filter((x) => typeof x === 'string' && x.trim()).map((s) => s.trim())
      : [];
  return {
    text,
    isResume: parsed.isResume === true,
    name: strOrNull(parsed.name),
    skills: strArr(parsed.skills),
    recentRole: strOrNull(parsed.recentRole),
    recentCompany: strOrNull(parsed.recentCompany),
  };
}

function responseToText(response) {
  if (typeof response?.text === 'string' && response.text.trim()) return response.text;
  try {
    const parts = response?.candidates?.[0]?.content?.parts || [];
    const joined = parts
      .map((p) => (typeof p?.text === 'string' ? p.text : ''))
      .join('')
      .trim();
    return joined || null;
  } catch {
    return null;
  }
}

/**
 * Extracts plain text (+ resume fields when applicable) from a PDF buffer.
 *
 * Never throws: returns the normalized object on success, or null on any
 * failure (bad input, missing key, API error, malformed response) with a
 * clear log line.
 *
 * @param {Buffer} pdfBuffer - raw PDF file bytes
 * @returns {Promise<{text:string,isResume:boolean,name:string|null,skills:string[],recentRole:string|null,recentCompany:string|null}|null>}
 */
export async function extractPdfContent(pdfBuffer) {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    console.error('[parsePdf] FAILED (bad input): expected a non-empty Buffer');
    return null;
  }
  if (pdfBuffer.length > MAX_PDF_BYTES) {
    console.error(
      `[parsePdf] FAILED (too large): ${(pdfBuffer.length / 1024 / 1024).toFixed(1)}MB exceeds the ${MAX_PDF_BYTES / 1024 / 1024}MB inline limit`
    );
    return null;
  }
  if (pdfBuffer.subarray(0, 4).toString('latin1') !== '%PDF') {
    console.error('[parsePdf] FAILED (bad input): buffer does not start with %PDF');
    return null;
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error('[parsePdf] FAILED (config): GEMINI_API_KEY is not set');
    return null;
  }

  let raw;
  try {
    // Client is constructed lazily (not at import time) so the key only needs
    // to be loaded before the call, not before the import.
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' } },
            { text: PROMPT },
          ],
        },
      ],
      config: { responseMimeType: 'application/json' },
    });
    // Count every completed request: the key's RPD quota is shared with the
    // planned matching fallback, and this is the visibility for that split.
    noteGeminiCall(GEMINI_SOURCE_PDF_PARSE);
    raw = responseToText(response);
  } catch (err) {
    console.error(`[parsePdf] FAILED (Gemini error): ${err?.message || err}`);
    return null;
  }

  const result = normalizePdfExtraction(raw);
  if (result === null) {
    console.error(`[parsePdf] FAILED (malformed response): ${String(raw).slice(0, 300)}`);
    return null;
  }
  console.log(
    `[parsePdf] ok chars=${result.text.length} isResume=${result.isResume} name=${result.name || '-'} skills=${result.skills.length}`
  );
  return result;
}
