// WhatsApp-style conversation card: shows one conversation with last message
import { useState } from "react";
import { formatRelativeTime, truncateText, getInitials, getAvatarColor } from "../lib/utils";
import { archiveMessage } from "../lib/api";
import { Check, X } from "lucide-react";
import { ConversationPreview } from "../types";

interface WhatsAppChatCardProps {
  conversation: ConversationPreview;
  onMessageClick?: (msg: ConversationPreview) => void;
}

export function WhatsAppChatCard({ conversation, onMessageClick }: WhatsAppChatCardProps) {
  const [hidden, setHidden] = useState(false);

  const handleArchive = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const result = await archiveMessage(conversation.id);
      if (result.ok) {
        setHidden(true);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleClick = () => {
    onMessageClick?.(conversation);
  };

  if (hidden) return null;

  const contactName = conversation.from || "Unknown contact";
  const isGroup =
    conversation.isGroup === true ||
    (typeof conversation.chatId === "string" && /@g\.us$/i.test(conversation.chatId));
  // Normalize raw JID forms that slipped through: strip the @domain suffix for
  // phone JIDs, LID JIDs AND group JIDs (@g.us) so we never render
  // "175316555276422@lid" or "120363426607146066@g.us" as a display name.
  const stripSuffix = (value: string) =>
    typeof value === "string" ? value.replace(/@(s\.whatsapp\.net|lid|g\.us)$/i, "") : value;
  const displayName = isGroup
    ? conversation.groupName || stripSuffix(contactName)
    : stripSuffix(contactName);
  
  const initials = getInitials(displayName);
  const avatarColor = getAvatarColor(displayName);
  const lastMessagePreview = truncateText(conversation.content || conversation.preview || "(no text content)", 60);
  const relativeTime = formatRelativeTime(conversation.timestamp || conversation.createdAt || new Date());
  const hasUnread = (conversation.unreadCount || 0) > 0;

  return (
    <div
      onClick={handleClick}
      className="bg-[#161616] border border-[#2a2a2a] hover:border-[#3a3a3a] rounded-xl p-4 transition-colors cursor-pointer flex items-center gap-3 group"
    >
      {/* Avatar */}
      <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 border font-semibold text-sm ${avatarColor}`}>
        {initials}
      </div>

      {/* Conversation Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className={`font-semibold text-[15px] truncate ${hasUnread ? 'text-white' : 'text-gray-200'}`}>
            {displayName}
          </span>
          {isGroup && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-950/50 text-emerald-400 border border-emerald-900/50 uppercase tracking-wider flex-shrink-0">
              Group
            </span>
          )}
          {conversation.source === "whatsapp" && (
            <span className="text-gray-500 text-xs flex-shrink-0">WhatsApp</span>
          )}
          {(conversation.messageCount || 0) > 1 && (
            <span className="text-gray-500 text-xs flex-shrink-0">
              {conversation.messageCount} messages
            </span>
          )}
        </div>
        {isGroup && conversation.sender && (
          <p className="text-xs text-gray-400 truncate mb-0.5">
            {conversation.sender}
          </p>
        )}
        <p className={`text-sm truncate ${hasUnread ? 'text-gray-300 font-medium' : 'text-gray-500'}`}>
          {lastMessagePreview}
        </p>
      </div>

      {/* Timestamp + Unread Badge */}
      <div className="flex flex-col items-end gap-2 flex-shrink-0">
        <span className={`text-xs whitespace-nowrap ${hasUnread ? 'text-white font-medium' : 'text-gray-500'}`}>
          {relativeTime}
        </span>
        {hasUnread && (
          <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center text-white text-xs font-semibold">
            {Math.min(conversation.unreadCount || 0, 9)}
          </div>
        )}
      </div>

      {/* Hidden archive/restore buttons on hover */}
      <div className="hidden group-hover:flex flex-shrink-0 gap-2">
        <button
          onClick={handleArchive}
          className="p-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-400 transition-colors"
          title="Archive conversation"
        >
          <Check className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
