// Google OAuth2 client wrapper: builds the OAuth2 client from env credentials and
// saves/loads/refreshes/disconnects Gmail refresh tokens in the MongoDB users collection.
import { getCollection } from './db.js';
import dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback';

let oauth2Client = null;

if (clientId && clientSecret) {
  oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getOAuthClient() {
  return oauth2Client;
}

export async function saveRefreshToken(userId, refreshToken) {
  const usersCollection = await getCollection('users');
  await usersCollection.updateOne(
    { _id: userId },
    { $set: { refreshToken, updatedAt: new Date() } },
    { upsert: true }
  );
}

export async function loadRefreshToken(userId = 'default') {
  const usersCollection = await getCollection('users');
  const user = await usersCollection.findOne({ _id: userId });
  return user?.refreshToken || null;
}

/**
 * Revokes the Gmail connection for a user by removing the stored refresh token
 * from MongoDB. Previously fetched messages are intentionally kept.
 * Makes GET /api/auth/status report Gmail as disconnected afterward.
 */
export async function disconnectGmail(userId = 'default') {
  const usersCollection = await getCollection('users');
  const result = await usersCollection.updateOne(
    { _id: userId },
    { $unset: { refreshToken: '' }, $set: { updatedAt: new Date() } }
  );
  return result;
}

export async function getValidAccessToken(userId = 'default') {
  const refreshToken = await loadRefreshToken(userId);

  if (!refreshToken) {
    throw new Error('No refresh token found for the user');
  }

  const oauthClient = getOAuthClient();
  if (!oauthClient) {
    throw new Error('Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  }

  oauthClient.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oauthClient.refreshAccessToken();
  return credentials.access_token;
}

/**
 * Returns a fully configured OAuth2 client with a valid access token.
 * This is the correct way to authenticate googleapis calls.
 */
export async function getAuthenticatedOAuthClient(userId = 'default') {
  const refreshToken = await loadRefreshToken(userId);

  if (!refreshToken) {
    throw new Error('No refresh token found for the user');
  }

  const oauthClient = getOAuthClient();
  if (!oauthClient) {
    throw new Error('Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  }

  oauthClient.setCredentials({ refresh_token: refreshToken });
  // Force a token refresh to ensure we have a valid access token
  await oauthClient.refreshAccessToken();
  return oauthClient;
}