import { getCollection } from './db.js';
import { getOAuthClient, saveRefreshToken, loadRefreshToken } from './auth.js';
import fs from 'node:fs';
import path from 'node:path';
import { fetchAndStoreGmailMessages } from './gmail/fetchMessages.js';

const whatsappSessionPath = path.resolve(process.cwd(), 'server', 'whatsapp-session.json');

export async function registerAuthRoutes(app) {
  app.put('/api/auth/profile', async (req, res) => {
    try {
      const { name, email } = req.body;
      const usersCollection = await getCollection('users');
      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (email !== undefined) updateData.email = email;
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
      const whatsappConnected = fs.existsSync(whatsappSessionPath);
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

  app.post('/api/auth/whatsapp/connect', (_req, res) => {
    res.json({ ok: false, message: 'WhatsApp integration is not implemented yet.' });
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