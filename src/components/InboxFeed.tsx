// All Inbox tab: lists every stored message across platforms with platform/matched/
// keyword filters and a click-through detail modal.
import { useEffect, useMemo, useState } from "react";
import { InboxMessageCard } from "./InboxMessageCard";
import { WhatsAppChatCard } from "./WhatsAppChatCard";
import { getInboxMessages } from "../lib/api";
import { Mail, MessageSquare } from "lucide-react";
import { MessageDetailModal } from "./MessageDetailModal";

export function InboxFeed() {
  const [activeFilter, setActiveFilter] = useState("All Platforms");
  const [matchedOnly, setMatchedOnly] = useState(false);
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
      const matchedMatches = !matchedOnly || msg.matched === true;
      const keywordMatches = !keywordMatchedOnly || msg.keywordMatched === true;
      return platformMatches && matchedMatches && keywordMatches;
    });
  }, [activeFilter, matchedOnly, keywordMatchedOnly, messages]);

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

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar pb-10 pt-12">
      <div className="mb-6 shrink-0">
        <h2 className="text-[22px] font-bold text-white mb-1 tracking-tight">
          All Inbox
        </h2>
        <p className="text-gray-400 text-sm">
          Everything from your connected platforms, most recent first
        </p>
      </div>

      <div className="flex justify-between items-center mb-6">
        <div className="flex space-x-3">
          <button
            onClick={() => setActiveFilter("All Platforms")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeFilter === "All Platforms"
                ? "bg-[#6366f1] text-white"
                : "border border-[#333] text-gray-300 hover:bg-[#1a1a1a]"
            }`}
          >
            All Platforms
          </button>
          <button
            onClick={() => setActiveFilter("Gmail")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center ${
              activeFilter === "Gmail"
                ? "bg-[#6366f1] text-white"
                : "border border-[#333] text-gray-300 hover:bg-[#1a1a1a]"
            }`}
          >
            <Mail className="w-4 h-4 mr-2" />
            Gmail
          </button>
          <button
            onClick={() => setActiveFilter("WhatsApp")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center ${
              activeFilter === "WhatsApp"
                ? "bg-[#6366f1] text-white"
                : "border border-[#333] text-gray-300 hover:bg-[#1a1a1a]"
            }`}
          >
            <MessageSquare className="w-4 h-4 mr-2" />
            WhatsApp
          </button>
        </div>

        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-400">Matched only</span>
            <button
              onClick={() => setMatchedOnly(!matchedOnly)}
              className={`w-10 h-5 rounded-full relative transition-colors ${matchedOnly ? "bg-[#6366f1]" : "bg-[#333]"}`}
            >
              <div
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${matchedOnly ? "left-[22px]" : "left-0.5"}`}
              />
            </button>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-400">Keyword matched</span>
            <button
              onClick={() => setKeywordMatchedOnly(!keywordMatchedOnly)}
              className={`w-10 h-5 rounded-full relative transition-colors ${keywordMatchedOnly ? "bg-indigo-500" : "bg-[#333]"}`}
            >
              <div
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${keywordMatchedOnly ? "left-[22px]" : "left-0.5"}`}
              />
            </button>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      <div className="space-y-4">
        {loading ? (
          <p className="text-sm text-gray-400">Loading inbox...</p>
        ) : visibleMessages.length === 0 ? (
          <div className="rounded-xl border border-[#2a2a2a] bg-[#111] p-6 text-sm text-gray-400">
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
