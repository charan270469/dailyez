export function buildNormalizedMessage(message) {
  const source = String(message?.source ?? '').trim().toLowerCase();
  const from = String(message?.from ?? '').trim().toLowerCase();
  const content = String(message?.content ?? '').trim().toLowerCase();
  const timestamp = message?.timestamp ?? null;

  return { source, from, content, timestamp };
}

export function matchWatchlistEntry(message, entries = []) {
  const normalized = buildNormalizedMessage(message);

  for (const entry of entries) {
    if (!entry?.active && entry?.active !== undefined) {
      continue;
    }

    const entryPlatform = String(entry?.platform ?? 'all').trim().toLowerCase();
    const entryType = String(entry?.type ?? '').trim().toLowerCase();
    const value = String(entry?.value ?? '').trim();
    const isGlobalScope = entryPlatform === 'all';
    const matchesPlatform = isGlobalScope || normalized.source === entryPlatform;

    if (!matchesPlatform) {
      continue;
    }

    if (entryType === 'email' || entryType === 'phone' || entryType === 'username') {
      const normalizedValue = value.trim().toLowerCase();
      if (normalized.from === normalizedValue || normalized.content.includes(normalizedValue)) {
        return { matched: true, matchedEntry: entry };
      }
      continue;
    }

    if (entryType === 'keyword' || entryType === 'name') {
      const normalizedValue = value.trim().toLowerCase();
      if (normalized.content.includes(normalizedValue) || normalized.from.includes(normalizedValue)) {
        return { matched: true, matchedEntry: entry };
      }
    }
  }

  return { matched: false, matchedEntry: null };
}
