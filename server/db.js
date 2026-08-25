// MongoDB connection layer: reads MONGODB_URI from env, connects lazily, and
// exposes getCollection() so routes can query collections without a shared app-level client.
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.MONGODB_URI;

// Sane timeouts so a dead/unreachable cluster surfaces fast instead of every
// request spinning through a full driver server-selection cycle (which turned
// one network outage into thousands of stacked MongoServerSelectionErrors).
// serverSelectionTimeoutMS bounds the whole "find a usable node" phase;
// connectTimeoutMS bounds the initial socket connect on each pooled socket.
const clientOptions = {
  serverSelectionTimeoutMS: 10_000,
  connectTimeoutMS: 10_000,
  maxPoolSize: 10,
  // retryWrites is on by default for Atlas, but mirror what the URI pins so
  // we never silently override an explicit retryWrites=false.
  ...(uri && uri.includes('retryWrites=') ? {} : { retryWrites: true }),
};

let client = null;

if (uri) {
  client = new MongoClient(uri, clientOptions);
}

// Reconnect backoff: after a failed dial we skip reconnect attempts for a short
// window. Without this, every WhatsApp message / signal refresh / cron tick
// triggers its own client.connect() (and driver-level retry loop) the instant
// the server goes dark, producing a thundering herd of parallel dials plus the
// giant per-attempt error dumps seen in the logs. The first attempt after the
// window still probes immediately, so recovery is not delayed.
const RECONNECT_BACKOFF_MS = 3_000;
let lastConnectFailedAt = 0;
let connectPromise = null;

export async function connectToDatabase() {
  if (!client) {
    return null;
  }

  if (client.topology?.isConnected?.()) {
    return client.db();
  }

  // Fast-fail inside the backoff window instead of re-dialing a known-bad target.
  if (Date.now() - lastConnectFailedAt < RECONNECT_BACKOFF_MS) {
    throw new Error('MongoDB unreachable (network/Atlas down; retrying in a moment)');
  }

  // Coalesce concurrent callers onto a single in-flight connect attempt.
  if (!connectPromise) {
    connectPromise = client.connect().then(
      () => {
        connectPromise = null;
        return client.db();
      },
      (error) => {
        connectPromise = null;
        lastConnectFailedAt = Date.now();
        throw error;
      }
    );
  }

  return connectPromise;
}

export async function getCollection(name) {
  const db = await connectToDatabase();
  if (!db) {
    throw new Error('MONGODB_URI is not defined. Set it to connect the app to MongoDB.');
  }

  return db.collection(name);
}
