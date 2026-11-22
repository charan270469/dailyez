// Deterministic source-domain matcher for "emails from X" signals: checks the sender's
// domain and display name against the extracted entity name (no LLM call).
/**
 * Deterministic source-domain matching. NO LLM CALL — pure code.
 * Checks if the email's sender domain/name plausibly matches the signal's
 * extracted entity name.
 */
export function matchSourceSignal(message, signal) {
  if (!signal.isSenderIntent || !signal.entityName) {
    return {
      matched: false,
      reasoning: 'Signal is not a source-intent signal',
      confidence: 'high',
    };
  }

  const senderDomain = extractDomain(message.from);
  const senderDisplayName = extractDisplayName(message.from);
  const targetKeywords = extractDomainKeywords(signal.entityName);

  // Check 1: Does the sender's domain contain any keyword from the entity name?
  const domainMatches = targetKeywords.some(kw => senderDomain?.includes(kw));

  // Check 2: Does the sender's display name (if any) closely match the entity name?
  const displayNameMatches = senderDisplayName &&
    normalizeEntityName(senderDisplayName).includes(normalizeEntityName(signal.entityName));

  // Check 3: Quick veto — is the sender domain a known third-party service?
  const knownThirdParties = [
    'internshala.com', 'linkedin.com', 'naukri.com', 'freshersindia.in',
    'twinehq.com', 'wemakedevs.org', 'crio.in', 'mountblue.io', 'abekus.co',
  ];
  const isThirdParty = knownThirdParties.some(d => senderDomain?.includes(d));

  const matched = (domainMatches || displayNameMatches) && !isThirdParty;

  return {
    matched,
    reasoning: matched
      ? `Sender domain/name matches the target entity "${signal.entityName}".`
      : `Sender (${senderDomain || senderDisplayName}) does not match target entity "${signal.entityName}".`,
    confidence: matched ? 'high' : 'high', // high confidence either way — it's code, not guess
    summary: matched ? `Email from ${signal.entityName}.` : '',
  };
}

function extractDomain(fromHeader) {
  const match = fromHeader.match(/<([^>]+)>/);
  const email = match ? match[1] : fromHeader;
  const domainMatch = email.match(/@([\w.-]+)/);
  return domainMatch ? domainMatch[1].toLowerCase() : null;
}

function extractDisplayName(fromHeader) {
  const match = fromHeader.match(/^([^<]+)</);
  return match ? match[1].trim() : null;
}

function normalizeEntityName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDomainKeywords(entityName) {
  return entityName
    .toLowerCase()
    .replace(/\b(foundation|for|higher|education|technologies|tech|limited|ltd|inc|corp|company)\b/g, '')
    .split(/[\s\-&,]+/)
    .filter(w => w.length > 2);
}
