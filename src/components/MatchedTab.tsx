import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Mail,
  MessageSquare,
  MessageCircle,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";
import { getImportantMessages } from "../lib/api";
import { MessageDetailModal } from "./MessageDetailModal";

interface SignalMatch {
  matchedSignalId: string;
  context: string;
  summary: string;
  reasoning: string;
  confidence: "high" | "medium" | "low";
}

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
  signalMatches?: SignalMatch[];
  spam?: boolean;
}

function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  const colors = {
    high: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    low: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${colors[level]}`}
    >
      {level}
    </span>
  );
}

export function MatchedTab({
  refreshKey = 0,
  activeSignalIds = [],
}: {
  refreshKey?: number;
  activeSignalIds?: string[];
}) {
  const [activeFilter, setActiveFilter] = useState("All Platforms");
  const [messages, setMessages] = useState<MatchedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeSpam, setIncludeSpam] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    let polls = 0;
    const MAX_POLLS = 8;

    async function loadMessages(showSpinner: boolean) {
      if (showSpinner) setLoading(true);
      try {
        const data = await getImportantMessages();
        if (cancelled) return;
        setMessages(data);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setError("Unable to load matched messages");
      } finally {
        if (!cancelled && showSpinner) setLoading(false);
      }
    }

    // Initial load right away so the newly added signal shows a loading state.
    loadMessages(true);

    // Poll for a short window so matches for a just-added signal (computed
    // asynchronously on the server) appear without needing a manual reload.
    const interval = setInterval(() => {
      polls += 1;
      if (polls > MAX_POLLS) {
        clearInterval(interval);
        return;
      }
      loadMessages(false);
    }, 4000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshKey]);

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
    const activeSet = new Set(activeSignalIds.map((id) => String(id)));
    return messages.filter((msg) => {
      const platformMatches =
        activeFilter === "All Platforms" ||
        msg.source?.toLowerCase() === activeFilter.toLowerCase();
      // Messages without a spam field are treated as non-spam (backwards compatible)
      const spamFilter = includeSpam ? true : !msg.spam;
      // Signal toggle filter: only show messages that match at least one
      // toggled-on signal. When no signals exist or all signals are toggled
      // off, show nothing at all (the tab is empty).
      const signalFilter =
        activeSet.size > 0 &&
        (msg.signalMatches || []).some(
          (m) => m.matchedSignalId && activeSet.has(String(m.matchedSignalId)),
        );
      return platformMatches && spamFilter && signalFilter;
    });
  }, [activeFilter, messages, includeSpam, activeSignalIds]);

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
      matches: (msg.signalMatches || []).map((sm) => ({
        keyword: sm.context.slice(0, 30),
        color: sm.confidence === "high" ? "red" : "indigo",
      })),
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

      <div className="space-y-3">
        {loading ? (
          <p className="text-sm text-gray-400">Loading matched messages...</p>
        ) : visibleMessages.length === 0 ? (
          <div className="rounded-xl border border-[#2a2a2a] bg-[#111] p-6 text-sm text-gray-400">
            No matched results found for your signals.
          </div>
        ) : (
          visibleMessages.map((msg) => (
            <div key={msg._id || msg.id}>
              <MatchedMessageCard
                message={msg}
                onClick={() => handleMessageClick(msg)}
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

function MatchedMessageCard({
  message,
  onClick,
}: {
  message: MatchedMessage;
  onClick: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const matches = message.signalMatches || [];
  const bestMatch = matches[0];
  const avgConfidence: "high" | "medium" | "low" = (() => {
    const levels = { high: 3, medium: 2, low: 1 };
    const avg =
      matches.reduce((sum, m) => sum + (levels[m.confidence] || 1), 0) /
      (matches.length || 1);
    if (avg >= 2.5) return "high";
    if (avg >= 1.5) return "medium";
    return "low";
  })();

  return (
    <div
      className="bg-[#111] border border-[#222] hover:border-[#333] rounded-xl transition-colors cursor-pointer"
      onClick={onClick}
    >
      <div className="p-3.5">
        <div className="flex items-start">
          <div className="mr-3.5">
            <div className="w-9 h-9 rounded-xl bg-red-950/40 flex items-center justify-center border border-red-900/50 flex-shrink-0">
              <Mail className="w-4 h-4 text-red-400" />
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-center mb-1">
              <div className="flex items-baseline space-x-2 truncate">
                <span className="font-semibold text-gray-100 text-[15px]">
                  {message.from || "Unknown"}
                </span>
                <span className="text-gray-500 text-sm">via Gmail</span>
              </div>
              <div className="flex items-center space-x-2 shrink-0 ml-2">
                {message.spam && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border border-red-500/30 bg-red-500/10 text-red-400">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Spam
                  </span>
                )}
                <ConfidenceBadge level={avgConfidence} />
                <span className="text-gray-500 text-xs whitespace-nowrap">
                  {message.timestamp
                    ? new Date(message.timestamp).toLocaleString()
                    : ""}
                </span>
              </div>
            </div>

            {message.subject && (
              <h4 className="text-white font-medium text-sm mb-0.5">
                {message.subject}
              </h4>
            )}

            {/* AI Summary line */}
            {bestMatch?.summary && (
              <p className="text-indigo-300/80 text-xs italic mb-2 line-clamp-1">
                {bestMatch.summary}
              </p>
            )}

            <p className="text-gray-400 text-sm line-clamp-2 mb-2">
              {message.content || message.preview || "No preview"}
            </p>

            {/* Signal match badges */}
            {matches.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-1">
                {matches.map((m, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                      m.confidence === "high"
                        ? "bg-emerald-950/30 text-emerald-400 border-emerald-900/30"
                        : m.confidence === "medium"
                          ? "bg-amber-950/30 text-amber-400 border-amber-900/30"
                          : "bg-red-950/30 text-red-400 border-red-900/30"
                    }`}
                  >
                    {m.context.length > 24
                      ? m.context.slice(0, 24) + "..."
                      : m.context}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Expandable reasoning section */}
        {matches.length > 0 && (
          <div className="mt-2" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              {expanded ? (
                <ChevronUp className="w-3.5 h-3.5 mr-1" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 mr-1" />
              )}
              Why this matched
            </button>
            {expanded && (
              <div className="mt-2 space-y-2">
                {matches.map((m, i) => (
                  <div
                    key={i}
                    className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-3 text-xs text-gray-400"
                  >
                    <span className="font-semibold text-gray-300 block mb-1">
                      Signal: {m.context}
                    </span>
                    <p className="leading-relaxed">{m.reasoning}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
