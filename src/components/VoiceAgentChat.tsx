// Floating voice-agent chat: records/clips microphone audio, transcribes it via Whisper,
// sends the command, and displays/speaks the agent's reply (replaces the old FloatingChat).
import { useEffect, useRef, useState } from "react";
import {
  Mic,
  Square,
  Sparkles,
  X,
  ArrowUp,
  Copy,
  Check,
  Trash2,
  Volume2,
  VolumeX,
  RotateCcw,
} from "lucide-react";
import { transcribeVoiceAudio, sendVoiceCommand } from "../lib/api";

interface ChatMessage {
  id: number;
  role: "user" | "agent";
  text: string;
  at: number;
  error?: boolean;
}

type VoiceStatus =
  | "idle"
  | "recording"
  | "transcribing"
  | "thinking"
  | "speaking";

// Voice-agent tab names from /api/voice/command -> DailyEz sidebar tab labels
const VOICE_TAB_MAP: Record<string, string> = {
  important: "Matched",
  inbox: "All Inbox",
  watchlist: "Matched",
  analytics: "Analytics",
  archive: "Archive",
  settings: "Settings",
};

const STATUS_LABELS: Record<VoiceStatus, string> = {
  idle: "Tap the mic and speak, or type a command",
  recording: "Listening… tap stop when you're done",
  transcribing: "Transcribing audio…",
  thinking: "Thinking…",
  speaking: "Speaking… tap the speaker to stop",
};

const SUGGESTIONS = [
  "Summarize my emails today",
  "Top 10 latest WhatsApp messages",
  "Summarize my group chats",
  "Take me to the mail from Harsh HR",
];

const WELCOME_TEXT = [
  "Hi! I'm your assistant. Ask me to summarize mail or chats, find an email, or add a signal.",
  "Try one of the quick prompts below to get started.",
].join("\n");

let messageId = 0;

interface VoiceAgentChatProps {
  onNavigate: (tab: string) => void;
}

function formatTime(at: number) {
  return new Date(at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatElapsed(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Bottom-center assistant chat. Full voice loop:
 * mic -> /api/voice/transcribe -> /api/voice/command -> displayed + spoken reply.
 */
export function VoiceAgentChat({ onNavigate }: VoiceAgentChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [input, setInput] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [recSecs, setRecSecs] = useState(0);
  const [lastUserText, setLastUserText] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const welcomedRef = useRef(false);
  const stickRef = useRef(true);
  const mutedRef = useRef(false);
  mutedRef.current = muted;

  const isBusy = waiting || status === "transcribing" || status === "thinking";

  // First-open welcome message (StrictMode-safe via ref guard)
  useEffect(() => {
    if (isOpen && !welcomedRef.current) {
      welcomedRef.current = true;
      setMessages([
        { id: ++messageId, role: "agent", text: WELCOME_TEXT, at: Date.now() },
      ]);
    }
  }, [isOpen]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 60);
  }, [isOpen]);

  // Recording timer
  useEffect(() => {
    if (status !== "recording") {
      setRecSecs(0);
      return;
    }
    const t = window.setInterval(() => setRecSecs((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [status]);

  // Keep the thread pinned to the newest message (only if already near bottom)
  useEffect(() => {
    const el = threadRef.current;
    if (isOpen && el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [isOpen, messages, isBusy, status]);

  function handleThreadScroll() {
    const el = threadRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  // Cleanup on unmount: stop recorder, mic tracks, and any speech
  useEffect(() => {
    return () => {
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  function pushUserMessage(text: string) {
    stickRef.current = true;
    setMessages((prev) => [
      ...prev,
      { id: ++messageId, role: "user", text, at: Date.now() },
    ]);
  }

  function pushAgentMessage(text: string, error = false) {
    stickRef.current = true;
    setMessages((prev) => [
      ...prev,
      { id: ++messageId, role: "agent", text, at: Date.now(), error },
    ]);
  }

  function stopRecording() {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        /* ignore — recorder may already be stopping */
      }
    }
    mediaRecorderRef.current = null;
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      pushAgentMessage(
        "This browser doesn't support microphone access. You can still type a command below.",
        true,
      );
      return;
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const blob = new Blob(chunks, {
          type: recorder.mimeType || "audio/webm",
        });
        void handleVoiceBlob(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setStatus("recording");
    } catch (error) {
      console.error("Microphone access failed:", error);
      pushAgentMessage(
        "Couldn't start the microphone. Check browser permissions and try again.",
        true,
      );
    }
  }

  function handleMicClick() {
    if (status === "recording") {
      stopRecording();
    } else if (!isBusy) {
      if (status === "speaking" && "speechSynthesis" in window)
        window.speechSynthesis.cancel();
      void startRecording();
    }
  }

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = String(reader.result || "");
        resolve(dataUrl.split(",")[1] || "");
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function handleVoiceBlob(blob: Blob) {
    if (!blob || blob.size === 0) {
      setStatus("idle");
      return;
    }
    try {
      setStatus("transcribing");
      const base64 = await blobToBase64(blob);
      const { text } = await transcribeVoiceAudio(
        base64,
        blob.type || "audio/webm",
      );
      const trimmed = (text || "").trim();
      if (!trimmed) {
        pushAgentMessage(
          "I couldn't hear anything. Try speaking closer to the mic.",
          true,
        );
        setStatus("idle");
        return;
      }
      pushUserMessage(trimmed);
      await runCommand(trimmed);
    } catch (error) {
      console.error("Transcription failed:", error);
      const err = error as { status?: number; body?: { error?: string } };
      pushAgentMessage(
        err?.status === 429
          ? "The AI's rate limit is currently reached — give it a few minutes, then try speaking again."
          : err?.body?.error ||
              "Something went wrong while transcribing your audio. Please try again.",
        true,
      );
      setStatus("idle");
    }
  }

  async function runCommand(text: string) {
    setWaiting(true);
    setStatus("thinking");
    setLastUserText(text);
    try {
      const result = await sendVoiceCommand(text);
      const reply = result.response || "Done.";
      pushAgentMessage(reply);
      if (result.navigateTo) {
        onNavigate(VOICE_TAB_MAP[result.navigateTo] || result.navigateTo);
      }
      speak(reply);
    } catch (error) {
      console.error("Voice command failed:", error);
      const err = error as { status?: number; body?: { response?: string } };
      const serverReply = err?.body?.response;
      pushAgentMessage(
        serverReply ||
          (err?.status === 429
            ? "The AI's rate limit is currently reached — give it a few minutes, then try again."
            : "Sorry — that command didn't go through. Please try again."),
        true,
      );
      setStatus("idle");
    } finally {
      setWaiting(false);
    }
  }

  function speak(text: string) {
    if (mutedRef.current || !("speechSynthesis" in window)) {
      setStatus("idle");
      return;
    }
    setStatus("speaking");
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.onstart = () => setStatus("speaking");
      utterance.onend = () => setStatus("idle");
      utterance.onerror = () => setStatus("idle");
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.error("Text-to-speech failed:", error);
      setStatus("idle");
    }
  }

  function handleSendText(text?: string) {
    const raw = (text ?? input).trim();
    if (!raw || isBusy || status === "recording") return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    pushUserMessage(raw);
    void runCommand(raw);
  }

  function handleRetry() {
    if (!lastUserText || isBusy || status === "recording") return;
    pushUserMessage(lastUserText);
    void runCommand(lastUserText);
  }

  async function handleCopy(id: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  function handleClear() {
    if (isBusy || status === "recording") return;
    stickRef.current = true;
    setMessages([
      { id: ++messageId, role: "agent", text: WELCOME_TEXT, at: Date.now() },
    ]);
  }

  function stopSpeaking() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setStatus("idle");
  }

  function toggleMute() {
    setMuted((m) => {
      const next = !m;
      if (next && "speechSynthesis" in window) window.speechSynthesis.cancel();
      if (next) setStatus("idle");
      return next;
    });
  }

  function handleClose() {
    if (status === "recording") stopRecording();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setIsOpen(false);
    setStatus("idle");
  }

  // Closed: compact "ask" pill, centered at the bottom
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-5 left-[calc(50%+40px)] -translate-x-1/2 z-50"
        aria-label="Open assistant"
      >
        <div className="flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-full bg-[#0b1220] border border-[#1e293b] shadow-[0_8px_18px_rgba(11,18,32,0.24)] hover:bg-[#16213a] transition-colors">
          <div className="w-7 h-7 rounded-full bg-[#2563eb] flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-[#ffffff]" />
          </div>
          <span className="text-xs text-[#ffffff] font-semibold whitespace-nowrap">
            Ask DailyEz
          </span>
          {isBusy ? (
            <span className="text-xs text-indigo-300 animate-pulse">
              working…
            </span>
          ) : (
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
          )}
          <span className="w-7 h-7 rounded-full bg-[#16213a] flex items-center justify-center text-[#94a3b8] transition-colors">
            <Mic className="w-4 h-4" />
          </span>
        </div>
      </button>
    );
  }

  const showSuggestions = messages.length <= 1 && !isBusy;
  const lastMessage = messages[messages.length - 1];
  const showRetry =
    !!lastMessage &&
    lastMessage.role === "agent" &&
    !!lastMessage.error &&
    !isBusy;

  // Open: centered chat panel, larger
  return (
    <div
      role="dialog"
      aria-label="SignalStream assistant"
      className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(960px,94vw)] h-[min(680px,84vh)] bg-[#151515] border border-[#2a2a2a] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[#2a2a2a] bg-[#141414]">
        <div className="flex items-center min-w-0">
          <div className="w-8 h-8 rounded-full bg-[#6366f1] flex items-center justify-center mr-3 shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-white font-semibold text-[15px] leading-tight truncate">
                Assistant
              </h3>
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  status === "recording"
                    ? "bg-red-500 animate-pulse"
                    : isBusy
                      ? "bg-amber-400 animate-pulse"
                      : status === "speaking"
                        ? "bg-sky-400 animate-pulse"
                        : "bg-emerald-400"
                }`}
              />
            </div>
            <p
              className={`text-xs truncate ${
                status === "recording"
                  ? "text-red-400 font-medium"
                  : "text-gray-400"
              }`}
            >
              {status === "recording"
                ? `Listening… ${formatElapsed(recSecs)}`
                : STATUS_LABELS[status]}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={toggleMute}
            className="text-gray-400 hover:text-white transition-colors p-1.5 rounded-md hover:bg-[#2a2a2a]"
            aria-label={muted ? "Unmute voice replies" : "Mute voice replies"}
            title={muted ? "Unmute voice replies" : "Mute voice replies"}
          >
            {muted ? (
              <VolumeX className="w-[18px] h-[18px]" />
            ) : (
              <Volume2 className="w-[18px] h-[18px]" />
            )}
          </button>
          <button
            onClick={handleClear}
            disabled={isBusy || status === "recording"}
            className="text-gray-400 hover:text-white disabled:opacity-40 transition-colors p-1.5 rounded-md hover:bg-[#2a2a2a]"
            aria-label="Clear conversation"
            title="Clear conversation"
          >
            <Trash2 className="w-[18px] h-[18px]" />
          </button>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white transition-colors p-1.5 rounded-md hover:bg-[#2a2a2a]"
            aria-label="Minimize assistant"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Recording banner */}
      {status === "recording" && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-300 text-xs font-medium">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
          <span className="tabular-nums">
            Recording {formatElapsed(recSecs)} — tap the red button to stop
          </span>
        </div>
      )}

      {/* Vertical message thread */}
      <div
        ref={threadRef}
        onScroll={handleThreadScroll}
        aria-live="polite"
        className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto px-4 py-4 bg-[#161616]"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "#3a3a3a transparent",
        }}
      >
        {messages.map((message) =>
          message.role === "user" ? (
            <div
              key={message.id}
              className="flex flex-col items-end self-end max-w-[85%]"
            >
              <div className="bg-[#a5b4fc] text-[#0a0a0a] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm font-medium whitespace-pre-wrap break-words leading-relaxed">
                {message.text}
              </div>
              <span className="text-[10px] text-gray-500 mt-1 pr-1">
                {formatTime(message.at)}
              </span>
            </div>
          ) : (
            <div
              key={message.id}
              className="flex items-start self-start max-w-[92%]"
            >
              <div className="w-6 h-6 rounded-full bg-[#2a2a2a] flex items-center justify-center mr-2 shrink-0 mt-1">
                <Sparkles className="w-3.5 h-3.5 text-gray-300" />
              </div>
              <div className="min-w-0">
                <div
                  className={`rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    message.error
                      ? "bg-[#2a1d1d] border border-red-500/30 text-red-100"
                      : "bg-[#222] border border-[#2a2a2a] text-gray-200"
                  }`}
                >
                  {message.text}
                </div>
                <div className="flex items-center gap-2 mt-1 ml-1">
                  <span className="text-[10px] text-gray-500">
                    {formatTime(message.at)}
                  </span>
                  <button
                    onClick={() => handleCopy(message.id, message.text)}
                    className="text-gray-500 hover:text-gray-300 transition-colors p-0.5"
                    aria-label="Copy reply"
                    title="Copy reply"
                  >
                    {copiedId === message.id ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          ),
        )}
        {isBusy && (
          <div className="flex items-start self-start">
            <div className="w-6 h-6 rounded-full bg-[#2a2a2a] flex items-center justify-center mr-2 shrink-0 mt-1">
              <Sparkles className="w-3.5 h-3.5 text-gray-300" />
            </div>
            <div
              className="bg-[#222] border border-[#2a2a2a] rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5"
              aria-label="Assistant is thinking"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" />
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}
        {showRetry && (
          <button
            onClick={handleRetry}
            className="self-start flex items-center gap-1.5 text-xs text-indigo-300 hover:text-indigo-200 border border-indigo-500/30 hover:border-indigo-400/50 rounded-full px-3 py-1.5 transition-colors ml-8"
          >
            <RotateCcw className="w-3 h-3" /> Retry
          </button>
        )}
        {showSuggestions && (
          <div className="flex flex-wrap gap-2 mt-1 ml-8">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => handleSendText(s)}
                className="text-xs text-gray-300 bg-[#222] border border-[#333] hover:border-[#6366f1] hover:text-white rounded-full px-3 py-1.5 transition-colors text-left"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Speaking bar */}
      {status === "speaking" && (
        <div className="flex items-center justify-between px-4 py-1.5 border-t border-[#2a2a2a] bg-[#141414] text-xs text-sky-300">
          <span className="animate-pulse">Speaking…</span>
          <button
            onClick={stopSpeaking}
            className="hover:text-white transition-colors font-medium"
          >
            Stop voice
          </button>
        </div>
      )}
      {/* Input + mic controls */}
      <div className="flex items-end gap-2 px-3 py-3 border-t border-[#2a2a2a] bg-[#141414]">
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 96) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSendText();
            }
          }}
          placeholder="Ask anything… (Enter to send, Shift+Enter for new line)"
          disabled={isBusy || status === "recording"}
          className="flex-1 min-w-0 bg-[#222] border border-[#333] text-gray-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-[#6366f1] transition-colors disabled:opacity-50 resize-none overflow-y-auto max-h-24 leading-relaxed"
          style={{ scrollbarWidth: "thin" }}
        />
        <button
          onClick={() => handleSendText()}
          disabled={!input.trim() || isBusy || status === "recording"}
          className="w-9 h-9 shrink-0 rounded-full bg-[#818cf8] hover:bg-[#6366f1] disabled:opacity-40 text-[#0a0a0a] hover:text-white flex items-center justify-center transition-colors"
          aria-label="Send message"
        >
          <ArrowUp className="w-4 h-4 font-bold" />
        </button>
        <button
          onClick={handleMicClick}
          disabled={status === "transcribing" || status === "thinking"}
          className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center transition-colors ${
            status === "recording"
              ? "bg-[#ef4444] hover:bg-[#dc2626] text-white animate-pulse"
              : "bg-[#818cf8] hover:bg-[#6366f1] text-[#0a0a0a] hover:text-white"
          } disabled:opacity-50`}
          aria-label={
            status === "recording" ? "Stop recording" : "Start recording"
          }
          title={
            status === "recording"
              ? `Stop recording (${formatElapsed(recSecs)})`
              : "Voice input"
          }
        >
          {status === "recording" ? (
            <Square className="w-4 h-4" fill="currentColor" />
          ) : (
            <Mic className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}
