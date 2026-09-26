// Settings tab: shows platform connection status, drives the Gmail and WhatsApp connect
// flows (QR scan), and hosts profile editing plus notifications/account placeholders.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Mail,
  MessageSquare,
  ChevronDown,
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
} from "../lib/api";
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
  const waPairingMode = true;
  const waReadyGate = false;
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
      console.error(err);
      setError("Unable to load connection status");
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
    } catch (err: any) {
      setError(err?.message || "Unable to request a WhatsApp pairing code.");
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
    } catch (err: any) {
      console.error(err);
      setMessage(err?.message || `Unable to disconnect ${name}.`);
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
      localStorage.setItem("signalstream-logged-out", "1");
      window.location.href = "/";
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Failed to log out. Please try again.");
    } finally {
      setLoggingOut(false);
    }
  };

  /*
    * Removed QR connection flow. Pairing-code status is handled above.
      // Immediate state check right after connect resolves: the backend already
      // knows whether it is resuming a saved session (status 'reconnecting') or
      // generating a fresh QR ('connecting' + qr) — pick the right UI up front
      // instead of defaulting to the QR-scanning prompt.
      if (waPollStoppedRef.current || waPollSessionRef.current !== pollSession) return;
      const initialController = new AbortController();
      waPollAbortRef.current = initialController;
      const initialState = await getWhatsAppQr(initialController.signal);
      waTraceQrResponse(initialState, 'initial');
      waHandleFreshAttempt(initialState.connectionAttemptId, 'initial');
      waStampQrReceived(initialState);
      if (waPollAbortRef.current === initialController) waPollAbortRef.current = null;
      if (waPollStoppedRef.current || waPollSessionRef.current !== pollSession) return;

      if (initialState.connected) {
        await finishConnected();
        return;
      }
      if (initialState.qr) {
        const qrGeneration = initialState.qrGeneration ?? 1;
        if (waAcknowledgedQrGenerationRef.current !== qrGeneration) {
          setWaQr(initialState.qr);
          setWaConfirming(false);
        }
        setWaScanning(false);
        setWaReconnecting(false);
        waQrCountRef.current = qrGeneration;
        setWaQrCount(qrGeneration);
      } else if (initialState.status === "reconnecting") {
        setWaReconnecting(true);
        setWaScanning(false);
        setWaConfirming(false);
      } else if (initialState.status === "rendering_qr") {
        // A NEW raw QR arrived but its image is still being rendered server-side.
        // Do NOT keep showing the previous (now stale) QR image — show the
        // "Confirming connection, please wait..." state until the ready QR
        // arrives under its matching generation.
        const qrGeneration = initialState.qrGeneration ?? waQrCountRef.current + 1;
        setWaQr(null);
        setWaConfirming(true);
        setWaScanning(false);
        setWaReconnecting(false);
        waQrCountRef.current = qrGeneration;
        setWaQrCount(qrGeneration);
      } else {
        // Fresh pairing / socket still coming up — QR-scanning UI.
        setWaReconnecting(false);
      }

      const pollWhatsAppState = async () => {
        if (waPollStoppedRef.current || waPollSessionRef.current !== pollSession) return;
        const controller = new AbortController();
        waPollAbortRef.current = controller;
        try {
          const state = await getWhatsAppQr(controller.signal);
          waTraceQrResponse(state, 'poll');
          if (waPollStoppedRef.current || waPollSessionRef.current !== pollSession) return;

          // (STEP 3) echo of fresh-cycle boundary: whenever connectionAttemptId
          // changes (e.g. auto-reconnect after a 408), drop any stale displayed
          // QR, show the "Confirming connection, please wait..." transition, and
          // force the <img> to re-mount. The fresh QR#1 (if already rendered)
          // replaces the placeholder further down in this same handler.
          const attemptChanged = waHandleFreshAttempt(state.connectionAttemptId, 'poll');
          if (attemptChanged) {
            setWaQr(null);
            setWaConfirming(true);
            setWaScanning(false);
            setWaReconnecting(false);
          }
          waStampQrReceived(state);

          if (state.connected) {
            await finishConnected();
            return;
          }

          if (state.qr) {
            const qrGeneration = state.qrGeneration ?? 1;
            if (waAcknowledgedQrGenerationRef.current !== qrGeneration) {
              setWaQr(state.qr);
              setWaConfirming(false);
              waAcknowledgedQrGenerationRef.current = null;
            }
            setWaScanning(false);
            setWaReconnecting(false);
            waQrCountRef.current = qrGeneration;
            setWaQrCount(qrGeneration);
            return;
          }

          if (state.status === "rendering_qr") {
            // A NEW raw QR arrived but its image is still being rendered
            // server-side (no `qr` payload yet). Never keep displaying the
            // previous — now superseded — QR image: switch to the "Confirming
            // connection, please wait..." state until the ready QR replaces it.
            const qrGeneration = state.qrGeneration ?? waQrCountRef.current + 1;
            setWaQr(null);
            setWaConfirming(true);
            setWaScanning(false);
            setWaReconnecting(false);
            waQrCountRef.current = qrGeneration;
            setWaQrCount(qrGeneration);
            return;
          }

          if (state.status === "logged_out") {
            stopWaPolling();
            setWaModalOpen(false);
            setWaReconnecting(null);
            setMessage("WhatsApp session was cleared. Please try connecting again.");
            return;
          }

          if (state.status === "reconnecting") {
            // Saved session is being resumed — keep the reconnecting UI; no QR.
            const waitingForNextQr = waQrCountRef.current >= 1;
            setWaReconnecting(!waitingForNextQr);
            setWaScanning(false);
            setWaQr(waitingForNextQr ? null : waQr);
            setWaConfirming(waitingForNextQr);
            return;
          }

          // Once a QR was shown, a cleared QR means WhatsApp is processing the
          // scan. Keep polling until Baileys supplies the next QR or connection.
          const waitingForConfirmation = waQrCountRef.current >= 1;
          setWaQr(waitingForConfirmation ? null : waQr);
          setWaConfirming(waitingForConfirmation);
          setWaReconnecting(false);
          setWaScanning(!waitingForConfirmation);
        } catch (err) {
          if (controller.signal.aborted || waPollStoppedRef.current || waPollSessionRef.current !== pollSession) return;
          // Transient network error — keep polling.
          setWaScanning(waQrCountRef.current < 1);
        } finally {
          if (waPollAbortRef.current === controller) waPollAbortRef.current = null;
        }
      };

      // Create the interval before the immediate request so a response that
      // closes the modal can always stop future polls.
      waPollRef.current = setInterval(pollWhatsAppState, 2000);

      // Expose an immediate-refresh handle so the scan acknowledgment button
      // button can re-poll right away instead of on the next (throttled) 2s
      // tick, and re-poll the instant the user returns to the tab/window.
      // Browsers throttle background-tab setInterval to ~1/min, so without this
      // the QR on screen can silently age (Baileys already rotated to a newer
      // ref) while the user is looking at their phone — they would then scan an
      // expired ref that never registers, silently exhausting QR refs until the
      // 408 close.
      const immediatePoll = () => {
        if (waPollStoppedRef.current || waPollSessionRef.current !== pollSession) return;
        pollWhatsAppState();
      };
      waImmediatePollRef.current = immediatePoll;
      const onVisibilityChange = () => {
        if (document.visibilityState === 'visible') immediatePoll();
      };
      const onWindowFocus = () => immediatePoll();
      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('focus', onWindowFocus);
      waPollCleanupFnsRef.current.push(() => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('focus', onWindowFocus);
        if (waImmediatePollRef.current === immediatePoll) waImmediatePollRef.current = null;
      });

      await pollWhatsAppState();
    } catch (err) {
      if (waPollStoppedRef.current || waPollSessionRef.current !== pollSession) return;
      console.error(err);
      stopWaPolling();
      setWaModalOpen(false);
      setWaReconnecting(null);
      setMessage("Unable to connect WhatsApp. Is the backend running?");
    }
  };
  */

  const gmailLabel = useMemo(() => {
    if (loading) return "Checking...";
    return status.gmail ? "Connected" : "Not connected";
  }, [loading, status.gmail]);

  return (
    <div className="flex h-full min-h-0 flex-col px-6 pb-5 pt-6">
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
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-xl border border-[#edf1f5] bg-[#fafbfc] px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-red-100 bg-red-50">
                    <Mail className="h-4 w-4 text-red-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[13px] font-medium text-[#111827]">Gmail</h3>
                    <p className="truncate text-[11px] text-[#8493a7]">
                      {status.gmail ? userProfile.email || "Connected" : "Not connected"}
                    </p>
                  </div>
                </div>
                <span className="whitespace-nowrap rounded-full bg-[#f1f5f9] px-2.5 py-1 text-[10px] text-[#718198]">
                  <span className="mr-1.5 inline-block h-1 w-1 rounded-full bg-[#94a3b8]" />
                  {gmailLabel}
                </span>
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

              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-xl border border-[#edf1f5] bg-[#fafbfc] px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50">
                    <MessageSquare className="h-4 w-4 text-emerald-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[13px] font-medium text-[#111827]">WhatsApp</h3>
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
                  {loading ? "Checking..." : status.whatsapp ? "Connected" : waReconnecting ? "Reconnecting" : "Not connected"}
                </span>
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
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-[12px] font-medium text-[#111827]">Push notifications on match</h3>
                  <p className="text-[10px] text-[#718198]">Get notified instantly when a message matches your watchlist</p>
                </div>
                <button type="button" role="switch" aria-checked="true" aria-label="Push notifications on match" className="relative h-[18px] w-8 shrink-0 rounded-full bg-[#2563eb] transition-colors">
                  <span className="absolute left-[15px] top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-transform motion-reduce:transition-none" />
                </button>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-[12px] font-medium text-[#111827]">Daily digest</h3>
                  <p className="text-[10px] text-[#718198]">Receive a summary email each morning</p>
                </div>
                <button type="button" role="switch" aria-checked="false" aria-label="Daily digest" className="relative h-[18px] w-8 shrink-0 rounded-full bg-[#e2e8f0] transition-colors">
                  <span className="absolute left-[2px] top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-transform motion-reduce:transition-none" />
                </button>
              </div>

              <div className="flex items-center justify-between gap-4 pt-1">
                <label htmlFor="digest-frequency" className="text-[12px] font-medium text-[#111827]">Digest frequency</label>
                <div className="relative w-[132px]">
                  <select id="digest-frequency" className="w-full cursor-pointer appearance-none rounded-md border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-[10px] text-[#334155] focus:outline-none focus:ring-2 focus:ring-blue-200">
                    <option>Daily</option>
                    <option>Weekly</option>
                    <option>Real-time</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#718198]" />
                </div>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
            <h2 className="px-[18px] pb-1 pt-4 text-[13px] font-semibold text-[#111827]">Account</h2>
            <div className="flex items-center justify-between gap-4 px-[18px] py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-[#4f46e5]">
                  {userProfile.avatar ? (
                    <img src={userProfile.avatar} alt="Profile" className="h-full w-full object-cover" />
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
                    {userProfile.name || (status.gmail && userProfile.email ? userProfile.email : "User")}
                  </h3>
                  <p className="truncate text-[10px] text-[#8493a7]">
                    {userProfile.email || (status.gmail ? "Connected via Google" : "Not signed in")}
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
              <h3 className="mb-2.5 text-[9px] font-semibold uppercase text-red-600">Danger zone</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-[#fcf7f7] px-3 py-2.5">
                  <p className="max-w-md text-[10px] leading-4 text-[#334155]">
                    Sign out of SignalStream. Your Google &amp; WhatsApp connections are revoked and you&apos;ll return to the sign-in screen.
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
                  <p className="text-[10px] leading-4 text-red-600">Once you delete your account, there is no going back. Please be certain.</p>
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
              {waPairingMode ? (
                waPairingCode ? (
                  "On your phone, open WhatsApp > Settings > Linked Devices > Link a Device > Link with phone number instead, and enter this code."
                ) : (
                  "Enter your WhatsApp phone number with country code to receive a pairing code."
                )
              ) : waReadyGate ? (
                "On your phone, open WhatsApp > Settings > Linked Devices > Link a Device, and get your camera ready to scan."
              ) : waReconnecting ? (
                "A saved WhatsApp session was found. Reconnecting automatically using it — no QR scan is needed. This usually completes in a few seconds."
              ) : (
                <>
                  Open WhatsApp on your phone → Settings → Linked devices → Link
                  a device, then scan the QR code below. If your phone asks you
                  to confirm linking, tap{" "}
                  <span className="text-white">Continue</span>. Keep this window
                  open while WhatsApp completes the pairing.
                </>
              )}
            </p>
            <div className="flex flex-col items-center">
              {waPairingMode ? (
                <div className="w-full">
                  {waPairingCode ? (
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
                  ) : (
                    <form
                      onSubmit={handlePairingCodeRequest}
                      className="flex flex-col gap-3 py-5"
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
                        onChange={(event) =>
                          setWaPhoneNumber(event.target.value)
                        }
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
                        {waPairingLoading
                          ? "Requesting code..."
                          : "Get pairing code"}
                      </button>
                    </form>
                  )}
                </div>
              ) : waReadyGate ? (
                <div className="h-56 w-full flex flex-col items-center justify-center gap-3">
                  <MessageSquare className="w-10 h-10 text-teal-400" />
                  <span className="text-gray-300 text-sm font-medium text-center max-w-xs">
                    Get your phone's camera ready — the QR code will appear the
                    moment you continue.
                  </span>
                  <button
                    onClick={() => {
                      setWaReadyGate(false);
                      handleWhatsAppConnect();
                    }}
                    className="mt-1 text-sm font-medium text-[#0f0f0f] bg-[#c7d2fe] hover:bg-[#a5b4fc] px-4 py-2 rounded-lg transition-colors"
                  >
                    I'm ready, show QR code
                  </button>
                </div>
              ) : waReconnecting ? (
                <div className="h-56 w-full flex flex-col items-center justify-center gap-3">
                  <div className="w-9 h-9 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-gray-300 text-sm font-medium">
                    Reconnecting…
                  </span>
                </div>
              ) : waConfirming ? (
                <div className="h-56 w-full flex flex-col items-center justify-center gap-3">
                  <div className="w-9 h-9 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-gray-300 text-sm font-medium">
                    Confirming connection, please wait...
                  </span>
                </div>
              ) : !waQr ? (
                <div className="h-56 w-full flex items-center justify-center text-gray-400 text-sm">
                  {waQrCountRef.current >= 1 && !waScanning
                    ? "Confirming on your phone…"
                    : waScanning
                      ? waReconnecting === null
                        ? "Starting WhatsApp…"
                        : "Generating QR code…"
                      : waQrCount > 1
                        ? "Checking the WhatsApp connection…"
                        : "Waiting for QR code…"}
                </div>
              ) : (
                <img
                  key={waQrKey}
                  ref={onWaImgRef}
                  src={waQr}
                  alt="WhatsApp QR code"
                  className="w-full max-w-[400px] h-auto rounded-lg bg-white p-2 [image-rendering:pixelated]"
                />
              )}
              {!waReadyGate && !waPairingMode && (
                <>
                  <p className="text-gray-400 text-sm mt-4 text-center">
                    {waReconnecting
                      ? "Your phone will show this device as linked once reconnection completes. You can close this window in the meantime."
                      : waConfirming
                        ? "WhatsApp is processing the pairing confirmation."
                        : !waQr
                          ? waQrCountRef.current >= 1
                            ? "Waiting for WhatsApp to confirm the scan…"
                            : "Please wait a moment."
                          : "Scan this code. If your phone asks to confirm, tap Continue."}
                  </p>
                  {!waReconnecting &&
                    (waQrCount >= 3 || waQrCountRef.current >= 3) && (
                      <p className="mt-3 text-xs text-amber-400/80 text-center">
                        Tip: make sure your phone's camera is well lit and
                        steady, and try scanning as soon as a new code appears.
                      </p>
                    )}
                  {waQr && waQrCount === 1 && (
                    <button
                      onClick={() => {
                        // Acknowledge the user's action, but keep the current QR
                        // visible. The backend owns QR rotation and may still be
                        // waiting for the first pairing handshake to finish.
                        waAcknowledgedQrGenerationRef.current = waQrCount;
                        waQrReceivedAtRef.current = 0;
                        // Refresh immediately so a resolved connection or a newer
                        // QR is reflected without waiting for the next interval.
                        waImmediatePollRef.current?.();
                      }}
                      className="mt-4 text-sm font-medium text-teal-300 hover:text-teal-200 border border-teal-900/60 hover:border-teal-700 px-4 py-2 rounded-lg transition-colors"
                    >
                      I scanned it, check connection
                    </button>
                  )}
                </>
              )}
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
