import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();
console.log('[dotenv]', {
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ? process.env.GOOGLE_CLIENT_ID.slice(0, 12) + '...' : '(missing)',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ? process.env.GOOGLE_CLIENT_SECRET.slice(0, 8) + '...' : '(missing)',
});

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
