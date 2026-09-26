// Inbox list-item card: renders one message with intent/keyword match badges and
// hover archive actions.
import { useState } from "react";
import { Check, X } from "lucide-react";
import { archiveMessage } from "../lib/api";
import {
  extractEmailAddress,
  formatRelativeTime,
  getAvatarColor,
  getInitials,
} from "../lib/utils";
import { InboxMessage } from "../types";
import { QuickAlertButton } from "./QuickAlertButton";

interface InboxMessageCardProps {
  key?: string | number;
  message: InboxMessage;
  onMessageClick: () => void;
}

export function InboxMessageCard({
  message,
  onMessageClick,
}: InboxMessageCardProps) {
  const [hidden, setHidden] = useState(false);

  const handleArchive = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      const result = await archiveMessage(message.id);
      if (result.ok) {
        setHidden(true);
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (hidden) return null;

  const senderName =
    message.sender.replace(/\s*<[^>]*>/, "").trim() || message.sender;
  const senderEmail = extractEmailAddress(message.sender);
  const avatarColor = getAvatarColor(senderName);
  const matches = message.signalMatches || [];
  const hasMatches = matches.length > 0;
  const keywordMatches = message.keywordSignalMatches || [];
  const hasKeywordMatches = keywordMatches.length > 0;

  // Quick "Alert me" target: exact sender email for Gmail, chat id for WhatsApp.
  const platformKey = (message.platform || "").toLowerCase();
  const sourceKey = (message.source || "").toLowerCase();
  const isSupportedPlatform =
    platformKey === "gmail" ||
    platformKey === "whatsapp" ||
    sourceKey === "gmail" ||
    sourceKey === "whatsapp";
  const isWhatsApp = platformKey === "whatsapp" || sourceKey === "whatsapp";
  const alertTarget = isWhatsApp
    ? {
        platform: "whatsapp" as const,
        target: message.chatId || message.sender,
        senderName: message.sender,
      }
    : {
        platform: "gmail" as const,
        target: senderEmail || message.sender,
        senderName,
      };

  return (
    <div className="group relative flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 transition-colors hover:border-slate-300">
      <div
        role="button"
        tabIndex={0}
        onClick={onMessageClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onMessageClick();
          }
        }}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        <div
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium ${avatarColor}`}
        >
          {getInitials(senderName)}
        </div>

        <div className="min-w-0 flex-1 pr-16">
          <div className="mb-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[12px] font-semibold text-[#111827]">
              {senderName}
            </span>
            <span className="rounded-sm bg-red-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-red-600">
              {message.source || "Gmail"}
            </span>
            {senderEmail && senderEmail !== senderName && (
              <span className="truncate text-[10px] text-[#8093ab]">
                {senderEmail}
              </span>
            )}
            {hasMatches && (
              <span className="rounded-sm bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-emerald-700">
                Intent
              </span>
            )}
            {hasKeywordMatches && (
              <span className="rounded-sm bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-blue-700">
                Keyword
              </span>
            )}
          </div>

          {message.subject && (
            <h4 className="mb-0.5 truncate text-[11px] font-medium text-[#29425f]">
              {message.subject}
            </h4>
          )}
          <p className="line-clamp-1 text-[11px] leading-[1.45] text-[#385574]">
            {message.preview}
          </p>

          {(hasMatches || hasKeywordMatches) && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {hasKeywordMatches && (
                <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[9px] font-medium text-blue-700">
                  Keyword:{" "}
                  {keywordMatches
                    .map((km) => km.matchedKeywords?.join(", "))
                    .filter(Boolean)
                    .join(", ")}
                </span>
              )}
              {matches.map((match, index) => (
                <span
                  key={index}
                  className={`rounded-full border px-2 py-0.5 text-[9px] font-medium ${
                    match.confidence === "high"
                      ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                      : match.confidence === "medium"
                        ? "border-amber-100 bg-amber-50 text-amber-700"
                        : "border-red-100 bg-red-50 text-red-700"
                  }`}
                >
                  {match.context.length > 20
                    ? `${match.context.slice(0, 20)}...`
                    : match.context}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <span className="absolute right-3 top-3 whitespace-nowrap text-[10px] text-[#8093ab]">
        {message.timestamp ? formatRelativeTime(message.timestamp) : ""}
      </span>

      <div className="absolute bottom-3 right-3 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {isSupportedPlatform && alertTarget.target && (
          <QuickAlertButton target={alertTarget} variant="pill" />
        )}
        <button
          type="button"
          onClick={handleArchive}
          title="Archive message"
          aria-label="Archive message"
          className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleArchive}
          title="Dismiss message"
          aria-label="Dismiss message"
          className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
