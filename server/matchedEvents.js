// Minimal SSE hub for live "message:matched" push (no new dependency).
// MatchedTab subscribes via EventSource; ingestion paths broadcast here.
const clients = new Set();

export function addMatchedClient(res) {
  clients.add(res);
}

export function removeMatchedClient(res) {
  clients.delete(res);
}

// ponytail: in-memory fan-out only — a multi-instance deploy would drop
// events for clients pinned to another instance (needs redis pub/sub).
export function broadcastMatchedMessage(message) {
  if (clients.size === 0) return;
  const payload = `event: message:matched\ndata: ${JSON.stringify(message)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}
