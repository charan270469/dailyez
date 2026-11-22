// Ad-hoc diagnostic script: hits the running API endpoints and prints inbox/matched/
// signal counts to sanity-check the data stored in MongoDB.
import http from 'http';

function get(path) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3001' + path, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const inbox = await get('/api/messages/inbox');
  console.log('Total messages in inbox:', inbox.length);

  const matched = inbox.filter(m => m.matched);
  console.log('Matched messages:', matched.length);

  const important = await get('/api/messages/important');
  console.log('Important (matched) endpoint:', important.length);

  const signals = await get('/api/signals');
  console.log('Signals:', signals.length);
  signals.forEach(s => {
    console.log(' - "' + s.context.slice(0, 60) + '" | matches:', s.matchCount);
  });

  if (inbox.length > 0) {
    const first = inbox[0];
    console.log('\nSample message:');
    console.log('  from:', first.from);
    console.log('  subject:', first.subject);
    console.log('  matched:', first.matched);
    console.log('  signalMatches:', first.signalMatches ? first.signalMatches.length : 0);
    console.log('  has signalMatches array:', Array.isArray(first.signalMatches));
  }

  // Check if any messages have signalMatches populated
  const withMatches = inbox.filter(m => m.signalMatches && m.signalMatches.length > 0);
  console.log('\nMessages with signalMatches data:', withMatches.length);
}

main().catch(console.error);