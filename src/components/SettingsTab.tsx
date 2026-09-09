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
    <div className="flex-1 overflow-y-auto no-scrollbar pb-10 pt-12 max-w-4xl">
      <div className="mb-8 shrink-0">
        <h2 className="text-[28px] font-bold text-[#e5e7eb] mb-1.5 tracking-tight">
          Settings
        </h2>
        <p className="text-gray-400 text-sm">
          Manage your account and connections
        </p>
      </div>

      <div className="space-y-6">
        {error && <p className="text-sm text-red-400">{error}</p>}
        {message && <p className="text-sm text-amber-400">{message}</p>}
        {/* Connected platforms */}
        <div className="bg-[#161616] border border-[#2a2a2a] rounded-xl overflow-hidden">
          <div className="px-6 py-5 border-b border-[#2a2a2a]">
            <h3 className="text-white font-semibold text-[15px]">
              Connected platforms
            </h3>
          </div>

          <div className="divide-y divide-[#2a2a2a]">
            <div className="p-6 flex items-center justify-between">
              <div className="flex items-center">
                <div className="w-12 h-12 rounded-lg bg-red-950/40 border border-red-900/50 flex items-center justify-center mr-4">
                  <Mail className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <h4 className="text-white font-medium text-[15px]">Gmail</h4>
                  <p className="text-gray-400 text-sm">
                    {status.gmail
                      ? userProfile.email
                        ? `Connected as ${userProfile.email}`
                        : "Connected"
                      : "Not connected"}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-6">
                <div
                  className={`flex items-center text-sm font-medium ${status.gmail ? "text-emerald-500" : "text-gray-500"}`}
                >
                  <div
                    className={`w-2 h-2 rounded-full mr-2 ${status.gmail ? "bg-emerald-500" : "bg-gray-500"}`}
                  ></div>
                  {loading
                    ? "Checking..."
                    : status.gmail
                      ? "Connected"
                      : "Not connected"}
                </div>
                <button
                  onClick={() =>
                    status.gmail
                      ? handleDisconnect("gmail")
                      : handleConnect("gmail")
                  }
                  className={`text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
                    status.gmail
                      ? "text-red-400 bg-[#1a1a1a] hover:bg-red-950/50 border border-red-900/50"
                      : "text-[#0f0f0f] bg-[#c7d2fe] hover:bg-[#a5b4fc]"
                  }`}
                >
                  {status.gmail ? "Disconnect" : "Connect"}
                </button>
              </div>
            </div>

            <div className="p-6 flex items-center justify-between">
              <div className="flex items-center">
                <div className="w-12 h-12 rounded-lg bg-teal-950/40 border border-teal-900/50 flex items-center justify-center mr-4">
                  <MessageSquare className="w-5 h-5 text-teal-500" />
                </div>
                <div>
                  <h4 className="text-white font-medium text-[15px]">
                    WhatsApp
                  </h4>
                  <p className="text-gray-400 text-sm">
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
              <div className="flex items-center space-x-6">
                <div
                  className={`flex items-center text-sm font-medium ${status.whatsapp ? "text-emerald-500" : waReconnecting ? "text-amber-400" : "text-gray-500"}`}
                >
                  <div
                    className={`w-2 h-2 rounded-full mr-2 ${status.whatsapp ? "bg-emerald-500" : waReconnecting ? "bg-amber-400" : "bg-gray-500"}`}
                  ></div>
                  {loading
                    ? "Checking..."
                    : status.whatsapp
                      ? "Connected"
                      : waReconnecting
                        ? "Reconnecting"
                        : "Not connected"}
                </div>
                <button
                  onClick={() =>
                    status.whatsapp
                      ? handleDisconnect("whatsapp")
                      : handleConnect("whatsapp")
                  }
                  className={`text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
                    status.whatsapp
                      ? "text-red-400 bg-[#1a1a1a] hover:bg-red-950/50 border border-red-900/50"
                      : "text-[#0f0f0f] bg-[#c7d2fe] hover:bg-[#a5b4fc]"
                  }`}
                >
                  {status.whatsapp ? "Disconnect" : "Connect"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-[#161616] border border-[#2a2a2a] rounded-xl overflow-hidden">
          <div className="px-6 py-5 border-b border-[#2a2a2a]">
            <h3 className="text-white font-semibold text-[15px]">
              Notifications
            </h3>
          </div>

          <div className="p-6 space-y-8">
            <div className="flex justify-between items-center">
              <div>
                <h4 className="text-white font-medium text-[15px] mb-1">
                  Push notifications on match
                </h4>
                <p className="text-gray-400 text-sm">
                  Get notified instantly when a message matches your watchlist
                </p>
              </div>
              <button className="w-12 h-6 rounded-full bg-[#818cf8] relative transition-colors">
                <div className="absolute top-1 left-7 w-4 h-4 rounded-full bg-white transition-transform" />
              </button>
            </div>

            <div className="flex justify-between items-center">
              <div>
                <h4 className="text-white font-medium text-[15px] mb-1">
                  Daily digest
                </h4>
                <p className="text-gray-400 text-sm">
                  Receive a summary email each morning
                </p>
              </div>
              <button className="w-12 h-6 rounded-full bg-[#333] relative transition-colors">
                <div className="absolute top-1 left-1 w-4 h-4 rounded-full bg-gray-400 transition-transform" />
              </button>
            </div>

            <div className="pt-2">
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Digest frequency
              </label>
              <div className="relative w-64">
                <select className="w-full bg-[#1a1a1a] border border-[#2a2a2a] text-gray-200 text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:border-[#818cf8] transition-colors appearance-none cursor-pointer">
                  <option>Daily</option>
                  <option>Weekly</option>
                  <option>Real-time</option>
                </select>
                <ChevronDown className="w-4 h-4 text-gray-500 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          </div>
        </div>

        {/* Account */}
        <div className="bg-[#161616] border border-[#2a2a2a] rounded-xl overflow-hidden">
          <div className="px-6 py-5 border-b border-[#2a2a2a]">
            <h3 className="text-white font-semibold text-[15px]">Account</h3>
          </div>

          <div className="p-6 border-b border-[#2a2a2a] flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <div className="w-16 h-16 rounded-full bg-indigo-500 overflow-hidden border-2 border-[#2a2a2a]">
                {userProfile.avatar ? (
                  <img
                    src={userProfile.avatar}
                    alt="Profile"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white text-xl font-semibold bg-indigo-600">
                    {userProfile.name
                      ? userProfile.name.charAt(0).toUpperCase()
                      : userProfile.email
                        ? userProfile.email.charAt(0).toUpperCase()
                        : "?"}
                  </div>
                )}
              </div>
              <div>
                <h3 className="text-white text-lg font-semibold">
                  {userProfile.name ||
                    (status.gmail && userProfile.email
                      ? userProfile.email
                      : "User")}
                </h3>
                <p className="text-gray-400 text-sm">
                  {userProfile.email ||
                    (status.gmail ? "Connected via Google" : "Not signed in")}
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowEditProfile(true)}
              className="text-sm font-medium text-gray-300 bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] px-4 py-2 rounded-lg transition-colors"
            >
              Edit profile
            </button>
          </div>

          <div className="p-6">
            <h4 className="text-[11px] font-bold text-red-500 uppercase tracking-wider mb-4">
              Danger Zone
            </h4>
            <div className="space-y-3">
              <div className="border border-red-900/50 bg-red-950/10 rounded-lg p-5 flex justify-between items-center">
                <p className="text-gray-400 text-sm font-medium">
                  Sign out of SignalStream. Your Google &amp; WhatsApp
                  connections are revoked and you&apos;ll return to the sign-in
                  screen.
                </p>
                <button
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="flex items-center gap-1.5 text-sm font-medium text-red-400 bg-[#1a1a1a] hover:bg-red-950/50 border border-red-900/50 px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
                >
                  <LogOut className="w-4 h-4" />
                  {loggingOut ? "Logging out…" : "Log out"}
                </button>
              </div>
              <div className="border border-red-900/50 bg-red-950/10 rounded-lg p-5 flex justify-between items-center">
                <p className="text-red-400/80 text-sm font-medium">
                  Once you delete your account, there is no going back. Please
                  be certain.
                </p>
                <button className="text-sm font-medium text-red-400 bg-[#1a1a1a] hover:bg-red-950/50 border border-red-900/50 px-4 py-2 rounded-lg transition-colors">
                  Delete account
                </button>
              </div>
            </div>
          </div>
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
