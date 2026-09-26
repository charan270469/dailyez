// WhatsApp-style conversation card: shows one conversation with last message
import { useState } from "react";
import {
  formatRelativeTime,
  truncateText,
  getInitials,
  getAvatarColor,
} from "../lib/utils";
import { archiveMessage } from "../lib/api";
import { Check } from "lucide-react";
import { ConversationPreview } from "../types";
import { QuickAlertButton } from "./QuickAlertButton";

interface WhatsAppChatCardProps {
  conversation: ConversationPreview;
  onMessageClick?: (msg: ConversationPreview) => void;
}

export function WhatsAppChatCard({
  conversation,
  onMessageClick,
}: WhatsAppChatCardProps) {
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
    (typeof conversation.chatId === "string" &&
      /@g\.us$/i.test(conversation.chatId));
  // Normalize raw JID forms that slipped through: strip the @domain suffix for
  // phone JIDs, LID JIDs AND group JIDs (@g.us) so we never render
  // "175316555276422@lid" or "120363426607146066@g.us" as a display name.
  const stripSuffix = (value: string) =>
    typeof value === "string"
      ? value.replace(/@(s\.whatsapp\.net|lid|g\.us)$/i, "")
      : value;
  const displayName = isGroup
    ? conversation.groupName || stripSuffix(contactName)
    : stripSuffix(contactName);

  const initials = getInitials(displayName);
  const avatarColor = getAvatarColor(displayName);
  const lastMessagePreview = truncateText(
    conversation.content || conversation.preview || "(no text content)",
    60,
  );
  const relativeTime = formatRelativeTime(
    conversation.timestamp || conversation.createdAt || new Date(),
  );
  const hasUnread = (conversation.unreadCount || 0) > 0;
  // Quick "Alert me" target: canonical chat id (or the display label as fallback).
  const alertTarget = {
    platform: "whatsapp" as const,
    target: conversation.chatId || conversation.from || displayName,
    senderName: displayName,
  };

  return (
    <div className="group relative flex items-start gap-3 rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-3 transition-colors hover:border-[#cbd5e1] dark:border-[#252d3c] dark:bg-[#131824] dark:hover:border-[#3a465a]">
      <div
        role="button"
        tabIndex={0}
        aria-label={`Open conversation with ${displayName}`}
        onClick={handleClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleClick();
          }
        }}
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-lg pr-16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#090c14]"
      >
        <div
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium ${avatarColor}`}
        >
          {initials}
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={`max-w-full truncate text-[12px] font-semibold ${hasUnread ? "text-[#111827] dark:text-[#f1f4f9]" : "text-[#29425f] dark:text-[#d5dcea]"}`}
            >
              {displayName}
            </span>
            {isGroup && (
              <span className="rounded-sm bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-emerald-800 dark:bg-[#10352d] dark:text-[#54d3a6]">
                Group
              </span>
            )}
            {conversation.source === "whatsapp" && (
              <span className="text-[10px] text-[#8093ab] dark:text-[#8b98aa]">WhatsApp</span>
            )}
            {(conversation.messageCount || 0) > 1 && (
              <span className="text-[10px] text-[#8093ab] dark:text-[#8b98aa]">
                {conversation.messageCount} messages
              </span>
            )}
          </div>
          {isGroup && conversation.sender && (
            <p className="mb-0.5 truncate text-[10px] text-[#7188a4] dark:text-[#8b98aa]">
              {conversation.sender}
            </p>
          )}
          <p
            className={`line-clamp-1 text-[11px] leading-[1.45] ${hasUnread ? "font-medium text-[#29425f] dark:text-[#d5dcea]" : "text-[#385574] dark:text-[#a8b3c4]"}`}
          >
            {lastMessagePreview}
          </p>
        </div>

        <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
          <span
            className={`whitespace-nowrap text-[10px] ${hasUnread ? "font-medium text-[#29425f] dark:text-[#d5dcea]" : "text-[#8093ab] dark:text-[#8b98aa]"}`}
          >
            {relativeTime}
          </span>
          {hasUnread && (
            <div className="flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-semibold text-white">
              {Math.min(conversation.unreadCount || 0, 9)}
            </div>
          )}
        </div>
      </div>

      <div className="absolute bottom-3 right-3 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {alertTarget.target && (
          <QuickAlertButton target={alertTarget} variant="pill" />
        )}
        <button
          type="button"
          onClick={handleArchive}
          className="flex h-7 w-7 items-center justify-center rounded border border-[#e2e8f0] bg-[#ffffff] text-slate-500 transition-colors hover:border-[#cbd5e1] hover:bg-[#f8fafc] hover:text-[#1e293b] dark:border-[#30394a] dark:bg-[#171e2b] dark:text-[#9aa6b8] dark:hover:border-[#46536a] dark:hover:bg-[#202a3a] dark:hover:text-[#f1f4f9]"
          title="Archive conversation"
          aria-label="Archive conversation"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
