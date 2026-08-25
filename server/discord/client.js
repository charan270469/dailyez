// discord.js persistent bot connection: owns the Client lifecycle, logs in with
// the DISCORD_BOT_TOKEN, and exposes the bot's connection state plus the guilds
// (servers) and their channels it can currently see.
//
// It also ingests new messages (messageCreate -> MongoDB) in real time: every
// text-channel message the bot can see is normalized, run through the shared
// signal-matching pipeline (same as Gmail/WhatsApp), and upserted into the
// `messages` collection with source: 'discord'.
//
// Unlike Gmail there is no OAuth flow: a discord.js bot stays connected using a
// long-lived bot token, so no browser redirect is involved.
import { Client, GatewayIntentBits } from 'discord.js';
import { getCollection } from '../db.js';
import { signalMessageMatches, getActiveSignals } from '../agents/signalMatching.js';

let client = null;
let botUsername = null;
let connected = false;

const REQUIRED_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
];

/**
 * Create (if needed), log in, and connect the persistent Discord bot.
 *
 * Idempotent — safe to call at every server start; if the client is already
 * ready this is a no-op. Returns the current { connected, botUsername } state.
 */
export async function startDiscordClient() {
  const token = process.env.DISCORD_BOT_TOKEN;

  if (!token) {
    console.warn('[discord] DISCORD_BOT_TOKEN is not set in .env — bot will not connect.');
    return { connected: false, botUsername: null };
  }

  // Already logged in and ready — nothing to do.
  if (client && client.isReady()) {
    return { connected, botUsername };
  }

  if (!client) {
    client = new Client({ intents: REQUIRED_INTENTS });

    client.once('ready', (bot) => {
      connected = true;
      botUsername = bot.user.username;
      const guildNames = bot.guilds.cache.map((g) => g.name);
      console.log(`[discord] Logged in as ${bot.user.tag} (id: ${bot.user.id})`);
      console.log(`[discord] In ${guildNames.length} server(s):`);
      guildNames.forEach((name) => console.log(`[discord]   - ${name}`));
    });

    client.on('disconnect', () => {
      connected = false;
      console.warn('[discord] Bot disconnected from Discord.');
    });

    client.on('error', (error) => {
      connected = false;
      console.error('[discord] Bot connection error:', error);
    });

    // Ingest every incoming message in real time. The handler filters bots,
    // drops empty/system-only messages, normalizes the document, runs the
    // shared signal-matching pipeline, and upserts to MongoDB (source: 'discord').
    // Fire-and-forget so a slow match or DB hiccup never stalls the gateway.
    client.on('messageCreate', (message) => {
      ingestDiscordMessage(message).catch((error) => {
        console.error('[discord] Failed to ingest message:', error.message);
      });
    });
  }

  if (!client.isReady()) {
    try {
      await client.login(token);
    } catch (error) {
      connected = false;
      console.error('[discord] Failed to log in:', error);
      throw error;
    }
  }

  return { connected, botUsername };
}

/**
 * Normalize a single incoming Discord message and persist it to MongoDB.
 *
 * Mirrors the WhatsApp/Gmail pipeline: a stable dedup key (Discord message id
 * + source), the same stored field set, and the shared signal-matching logic.
 * Skips bot messages, non-text channels, and empty/system-only messages.
 *
 * @param {import('discord.js').Message} message - incoming gateway message
 * @returns {Promise<object|null>} The stored normalized document, or null when skipped
 */
async function ingestDiscordMessage(message) {
  if (!message || !message.channel || !message.channel.isTextBased()) return null;
  // Never ingest our own replies or messages from other bots.
  if (message.author && message.author.bot) return null;

  const guild = message.guild || null;
  const channel = message.channel;

  // Fall back to embed/attachment summary when the message has no body text.
  let text = message.content || '';
  if (!text && message.embeds && message.embeds.length) {
    text = message.embeds
      .map((e) => e.description || e.title || '')
      .filter(Boolean)
      .join(' | ');
  }
  if (!text && message.attachments && message.attachments.size) {
    text = message.attachments.first().url || '[attachment]';
  }
  if (!text) return null; // drop system/empty messages

  const author = message.author || {};
  const from = author.username || author.tag || 'Unknown user';
  const sender = author.tag || from;

  const normalized = {
    // Stable dedup key per Discord message.
    id: message.id,
    from,
    sender,
    source: 'discord',
    subject: guild
      ? `Discord · ${guild.name} · #${channel.name}`
      : `Discord · #${channel.name}`,
    content: text,
    preview: text.slice(0, 200),
    timestamp: message.createdAt || new Date(),
    // Populated by matching below / kept parity with Gmail & WhatsApp.
    matched: false,
    keywordMatched: false,
    signalMatches: [],
    keywordSignalMatches: [],
    status: 'active',
    // Conversations group by Discord text channel.
    chatId: channel.id,
    channelId: channel.id,
    channelName: channel.name,
    isGroup: true,
    groupName: channel.name,
    guildId: guild ? guild.id : null,
    guildName: guild ? guild.name : null,
    raw: {
      id: message.id,
      channelId: channel.id,
      guildId: guild ? guild.id : null,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const messagesCollection = await getCollection('messages');

  // Carry forward any prior match state so a re-ingest never wipes a signal match.
  const existing = await messagesCollection.findOne({ id: normalized.id, source: 'discord' });
  const alreadyMatched = !!(existing?.signalMatches?.length > 0);

  if (alreadyMatched) {
    normalized.matched = existing.matched || false;
    normalized.signalMatches = existing.signalMatches;
    normalized.keywordMatched = existing.keywordMatched || false;
    normalized.keywordSignalMatches = existing.keywordSignalMatches || [];
  } else if (!existing?.signalChecked) {
    // New / not-yet-checked message: run the shared signal-matching pipeline.
    try {
      const signals = await getActiveSignals();
      if (signals.length > 0) {
        const result = await signalMessageMatches(
          { from: normalized.from, subject: normalized.subject, content: normalized.content },
          signals
        );
        if (result.matches.length > 0) {
          normalized.matched = true;
          normalized.signalMatches = [...(existing?.signalMatches || []), ...result.matches];

          const signalsCollection = await getCollection('signals');
          for (const match of result.matches) {
            await signalsCollection.updateOne(
              { _id: match.matchedSignalId },
              { $inc: { matchCount: 1 }, $set: { lastMatched: new Date() } }
            );
          }
        }
        if (result.keywordMatched) {
          normalized.keywordMatched = true;
          normalized.keywordSignalMatches = [
            ...(existing?.keywordSignalMatches || []),
            ...result.keywordMatches,
          ];
        }
      } else if (existing) {
        normalized.matched = existing.matched || false;
        normalized.signalMatches = existing.signalMatches || [];
        normalized.keywordMatched = existing.keywordMatched || false;
        normalized.keywordSignalMatches = existing.keywordSignalMatches || [];
      }
      // Mark as checked so the periodic recheck sweep doesn't re-LLM it.
      normalized.signalChecked = true;
    } catch (error) {
      console.warn('[discord] Signal matching failed (storing message unchecked):', error.message);
      if (existing) {
        normalized.matched = existing.matched || false;
        normalized.signalMatches = existing.signalMatches || [];
      }
    }
  }

  await messagesCollection.updateOne(
    { id: normalized.id, source: 'discord' },
    { $set: normalized },
    { upsert: true }
  );

  return normalized;
}

/**
 * GET /api/discord/servers payload: every guild the bot is in, each with its
 * text-capable channels ({ serverId, serverName, channels }).
 * Returns [] when the bot is not connected.
 */
export function getDiscordServers() {
  if (!client || !client.isReady()) {
    return [];
  }

  return client.guilds.cache.map((guild) => ({
    serverId: guild.id,
    serverName: guild.name,
    channels: guild.channels.cache
      .filter((channel) => channel.isTextBased())
      .map((channel) => ({
        channelId: channel.id,
        channelName: channel.name,
      })),
  }));
}

/**
 * GET /api/discord/status payload:
 * { connected: boolean, botUsername: string | null }
 */
export function getDiscordStatus() {
  return { connected, botUsername };
}