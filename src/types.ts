export interface Match {
  keyword: string;
  color: 'red' | 'indigo';
}

export interface Message {
  id: string;
  sender: string;
  source: string;
  platform: 'Gmail' | 'WhatsApp' | 'Discord';
  timestamp: string;
  preview: string;
  matches: Match[];
}

export interface InboxMessage {
  id: string;
  sender: string;
  source: string;
  platform: 'Gmail' | 'WhatsApp' | 'Discord' | 'Slack';
  timestamp: string;
  subject?: string;
  preview: string;
}

export interface WatchlistEntry {
  id: string;
  keyword: string;
  platforms: string;
}

export interface ArchiveMessage {
  id: string;
  sender: string;
  platform: 'Gmail' | 'WhatsApp' | 'Discord' | 'System';
  timestamp: string;
  preview: string;
  status: 'READ' | 'PROCESSED' | 'DISMISSED';
}

export interface DetailedWatchlistEntry {
  id: string;
  name: string;
  type: string;
  scope: string;
  matches: number;
  matchText: string;
  recentMatch: string;
  statusColor: 'green' | 'gray' | 'red';
  iconType: 'key' | 'at' | 'phone' | 'user' | 'contact' | 'alert';
}
