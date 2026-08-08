/**
 * Extract the target institution/entity/sender from a signal's freeform context.
 * This runs ONCE per signal creation, not per email.
 * For now, use a simple rule: if the signal starts with "from" or "gather...from",
 * extract what comes after. Later, upgrade to a quick LLM call if the pattern is
 * too varied.
 *
 * @param {string} context - The user's signal description
 * @returns {{ entityName: string, isSenderIntent: boolean }}
 */
export function parseSignalEntity(context) {
  const lowerContext = context.toLowerCase();

  // Pattern 1: "from X" or "mails from X" or "gather...from X"
  const fromMatch = context.match(/from\s+([A-Za-z\s&.,()-]+?)(?:\s+(?:or|and|,|$|for|if|when|to))/i);
  if (fromMatch) {
    return {
      entityName: fromMatch[1].trim(),
      isSenderIntent: true, // this is a "source" signal, not a topic/event
    };
  }

  // Pattern 2: "alerts?" / "notify" / "tell me when" → likely event-based, not source-based
  if (/alert|notify|tell me when|whenever/i.test(lowerContext)) {
    return {
      entityName: null,
      isSenderIntent: false, // event or topic intent
    };
  }

  return {
    entityName: null,
    isSenderIntent: false,
  };
}

/**
 * Normalize an entity name to common variations (removes extra spaces, case-insensitive).
 * Build a "canonical form" that can be compared against email sender names/domains.
 */
export function normalizeEntityName(entityName) {
  if (!entityName) return '';
  return entityName.toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract likely domain keywords from an entity name.
 * E.g., "ICFAI Foundation for Higher Education" → ["icfai"]
 * "MountBlue Technologies" → ["mountblue"]
 */
export function extractDomainKeywords(entityName) {
  if (!entityName) return [];
  
  // remove common corporate/institutional suffixes, extract main brand tokens
  const words = entityName
    .toLowerCase()
    .replace(/\b(foundation|for|higher|education|technologies|tech|limited|ltd|inc|corp|company)\b/g, '')
    .split(/[\s\-&,]+/)
    .filter(w => w.length > 2);
  
  return [...new Set(words)]; // deduplicate
}
