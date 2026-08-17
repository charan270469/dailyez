// MongoDB connection layer: reads MONGODB_URI from env, connects lazily, and
// exposes getCollection() so routes can query collections without a shared app-level client.
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.MONGODB_URI;
let client = null;

if (uri) {
  client = new MongoClient(uri);
}

export async function connectToDatabase() {
  if (!client) {
    return null;
  }

  if (!client.topology?.isConnected?.()) {
    await client.connect();
  }

  return client.db();
}

export async function getCollection(name) {
  const db = await connectToDatabase();
  if (!db) {
    throw new Error('MONGODB_URI is not defined. Set it to connect the app to MongoDB.');
  }

  return db.collection(name);
}
