// One-click "Alert me" toggle for inbox message cards (Gmail + WhatsApp).
// Click ON: POST /api/signals/quick-alert with the sender/chat target.
// Click again (ON state): DELETE /api/signals/quick-alert to turn it back OFF.
// Backend dedups on alertTarget + alertPlatform, so a duplicate signal is never
// created. A tiny module-level cache of existing alert keys lets every card
// light up as already-alerting on page load with a single GET /api/signals call.
import { useEffect, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { deleteQuickAlertSignal, getSignals, quickAlertSignal } from "../services/api";

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

function forgetAlertKey(key: string) {
  cachedAlertKeys?.delete(key);
}

export function QuickAlertButton({
  target,
  variant = "pill",
  className = "",
}: QuickAlertButtonProps) {
  const [state, setState] = useState<"idle" | "loading" | "active">("idle");
  const alertKey = `${target.platform}:${target.target}`;
  const isActive = state === "active";

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
    if (state === "loading" || !target.target) return;
    setState("loading");
    try {
      if (isActive) {
        await deleteQuickAlertSignal({ target: target.target, platform: target.platform });
        forgetAlertKey(alertKey);
        setState("idle");
      } else {
        await quickAlertSignal({
          target: target.target,
          platform: target.platform,
          senderName: target.senderName,
        });
        rememberAlertKey(alertKey);
        setState("active");
      }
    } catch (err) {
      console.error("Quick alert toggle failed", err);
      setState(isActive ? "active" : "idle");
    }
  };

  const label = state === "loading" ? "Alerting…" : isActive ? "Alerts on" : "Alert me";
  const sender = target.senderName || target.target;
  const tooltip = isActive
    ? `Alerts ON for ${sender} — click the bell again to turn alerts OFF`
    : `Alerts OFF — click the bell to get notified whenever ${sender} sends again`;

  const base = "inline-flex items-center justify-center gap-1 rounded-md border transition-colors flex-shrink-0";
  const tone = isActive
    ? "bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-500/15 dark:border-amber-500/40 dark:text-amber-300"
    : "bg-[#ffffff] border-[#e2e8f0] text-slate-400 hover:text-slate-700 hover:border-[#cbd5e1] dark:bg-[#171e2b] dark:border-[#30394a] dark:text-[#9aa6b8] dark:hover:text-[#f1f4f9] dark:hover:border-[#46536a]";
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
        <BellRing className="w-3.5 h-3.5" />
      ) : (
        <Bell className="w-3.5 h-3.5" />
      )}
      {variant === "pill" && <span>{label}</span>}
    </button>
  );
}