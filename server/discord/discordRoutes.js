// Discord HTTP routes: expose the persistent bot's connection state and the
// list of servers/channels it can listen in (used by the frontend channel
// picker). No OAuth flow — the bot logs in with a token at server start.
import {
  getDiscordServers,
  getDiscordStatus,
} from './client.js';

/**
 * Discord connection endpoints plus the read-only server/channel listing used
 * by the frontend channel picker. Live message ingestion happens inside the
 * bot client (messageCreate -> MongoDB), not here.
 */
export function registerDiscordRoutes(app) {
  // GET /api/discord/servers — servers the bot is in, each with its channels:
  // [{ serverId, serverName, channels: [{ channelId, channelName }] }]
  app.get('/api/discord/servers', (_req, res) => {
    res.json(getDiscordServers());
  });

  // GET /api/discord/status — { connected: boolean, botUsername: string|null }
  app.get('/api/discord/status', (_req, res) => {
    res.json(getDiscordStatus());
  });
}