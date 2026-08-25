// Diagnostic script: reports what WhatsApp messages actually exist in the DB.
// Run from the server/ directory: node tests/diagnoseWhatsApp.mjs
import { getCollection } from '../db.js';

async function main() {
  const messages = await getCollection('messages');

  const total = await messages.countDocuments({ source: 'whatsapp' });
  console.log('Total whatsapp messages:', total);

  const statusCount = await messages.countDocuments({
    source: 'whatsapp',
    $or: [
      { chatId: /status@broadcast/i },
      { groupJid: /status@broadcast/i },
      { raw: /status@broadcast/i },
    ],
  });
  console.log('Presumed status@broadcast records:', statusCount);

  // Distinct chatId breakdown for whatsapp messages
  const chatAgg = await messages.aggregate([
    { $match: { source: 'whatsapp' } },
    { $group: { _id: '$chatId', n: { $sum: 1 }, sampleFrom: { $first: '$from' } } },
    { $sort: { n: -1 } },
    { $limit: 40 },
  ]).toArray();

  console.log('\nTop chatIds:');
  for (const row of chatAgg) {
    console.log('  ' + String(row._id).padEnd(45) + ' n=' + String(row.n).padStart(4) + '  from="' + (row.sampleFrom || '') + '"');
  }

  // Group / non-group / status counts
  const groups = await messages.countDocuments({ source: 'whatsapp', isGroup: true });
  const nonGroups = await messages.countDocuments({ source: 'whatsapp', $or: [{ isGroup: false }, { isGroup: { $exists: false } }] });
  console.log('\nisGroup=true:', groups, ' | non-group/unknown:', nonGroups);

  // Sample a couple of records with raw keys present
  const samples = await messages.find({ source: 'whatsapp', raw: { $exists: true } }).limit(3).toArray();
  console.log('\nSample raw keys:');
  for (const s of samples) {
    const k = s.raw && s.raw.key;
    console.log('  remoteJid=' + (k && k.remoteJid) + ' participant=' + (k && k.participant) + ' from="' + s.from + '" groupName=' + (s.groupName || 'null'));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });