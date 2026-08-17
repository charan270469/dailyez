// Legacy "Priority" tab: lists important/matched messages from getImportantMessages
// with platform filters. Superseded in the sidebar by the Matched tab.
import { useEffect, useMemo, useState } from "react";
import { Search, Plus, Mail, MessageSquare, MessageCircle } from "lucide-react";
import { MessageCard } from "./MessageCard";
import { getImportantMessages } from "../lib/api";

export function PriorityFeed() {
  const [activeFilter, setActiveFilter] = useState("All Platforms");
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadMessages() {
      try {
        setLoading(true);
        const data = await getImportantMessages();
        setMessages(data);
        setError(null);
      } catch (err) {
        console.error(err);
        setError("Unable to load important messages");
      } finally {
        setLoading(false);
      }
    }

    loadMessages();
  }, []);

  // Compute dynamic platform count from messages
  const platformSet = useMemo(() => {
    const platforms = new Set<string>();
    messages.forEach((msg) => {
      const source = (msg.source || "").toLowerCase();
      if (source === "gmail") platforms.add("Gmail");
      else if (source === "whatsapp") platforms.add("WhatsApp");
      else if (source === "discord") platforms.add("Discord");
    });
    return platforms;
  }, [messages]);

  const subtitle = useMemo(() => {
    if (loading) return "Loading...";
    return `Showing ${messages.length} action-required message${messages.length !== 1 ? "s" : ""}${platformSet.size > 0 ? ` across ${platformSet.size} platform${platformSet.size !== 1 ? "s" : ""}` : ""}.`;
  }, [messages, platformSet, loading]);

  const visibleMessages = useMemo(() => {
    return messages.filter(
      (msg) =>
        activeFilter === "All Platforms" ||
        msg.source?.toLowerCase() === activeFilter.toLowerCase(),
    );
  }, [activeFilter, messages]);

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar pb-10 pt-12">
      <div className="flex justify-between items-start mb-6 shrink-0">
        <div>
          <h2 className="text-[22px] font-bold text-white mb-1 tracking-tight">
            Priority Actions
          </h2>
          <p className="text-gray-400 text-sm">{subtitle}</p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 transform -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter visible signals..."
              className="bg-[#1a1a1a] border border-[#2a2a2a] text-gray-300 text-sm rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:border-indigo-500 w-[240px] transition-colors"
            />
          </div>
          <button className="flex items-center text-sm font-medium text-gray-300 bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] px-4 py-2 rounded-lg transition-colors">
            <Plus className="w-4 h-4 mr-2" />
            Watchlist
          </button>
        </div>
      </div>

      <div className="flex space-x-3 mb-6 shrink-0">
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

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      <div className="space-y-4">
        {loading ? (
          <p className="text-sm text-gray-400">Loading priority messages...</p>
        ) : visibleMessages.length === 0 ? (
          <div className="rounded-xl border border-[#2a2a2a] bg-[#111] p-6 text-sm text-gray-400">
            No priority messages available right now.
          </div>
        ) : (
          visibleMessages.map((msg) => (
            <MessageCard
              key={msg._id || msg.id}
              message={{
                id: msg._id || msg.id,
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
                preview: msg.content || "No preview available",
                matches: (msg.signalMatches || []).map((sm: any) => ({
                  keyword: sm.context ? sm.context.slice(0, 30) : "Matched",
                  color: sm.confidence === "high" ? "red" : "indigo",
                })),
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
