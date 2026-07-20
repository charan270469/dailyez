import { Message, WatchlistEntry, InboxMessage, DetailedWatchlistEntry, ArchiveMessage } from './types';

// Placeholder mock data for real API integration
export const mockArchiveMessages: ArchiveMessage[] = [
  {
    id: '1',
    sender: 'Sarah Jenkins',
    platform: 'Gmail',
    timestamp: '2h ago',
    preview: 'Meeting Notes: Project Phoenix status update and Q3 timeline review...',
    status: 'READ'
  },
  {
    id: '2',
    sender: 'dev-lead-alpha',
    platform: 'Discord',
    timestamp: '5h ago',
    preview: 'Merged PR #402. System stability improved on the edge clusters. No further action needed.',
    status: 'PROCESSED'
  },
  {
    id: '3',
    sender: 'Marcus Aurelius',
    platform: 'WhatsApp',
    timestamp: 'Yesterday',
    preview: 'Can you join the call later today? We need to finalize the visual direction.',
    status: 'DISMISSED'
  },
  {
    id: '4',
    sender: 'System Guardian',
    platform: 'System',
    timestamp: '2 days ago',
    preview: 'Routine security scan completed. 0 vulnerabilities found in the core signal pipeline.',
    status: 'READ'
  }
];

export const mockInboxMessages: InboxMessage[] = [
  {
    id: '1',
    sender: 'Alex Rivera',
    source: 'via Gmail',
    platform: 'Gmail',
    timestamp: '2m ago',
    subject: 'Project Milestone: Quarter 3 Sync',
    preview: 'Just following up on the design system updates for the SignalStream project. I\'ll need to finalize the component hierarchy before the end of the week. Let\'s touch...'
  },
  {
    id: '2',
    sender: 'Jordan Smith',
    source: 'via WhatsApp',
    platform: 'WhatsApp',
    timestamp: '15m ago',
    preview: 'Hey, I\'ve sent the updated logos for the mobile app. Can you check them out and let me know if the indigo accent matches the brand guidelines?'
  },
  {
    id: '3',
    sender: 'Design Team',
    source: 'via Discord',
    platform: 'Discord',
    timestamp: '42m ago',
    subject: 'New Assets Uploaded',
    preview: '@channel All the Lottie animations for the onboarding flow are now in the shared folder. Please review the timing on the success state animation as it felt a bit fast in...'
  },
  {
    id: '4',
    sender: 'Sarah Chen',
    source: 'via Slack',
    platform: 'Slack',
    timestamp: '1h ago',
    preview: 'Meeting shifted to 3:00 PM today. We need everyone there to discuss the deployment strategy for next week\'s beta release.'
  },
  {
    id: '5',
    sender: 'Mark Thompson',
    source: 'via Gmail',
    platform: 'Gmail',
    timestamp: '2h ago',
    subject: 'Invoices for January',
    preview: 'Hi there, I\'ve attached all the invoices for the previous month. Let me know if everything looks correct before we process payment.'
  }
];

export const mockMessages: Message[] = [
  {
    id: '1',
    sender: 'Sarah Jenkins',
    source: 'via Gmail',
    platform: 'Gmail',
    timestamp: '2m ago',
    preview: 'Q4 Budget Approval Required - We need the final numbers for the SignalStream expansion before tomorrow\'s board meeting.',
    matches: [
      { keyword: 'BUDGET', color: 'red' },
      { keyword: 'EXPANSION', color: 'indigo' },
    ],
  },
  {
    id: '2',
    sender: 'dev-lead-alpha',
    source: 'in #deployment',
    platform: 'Discord',
    timestamp: '14m ago',
    preview: 'Emergency patch deployed to production. Monitoring latency on the US-East cluster for the next hour.',
    matches: [
      { keyword: 'EMERGENCY', color: 'red' },
    ],
  },
  {
    id: '3',
    sender: 'Marcus Aurelius',
    source: 'via WhatsApp',
    platform: 'WhatsApp',
    timestamp: '42m ago',
    preview: 'The investor meeting for SignalStream has been moved to 3 PM. Please bring the updated revenue projections.',
    matches: [
      { keyword: 'INVESTOR', color: 'red' },
    ],
  },
  {
    id: '4',
    sender: 'Alex Rivera',
    source: 'in #product-sync',
    platform: 'Discord',
    timestamp: '1h ago',
    preview: 'User feedback suggests we need more granularity in the watchlist notification settings. Let\'s prioritize this for Q3.',
    matches: [
      { keyword: 'PRIORITIZE', color: 'indigo' },
    ],
  },
];

export const mockWatchlist: WatchlistEntry[] = [
  { id: '1', keyword: 'Budget', platforms: 'All Platforms' },
  { id: '2', keyword: 'Emergency', platforms: 'Discord' },
  { id: '3', keyword: 'Investor', platforms: 'WhatsApp, Gmail' },
];

export const mockDetailedWatchlist: DetailedWatchlistEntry[] = [
  {
    id: '1',
    name: 'Budget',
    type: 'Keyword',
    scope: 'ALL PLATFORMS',
    matches: 23,
    matchText: '23 matches',
    recentMatch: '2m ago',
    statusColor: 'green',
    iconType: 'key'
  },
  {
    id: '2',
    name: 'rubrik.com',
    type: 'Domain',
    scope: 'GMAIL',
    matches: 112,
    matchText: '112 matches',
    recentMatch: '15m ago',
    statusColor: 'green',
    iconType: 'at'
  },
  {
    id: '3',
    name: '+91 9832...',
    type: 'Phone',
    scope: 'WHATSAPP',
    matches: 0,
    matchText: '0 matches',
    recentMatch: 'Never',
    statusColor: 'gray',
    iconType: 'phone'
  },
  {
    id: '4',
    name: '@devlead',
    type: 'Username',
    scope: 'DISCORD',
    matches: 8,
    matchText: '8 matches',
    recentMatch: '1h ago',
    statusColor: 'green',
    iconType: 'user'
  },
  {
    id: '5',
    name: 'Sarah Jenkins',
    type: 'Contact',
    scope: 'GMAIL',
    matches: 2,
    matchText: '2 matches',
    recentMatch: '42m ago',
    statusColor: 'green',
    iconType: 'contact'
  },
  {
    id: '6',
    name: 'Emergency',
    type: 'Keyword',
    scope: 'DISCORD',
    matches: 1,
    matchText: '1 match',
    recentMatch: 'Just now',
    statusColor: 'red',
    iconType: 'alert'
  }
];

export const chartData = [
  { day: 'MON', value: 30 },
  { day: 'TUE', value: 45 },
  { day: 'WED', value: 35 },
  { day: 'THU', value: 70 },
  { day: 'FRI', value: 100, active: true },
  { day: 'SAT', value: 40 },
  { day: 'SUN', value: 25 },
];
