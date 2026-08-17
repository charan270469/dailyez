// Floating voice-agent chat: records/clips microphone audio, transcribes it via Whisper,
// sends the command, and displays/speaks the agent's reply (replaces the old FloatingChat).
import { useEffect, useRef, useState } from "react";
import { Mic, Square, Sparkles, X, ArrowUp, MoreHorizontal } from "lucide-react";
import { transcribeVoiceAudio, sendVoiceCommand } from "../lib/api";

interface ChatMessage {
  id: number;
  role: "user" | "agent";
  text: string;
}

type VoiceStatus = "idle" | "recording" | "transcribing" | "thinking" | "speaking";

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
  recording: "Listening… hit the red button when you're done",
  transcribing: "Transcribing audio…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

const WELCOME_TEXT = [
  "Hi! I'm your voice agent.",
  '• "Summarize my emails today"',
  '• "Add a signal for emails from recruiters"',
  '• "Go to Analytics"',
].join("\n");

let messageId = 0;

interface VoiceAgentChatProps {
  onNavigate: (tab: string) => void;
}

/**
 * Horizontal, long voice-agent chat floating at the bottom-center of the screen
 * (replaces the old bottom-right FloatingChat). Full voice loop:
 * mic -> /api/voice/transcribe -> /api/voice/command -> displayed + spoken reply.
 */
export function VoiceAgentChat({ onNavigate }: VoiceAgentChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [input, setInput] = useState("");
  const [waiting, setWaiting] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const welcomedRef = useRef(false);

  const isBusy = waiting || status === "transcribing" || status === "thinking";

  // First-open welcome message (StrictMode-safe via ref guard)
  useEffect(() => {
    if (isOpen && !welcomedRef.current) {
      welcomedRef.current = true;
      setMessages([{ id: ++messageId, role: "agent", text: WELCOME_TEXT }]);
    }
  }, [isOpen]);

  // Keep the horizontal thread scrolled to the newest message
  useEffect(() => {
    if (isOpen && threadRef.current) {
      threadRef.current.scrollLeft = threadRef.current.scrollWidth;
    }
  }, [isOpen, messages, isBusy]);

  // Cleanup on unmount: stop recorder, mic tracks, and any speech
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
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
    setMessages((prev) => [...prev, { id: ++messageId, role: "user", text }]);
  }

  function pushAgentMessage(text: string) {
    setMessages((prev) => [...prev, { id: ++messageId, role: "agent", text }]);
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
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
      pushAgentMessage("This browser doesn't support microphone access. You can still type a command below.");
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
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        void handleVoiceBlob(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setStatus("recording");
    } catch (error) {
      console.error("Microphone access failed:", error);
      pushAgentMessage("Couldn't start the microphone. Check browser permissions and try again.");
    }
  }

  function handleMicClick() {
    if (status === "recording") {
      stopRecording();
    } else if (!isBusy) {
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
      const { text } = await transcribeVoiceAudio(base64, blob.type || "audio/webm");
      const trimmed = (text || "").trim();
      if (!trimmed) {
        pushAgentMessage("I couldn't hear anything. Try speaking closer to the mic.");
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
            "Something went wrong while transcribing your audio. Please try again."
      );
      setStatus("idle");
    }
  }

  async function runCommand(text: string) {
    setWaiting(true);
    setStatus("thinking");
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
            : "Sorry — that command didn't go through. Please try again.")
      );
      setStatus("idle");
    } finally {
      setWaiting(false);
    }
  }

  function speak(text: string) {
    if (!("speechSynthesis" in window)) {
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

  function handleSendText() {
    const text = input.trim();
    if (!text || isBusy || status === "recording") return;
    setInput("");
    pushUserMessage(text);
    void runCommand(text);
  }

  function handleClose() {
    if (status === "recording") stopRecording();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setIsOpen(false);
    setStatus("idle");
  }

  // Closed: compact horizontal "voice agent" pill, centered at the bottom
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50"
        aria-label="Open voice agent"
      >
        <div className="flex items-center gap-3 pl-3 pr-2 py-2 rounded-full bg-[#0f0f0f] border border-[#2a2a2a] shadow-[0_8px_30px_rgba(0,0,0,0.5)] hover:border-[#6366f1] transition-colors">
          <div className="w-8 h-8 rounded-full bg-[#6366f1] flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm text-gray-200 font-medium whitespace-nowrap">Ask SignalStream</span>
          <span
            className={`w-2 h-2 rounded-full ${
              status === "recording" ? "bg-red-500 animate-pulse" : "bg-emerald-400"
            }`}
          />
          <span className="w-8 h-8 rounded-full bg-[#818cf8] flex items-center justify-center text-[#0a0a0a] transition-colors">
            <Mic className="w-4 h-4" />
          </span>
        </div>
      </button>
    );
  }

  // Open: horizontal, long voice-agent panel, centered at the bottom
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(860px,94vw)] bg-[#161616] border border-[#2a2a2a] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a] bg-[#141414]">
        <div className="flex items-center min-w-0">
          <div className="w-8 h-8 rounded-full bg-[#6366f1] flex items-center justify-center mr-3 shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <h3 className="text-white font-bold text-[15px] leading-tight">SignalStream Voice Agent</h3>
            <p
              className={`text-xs truncate ${
                status === "recording" ? "text-red-400 font-medium" : "text-gray-400"
              }`}
            >
              {STATUS_LABELS[status]}
            </p>
          </div>
        </div>
        <button
          onClick={handleClose}
          className="text-gray-400 hover:text-white transition-colors p-1.5 rounded-md hover:bg-[#2a2a2a]"
          aria-label="Minimize voice agent"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Horizontal message thread */}
      <div
        ref={threadRef}
        className="no-scrollbar flex items-center gap-3 overflow-x-auto px-4 py-4 min-h-[150px] bg-[#161616]"
      >
        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="shrink-0 ml-auto">
              <div className="bg-[#a5b4fc] text-[#0a0a0a] rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[340px] text-sm font-medium whitespace-pre-wrap">
                {message.text}
              </div>
            </div>
          ) : (
            <div key={message.id} className="shrink-0 flex items-start">
              <div className="w-6 h-6 rounded-full bg-[#2a2a2a] flex items-center justify-center mr-2 shrink-0 mt-1">
                <Sparkles className="w-3.5 h-3.5 text-gray-300" />
              </div>
              <div className="bg-[#222] border border-[#2a2a2a] text-gray-200 rounded-2xl rounded-tl-sm px-4 py-2.5 max-w-[420px] text-sm leading-relaxed whitespace-pre-wrap">
                {message.text}
              </div>
            </div>
          )
        )}
        {isBusy && (
          <div className="shrink-0 flex items-start">
            <div className="w-6 h-6 rounded-full bg-[#2a2a2a] flex items-center justify-center mr-2 shrink-0 mt-1">
              <Sparkles className="w-3.5 h-3.5 text-gray-300" />
            </div>
            <div className="bg-[#222] border border-[#2a2a2a] text-gray-400 rounded-2xl rounded-tl-sm px-4 py-3">
              <MoreHorizontal className="w-5 h-5 animate-pulse" />
            </div>
          </div>
        )}
      </div>
      {/* Input + mic controls */}
      <div className="flex items-center gap-3 px-4 py-3 border-t border-[#2a2a2a] bg-[#141414]">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSendText();
          }}
          placeholder="Or type a command… (Enter to send)"
          disabled={isBusy || status === "recording"}
          className="flex-1 min-w-0 bg-[#222] border border-[#333] text-gray-200 text-sm rounded-full pl-4 pr-12 py-2.5 focus:outline-none focus:border-[#6366f1] transition-colors disabled:opacity-50"
        />
        <button
          onClick={handleSendText}
          disabled={!input.trim() || isBusy || status === "recording"}
          className="w-9 h-9 shrink-0 rounded-full bg-[#818cf8] hover:bg-[#6366f1] disabled:opacity-40 text-[#0a0a0a] hover:text-white flex items-center justify-center transition-colors"
          aria-label="Send message"
        >
          <ArrowUp className="w-4 h-4 font-bold" />
        </button>
        <button
          onClick={handleMicClick}
          disabled={status === "transcribing" || status === "thinking"}
          className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center transition-colors ${
            status === "recording"
              ? "bg-[#ef4444] hover:bg-[#dc2626] text-white animate-pulse"
              : "bg-[#818cf8] hover:bg-[#6366f1] text-[#0a0a0a] hover:text-white"
          } disabled:opacity-50`}
          aria-label={status === "recording" ? "Stop recording" : "Start recording"}
        >
          {status === "recording" ? (
            <Square className="w-4 h-4" fill="currentColor" />
          ) : (
            <Mic className="w-5 h-5" />
          )}
        </button>
      </div>
    </div>
  );
}