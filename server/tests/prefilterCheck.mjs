// Standalone verification of the keywordPreFilter changes against the user's scenario.
// Run with: node --input-type=module server/tests/prefilterCheck.mjs
const STOP_WORDS = new Set([
  'show', 'find', 'tell', 'give', 'need', 'want', 'like', 'look',
  'this', 'that', 'these', 'those', 'with', 'from', 'have', 'has',
  'been', 'will', 'would', 'could', 'should', 'shall', 'must',
  'what', 'when', 'where', 'which', 'who', 'whom', 'whose',
  'about', 'into', 'over', 'after', 'before', 'between', 'under',
  'just', 'also', 'very', 'than', 'then', 'more', 'some', 'such',
  'only', 'other', 'than', 'they', 'them', 'their', 'were',
  'your', 'youre', 'yours', 'itself', 'being', 'doing',
  'alert', 'every', 'each', 'both', 'most', 'many',
]);

function keywordPreFilter(message, signalContext) {
  const text = (message.from + ' ' + message.subject + ' ' + message.content).toLowerCase();
  const context = signalContext.toLowerCase();

  const GENERIC_WORDS = new Set([
    'college', 'university', 'school', 'institute', 'institution', 'academy',
    'foundation', 'higher', 'education', 'tech', 'technology', 'jobs', 'job',
    'intern', 'internship', 'mail', 'mails', 'email', 'emails', 'from', 'to',
    'the', 'and', 'or', 'my', 'your', 'our', 'about', 'with', 'for', 'gather',
    'collect', 'get', 'show', 'find', 'see', 'watch', 'alert', 'notify',
  ]);

  const words = signalContext.split(/\s+/).map(w => w.replace(/[^a-zA-Z0-9.]/g, '')).filter(Boolean);
  const domainMatch = signalContext.match(/[a-z0-9]([a-z0-9-]*[a-z0-9])?\.[a-z]{2,}/g) || [];
  const distinctiveTokens = new Set(
    domainMatch.map(d => d.toLowerCase()).concat(
      words.filter(w => /[A-Z]/.test(w) && w.length >= 2).map(w => w.toLowerCase())
    )
  );
  for (const g of GENERIC_WORDS) distinctiveTokens.delete(g);

  if (distinctiveTokens.size > 0) {
    for (const token of distinctiveTokens) {
      if (text.includes(token)) return true;
    }
    return false;
  }

  const keyTerms = context.split(/\s+/).filter(w => w.length > 3 && !STOP_WORDS.has(w));
  if (keyTerms.length === 0) return true;

  const sourceDomainMatch = context.match(/[a-z0-9]([a-z0-9-]*[a-z0-9])?\.[a-z]{2,}/g);
  if (sourceDomainMatch) {
    for (const domain of sourceDomainMatch) {
      if (text.includes(domain)) return true;
    }
  }
  for (const term of keyTerms) {
    if (text.includes(term)) return true;
  }
  return false;
}

const signal = 'gather mails from my college ICFAI foundation for higher education or from icfai tech';

const cases = [
  { name: 'CAPGEMINI (freshersindia)', shouldPass: false, msg: { from: 'Kasthuri | HR Team <sanjoli.raj@freshersindia.in>', subject: 'CAPGEMINI.. Your Application has been processed', content: 'profile eligible 50000 salary' } },
  { name: 'Tech Mahindra (freshersindia)', shouldPass: false, msg: { from: 'Mallika HR <sanjoli.raj@freshersindia.in>', subject: 'TECH MAHINDRA.. Your Application has been processed', content: 'package 65000' } },
  { name: 'Queens Of Change Foundation (Internshala)', shouldPass: false, msg: { from: 'Internshala <student@internshala.com>', subject: 'Queens Of Change Foundation is hiring Backend intern', content: 'apply for internship' } },
  { name: 'Laprea Education (LinkedIn)', shouldPass: false, msg: { from: 'newsletters-noreply@linkedin.com', subject: 'UI/UX Designer Laprea Education Inc', content: 'new job' } },
  { name: 'Real ICFAI official mail', shouldPass: true, msg: { from: 'ICFAI Admissions <admissions@icfaiuniversity.in>', subject: 'Semester Fee / Exam Schedule', content: 'Dear student, your exam schedule is out' } },
  { name: 'IFHE-styled ICFAI mail (mentions ICFAI)', shouldPass: true, msg: { from: 'IFHE Office <admissions@ifheindia.org>', subject: 'Class schedule updates', content: 'ICFAI Foundation for Higher Education important notice' } },
];

let pass = 0;
for (const c of cases) {
  const got = keywordPreFilter(c.msg, signal);
  const ok = got === c.shouldPass;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${c.name} | expected ${c.shouldPass} got ${got}`);
}
console.log(`\n${pass}/${cases.length} passed`);
