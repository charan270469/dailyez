// Modal showing a single message's full details (sender, subject, content, matches)
// with an archive action and — for WhatsApp conversations — a "Summarize this chat"
// button that reuses the server's existing WhatsApp summarizer.
import { useState, useEffect } from "react";
import { X, Mail, MessageSquare, Archive, Sparkles, Loader2, Search } from "lucide-react";
import { archiveMessage, summarizeWhatsAppChat, searchWhatsAppChat } from "../lib/api";

interface MessageDetailModalProps {
  message: {
    id: string;
    sender: string;
    source: string;
    platform: string;
    timestamp: string;
    subject?: string;
    preview: string;
    chatId?: string;
    matches?: Array<{ keyword: string; color: string }>;
  };
  onClose: () => void;
}

export function MessageDetailModal({
  message,
  onClose,
}: MessageDetailModalProps) {
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryCount, setSummaryCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const getPlatformIcon = () => {
    switch (message.platform) {
      case "Gmail":
        return <Mail className="w-5 h-5 text-red-400" />;
      case "WhatsApp":
        return <MessageSquare className="w-5 h-5 text-green-400" />;
      default:
        return null;
    }
  };

  const handleArchive = async () => {
    try {
      await archiveMessage(message.id);
      onClose();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSummarize = async () => {
    if (!message.chatId || summaryLoading) return;
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const result = await summarizeWhatsAppChat(message.chatId);
      setSummary(result.summary);
      setSummaryCount(result.messageCount);
    } catch (err) {
      console.error(err);
      setSummary(null);
      setSummaryError(
        err instanceof Error ? err.message : "Failed to summarize this chat.",
      );
    } finally {
      setSummaryLoading(false);
    }
  };

  // WhatsApp conversation search: as the user types, query the backend for
  // messages in this chat whose content contains the query (300ms debounce).
  // Clearing the input resets the modal back to the full single-message view.
  useEffect(() => {
    if (message.source !== "whatsapp") return;
    const chatId = message.chatId;
    if (!chatId) return;

    const query = searchQuery.trim();
    if (!query) {
      setSearchResults(null);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    setSearchError(null);

    // `active` guard prevents a slower earlier response from clobbering the
    // results of a newer query (out-of-order fetches on fast typing).
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const results = await searchWhatsAppChat(chatId, query);
        if (active) setSearchResults(results);
      } catch (err) {
        console.error(err);
        if (active) {
          setSearchResults([]);
          setSearchError(
            err instanceof Error ? err.message : "Failed to search this conversation.",
          );
        }
      } finally {
        if (active) setSearchLoading(false);
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery, message.source, message.chatId]);

  // While a conversation search is active (input non-empty + results arrived),
  // the modal swaps the single-message detail for the list of matching messages.
  const isSearchMode = message.source === "whatsapp" && searchResults !== null;

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1a1a] border border-[#333] rounded-xl w-full max-w-2xl max-h-[85vh] overflow-hidden shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-[#333] shrink-0">
          <div className="flex justify-between items-center p-5">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-[#222] border border-[#333] flex items-center justify-center">
                {getPlatformIcon()}
              </div>
              <div>
                <h3 className="text-white font-semibold text-lg">
                  Message Details
                </h3>
                <span className="text-gray-500 text-xs">{message.platform}</span>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleArchive}
                className="p-2 text-gray-400 hover:text-white hover:bg-[#222] rounded-lg transition-colors"
                title="Archive"
              >
                <Archive className="w-5 h-5" />
              </button>
              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-white hover:bg-[#222] rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* WhatsApp: search within this conversation */}
          {message.source === "whatsapp" && message.chatId && (
            <div className="px-5 pb-4 border-t border-[#222]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search this conversation..."
                  className="w-full rounded-lg bg-[#222] border border-[#333] pl-9 pr-9 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#6366f1] transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-gray-400 hover:text-white hover:bg-[#333] transition-colors"
                    title="Clear search (back to full conversation)"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {searchQuery && (
                <p className="mt-2 text-[11px] text-gray-500">
                  {searchLoading
                    ? "Searching messages..."
                    : searchError
                      ? searchError
                      : searchResults === null
                        ? ""
                        : `${searchResults.length} message${searchResults.length === 1 ? "" : "s"} match "${searchQuery.trim()}"`}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Sender & Timestamp (hidden while conversation search results are shown) */}
          {!isSearchMode && (
            <div className="flex justify-between items-start">
              <div>
                <h4 className="text-white font-bold text-xl">{message.sender}</h4>
                <p className="text-gray-400 text-sm mt-1">{message.source}</p>
              </div>
              <span className="text-gray-500 text-sm whitespace-nowrap">
                {message.timestamp}
              </span>
            </div>
          )}

          {/* WhatsApp: Summarize this chat */}
          {message.source === "whatsapp" && message.chatId && (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handleSummarize}
                disabled={summaryLoading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed bg-[#6366f1] text-white hover:bg-[#4f46e5]"
              >
                {summaryLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {summaryLoading ? "Summarizing..." : "Summarize this chat"}
              </button>
              {summary && !summaryLoading && summaryCount > 0 && (
                <span className="text-gray-500 text-xs">
                  Based on the {summaryCount} most recent messages
                </span>
              )}
            </div>
          )}

          {/* WhatsApp: AI summary result / loading / error */}
          {(summaryLoading || summary !== null || summaryError !== null) && (
            <div
              className={`bg-[#111] border rounded-lg p-4 ${
                summaryError ? "border-red-900/30" : "border-indigo-900/40"
              }`}
            >
              <span
                className={`text-[11px] font-bold tracking-widest uppercase ${
                  summaryError ? "text-red-400" : "text-indigo-400"
                }`}
              >
                AI Summary
              </span>
              {summaryLoading ? (
                <p className="mt-2 text-gray-500 text-sm flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Summarizing this conversation…
                </p>
              ) : summaryError ? (
                <p className="mt-2 text-red-400 text-sm">{summaryError}</p>
              ) : (
                <>
                  <p className="mt-2 text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">
                    {summary}
                  </p>
                  {summaryCount > 0 && (
                    <p className="mt-1.5 text-[11px] text-gray-500">
                      Summarized from the {summaryCount} most recent stored messages.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* WhatsApp: conversation search results replace the single-message detail */}
          {isSearchMode ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold tracking-widest uppercase text-gray-500">
                  Search Results
                </span>
                <button
                  onClick={() => setSearchQuery("")}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
                >
                  Reset to full conversation
                </button>
              </div>

              {searchLoading ? (
                <p className="text-sm text-gray-400 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Searching…
                </p>
              ) : searchError ? (
                <p className="text-sm text-red-400">{searchError}</p>
              ) : searchResults.length === 0 ? (
                <p className="text-sm text-gray-400">
                  No messages match &ldquo;{searchQuery.trim()}&rdquo; in this conversation.
                </p>
              ) : (
                <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                  {searchResults.map((result) => (
                    <div
                      key={result._id || result.id}
                      className="bg-[#161616] border border-[#2a2a2a] rounded-lg p-3"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-semibold text-white truncate">
                          {result.sender || result.from || "Unknown sender"}
                        </span>
                        <span className="text-[11px] text-gray-500 whitespace-nowrap">
                          {result.timestamp
                            ? new Date(result.timestamp).toLocaleString()
                            : ""}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm text-gray-300 leading-relaxed whitespace-pre-wrap break-words">
                        {result.content || result.preview || "(no text content)"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Subject */}
              {message.subject && (
                <div className="bg-[#111] border border-[#2a2a2a] rounded-lg p-4">
                  <span className="text-[11px] font-bold tracking-widest text-gray-500 uppercase">
                    Subject
                  </span>
                  <p className="text-white font-medium text-base mt-1">
                    {message.subject}
                  </p>
                </div>
              )}

              {/* Content */}
              <div className="bg-[#111] border border-[#2a2a2a] rounded-lg p-5">
                <span className="text-[11px] font-bold tracking-widest text-gray-500 uppercase">
                  Content
                </span>
                <div className="mt-3 text-gray-300 text-[15px] leading-relaxed whitespace-pre-wrap">
                  {message.preview}
                </div>
              </div>

              {/* Matches */}
              {message.matches && message.matches.length > 0 && (
                <div className="bg-[#111] border border-[#2a2a2a] rounded-lg p-4">
                  <span className="text-[11px] font-bold tracking-widest text-gray-500 uppercase">
                    Watchlist Matches
                  </span>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {message.matches.map((match, idx) => (
                      <span
                        key={idx}
                        className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold tracking-wider uppercase border ${
                          match.color === "red"
                            ? "bg-red-950/30 text-red-400 border-red-900/30"
                            : "bg-indigo-950/30 text-indigo-400 border-indigo-900/30"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full mr-1.5 ${match.color === "red" ? "bg-red-500" : "bg-indigo-500"}`}
                        ></span>
                        MATCHED: {match.keyword}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
