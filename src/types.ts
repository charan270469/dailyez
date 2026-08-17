// Shared TypeScript interfaces describing frontend data shapes (messages and
// inbox items with their signal/keyword match metadata), used across components.
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
  matched?: boolean;
  signalMatches?: Array<{
    matchedSignalId?: string;
    context: string;
    summary?: string;
    reasoning?: string;
    confidence: 'high' | 'medium' | 'low';
  }>;
  keywordMatched?: boolean;
  keywordSignalMatches?: Array<{
    signalId?: string;
    context?: string;
    keywords?: string[];
    matchedKeywords?: string[];
  }>;
}

// Grouped conversation (last message per chat + metadata)
export interface ConversationPreview extends InboxMessage {
  chatId?: string;
  from: string;
  content?: string;
  messageCount?: number;
  unreadCount?: number;
}
