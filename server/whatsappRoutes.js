// WhatsApp connection HTTP routes: starts the Baileys socket and returns the
// current QR/connection state to the frontend for the QR-scan linking flow.
import { startWhatsAppConnection, getWhatsAppConnectionState, disconnectWhatsApp } from './whatsapp/connection.js';

/**
 * WhatsApp connection endpoints (backend connection only — message ingestion
 * is wired in a later step).
 */
export function registerWhatsAppRoutes(app) {
  const handleConnect = async (_req, res) => {
    try {
      const result = await startWhatsAppConnection();
      res.json({ ok: true, ...result });
    } catch (error) {
      console.error('[whatsapp] connect failed:', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  };

  // GET /api/whatsapp/qr — returns the current QR data URL if a QR is pending,
  // { connected: true } if the session is live, or { status: 'not_started' } if
  // the connection has never been initiated.
  app.get('/api/whatsapp/qr', (_req, res) => {
    res.json(getWhatsAppConnectionState());
  });
  app.get('/api/auth/whatsapp/qr', (_req, res) => {
    res.json(getWhatsAppConnectionState());
  });

  // POST /api/whatsapp/connect — initializes the Baileys connection if it is
  // not already running (no-op when it is).
  app.post('/api/whatsapp/connect', handleConnect);
  app.post('/api/auth/whatsapp/connect', handleConnect);

  // POST /api/whatsapp/disconnect — logs the socket out, cancels auto-reconnect,
  // and clears the persisted session so the next connect needs a fresh QR scan.
  const handleDisconnect = async (_req, res) => {
    try {
      const result = await disconnectWhatsApp();
      res.json({ ok: true, message: 'WhatsApp disconnected.', ...result });
    } catch (error) {
      console.error('[whatsapp] disconnect failed:', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  };
  app.post('/api/whatsapp/disconnect', handleDisconnect);
  app.post('/api/auth/whatsapp/disconnect', handleDisconnect);
};