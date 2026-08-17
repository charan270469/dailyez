// Modal showing a single message's full details (sender, subject, content, matches)
// with an archive action.
import { X, Mail, MessageSquare, Diamond, Archive } from "lucide-react";
import { archiveMessage } from "../lib/api";

interface MessageDetailModalProps {
  message: {
    id: string;
    sender: string;
    source: string;
    platform: string;
    timestamp: string;
    subject?: string;
    preview: string;
    matches?: Array<{ keyword: string; color: string }>;
  };
  onClose: () => void;
}

export function MessageDetailModal({
  message,
  onClose,
}: MessageDetailModalProps) {
  const getPlatformIcon = () => {
    switch (message.platform) {
      case "Gmail":
        return <Mail className="w-5 h-5 text-red-400" />;
      case "WhatsApp":
        return <MessageSquare className="w-5 h-5 text-green-400" />;
      case "Discord":
        return <Diamond className="w-5 h-5 text-indigo-400" />;
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
        <div className="flex justify-between items-center p-5 border-b border-[#333] shrink-0">
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Sender & Timestamp */}
          <div className="flex justify-between items-start">
            <div>
              <h4 className="text-white font-bold text-xl">{message.sender}</h4>
              <p className="text-gray-400 text-sm mt-1">{message.source}</p>
            </div>
            <span className="text-gray-500 text-sm whitespace-nowrap">
              {message.timestamp}
            </span>
          </div>

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
        </div>
      </div>
    </div>
  );
}
