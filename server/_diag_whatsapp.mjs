import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
dotenv.config();

const uri = process.env.MONGODB_URI;
console.log('URI present:', !!uri, uri ? uri.replace(/:.*@/, ':****@') : '');
const c = new MongoClient(uri);
await c.connect();
const db = c.db();
const coll = db.collection('messages');

const groups = await coll.aggregate([
  { $match: { source: 'whatsapp' } },
  { $group: { _id: '$chatId', n: { $sum: 1 }, last: { $max: '$timestamp' } } },
  { $sort: { n: -1 } },
]).toArray();
console.log('distinct whatsapp chats in messages:', JSON.stringify(groups, null, 2));
console.log('total whatsapp docs:', await coll.countDocuments({ source: 'whatsapp' }));
console.log('total gmail docs:', await coll.countDocuments({ source: 'gmail' }));
console.log('total messages:', await coll.countDocuments({}));

// Show a few raw whatsapp docs (chatId + name-ish fields)
const sample = await coll.find({ source: 'whatsapp' }).limit(5).toArray();
for (const s of sample) {
  console.log('---', 'id:', s.id, '| _id:', s._id?.toString?.(), '| from:', s.from, '| chatId:', s.chatId, '| ts:', s.timestamp, '| status:', s.status);
}
await c.close();