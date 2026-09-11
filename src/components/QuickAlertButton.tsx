// One-click "Alert me" button for message cards (Gmail + WhatsApp).
// Calls POST /api/signals/quick-alert with the sender/chat target and shows a
// compact confirmed ("Alerted") state afterwards. Re-clicks on an alerted card
// are no-ops and the backend additionally dedups on alertTarget + alertPlatform,
// so a duplicate signal is never created. A tiny module-level cache of existing
// alert keys lets every card light up as already-alerting on page load with a
// single GET /api/signals call.
import { useEffect, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { getSignals, quickAlertSignal } from "../lib/api";

export interface QuickAlertTarget {
  target: string;
  platform: "gmail" | "whatsapp";
  senderName?: string;
}

interface QuickAlertButtonProps {
  target: QuickAlertTarget;
  /** "pill" = bell icon + short label ("Alert me" / "Alerted"); "icon" = icon-only with tooltip */
  variant?: "pill" | "icon";
  className?: string;
}

// "gmail:admissions@x.com" / "whatsapp:919876543210" — the same keys the backend
// dedups on, kept in sync with every created alert (and the initial signals list).
let cachedAlertKeys: Set<string> | null = null;
let cachePromise: Promise<void> | null = null;

function ensureAlertKeysLoaded() {
  if (cachedAlertKeys) return Promise.resolve();
  if (!cachePromise) {
    cachePromise = getSignals()
      .then((all) => {
        cachedAlertKeys = new Set(
          (all || [])
            .filter((s) => s.alertEnabled && s.alertTarget)
            .map((s) => `${s.alertPlatform || "gmail"}:${s.alertTarget}`),
        );
      })
      .catch((err) => {
        console.error("Failed to load existing alert signals", err);
      })
      .finally(() => {
        cachePromise = null;
      });
  }
  return cachePromise;
}

function rememberAlertKey(key: string) {
  if (!cachedAlertKeys) cachedAlertKeys = new Set();
  cachedAlertKeys.add(key);
}

export function QuickAlertButton({
  target,
  variant = "pill",
  className = "",
}: QuickAlertButtonProps) {
  const [state, setState] = useState<"idle" | "loading" | "active">("idle");
  const alertKey = `${target.platform}:${target.target}`;

  // Pre-fill the "already alerting" state when an alert for this sender already
  // exists (fetched once and cached across every card).
  useEffect(() => {
    let cancelled = false;
    ensureAlertKeysLoaded().then(() => {
      if (!cancelled && cachedAlertKeys?.has(alertKey)) {
        setState("active");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [alertKey]);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (state !== "idle" || !target.target) return; // no-op while loading/already alerting
    setState("loading");
    try {
      await quickAlertSignal({
        target: target.target,
        platform: target.platform,
        senderName: target.senderName,
      });
      rememberAlertKey(alertKey);
      setState("active");
    } catch (err) {
      console.error("Quick alert failed", err);
      setState("idle");
    }
  };

  const isActive = state === "active";
  const label = state === "loading" ? "Alerting…" : isActive ? "Alerted" : "Alert me";
  const tooltip = isActive
    ? `Already alerting for messages from ${target.senderName || target.target}`
    : `Alert me for messages from ${target.senderName || target.target}`;

  const base = "inline-flex items-center justify-center gap-1 rounded-md border transition-colors flex-shrink-0";
  const tone = isActive
    ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-300"
    : "bg-[#2a2a2a] hover:bg-[#333] border border-[#333] hover:border-[#444] text-gray-400 hover:text-white";
  const size =
    variant === "icon"
      ? "w-7 h-7"
      : "px-2 py-1 text-[10px] font-semibold";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === "loading"}
      title={tooltip}
      aria-pressed={isActive}
      aria-label={label}
      className={`${base} ${size} ${tone} ${state === "loading" ? "opacity-70 cursor-wait" : ""} ${className}`}
    >
      {isActive ? (
        <Bell className="w-3.5 h-3.5" />
      ) : (
        <BellRing className="w-3.5 h-3.5" />
      )}
      {variant === "pill" && <span>{label}</span>}
    </button>
  );
}