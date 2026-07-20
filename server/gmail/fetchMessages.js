import { google } from 'googleapis';
import { getCollection } from '../db.js';
import { getOAuthClient, getValidAccessToken } from '../auth.js';
import { matchWatchlistEntry } from '../watchlistMatcher.js';

export async function fetchAndStoreGmailMessages(maxResults = 10, oauth2ClientArg = null) {
  let gmail;
  if (oauth2ClientArg) {
    // Use the already-authenticated OAuth2 client (e.g. from OAuth callback)
    gmail = google.gmail({ version: 'v1', auth: oauth2ClientArg });
  } else {
    // Standalone / scheduled sync: get a fresh access token
    const accessToken = await getValidAccessToken();
    gmail = google.gmail({ version: 'v1', auth: accessToken });
  }
  const response = await gmail.users.messages.list({ userId: 'me', maxResults });
  const messages = response.data.messages || [];
  const messagesCollection = await getCollection('messages');
  const watchlistCollection = await getCollection('watchlist');
  const entries = await watchlistCollection.find({ active: true }).toArray();

  let matchedCount = 0;

  for (const message of messages) {
    const details = await gmail.users.messages.get({ userId: 'me', id: message.id });
    const payload = details.data.payload || {};
    const headers = payload.headers || [];
    const subject = headers.find((header) => header.name === 'Subject')?.value || 'No subject';
    const sender = headers.find((header) => header.name === 'From')?.value || 'Unknown sender';
    const body = details.data.snippet || '';
    const timestamp = details.data.internalDate ? new Date(Number(details.data.internalDate)) : new Date();
    const normalizedMessage = {
      source: 'gmail',
      from: sender,
      content: `${subject}\n${body}`,
      timestamp,
    };
    const match = matchWatchlistEntry(normalizedMessage, entries);

    if (match.matched) {
      matchedCount += 1;
    }

    await messagesCollection.updateOne(
      { id: message.id },
      {
        $setOnInsert: { id: message.id },
        $set: {
          source: 'gmail',
          platform: 'gmail',
          from: sender,
          subject,
          content: body,
          timestamp,
          matched: match.matched,
          matchedEntry: match.matchedEntry || null,
          status: 'active',
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  return { count: messages.length, matchedCount };
}
