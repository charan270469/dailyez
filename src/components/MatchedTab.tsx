import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Link2,
  Mail,
  MessageCircle,
} from "lucide-react";
import { getImportantMessages, getInboxMessages } from "../lib/api";
import { extractEmailAddress } from "../lib/utils";
import { MessageDetailModal } from "./MessageDetailModal";
import { QuickAlertButton } from "./QuickAlertButton";

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
  chatId?: string;
  senderJid?: string;
  from?: string;
  sender?: string;
  source?: string;
  subject?: string;
  content?: string;
  bodyText?: string;
  preview?: string;
  timestamp?: string;
  createdAt?: string;
  matched?: boolean;
  signalMatches?: SignalMatch[];
  spam?: boolean;
}

const confidenceTone = {
  high: "border-emerald-200 bg-emerald-50 text-emerald-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  low: "border-red-200 bg-red-50 text-red-700",
};
function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  return (
    <span
      className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${confidenceTone[level]}`}
    >
      {level}
    </span>
  );
}

export function MatchedTab({
  refreshKey = 0,
  activeSignalIds = [],
  onManageConnections,
  onMatchedCountChange,
  hasSignals = null,
}: {
  refreshKey?: number;
  activeSignalIds?: string[];
  onManageConnections?: () => void;
  onMatchedCountChange?: (count: number | null) => void;
  hasSignals?: boolean | null;
}) {
  const [activeFilter, setActiveFilter] = useState("All Platforms");
  const [messages, setMessages] = useState<MatchedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeSpam, setIncludeSpam] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<any>(null);

  useEffect(() => {
    let cancelled = false,
      polls = 0;
    const loadMessages = async (showSpinner: boolean) => {
      if (showSpinner) setLoading(true);
      try {
        const data = await getImportantMessages();
        if (!cancelled) {
          setMessages(data);
          setError(null);
        }
      } catch (primaryError) {
        // Keep the existing important endpoint as the primary path. Some server
        // deployments can reject its cleanup mutation, though the inbox endpoint
        // still provides the same persisted matched documents read-only.
        try {
          const inbox = await getInboxMessages();
          const matched = inbox.filter(
            (message) =>
              message.matched || (message.signalMatches || []).length > 0,
          );
          if (!cancelled) {
            setMessages(matched);
            setError(null);
          }
        } catch (fallbackError) {
          console.error(
            "Unable to load matched messages",
            primaryError,
            fallbackError,
          );
          if (!cancelled) setError("Unable to load matched messages");
        }
      } finally {
        if (!cancelled && showSpinner) setLoading(false);
      }
    };
    void loadMessages(true);
    const interval = window.setInterval(() => {
      polls += 1;
      if (polls > 8) window.clearInterval(interval);
      else void loadMessages(false);
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [refreshKey]);

  const platformSet = useMemo(
    () =>
      new Set(
        messages
          .map((message) => message.source?.toLowerCase())
          .filter(Boolean),
      ),
    [messages],
  );
  const visibleMessages = useMemo(() => {
    const activeSet = new Set(activeSignalIds.map(String));
    return messages.filter((message) => {
      const platformMatches =
        activeFilter === "All Platforms" ||
        message.source?.toLowerCase() === activeFilter.toLowerCase();
      const signalMatches =
        hasSignals === null
          ? true
          : hasSignals &&
            activeSet.size > 0 &&
            (message.signalMatches || []).some(
              (match) =>
                match.matchedSignalId &&
                activeSet.has(String(match.matchedSignalId)),
            );
      return platformMatches && signalMatches && (includeSpam || !message.spam);
    });
  }, [activeFilter, activeSignalIds, hasSignals, includeSpam, messages]);

  const subtitle = loading
    ? "Loading..."
    : `Showing ${visibleMessages.length} matched result${visibleMessages.length === 1 ? "" : "s"} across ${platformSet.size} platform${platformSet.size === 1 ? "" : "s"}.`;
  useEffect(() => {
    onMatchedCountChange?.(loading ? null : visibleMessages.length);
  }, [loading, onMatchedCountChange, visibleMessages.length]);
  const openMessage = (message: MatchedMessage) =>
    setSelectedMessage({
      id: message._id || message.id || "",
      chatId: message.chatId,
      sender: message.from || message.sender || "Unknown sender",
      source: message.source || "gmail",
      platform: message.source === "whatsapp" ? "WhatsApp" : "Gmail",
      timestamp: message.timestamp
        ? new Date(message.timestamp).toLocaleString()
        : "",
      subject: message.subject,
      preview:
        message.content ||
        message.bodyText ||
        message.preview ||
        "No preview available",
      matches: (message.signalMatches || []).map((match) => ({
        keyword: match.context.slice(0, 30),
        color: match.confidence === "high" ? "red" : "indigo",
      })),
    });
  const filters = [
    { label: "All Platforms", icon: null },
    { label: "Gmail", icon: Mail },
    { label: "WhatsApp", icon: MessageCircle },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f7f9fc] px-6 pb-5 pt-6">
      <div className="mb-4 shrink-0">
        <h1 className="text-[24px] font-bold leading-tight tracking-tight text-[#0f2742]">
          Matched
        </h1>
        <p className="mt-1 text-xs text-[#58708d]">{subtitle}</p>
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
              {Icon && (
                <Icon
                  className={`h-3.5 w-3.5 ${label === "Gmail" ? "text-red-500" : "text-emerald-600"}`}
                />
              )}
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
          Include spam
          <button
            type="button"
            role="switch"
            aria-checked={includeSpam}
            onClick={() => setIncludeSpam((value) => !value)}
            className={`relative h-5 w-8 rounded-full transition-colors duration-200 ease-out ${includeSpam ? "bg-[#2563eb]" : "bg-slate-200"}`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none ${includeSpam ? "translate-x-3" : "translate-x-0"}`}
            />
          </button>
        </label>
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
            Loading matched messages...
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm text-[#58708d]">
            No matched results found for your signals.
          </div>
        ) : (
          visibleMessages.map((message, index) => (
            <MatchedMessageCard
              key={message._id || message.id || index}
              message={message}
              onClick={() => openMessage(message)}
            />
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
  const matches = message.signalMatches || [],
    bestMatch = matches[0];
  const sender = message.from || message.sender || "Unknown sender";
  const body =
    message.content || message.bodyText || message.preview || "No preview";
  const average = (() => {
    const values = { high: 3, medium: 2, low: 1 };
    const total =
      matches.reduce((sum, match) => sum + values[match.confidence], 0) /
      (matches.length || 1);
    return total >= 2.5 ? "high" : total >= 1.5 ? "medium" : "low";
  })() as "high" | "medium" | "low";
  const isWhatsApp = message.source?.toLowerCase() === "whatsapp";
  const alertTarget = isWhatsApp
    ? {
        platform: "whatsapp" as const,
        target:
          message.chatId ||
          message.senderJid ||
          message.from ||
          message.sender ||
          "",
        senderName: sender,
      }
    : {
        platform: "gmail" as const,
        target:
          extractEmailAddress(message.from || message.sender || "") ||
          message.from ||
          message.sender ||
          "",
        senderName: sender,
      };
  const accent = isWhatsApp ? "bg-emerald-500" : "bg-red-500";
  return (
    <article
      onClick={onClick}
      className="group relative cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-white transition-colors hover:border-blue-300"
    >
      <span className={`absolute bottom-0 left-0 top-0 w-[3px] ${accent}`} />
      <div className="p-4 pl-6">
        <div className="flex items-start gap-3">
          <span
            className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${isWhatsApp ? "bg-emerald-100 text-emerald-600" : "bg-red-50 text-red-500"}`}
          >
            {isWhatsApp ? (
              <MessageCircle className="h-3.5 w-3.5" />
            ) : (
              <Mail className="h-3.5 w-3.5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2 text-xs">
              <span className="truncate font-semibold text-[#0f2742]">
                {sender}
              </span>
              <span className="hidden truncate text-[#8aa0bb] sm:inline">
                {isWhatsApp
                  ? ""
                  : extractEmailAddress(message.from || message.sender || "")}
              </span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-[#385574]">
                via {isWhatsApp ? "WhatsApp" : "Gmail"}
              </span>
              <ConfidenceBadge level={average} />
              <span className="ml-auto shrink-0 text-[10px] text-[#7890ab]">
                {message.timestamp || message.createdAt
                  ? new Date(
                      message.timestamp || message.createdAt || "",
                    ).toLocaleString()
                  : ""}
              </span>
            </div>
            <h2 className="mt-2 min-w-0 text-sm font-bold leading-5 text-[#0f2742]">
              {message.subject || sender || "Matched message"}
            </h2>
            {bestMatch?.summary && (
              <p className="mt-1 text-xs italic leading-5 text-[#2563eb]">
                {bestMatch.summary}
              </p>
            )}
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#405a78]">
              {body}
            </p>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {message.spam && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">
                    <AlertTriangle className="h-3 w-3" />
                    SPAM
                  </span>
                )}
                {matches.slice(0, 1).map((match, index) => (
                  <span
                    key={index}
                    className="max-w-[220px] truncate rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700"
                  >
                    ● {match.context}
                  </span>
                ))}
                {matches.length > 0 && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setExpanded((value) => !value);
                    }}
                    className="flex items-center gap-0.5 text-xs text-[#456887] hover:text-[#2563eb]"
                  >
                    {expanded ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                    Why this matched
                  </button>
                )}
              </div>
              {alertTarget.target && (
                <span
                  onClick={(event) => event.stopPropagation()}
                  className="inline-flex"
                >
                  <QuickAlertButton target={alertTarget} variant="icon" />
                </span>
              )}
            </div>
            {expanded && (
              <div
                onClick={(event) => event.stopPropagation()}
                className="mt-3 space-y-2 border-t border-slate-100 pt-3"
              >
                {matches.map((match, index) => (
                  <div
                    key={index}
                    className="rounded-md bg-slate-50 px-3 py-2 text-xs leading-5 text-[#48627f]"
                  >
                    <span className="font-semibold text-[#29425f]">
                      {match.context}
                    </span>
                    <p>{match.reasoning}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
