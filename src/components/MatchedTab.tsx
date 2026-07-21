import { useEffect, useMemo, useState } from "react";
import { Search, Mail, MessageSquare, MessageCircle } from "lucide-react";
import { getImportantMessages } from "../lib/api";
import { MessageCard } from "./MessageCard";
import { MessageDetailModal } from "./MessageDetailModal";

interface MatchedMessage {
  _id?: string;
  id?: string;
  from?: string;
  source?: string;
  subject?: string;
  content?: string;
  preview?: string;
  timestamp?: string;
  matched?: boolean;
  matchedEntry?: {
    value: string;
  };
  spam?: boolean;
}

export function MatchedTab() {
  const [activeFilter, setActiveFilter] = useState("All Platforms");
  const [messages, setMessages] = useState<MatchedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeSpam, setIncludeSpam] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<any>(null);

  useEffect(() => {
    async function loadMessages() {
      try {
        setLoading(true);
        const data = await getImportantMessages();
        setMessages(data);
        setError(null);
      } catch (err) {
        console.error(err);
        setError("Unable to load matched messages");
      } finally {
        setLoading(false);
      }
    }

    loadMessages();
  }, []);

  const platformSet = useMemo(() => {
    const platforms = new Set<string>();
    messages.forEach((msg: MatchedMessage) => {
      const source = (msg.source || "").toLowerCase();
      if (source === "gmail") platforms.add("Gmail");
      else if (source === "whatsapp") platforms.add("WhatsApp");
      else if (source === "discord") platforms.add("Discord");
    });
    return platforms;
  }, [messages]);

  const visibleMessages = useMemo(() => {
    return messages.filter((msg) => {
      const platformMatches =
        activeFilter === "All Platforms" ||
        msg.source?.toLowerCase() === activeFilter.toLowerCase();
      const spamFilter = includeSpam ? true : !msg.spam;
      return platformMatches && spamFilter;
    });
  }, [activeFilter, messages, includeSpam]);

  const subtitle = useMemo(() => {
    if (loading) return "Loading...";
    const filtered = visibleMessages.length;
    return `Showing ${filtered} matched result${filtered !== 1 ? "s" : ""}${platformSet.size > 0 ? ` across ${platformSet.size} platform${platformSet.size !== 1 ? "s" : ""}` : ""}.`;
  }, [visibleMessages, platformSet, loading]);

  const handleMessageClick = (msg: MatchedMessage) => {
    setSelectedMessage({
      id: msg._id || msg.id || "",
      sender: msg.from || "Unknown sender",
      source: msg.source || "gmail",
      platform:
        msg.source === "gmail"
          ? "Gmail"
          : msg.source === "whatsapp"
            ? "WhatsApp"
            : "Discord",
      timestamp: msg.timestamp ? new Date(msg.timestamp).toLocaleString() : "",
      subject: msg.subject,
      preview: msg.content || msg.preview || "No preview available",
      matches: msg.matchedEntry
        ? [{ keyword: msg.matchedEntry.value, color: "red" }]
        : [],
    });
  };

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar pb-10">
      <div className="flex justify-between items-start mb-6 shrink-0">
        <div>
          <h2 className="text-[22px] font-bold text-white mb-1 tracking-tight">
            Matched
          </h2>
          <p className="text-gray-400 text-sm">{subtitle}</p>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 transform -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filter matched results..."
            className="bg-[#1a1a1a] border border-[#2a2a2a] text-gray-300 text-sm rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:border-indigo-500 w-[240px] transition-colors"
          />
        </div>
      </div>

      <div className="flex items-center justify-between mb-6 shrink-0">
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
          <button
            onClick={() => setActiveFilter("Discord")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center ${
              activeFilter === "Discord"
                ? "bg-[#6366f1] text-white"
                : "border border-[#333] text-gray-300 hover:bg-[#1a1a1a]"
            }`}
          >
            <MessageCircle className="w-4 h-4 mr-2" />
            Discord
          </button>
        </div>

        {/* Toggles */}
        <div className="flex items-center space-x-5">
          <label className="flex items-center space-x-2 text-sm text-gray-400 cursor-pointer">
            <span>Include spam</span>
            <button
              onClick={() => setIncludeSpam(!includeSpam)}
              className={`w-10 h-5 rounded-full relative transition-colors ${
                includeSpam ? "bg-[#6366f1]" : "bg-[#333]"
              }`}
            >
              <div
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  includeSpam ? "left-[22px]" : "left-0.5"
                }`}
              />
            </button>
          </label>
        </div>
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      <div className="space-y-4">
        {loading ? (
          <p className="text-sm text-gray-400">Loading matched messages...</p>
        ) : visibleMessages.length === 0 ? (
          <div className="rounded-xl border border-[#2a2a2a] bg-[#111] p-6 text-sm text-gray-400">
            No matched results found for your watchlist signals.
          </div>
        ) : (
          visibleMessages.map((msg) => (
            <div
              key={msg._id || msg.id}
              onClick={() => handleMessageClick(msg)}
            >
              <MessageCard
                message={{
                  id: msg._id || msg.id || "",
                  sender: msg.from || "Unknown sender",
                  source: msg.source || "gmail",
                  platform:
                    msg.source === "gmail"
                      ? "Gmail"
                      : msg.source === "whatsapp"
                        ? "WhatsApp"
                        : "Discord",
                  timestamp: msg.timestamp
                    ? new Date(msg.timestamp).toLocaleString()
                    : "",
                  preview: msg.content || msg.preview || "No preview available",
                  matches: msg.matchedEntry
                    ? [{ keyword: msg.matchedEntry.value, color: "red" }]
                    : [],
                }}
              />
            </div>
          ))
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
