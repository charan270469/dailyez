// Inbox list-item card: renders one message with intent/keyword match badges and
// hover archive actions.
import { useState } from "react";
import {
  AtSign,
  MessageSquare,
  AlertCircle,
  Check,
  X,
} from "lucide-react";
import { archiveMessage } from "../lib/api";
import { InboxMessage } from "../types";

interface InboxMessageCardProps {
  key?: string | number;
  message: InboxMessage;
}

export function InboxMessageCard({ message }: InboxMessageCardProps) {
  const [hidden, setHidden] = useState(false);

  const handleArchive = async () => {
    try {
      const result = await archiveMessage(message.id);
      if (result.ok) {
        setHidden(true);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const getPlatformIcon = () => {
    switch (message.platform) {
      case "Gmail":
        return (
          <div className="w-9 h-9 rounded-full bg-indigo-950/40 border border-indigo-900/40 flex items-center justify-center text-indigo-400">
            <AtSign className="w-4 h-4" />
          </div>
        );
      case "WhatsApp":
        return (
          <div className="w-9 h-9 rounded-full bg-green-950/40 border border-green-900/40 flex items-center justify-center text-green-400">
            <MessageSquare className="w-4 h-4" />
          </div>
        );
      case "Slack":
        return (
          <div className="w-9 h-9 rounded-full bg-red-950/40 border border-red-900/40 flex items-center justify-center text-red-400">
            <AlertCircle className="w-4 h-4" />
          </div>
        );
      default:
        return null;
    }
  };

  if (hidden) return null;

  const matches = message.signalMatches || [];
  const hasMatches = matches.length > 0;
  const keywordMatches = message.keywordSignalMatches || [];
  const hasKeywordMatches = keywordMatches.length > 0;

  return (
    <div className="bg-[#161616] border border-[#2a2a2a] hover:border-[#3a3a3a] rounded-xl p-4 transition-colors relative group cursor-pointer flex">
      <div className="mr-3.5 mt-0.5">{getPlatformIcon()}</div>

      <div className="flex-1 min-w-0 pr-20">
        <div className="flex justify-between items-start mb-1">
          <div className="flex items-baseline space-x-2 truncate pr-4">
            <span className="font-semibold text-gray-100 text-[15px]">
              {message.sender}
            </span>
            <span className="text-gray-500 text-xs">{message.source}</span>
            {hasMatches && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-950/40 text-emerald-400 border border-emerald-900/40 uppercase tracking-wider">
                Intent
              </span>
            )}
            {hasKeywordMatches && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-indigo-950/40 text-indigo-400 border border-indigo-900/40 uppercase tracking-wider">
                Keyword
              </span>
            )}
          </div>
          <span className="text-gray-500 text-xs whitespace-nowrap absolute right-4 top-4">
            {message.timestamp}
          </span>
        </div>

        {message.subject && (
          <h4 className="text-white font-medium text-[15px] mb-1">
            {message.subject}
          </h4>
        )}
        <p className="text-gray-400 text-sm line-clamp-2 leading-relaxed">
          {message.preview}
        </p>

        {/* Match badges */}
        {(hasMatches || hasKeywordMatches) && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {hasKeywordMatches && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-medium border bg-indigo-950/30 text-indigo-400 border-indigo-900/30">
                Keyword:{" "}
                {keywordMatches
                  .map((km) => km.matchedKeywords?.join(", "))
                  .filter(Boolean)
                  .join(", ")}
              </span>
            )}
            {matches.map((m, i) => (
              <span
                key={i}
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-medium border ${
                  m.confidence === "high"
                    ? "bg-emerald-950/30 text-emerald-400 border-emerald-900/30"
                    : m.confidence === "medium"
                      ? "bg-amber-950/30 text-amber-400 border-amber-900/30"
                      : "bg-red-950/30 text-red-400 border-red-900/30"
                }`}
              >
                {m.context.length > 20
                  ? m.context.slice(0, 20) + "..."
                  : m.context}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Action Buttons (visible on hover) */}
      <div className="absolute right-4 bottom-4 flex items-center space-x-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleArchive}
          className="w-7 h-7 bg-[#2a2a2a] hover:bg-[#333] border border-[#333] hover:border-[#444] rounded flex items-center justify-center text-gray-400 hover:text-white transition-colors"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleArchive}
          className="w-7 h-7 bg-[#2a2a2a] hover:bg-[#333] border border-[#333] hover:border-[#444] rounded flex items-center justify-center text-gray-400 hover:text-white transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
