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
  platform: 'Gmail' | 'WhatsApp';
  timestamp: string;
  preview: string;
  matches: Match[];
}

export interface InboxMessage {
  id: string;
  sender: string;
  source: string;
  platform: 'Gmail' | 'WhatsApp' | 'Slack';
  timestamp: string;
  subject?: string;
  preview: string;
  createdAt?: string | Date;
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
  // WhatsApp metadata
  isGroup?: boolean;
  groupName?: string;
  groupJid?: string;
  chatId?: string;
}

// Grouped conversation (last message per chat + metadata)
export interface ConversationPreview extends InboxMessage {
  chatId?: string;
  from: string;
  sender: string;
  senderJid?: string;
  content?: string;
  messageCount?: number;
  unreadCount?: number;
}
