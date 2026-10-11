// Settings tab: shows platform connection status, drives the Gmail and WhatsApp connect
// flows (QR scan), and hosts profile editing plus notifications/account placeholders.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Mail,
  MessageSquare,
  User,
  X,
  LogOut,
} from "lucide-react";
import {
  getAuthStatus,
  requestWhatsAppPairingCode,
  getWhatsAppStatus,
  disconnectPlatform,
  logoutUser,
  updateProfile,
  getErrorMessage,
} from "../services/api";
import { EditProfileModal } from "./EditProfileModal";

export function SettingsTab() {
  const [status, setStatus] = useState({
    gmail: false,
    whatsapp: false,
  });
  const [userProfile, setUserProfile] = useState<{
    name: string | null;
    email: string | null;
    avatar: string | null;
  }>({ name: null, email: null, avatar: null });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [waModalOpen, setWaModalOpen] = useState(false);
  const [waPhoneNumber, setWaPhoneNumber] = useState("");
  const [waPairingCode, setWaPairingCode] = useState<string | null>(null);
  const [waPairingLoading, setWaPairingLoading] = useState(false);
  const waPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waPollSessionRef = useRef(0);
  const [waReconnecting, setWaReconnecting] = useState<boolean | null>(null);

  const stopWaPolling = () => {
    waPollSessionRef.current += 1;
    if (waPollRef.current) {
      clearInterval(waPollRef.current);
      waPollRef.current = null;
    }
  };
  const loadStatus = async () => {
    try {
      setLoading(true);
      const result = await getAuthStatus();
      setStatus({
        gmail: result.gmail,
        whatsapp: result.whatsapp,
      });
      if (result.user) {
        setUserProfile(result.user);
      }
      setError(null);
    } catch (err) {
      console.error("Failed to load connection status", err);
      setError(getErrorMessage(err, "Unable to load connection status"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
    // Stop the WhatsApp QR poll if the component unmounts mid-scan.
    return () => stopWaPolling();
  }, []);

  const handleConnect = async (name: "gmail" | "whatsapp") => {
    if (name === "gmail") {
      window.location.href = "http://localhost:3000/auth/google";
      return;
    }

    // Open the readiness screen before starting the Baileys connection.
    setWaModalOpen(true);
    setWaPairingCode(null);
    setWaReconnecting(null);
    setMessage(null);
  };

  const handlePairingCodeRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    setWaPairingLoading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await requestWhatsAppPairingCode(waPhoneNumber);
      setWaPairingCode(result.code);
      const pollSession = waPollSessionRef.current + 1;
      waPollSessionRef.current = pollSession;
      const pollPairingStatus = async () => {
        if (waPollSessionRef.current !== pollSession) return;
        try {
          const state = await getWhatsAppStatus();
          if (state.connected) {
            stopWaPolling();
            setWaModalOpen(false);
            setWaPairingCode(null);
            setMessage("WhatsApp connected successfully.");
            await loadStatus();
          }
        } catch {
          // Keep polling through transient status requests while the phone pairs.
        }
      };
      waPollRef.current = setInterval(pollPairingStatus, 2000);
      await pollPairingStatus();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to request a WhatsApp pairing code."));
    } finally {
      setWaPairingLoading(false);
    }
  };

  const displayPairingCode = waPairingCode
    ? `${waPairingCode.slice(0, 4)}-${waPairingCode.slice(4)}`
    : null;

  // Disconnect a connected platform (Gmail revokes OAuth, WhatsApp logs out the
  // Baileys socket).
  const handleDisconnect = async (name: "gmail" | "whatsapp") => {
    setMessage(null);
    setError(null);
    if (name === "whatsapp") {
      stopWaPolling();
      setWaModalOpen(false);
      setWaReconnecting(null);
      // Update the row immediately. The server still performs the real logout
      // and the final status refresh below corrects this if it fails.
      setStatus((current) => ({ ...current, whatsapp: false }));
    }
    try {
      const result = await disconnectPlatform(name);
      setMessage(result.message || `${name} disconnected`);
    } catch (err) {
      console.error(`Failed to disconnect ${name}`, err);
      setMessage(getErrorMessage(err, `Unable to disconnect ${name}.`));
    } finally {
      await loadStatus();
    }
  };

  // Sign out: revoke Gmail + WhatsApp, mark signed-out, back to the login screen.
  const handleLogout = async () => {
    stopWaPolling();
    setWaModalOpen(false);
    setMessage(null);
    setError(null);
    setLoggingOut(true);
    try {
      await logoutUser();
      localStorage.setItem("dailyez-logged-out", "1");
      window.location.href = "/";
    } catch (err) {
      console.error("Failed to log out", err);
      setError(getErrorMessage(err, "Failed to log out. Please try again."));
    } finally {
      setLoggingOut(false);
    }
  };

  const gmailLabel = useMemo(() => {
    if (loading) return "Checking...";
    return status.gmail ? "Connected" : "Not connected";
  }, [loading, status.gmail]);

  return (
    <div
      data-settings-dark
      className="flex h-full min-h-0 flex-col px-6 pb-5 pt-6"
    >
      <div className="mb-4 shrink-0">
        <h1 className="text-[24px] font-bold leading-tight tracking-tight text-[#0f2742]">
          Settings
        </h1>
        <p className="mt-1 text-xs text-[#58708d]">
          Manage your account and connections
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-14 pr-1">
        <div className="mx-auto max-w-2xl space-y-[18px]">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {message && <p className="text-sm text-amber-700">{message}</p>}

          <section className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
            <h2 className="px-[18px] pb-3 pt-4 text-[13px] font-semibold text-[#111827]">
              Connected platforms
            </h2>
            <div className="space-y-2.5 px-[18px] pb-[18px]">
              <div
                className={`grid ${status.gmail ? "grid-cols-[minmax(0,1fr)_auto_auto_auto]" : "grid-cols-[minmax(0,1fr)_auto_auto]"} items-center gap-3 rounded-xl border border-[#edf1f5] bg-[#fafbfc] px-3 py-2.5`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-red-100 bg-red-50">
                    <Mail className="h-4 w-4 text-red-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[13px] font-medium text-[#111827]">
                      Gmail
                    </h3>
                    <p className="truncate text-[11px] text-[#8493a7]">
                      {status.gmail
                        ? userProfile.email || "Connected"
                        : "Not connected"}
                    </p>
                  </div>
                </div>
                <span className="whitespace-nowrap rounded-full bg-[#f1f5f9] px-2.5 py-1 text-[10px] text-[#718198]">
                  <span className="mr-1.5 inline-block h-1 w-1 rounded-full bg-[#94a3b8]" />
                  {gmailLabel}
                </span>
                {status.gmail && (
                  <button
                    onClick={() => handleConnect("gmail")}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-medium text-[#29425f] shadow-sm transition-colors hover:border-blue-300 hover:text-[#2563eb]"
                  >
                    Reconnect
                  </button>
                )}
                <button
                  onClick={() =>
                    status.gmail
                      ? handleDisconnect("gmail")
                      : handleConnect("gmail")
                  }
                  className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors ${
                    status.gmail
                      ? "border border-red-200 bg-white text-red-600 hover:bg-red-50"
                      : "bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
                  }`}
                >
                  {status.gmail ? "Disconnect" : "Connect"}
                </button>
              </div>

              <div
                className={`grid ${status.whatsapp ? "grid-cols-[minmax(0,1fr)_auto_auto_auto]" : "grid-cols-[minmax(0,1fr)_auto_auto]"} items-center gap-3 rounded-xl border border-[#edf1f5] bg-[#fafbfc] px-3 py-2.5`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50">
                    <MessageSquare className="h-4 w-4 text-emerald-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[13px] font-medium text-[#111827]">
                      WhatsApp
                    </h3>
                    <p className="text-[11px] text-[#8493a7]">
                      {loading
                        ? "Checking..."
                        : status.whatsapp
                          ? "Connected"
                          : waReconnecting
                            ? "Reconnecting"
                            : "Not connected"}
                    </p>
                  </div>
                </div>
                <span className="whitespace-nowrap rounded-full bg-[#f1f5f9] px-2.5 py-1 text-[10px] text-[#718198]">
                  <span className="mr-1.5 inline-block h-1 w-1 rounded-full bg-[#94a3b8]" />
                  {loading
                    ? "Checking..."
                    : status.whatsapp
                      ? "Connected"
                      : waReconnecting
                        ? "Reconnecting"
                        : "Not connected"}
                </span>
                {status.whatsapp && (
                  <button
                    onClick={() => handleConnect("whatsapp")}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-medium text-[#29425f] shadow-sm transition-colors hover:border-blue-300 hover:text-[#2563eb]"
                  >
                    Reconnect
                  </button>
                )}
                <button
                  onClick={() =>
                    status.whatsapp
                      ? handleDisconnect("whatsapp")
                      : handleConnect("whatsapp")
                  }
                  className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors ${
                    status.whatsapp
                      ? "border border-red-200 bg-white text-red-600 hover:bg-red-50"
                      : "bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
                  }`}
                >
                  {status.whatsapp ? "Disconnect" : "Connect"}
                </button>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
            <h2 className="px-[18px] pb-1 pt-4 text-[13px] font-semibold text-[#111827]">
              Notifications
            </h2>
            <div className="space-y-3 px-[18px] pb-[18px] pt-1">
              <div className="flex items-center justify-between gap-4 opacity-60">
                <div>
                  <h3 className="flex items-center gap-2 text-[12px] font-medium text-[#111827]">
                    Push notifications on match
                    <span className="rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[10px] font-medium text-[#718198]">
                      Coming soon
                    </span>
                  </h3>
                  <p className="text-[10px] text-[#718198]">
                    Get notified instantly when a message matches your watchlist
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked="false"
                  aria-disabled="true"
                  aria-label="Push notifications on match (coming soon)"
                  disabled
                  tabIndex={-1}
                  className="relative h-[18px] w-8 shrink-0 cursor-not-allowed rounded-full bg-[#e2e8f0]"
                >
                  <span className="absolute left-[2px] top-[2px] h-[14px] w-[14px] rounded-full bg-white" />
                </button>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
            <h2 className="px-[18px] pb-1 pt-4 text-[13px] font-semibold text-[#111827]">
              Account
            </h2>
            <div className="flex items-center justify-between gap-4 px-[18px] py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-[#4f46e5]">
                  {userProfile.avatar ? (
                    <img
                      src={userProfile.avatar}
                      alt="Profile"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-white">
                      {userProfile.name
                        ? userProfile.name.charAt(0).toUpperCase()
                        : userProfile.email
                          ? userProfile.email.charAt(0).toUpperCase()
                          : "?"}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-[12px] font-medium text-[#111827]">
                    {userProfile.name ||
                      (status.gmail && userProfile.email
                        ? userProfile.email
                        : "User")}
                  </h3>
                  <p className="truncate text-[10px] text-[#8493a7]">
                    {userProfile.email ||
                      (status.gmail ? "Connected via Google" : "Not signed in")}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowEditProfile(true)}
                className="shrink-0 rounded-md border border-[#e2e8f0] bg-white px-3 py-1.5 text-[10px] font-medium text-[#334155] transition-colors hover:bg-[#f8fafc]"
              >
                Edit profile
              </button>
            </div>

            <div className="mx-[18px] border-t border-[#edf1f5]" />
            <div className="px-[18px] pb-[18px] pt-4">
              <h3 className="mb-2.5 text-[9px] font-semibold uppercase text-red-600">
                Danger zone
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-[#fcf7f7] px-3 py-2.5">
                  <p className="max-w-md text-[10px] leading-4 text-[#334155]">
                    Sign out of DailyEz. Your Google &amp; WhatsApp
                    connections are revoked and you&apos;ll return to the
                    sign-in screen.
                  </p>
                  <button
                    onClick={handleLogout}
                    disabled={loggingOut}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-[10px] font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
                  >
                    <LogOut className="h-3 w-3" />
                    {loggingOut ? "Logging out…" : "Log out"}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-[#fcf7f7] px-3 py-2.5">
                  <p className="text-[10px] leading-4 text-red-600">
                    Once you delete your account, there is no going back. Please
                    be certain.
                  </p>
                  <button className="shrink-0 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-[10px] font-medium text-red-600 transition-colors hover:bg-red-50">
                    Delete account
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {waModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-[#161616] border border-[#2a2a2a] rounded-2xl p-4 sm:p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold text-[15px]">
                {waReconnecting
                  ? "Reconnecting WhatsApp"
                  : "Link your WhatsApp"}
              </h3>
              <button
                onClick={() => {
                  stopWaPolling();
                  setWaModalOpen(false);
                }}
                className="text-gray-400 hover:text-white transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-gray-400 text-sm mb-5">
              {waReconnecting
                ? "A saved WhatsApp session was found. Reconnecting automatically using it — no QR scan is needed. This usually completes in a few seconds."
                : waPairingCode
                  ? "On your phone, open WhatsApp > Settings > Linked Devices > Link a Device > Link with phone number instead, and enter this code."
                  : "Enter your WhatsApp phone number with country code to receive a pairing code."}
            </p>
            <div className="flex flex-col items-center">
              {waPairingCode ? (
                <div className="w-full">
                  <div className="flex flex-col items-center gap-4 py-8">
                    <div
                      className="text-4xl font-bold tracking-[0.35em] text-white font-mono"
                      aria-label={`Pairing code ${displayPairingCode}`}
                    >
                      {displayPairingCode}
                    </div>
                    <p className="text-gray-400 text-sm text-center">
                      Enter this 8-character code on your phone. Keep this
                      window open while WhatsApp completes the pairing.
                    </p>
                    <button
                      type="button"
                      onClick={() => setWaPairingCode(null)}
                      className="text-sm text-teal-300 hover:text-teal-200 underline underline-offset-4"
                    >
                      Get a new code
                    </button>
                  </div>
                </div>
              ) : (
                <form
                  onSubmit={handlePairingCodeRequest}
                  className="flex w-full flex-col gap-3 py-5"
                >
                  <label
                    htmlFor="whatsapp-phone"
                    className="text-sm font-medium text-gray-300"
                  >
                    WhatsApp phone number
                  </label>
                  <input
                    id="whatsapp-phone"
                    value={waPhoneNumber}
                    onChange={(event) => setWaPhoneNumber(event.target.value)}
                    placeholder="15551234567 (country code included)"
                    inputMode="tel"
                    autoComplete="tel"
                    className="w-full bg-[#1a1a1a] border border-[#2a2a2a] text-white rounded-lg px-4 py-3 focus:outline-none focus:border-teal-500"
                    required
                  />
                  <p className="text-xs text-gray-500">
                    Use the exact number registered on WhatsApp, including
                    country code, with no +, spaces, or leading trunk zero.
                  </p>
                  <button
                    type="submit"
                    disabled={waPairingLoading}
                    className="text-sm font-medium text-[#0f0f0f] bg-[#99f6e4] hover:bg-[#5eead4] px-4 py-2.5 rounded-lg transition-colors disabled:opacity-60"
                  >
                    {waPairingLoading ? "Requesting code..." : "Get pairing code"}
                  </button>
                </form>
              )}
            </div>
            <button
              onClick={() => {
                stopWaPolling();
                setWaModalOpen(false);
              }}
              className="mt-5 text-sm font-medium text-gray-300 bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] px-4 py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showEditProfile && (
        <EditProfileModal
          profile={userProfile}
          onSave={async (profile) => {
            const resp = await updateProfile({
              name: profile.name,
              ...(profile.avatar !== undefined
                ? { avatar: profile.avatar }
                : {}),
            });
            if (resp.user) {
              setUserProfile(resp.user);
            }
            setMessage("Profile updated successfully");
          }}
          onClose={() => setShowEditProfile(false)}
        />
      )}
    </div>
  );
}
