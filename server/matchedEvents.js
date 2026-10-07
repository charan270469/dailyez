// Minimal SSE hub for live "message:matched" push (no new dependency).
// MatchedTab subscribes via EventSource; ingestion paths broadcast here.
const clients = new Set();

export function addMatchedClient(res) {
  clients.add(res);
}

export function removeMatchedClient(res) {
  clients.delete(res);
}

export function broadcastMatchedMessage(message) {
  const payload = `event: message:matched\ndata: ${JSON.stringify(message)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}
