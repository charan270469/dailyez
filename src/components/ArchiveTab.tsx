// Archive tab: lists archived messages, supports restoring them, and filters by
// read/processed/dismissed/expired status.
import { useEffect, useMemo, useState } from "react";
import {
  Mail,
  MessageSquare,
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
        return Date.now() - archivedAt > 1 * 24 * 60 * 60 * 1000;
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
    const remainingMs = 1 * 24 * 60 * 60 * 1000 - (Date.now() - archivedTime);
    const remainingHours = Math.max(
      0,
      Math.ceil(remainingMs / (1000 * 60 * 60)),
    );
    if (remainingHours <= 0) return "expired";
    return `expires in ${remainingHours}h`;
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-6 pb-5 pt-6">
      <div className="mb-4 shrink-0">
        <h1 className="text-[24px] font-bold leading-tight tracking-tight text-[#0f2742]">
          Archived Messages
        </h1>
        <p className="mt-1 text-xs text-[#58708d]">
          Access all your previously monitored signals and muted threads
          {lastUpdated && (
            <span className="ml-2 text-[#91a3bc]">
              · Last updated {lastUpdated}
            </span>
          )}
        </p>
      </div>

      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-3 pr-[92px]">
        <div className="flex h-8 shrink-0 rounded-md border border-slate-200 bg-slate-50 p-0.5">
          {["All Archived", "Muted", "Expired"].map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => setActiveFilter(label)}
              className={`flex items-center gap-1.5 rounded px-3 text-xs font-semibold transition-colors ${activeFilter === label ? "bg-white text-[#2563eb] shadow-sm" : "text-[#48627f] hover:text-[#0f2742]"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={loadMessages}
            disabled={loading}
            className="flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-[#29425f] shadow-sm transition-colors hover:border-blue-300 hover:text-[#2563eb] disabled:opacity-60"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
          <button className="flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-[#29425f] shadow-sm transition-colors hover:border-blue-300 hover:text-[#2563eb]">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            New Filter
          </button>
        </div>
      </div>
      <div className="mb-5 flex shrink-0 items-center gap-4 text-xs text-[#91a3bc]">
        <span className="h-px flex-1 bg-slate-200" />
        <span>No more past messages</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>
      {error && <p className="mb-3 shrink-0 text-xs text-red-600">{error}</p>}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-14 pr-1">
        {loading ? (
          <div className="rounded-lg border border-slate-200 p-5 text-sm text-[#58708d]">
            Loading archive...
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm text-[#58708d]">
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
                  {getIcon(msg.source === "whatsapp" ? "WhatsApp" : "Gmail")}
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
                    {msg.source === "whatsapp" ? "WhatsApp" : "Gmail"}
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
