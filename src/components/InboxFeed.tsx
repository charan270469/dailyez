// All Inbox tab: lists every stored message across platforms with platform/matched/
// keyword filters and a click-through detail modal.
import { useEffect, useRef, useState } from "react";
import { InboxMessageCard } from "./InboxMessageCard";
import { WhatsAppChatCard } from "./WhatsAppChatCard";
import { getInboxPage } from "../lib/api";
import { Link2, Mail, MessageCircle } from "lucide-react";
import { MessageDetailModal } from "./MessageDetailModal";

const PAGE_SIZE = 20;

function filterKey(source: string, keywordMatched: boolean) {
  return source + "|" + (keywordMatched ? "1" : "0");
}

function toSourceParam(label: string) {
  return label === "All Platforms" ? undefined : label.toLowerCase();
}

// Module cache so tab switches don't reload: DashboardLayout unmounts this tab
// when navigating away, so remounts reuse the FULL loaded list (all scrolled
// pages + deepest cursor) instantly. Load-more writes through to the cache;
// first-page (re)fetches only merge unseen items at the top and never replace.
const inboxCache = new Map<
  string,
  { messages: any[]; nextCursor: string | null }
>();
const inboxFirstPagePromises = new Map<
  string,
  Promise<{ messages: any[]; nextCursor: string | null }>
>();

function fetchFirstPageShared(source: string, keywordMatched: boolean) {
  const key = filterKey(source, keywordMatched);
  const pending = inboxFirstPagePromises.get(key);
  if (pending) return pending;
  // ponytail: shared first-page fetch only; callers merge + write the cache
  // (the fetcher can't know the current list, so it must not overwrite it).
  const promise = getInboxPage(PAGE_SIZE, null, {
    source: toSourceParam(source),
    keywordMatched: keywordMatched || undefined,
  }).finally(() => {
    inboxFirstPagePromises.delete(key);
  });
  inboxFirstPagePromises.set(key, promise);
  return promise;
}

function appendUnseen(existing: any[], incoming: any[]) {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((m) => m._id || m.id));
  const fresh = incoming.filter((m) => !seen.has(m._id || m.id));
  return fresh.length === 0 ? existing : [...existing, ...fresh];
}

function prependUnseen(existing: any[], incoming: any[]) {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((m) => m._id || m.id));
  const fresh = incoming.filter((m) => !seen.has(m._id || m.id));
  return fresh.length === 0 ? existing : [...fresh, ...existing];
}

interface InboxFeedProps {
  onManageConnections: () => void;
}

export function InboxFeed({ onManageConnections }: InboxFeedProps) {
  const [activeFilter, setActiveFilter] = useState("All Platforms");
  const [keywordMatchedOnly, setKeywordMatchedOnly] = useState(false);
  const initialKey = filterKey("All Platforms", false);
  const [messages, setMessages] = useState<any[]>(
    () => inboxCache.get(initialKey)?.messages ?? [],
  );
  const [nextCursor, setNextCursor] = useState<string | null>(
    () => inboxCache.get(initialKey)?.nextCursor ?? null,
  );
  const [loading, setLoading] = useState(
    () => !inboxCache.get(initialKey)?.messages?.length,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<any>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Refs mirror state for the observer callback so it never closes over a stale cursor.
  const cursorRef = useRef<string | null>(nextCursor);
  cursorRef.current = nextCursor;
  const loadingMoreRef = useRef(loadingMore);
  loadingMoreRef.current = loadingMore;
  const filterRef = useRef({
    source: activeFilter,
    keywordMatched: keywordMatchedOnly,
  });
  filterRef.current = {
    source: activeFilter,
    keywordMatched: keywordMatchedOnly,
  };
  const loadSeq = useRef(0);

  // First page for the current filter combo. Cached combos render instantly
  // from the module cache (the FULL loaded list, not just page 1) and only
  // check page 1 in the background, merging unseen items at the top — so a
  // remount after a sidebar/browser tab switch never clears or replaces
  // already-loaded messages.
  useEffect(() => {
    const seq = ++loadSeq.current;
    let cancelled = false;
    const key = filterKey(activeFilter, keywordMatchedOnly);
    const cached = inboxCache.get(key);
    if (cached && cached.messages.length > 0) {
      setMessages(cached.messages);
      setNextCursor(cached.nextCursor);
      setLoading(false);
      setError(null);
      fetchFirstPageShared(activeFilter, keywordMatchedOnly)
        .then((data) => {
          if (cancelled || loadSeq.current !== seq) return;
          setMessages((prev) => {
            const merged = prependUnseen(prev, data.messages);
            if (merged === prev) return prev;
            inboxCache.set(key, {
              messages: merged,
              nextCursor: inboxCache.get(key)?.nextCursor ?? data.nextCursor,
            });
            return merged;
          });
          setError(null);
        })
        .catch((err) => {
          // Silent: never flash loading/error over already-visible messages.
          console.error(err);
        });
      return () => {
        cancelled = true;
      };
    }
    setMessages([]);
    setNextCursor(null);
    setLoading(true);
    setError(null);
    fetchFirstPageShared(activeFilter, keywordMatchedOnly)
      .then((data) => {
        if (cancelled || loadSeq.current !== seq) return;
        setMessages((prev) => {
          // Remount effects can race: the second (empty-cache) fetch resolves
          // after the first real page already rendered — merge, never replace.
          if (prev.length === 0) {
            inboxCache.set(key, data);
            return data.messages;
          }
          const merged = prependUnseen(prev, data.messages);
          if (merged !== prev) {
            inboxCache.set(key, {
              messages: merged,
              nextCursor: inboxCache.get(key)?.nextCursor ?? data.nextCursor,
            });
          }
          return merged;
        });
        setNextCursor((prevCursor) => prevCursor ?? data.nextCursor);
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        if (cancelled || loadSeq.current !== seq) return;
        if (!inboxCache.has(key)) {
          setError("Unable to load inbox messages");
        }
      })
      .finally(() => {
        if (cancelled || loadSeq.current !== seq) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeFilter, keywordMatchedOnly]);

  useEffect(() => {
    let cancelled = false;

    // Silent "check for new": re-fetch page 1 only and prepend unseen items at
    // the top for the CURRENT filter, so already-loaded pages beneath never
    // flash, disappear, or reset their cursor.
    async function silentRefresh() {
      const seq = loadSeq.current;
      const { source, keywordMatched } = filterRef.current;
      const key = filterKey(source, keywordMatched);
      try {
        const data = await fetchFirstPageShared(source, keywordMatched);
        if (cancelled || loadSeq.current !== seq) return;
        if (
          filterRef.current.source !== source ||
          filterRef.current.keywordMatched !== keywordMatched
        )
          return;
        setMessages((prev) => {
          const merged = prependUnseen(prev, data.messages);
          if (merged === prev) return prev;
          inboxCache.set(key, {
            messages: merged,
            nextCursor: inboxCache.get(key)?.nextCursor ?? data.nextCursor,
          });
          return merged;
        });
        setError(null);
      } catch (err) {
        // Silent: never flash loading/error over already-visible messages.
        console.error(err);
      }
    }

    // While mounted, pick up periodic Gmail fetches silently (no spinner).
    const interval = window.setInterval(() => {
      void silentRefresh();
    }, 30000);

    // Re-check for new arrivals after a WhatsApp resync clears + re-fetches
    // messages (merge-only; the wipe itself is picked up on filter change).
    const reloadOnResync = () => silentRefresh();
    window.addEventListener("whatsapp-resynced", reloadOnResync);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("whatsapp-resynced", reloadOnResync);
    };
  }, []);

  // Infinite scroll: sentinel near the list bottom loads the next 20 via cursor.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        if (loadingMoreRef.current) return;
        const cursor = cursorRef.current;
        if (!cursor) return;
        const { source, keywordMatched } = filterRef.current;
        const seq = loadSeq.current;
        loadingMoreRef.current = true;
        setLoadingMore(true);
        getInboxPage(PAGE_SIZE, cursor, {
          source: toSourceParam(source),
          keywordMatched: keywordMatched || undefined,
        })
          .then((data) => {
            if (loadSeq.current !== seq) return;
            const key = filterKey(source, keywordMatched);
            setMessages((prev) => {
              const merged = appendUnseen(prev, data.messages);
              if (merged === prev) return prev;
              inboxCache.set(key, { messages: merged, nextCursor: data.nextCursor });
              return merged;
            });
            setNextCursor(data.nextCursor);
          })
          .catch((err) => console.error(err))
          .finally(() => {
            if (loadSeq.current !== seq) return;
            loadingMoreRef.current = false;
            setLoadingMore(false);
          });
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const handleMessageClick = (msg: any) => {
    setSelectedMessage({
      id: msg._id || msg.id,
      chatId: msg.chatId,
      sender: msg.sender || msg.from || "Unknown sender",
      source: msg.source || "gmail",
      platform: msg.source === "whatsapp" ? "WhatsApp" : "Gmail",
      timestamp: msg.timestamp ? new Date(msg.timestamp).toLocaleString() : "",
      subject: msg.subject,
      preview: msg.content || msg.preview || "No preview available",
      matches: (msg.signalMatches || []).map((sm: any) => ({
        keyword: sm.context ? sm.context.slice(0, 30) : "Matched",
        color: sm.confidence === "high" ? "red" : "indigo",
      })),
    });
  };

  const filters = [
    { label: "All Platforms", icon: null },
    { label: "Gmail", icon: Mail },
    { label: "WhatsApp", icon: MessageCircle },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f7f9fc] px-6 pb-5 pt-6 dark:bg-[#090c14]">
      <div className="mb-4 shrink-0">
        <h1 className="text-[24px] font-bold leading-tight tracking-tight text-[#0f2742] dark:text-[#f4f6fa]">
          All Inbox
        </h1>
        <p className="mt-1 text-xs text-[#58708d] dark:text-[#9aa6b8]">
          Everything from your connected platforms, most recent first
        </p>
      </div>

      <div
        data-matched-filter-row
        className="mb-3 flex shrink-0 flex-wrap items-center gap-3"
      >
        <div className="flex h-8 shrink-0 rounded-md border border-slate-200 bg-slate-50 p-0.5">
          {filters.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              aria-pressed={activeFilter === label}
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
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-[#29425f] dark:text-[#aab5c5]">
          Keyword matched
          <button
            type="button"
            role="switch"
            aria-checked={keywordMatchedOnly}
            onClick={() => setKeywordMatchedOnly((value) => !value)}
            className={`relative h-5 w-8 rounded-full transition-colors duration-200 ease-out ${keywordMatchedOnly ? "bg-[#2563eb] dark:bg-[#3b82f6]" : "bg-slate-200 dark:bg-[#30394a]"}`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-[#ffffff] shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none dark:bg-[#aeb9ca] ${keywordMatchedOnly ? "translate-x-3" : "translate-x-0"}`}
            />
          </button>
        </label>
      </div>
      {error && (
        <p className="mb-3 shrink-0 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-14 pr-1">
        {loading ? (
          <div className="rounded-lg border border-[#e2e8f0] p-5 text-sm text-[#58708d] dark:border-[#252d3c] dark:text-[#9aa6b8]">
            Loading inbox...
          </div>
        ) : messages.length === 0 ? (
          <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-5 text-sm text-[#58708d] dark:border-[#252d3c] dark:bg-[#131824] dark:text-[#9aa6b8]">
            No messages available for this view yet.
          </div>
        ) : (
          messages.map((msg) => {
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
              <InboxMessageCard
                key={msg._id || msg.id}
                onMessageClick={() => handleMessageClick(msg)}
                message={{
                  id: msg._id || msg.id,
                  sender: msg.from || "Unknown sender",
                  source: msg.source || "gmail",
                  platform: msg.source === "whatsapp" ? "WhatsApp" : "Gmail",
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
            );
          })
        )}
        <div ref={sentinelRef} aria-hidden="true" className="h-1" />
        {loadingMore && (
          <div className="rounded-lg border border-[#e2e8f0] p-3 text-center text-xs text-[#58708d] dark:border-[#252d3c] dark:text-[#9aa6b8]">
            Loading more messages…
          </div>
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
