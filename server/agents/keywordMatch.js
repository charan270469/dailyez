// Deterministic keyword matcher: checks a signal's keywords against an email's subject/body
// (no LLM) and feeds the cheap keyword-match path that lights up "Keyword" badges in All Inbox.
/**
 * Keyword-based substring matching for email signals.
 * This is a cheap, deterministic pre-filter that runs BEFORE any LLM call.
 * No AI involved — just case-insensitive substring checks.
 *
 * Matching logic:
 * - For each keyword in the signal's keywords array
 * - Check if keyword is a substring of email.subject OR email.bodyText
 * - Case-insensitive comparison
 * - If ANY keyword matches, the email is considered a keyword match for that signal
 */

/**
 * Check if an email message matches any keyword for a given signal.
 *
 * @param {Object} message - The email message object
 * @param {string} message.subject - Email subject line
 * @param {string} message.content - Email body text / snippet
 * @param {string[]} keywords - Array of keywords to check (already lowercased/trimmed)
 * @returns {{ matched: boolean, matchedKeywords: string[] }}
 */
export function matchKeywords(message, keywords) {
  if (!keywords || keywords.length === 0) {
    return { matched: false, matchedKeywords: [] };
  }

  const subject = (message.subject || '').toLowerCase();
  const body = (message.content || message.body || message.bodyText || '').toLowerCase();
  const matchedKeywords = [];

  for (const keyword of keywords) {
    const kw = keyword.toLowerCase().trim();
    if (!kw) continue;
    // Check if keyword is a substring of subject OR body
    if (subject.includes(kw) || body.includes(kw)) {
      matchedKeywords.push(kw);
    }
  }

  return {
    matched: matchedKeywords.length > 0,
    matchedKeywords,
  };
}

/**
 * Check an email message against all active signals' keywords.
 * Returns an array of keyword matches, one entry per signal that matched.
 *
 * @param {Object} message - The email message
 * @param {Array} signals - Array of signal objects with keywords arrays
 * @returns {Array<{ signalId: string, keywords: string[], matchedKeywords: string[] }>}
 */
export function matchMessageAgainstAllSignals(message, signals) {
  if (!signals || signals.length === 0) return [];

  const results = [];

  for (const signal of signals) {
    const signalKeywords = signal.keywords || [];
    if (signalKeywords.length === 0) continue;

    const { matched, matchedKeywords } = matchKeywords(message, signalKeywords);
    if (matched) {
      results.push({
        signalId: signal._id,
        context: signal.context || '',
        keywords: signalKeywords,
        matchedKeywords,
      });
    }
  }

  return results;
}