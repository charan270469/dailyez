import { useEffect, useMemo, useState } from "react";
import {
  Mail,
  MessageSquare,
  MessageCircle,
  Shield,
  SlidersHorizontal,
  RefreshCw,
} from "lucide-react";
import { getArchiveMessages, restoreMessage } from "../lib/api";

interface ArchiveCard {
  _id?: string;
  id?: string;
  from?: string;
  source?: string;
  content?: string;
  archivedAt?: string;
  timestamp?: string;
  status?: string;
}

export function ArchiveTab() {
  const [activeFilter, setActiveFilter] = useState("All Archived");
  const [messages, setMessages] = useState<ArchiveCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  const getIcon = (platform: string) => {
    switch (platform) {
      case "Gmail":
        return <Mail className="w-4 h-4 text-gray-400" />;
      case "WhatsApp":
        return <MessageSquare className="w-4 h-4 text-gray-400" />;
      case "Discord":
        return <MessageCircle className="w-4 h-4 text-gray-400" />;
      case "System":
        return <Shield className="w-4 h-4 text-gray-400" />;
      default:
        return null;
    }
  };

  useEffect(() => {
    loadMessages();
    // Realtime polling every 30 seconds
    const interval = setInterval(loadMessages, 30000);
    return () => clearInterval(interval);
  }, []);

  async function loadMessages() {
    try {
      setLoading(true);
      const data = await getArchiveMessages();
      setMessages(data);
      setError(null);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      console.error(err);
      setError("Unable to load archived messages");
    } finally {
      setLoading(false);
    }
  }

  async function handleRestore(id?: string) {
    if (!id) return;
    try {
      const result = await restoreMessage(id);
      if (result.ok) {
        setMessages((current) =>
          current.filter((msg) => (msg._id || msg.id) !== id),
        );
      }
    } catch (err) {
      console.error(err);
      setError("Unable to restore the message");
    }
  }

  const visibleMessages = useMemo(() => {
    if (activeFilter === "Expired") {
      return messages.filter((msg) => {
        const archivedAt = msg.archivedAt
          ? new Date(msg.archivedAt).getTime()
          : 0;
        return Date.now() - archivedAt > 4 * 24 * 60 * 60 * 1000;
      });
    }
    return messages;
  }, [activeFilter, messages]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "READ":
        return (
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-gray-800 text-gray-400 border border-gray-700 uppercase tracking-wider">
            READ
          </span>
        );
      case "PROCESSED":
        return (
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-950/60 text-emerald-500 border border-emerald-900/50 uppercase tracking-wider">
            PROCESSED
          </span>
        );
      case "DISMISSED":
        return (
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-red-950/60 text-red-500 border border-red-900/50 uppercase tracking-wider">
            DISMISSED
          </span>
        );
      default:
        return null;
    }
  };

  const formatRelativeTime = (timestamp?: string) => {
    if (!timestamp) return "recently archived";
    const archivedTime = new Date(timestamp).getTime();
    const diffMs = Date.now() - archivedTime;
    const hours = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const formatExpiresIn = (timestamp?: string) => {
    if (!timestamp) return "expires soon";
    const archivedTime = new Date(timestamp).getTime();
    const remainingMs = 4 * 24 * 60 * 60 * 1000 - (Date.now() - archivedTime);
    const remainingHours = Math.max(
      0,
      Math.ceil(remainingMs / (1000 * 60 * 60)),
    );
    if (remainingHours <= 0) return "expired";
    return `expires in ${remainingHours}h`;
  };

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar pb-10">
      <div className="flex justify-between items-start mb-6 shrink-0">
        <div>
          <h2 className="text-[28px] font-bold text-white mb-1.5 tracking-tight">
            Archive
          </h2>
          <p className="text-gray-400 text-sm">
            Access all your previously monitored signals and muted threads
            {lastUpdated && (
              <span className="ml-2 text-gray-500">
                · Last updated {lastUpdated}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={loadMessages}
            disabled={loading}
            className="flex items-center text-sm font-medium text-gray-300 bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
          >
            <RefreshCw
              className={`w-4 h-4 mr-2 text-gray-400 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
          <button className="flex items-center text-sm font-medium text-gray-300 bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] px-4 py-2 rounded-lg transition-colors">
            <SlidersHorizontal className="w-4 h-4 mr-2 text-gray-400" />
            New Filter
          </button>
        </div>
      </div>

      <div className="flex space-x-3 mb-6 shrink-0">
        <button
          onClick={() => setActiveFilter("All Archived")}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            activeFilter === "All Archived"
              ? "bg-[#6366f1] text-white"
              : "border border-[#333] text-gray-300 hover:bg-[#1a1a1a]"
          }`}
        >
          All Archived
        </button>
        <button
          onClick={() => setActiveFilter("Muted")}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            activeFilter === "Muted"
              ? "bg-[#6366f1] text-white"
              : "border border-[#333] text-gray-300 hover:bg-[#1a1a1a]"
          }`}
        >
          Muted
        </button>
        <button
          onClick={() => setActiveFilter("Expired")}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            activeFilter === "Expired"
              ? "bg-[#6366f1] text-white"
              : "border border-[#333] text-gray-300 hover:bg-[#1a1a1a]"
          }`}
        >
          Expired
        </button>
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      <div className="space-y-4">
        {loading ? (
          <p className="text-sm text-gray-400">Loading archive...</p>
        ) : visibleMessages.length === 0 ? (
          <div className="rounded-xl border border-[#2a2a2a] bg-[#111] p-6 text-sm text-gray-400">
            No archived messages to show.
          </div>
        ) : (
          visibleMessages.map((msg) => (
            <div
              key={msg._id || msg.id}
              className="bg-[#161616] border border-[#2a2a2a] rounded-xl p-5 flex transition-colors hover:border-[#333]"
            >
              <div className="mr-5 mt-0.5 shrink-0">
                <div className="w-10 h-10 rounded-xl bg-[#222] border border-[#333] flex items-center justify-center">
                  {getIcon(
                    msg.source === "gmail"
                      ? "Gmail"
                      : msg.source === "whatsapp"
                        ? "WhatsApp"
                        : "Discord",
                  )}
                </div>
              </div>

              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <div className="flex justify-between items-start mb-2">
                  <span className="font-semibold text-gray-200 text-[15px] truncate pr-4">
                    {msg.from || "Unknown sender"}
                  </span>
                  <div className="flex items-center space-x-4 shrink-0">
                    <span className="text-gray-500 text-sm">
                      {formatRelativeTime(msg.archivedAt)}
                    </span>
                    {getStatusBadge(msg.status || "READ")}
                  </div>
                </div>

                <p className="text-gray-400 text-[15px] mb-4 line-clamp-1">
                  {msg.content || "No preview available"}
                </p>

                <div className="flex items-center justify-between">
                  <span className="inline-block px-2.5 py-1 rounded-md bg-[#222] border border-[#333] text-[10px] font-bold text-gray-400 tracking-wider uppercase">
                    {msg.source === "gmail"
                      ? "Gmail"
                      : msg.source === "whatsapp"
                        ? "WhatsApp"
                        : "Discord"}
                  </span>
                  <button
                    onClick={() => handleRestore(msg._id || msg.id)}
                    className="text-sm text-gray-300 hover:text-white"
                  >
                    {formatExpiresIn(msg.archivedAt)}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
