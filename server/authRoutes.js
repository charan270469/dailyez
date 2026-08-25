// Google OAuth2 + connection-status routes: drives the consent-screen flow, handles the
// OAuth callback, updates the user profile, and reports per-platform connection status.
import { getCollection } from './db.js';
import { getOAuthClient, saveRefreshToken, disconnectGmail } from './auth.js';
import fs from 'node:fs';
import path from 'node:path';
import { fetchAndStoreGmailMessages } from './gmail/fetchMessages.js';
import { startWhatsAppConnection, getWhatsAppConnectionState } from './whatsapp/connection.js';

const whatsappSessionPath = path.resolve(process.cwd(), 'server', 'whatsapp-session.json');

const MAX_AVATAR_BYTES = 4 * 1024 * 1024; // ~4 MB cap for a profile photo (data URL)

/**
 * Validates + normalizes an avatar value coming from the client.
 * Accepts an external https:// URL (e.g. the Google profile photo) or a base64
 * data URL (a newly uploaded image). Returns the normalized string or null.
 */
function sanitizeAvatar(avatar) {
  if (avatar === undefined || avatar === null || avatar === '') return null;

  const value = String(avatar).trim();

  const isDataUrl =
    /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(value) || /^data:image\/[a-z+.-]+;base64,/i.test(value);
  const isHttpUrl = /^https?:\/\/.+/i.test(value);

  if (!isDataUrl && !isHttpUrl) {
    throw new Error('Avatar must be an image URL or a base64 image data URL.');
  }

  if (isDataUrl) {
    const rawBytes = Math.ceil((value.length - value.indexOf(',') - 1) * 3 / 4);
    if (rawBytes > MAX_AVATAR_BYTES) {
      throw new Error('Profile photo is too large. Please upload an image under 4 MB.');
    }
  }

  return value;
}

export async function registerAuthRoutes(app) {
  app.put('/api/auth/profile', async (req, res) => {
    try {
      const { name } = req.body;
      const usersCollection = await getCollection('users');
      const updateData = {};
      if (name !== undefined && typeof name === 'string') updateData.name = name.trim();
      // email is intentionally NOT updated here — it is set from Google OAuth and
      // must stay immutable once connected (login email). A client-supplied email
      // is ignored so the field can never be changed.
      if (req.body.avatar !== undefined) {
        const avatar = sanitizeAvatar(req.body.avatar);
        if (avatar === null) updateData.avatar = null;
        else updateData.avatar = avatar;
      }
      updateData.updatedAt = new Date();

      await usersCollection.updateOne(
        { _id: 'default' },
        { $set: updateData },
        { upsert: true }
      );

      const user = await usersCollection.findOne({ _id: 'default' });
      res.json({
        ok: true,
        user: {
          name: user?.name || null,
          email: user?.email || null,
          avatar: user?.avatar || null,
        },
      });
    } catch (error) {
      console.error('Failed to update profile', error);
      res.status(500).json({ ok: false, error: 'Failed to update profile' });
    }
  });

  app.get('/api/auth/status', async (_req, res) => {
    try {
      const usersCollection = await getCollection('users');
      const user = await usersCollection.findOne({ _id: 'default' });
      const gmailConnected = Boolean(user?.refreshToken);
      // Live Baileys connection (auth_session folder) OR the legacy session file.
      const whatsappConnected =
        getWhatsAppConnectionState().connected === true ||
        fs.existsSync(whatsappSessionPath);
      const discordConnected = Boolean(process.env.DISCORD_BOT_TOKEN);

      res.json({
        gmail: gmailConnected,
        whatsapp: whatsappConnected,
        discord: discordConnected,
        user: {
          name: user?.name || null,
          email: user?.email || null,
          avatar: user?.avatar || null,
        },
      });
    } catch (error) {
      console.error('Failed to load auth status', error);
      res.json({ gmail: false, whatsapp: false, discord: false, user: { name: null, email: null, avatar: null } });
    }
  });

  app.patch('/api/auth/gmail/disconnect', async (_req, res) => {
    try {
      await disconnectGmail('default');
      res.json({ ok: true, message: 'Gmail disconnected.' });
    } catch (error) {
      console.error('Failed to disconnect Gmail', error);
      res.status(500).json({ ok: false, error: 'Failed to disconnect Gmail' });
    }
  });

  // POST /api/auth/:platform/disconnect — generic disconnect endpoint used by the
  // frontend "Disconnect" buttons. Dispatches to the Google OAuth token revoke for
  // Gmail, the Baileys socket logout for WhatsApp, and reports honestly for
  // Discord (which has no real integration yet).
  app.post('/api/auth/:platform/disconnect', async (req, res) => {
    const platform = String(req.params.platform || '').toLowerCase();

    try {
      if (platform === 'gmail') {
        await disconnectGmail('default');
        return res.json({ ok: true, message: 'Gmail disconnected.' });
      }

      if (platform === 'whatsapp') {
        const { disconnectWhatsApp } = await import('./whatsapp/connection.js');
        await disconnectWhatsApp();
        return res.json({ ok: true, message: 'WhatsApp disconnected.' });
      }

      if (platform === 'discord') {
        return res.json({ ok: false, message: 'Discord integration is not implemented yet.' });
      }

      return res.status(400).json({ ok: false, error: `Unknown platform: ${platform}` });
    } catch (error) {
      console.error(`Failed to disconnect ${platform}`, error);
      res.status(500).json({ ok: false, error: `Failed to disconnect ${platform}` });
    }
  });

  // POST /api/auth/logout — signs the user out of the app. Disconnects both Gmail
  // (revokes the Google refresh token) and WhatsApp (logs out the Baileys socket),
  // then marks the profile as signed out. The Google name/email/avatar are kept so
  // reconnecting is one click; the app shows a sign-in screen until the user logs
  // back in via Google OAuth.
  app.post('/api/auth/logout', async (_req, res) => {
    try {
      // 1) Revoke Gmail credentials (make GET /api/auth/status report gmail:false).
      await disconnectGmail('default');

      // 2) Log out the WhatsApp Baileys socket + clear its persisted session.
      const { disconnectWhatsApp } = await import('./whatsapp/connection.js');
      await disconnectWhatsApp().catch((error) => {
        console.warn('[logout] WhatsApp logout error (continuing):', error.message);
      });

      // 3) Mark the profile as signed out so the frontend shows the login screen.
      const usersCollection = await getCollection('users');
      await usersCollection.updateOne(
        { _id: 'default' },
        { $set: { signedOut: true, updatedAt: new Date() }, $unset: { refreshToken: '' } },
        { upsert: true }
      );

      res.json({ ok: true, message: 'Logged out successfully.' });
    } catch (error) {
      console.error('Failed to log out', error);
      res.status(500).json({ ok: false, error: 'Failed to log out' });
    }
  });

  app.post('/api/auth/whatsapp/connect', async (_req, res) => {
    try {
      const result = await startWhatsAppConnection();
      res.json({ ok: true, ...result });
    } catch (error) {
      console.error('[whatsapp] connect failed:', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/auth/discord/connect', (_req, res) => {
    res.json({ ok: false, message: 'Discord integration is not implemented yet.' });
  });

  app.get('/auth/google', (_req, res) => {
    const oauth2Client = getOAuthClient();

    if (!oauth2Client) {
      return res.status(503).json({
        ok: false,
        error: 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
      });
    }

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
      ],
      redirect_uri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback',
    });
    res.redirect(authUrl);
  });

  app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) {
      return res.status(400).json({ ok: false, error: 'Missing OAuth code' });
    }

    try {
      const oauth2Client = getOAuthClient();
      if (!oauth2Client) {
        return res.status(503).json({
          ok: false,
          error: 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
        });
      }

      const { tokens } = await oauth2Client.getToken(code);
      if (tokens.refresh_token) {
        await saveRefreshToken('default', tokens.refresh_token);
      }

      // Fetch the user's Google profile info (name, email, avatar)
      try {
        oauth2Client.setCredentials(tokens);
        const { google } = await import('googleapis');
        const people = google.people({ version: 'v1', auth: oauth2Client });
        const profile = await people.people.get({
          resourceName: 'people/me',
          personFields: 'names,emailAddresses,photos',
        });

        const name = profile.data.names?.[0]?.displayName || null;
        const email = profile.data.emailAddresses?.[0]?.value || null;
        const avatar = profile.data.photos?.[0]?.url || null;

        const usersCollection = await getCollection('users');
        await usersCollection.updateOne(
          { _id: 'default' },
          {
            $set: {
              name,
              email,
              avatar,
              signedOut: false,
              updatedAt: new Date(),
            },
          },
          { upsert: true }
        );
      } catch (profileError) {
        // If profile fetch fails, still proceed — user info is a nice-to-have
        console.error('Failed to fetch Google profile info', profileError);
      }

      try {
        const syncResult = await fetchAndStoreGmailMessages(50, oauth2Client);
        console.log('Gmail sync completed after OAuth', syncResult);
      } catch (syncError) {
        console.error('Failed to sync Gmail messages after OAuth', syncError);
      }

      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/?gmail=connected`);
    } catch (error) {
      console.error('Google OAuth callback failed', error);
      res.status(500).json({ ok: false, error: 'Google OAuth callback failed', details: error.message });
    }
  });
}