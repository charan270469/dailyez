// All Inbox tab: lists every stored message across platforms with platform/matched/
// keyword filters and a click-through detail modal.
import { useEffect, useMemo, useState } from "react";
import { InboxMessageCard } from "./InboxMessageCard";
import { WhatsAppChatCard } from "./WhatsAppChatCard";
import { getInboxMessages } from "../lib/api";
import { Link2, Mail, MessageCircle } from "lucide-react";
import { MessageDetailModal } from "./MessageDetailModal";

interface InboxFeedProps {
  onManageConnections: () => void;
}

export function InboxFeed({ onManageConnections }: InboxFeedProps) {
  const [activeFilter, setActiveFilter] = useState("All Platforms");
  const [keywordMatchedOnly, setKeywordMatchedOnly] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<any>(null);

  useEffect(() => {
    async function loadMessages() {
      try {
        setLoading(true);
        const data = await getInboxMessages();
        setMessages(data);
        setError(null);
      } catch (err) {
        console.error(err);
        setError("Unable to load inbox messages");
      } finally {
        setLoading(false);
      }
    }

    loadMessages();

    // Reload automatically when a WhatsApp resync clears + re-fetches messages.
    const reloadOnResync = () => loadMessages();
    window.addEventListener('whatsapp-resynced', reloadOnResync);

    return () => window.removeEventListener('whatsapp-resynced', reloadOnResync);
  }, []);

  const visibleMessages = useMemo(() => {
    return messages.filter((msg) => {
      const platformMatches =
        activeFilter === "All Platforms" ||
        msg.source?.toLowerCase() === activeFilter.toLowerCase();
      const keywordMatches = !keywordMatchedOnly || msg.keywordMatched === true;
      return platformMatches && keywordMatches;
    });
  }, [activeFilter, keywordMatchedOnly, messages]);

  const handleMessageClick = (msg: any) => {
    setSelectedMessage({
      id: msg._id || msg.id,
      chatId: msg.chatId,
      sender: msg.sender || msg.from || "Unknown sender",
      source: msg.source || "gmail",
      platform:
        msg.source === "whatsapp"
          ? "WhatsApp"
          : "Gmail",
      timestamp: msg.timestamp ? new Date(msg.timestamp).toLocaleString() : "",
      subject: msg.subject,
      preview: msg.content || msg.preview || "No preview available",
      matches: (msg.signalMatches || []).map((sm: any) => ({
        keyword: sm.context ? sm.context.slice(0, 30) : "Matched",
        color: sm.confidence === "high" ? "red" : "indigo",
      })),
    });
  };

  const filters = [{ label: "All Platforms", icon: null }, { label: "Gmail", icon: Mail }, { label: "WhatsApp", icon: MessageCircle }];

  return (
    <div className="flex h-full min-h-0 flex-col px-6 pb-5 pt-6">
      <div className="mb-4 shrink-0">
        <h1 className="text-[24px] font-bold leading-tight tracking-tight text-[#0f2742]">
          All Inbox
        </h1>
        <p className="mt-1 text-xs text-[#58708d]">
          Everything from your connected platforms, most recent first
        </p>
      </div>

      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-3 pr-[92px]">
        <div className="flex h-8 shrink-0 rounded-md border border-slate-200 bg-slate-50 p-0.5">
          {filters.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => setActiveFilter(label)}
              className={`flex items-center gap-1.5 rounded px-3 text-xs font-semibold transition-colors ${activeFilter === label ? "bg-white text-[#2563eb] shadow-sm" : "text-[#48627f] hover:text-[#0f2742]"}`}
            >
              {Icon && <Icon className={`h-3.5 w-3.5 ${label === "Gmail" ? "text-red-500" : "text-emerald-600"}`} />}
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onManageConnections}
          className="flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-[#29425f] shadow-sm transition-colors hover:border-blue-300 hover:text-[#2563eb]"
        >
          <Link2 className="h-3.5 w-3.5" />
          Manage connections
        </button>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-[#29425f]">
          Keyword matched
          <button
            type="button"
            role="switch"
            aria-checked={keywordMatchedOnly}
            onClick={() => setKeywordMatchedOnly((value) => !value)}
            className={`relative h-5 w-8 rounded-full transition-colors duration-200 ease-out ${keywordMatchedOnly ? "bg-[#2563eb]" : "bg-slate-200"}`}
          >
            <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none ${keywordMatchedOnly ? "translate-x-3" : "translate-x-0"}`} />
          </button>
        </label>
      </div>
      <div className="mb-5 flex shrink-0 items-center gap-4 text-xs text-[#91a3bc]"><span className="h-px flex-1 bg-slate-200" /><span>No more past messages</span><span className="h-px flex-1 bg-slate-200" /></div>

      {error && <p className="mb-3 shrink-0 text-xs text-red-600">{error}</p>}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-14 pr-1">
        {loading ? (
          <div className="rounded-lg border border-slate-200 p-5 text-sm text-[#58708d]">Loading inbox...</div>
        ) : visibleMessages.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm text-[#58708d]">
            No messages available for this view yet.
          </div>
        ) : (
          visibleMessages.map((msg) => {
            // Use WhatsApp conversation card for WhatsApp messages
            if (msg.source === "whatsapp") {
              return (
                <WhatsAppChatCard
                  key={msg._id || msg.id}
                  conversation={{
                    id: msg._id || msg.id,
                    from: msg.from || "Unknown contact",
                    sender: msg.sender || msg.from || "Unknown contact",
                    chatId: msg.chatId,
                    source: msg.source,
                    platform: "WhatsApp",
                    timestamp: msg.timestamp || msg.createdAt,
                    subject: msg.subject,
                    preview: msg.content || msg.preview || "(no text content)",
                    content: msg.content,
                    messageCount: msg.messageCount,
                    unreadCount: msg.unreadCount,
                    matched: msg.matched || false,
                    signalMatches: msg.signalMatches || [],
                    keywordMatched: msg.keywordMatched || false,
                    keywordSignalMatches: msg.keywordSignalMatches || [],
                    isGroup: msg.isGroup === true,
                    groupName: msg.groupName,
                    groupJid: msg.groupJid,
                  }}
                  onMessageClick={handleMessageClick}
                />
              );
            }

            // Use standard inbox card for other platforms
            return (
              <div
                key={msg._id || msg.id}
                onClick={() => handleMessageClick(msg)}
              >
                <InboxMessageCard
                  message={{
                    id: msg._id || msg.id,
                    sender: msg.from || "Unknown sender",
                    source: msg.source || "gmail",
                    platform:
                      msg.source === "whatsapp"
                        ? "WhatsApp"
                        : "Gmail",
                    timestamp: msg.timestamp
                      ? new Date(msg.timestamp).toLocaleString()
                      : "",
                    subject: msg.subject,
                    preview: msg.content || msg.preview || "No preview available",
                    matched: msg.matched || false,
                    signalMatches: msg.signalMatches || [],
                    keywordMatched: msg.keywordMatched || false,
                    keywordSignalMatches: msg.keywordSignalMatches || [],
                  }}
                />
              </div>
            );
          })
        )}
      </div>

      {selectedMessage && (
        <MessageDetailModal
          message={selectedMessage}
          onClose={() => setSelectedMessage(null)}
        />
      )}
    </div>
  );
}
