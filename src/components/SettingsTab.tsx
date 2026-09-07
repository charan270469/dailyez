// Settings tab: shows platform connection status, drives the Gmail and WhatsApp connect
// flows (QR scan), and hosts profile editing plus notifications/account placeholders.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  connectWhatsApp,
  requestWhatsAppPairingCode,
  getWhatsAppQr,
  disconnectPlatform,
  logoutUser,
  updateProfile,
  type WhatsAppConnectionState,
} from "../lib/api";
import { EditProfileModal } from "./EditProfileModal";

// FNV-1a 32-bit checksum over a string. QR `qr` payloads are base64 data URLs
// tens of KB long, so we fingerprint them (hex hash) instead of logging the
// whole string. Used by the STEP 1 diagnostics below to detect whether a freshly
// polled QR image actually differs from the one previously displayed.
function qrDataChecksum(data: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

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

  // WhatsApp (Baileys QR) flow state
  const [waModalOpen, setWaModalOpen] = useState(false);
  const [waPairingMode, setWaPairingMode] = useState(true);
  const [waPhoneNumber, setWaPhoneNumber] = useState("");
  const [waPairingCode, setWaPairingCode] = useState<string | null>(null);
  const [waPairingLoading, setWaPairingLoading] = useState(false);
  const [waQr, setWaQr] = useState<string | null>(null);
  const [waScanning, setWaScanning] = useState(false);
  const [waQrCount, setWaQrCount] = useState(0);
  const [waConfirming, setWaConfirming] = useState(false);
  // Readiness gate: do not start the backend connection until the user is ready
  // to scan, so the QR validity window is not consumed by setup instructions.
  const [waReadyGate, setWaReadyGate] = useState(false);
  const waQrCountRef = useRef(0);
  // (STEP 3) Incremented on every fresh connectionAttemptId so the QR <img> gets
  // a brand-new `key` → React fully unmounts/remounts the element at each
  // reconnect boundary (rules out any cached-image/stale-reference issue).
  const [waQrKey, setWaQrKey] = useState(0);
  const waAcknowledgedQrGenerationRef = useRef<number | null>(null);
  const waPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waPollStoppedRef = useRef(true);
  const waPollSessionRef = useRef(0);
  const waPollAbortRef = useRef<AbortController | null>(null);
  // ── STEP 1 diagnostics (temp): WhatsApp QR-pairing logging for the 408
  //    "QR refs attempts ended" investigation. Tracks the QR <img> element, its
  //    mount count, and the last polled QR generation + image fingerprint so we
  //    can tell whether a fresh QR after an auto-reconnect actually reaches the
  //    DOM or the modal stays stuck on a stale image.
  const waImgRef = useRef<HTMLImageElement | null>(null);
  const waImgMountCountRef = useRef(0);
  const waLastPollGenRef = useRef<number | null>(null);
  const waLastPollHashRef = useRef<string | null>(null);
  // (STEP 3) Last seen backend connectionAttemptId. Incremented on EVERY full
  // connectSocket()/reconnect on the server — an unambiguous "fresh QR cycle
  // started" signal that doesn't depend on qrGeneration (which resets to 1 and
  // may coincide with a previous attempt's value).
  const waConnectionAttemptIdRef = useRef<number | null>(null);
  // Timestamp when the currently displayed QR image was fetched; used to know
  // whether the on-screen QR has silently aged (e.g. browser throttled the 2s
  // poll while the tab was backgrounded) and needs an immediate refetch before
  // the user scans it.
  const waQrReceivedAtRef = useRef(0);
  // Set inside handleConnect so the scan acknowledgment button and the
  // visibility/focus handlers can trigger an immediate poll instead of waiting
  // for the next (possibly throttled) 2s tick.
  const waImmediatePollRef = useRef<(() => void) | null>(null);
  // Cleanup functions for listeners/interval registration so repeated Connect
  // clicks never accumulate stale handlers.
  const waPollCleanupFnsRef = useRef<Array<() => void>>([]);
  // WhatsApp reconnecting mode:
  //   true  → backend is resuming a saved session; NO QR will appear.
  //   false → fresh pairing in progress (QR-scan UI).
  //   null  → first status check hasn't returned yet (show neutral "starting").
  const [waReconnecting, setWaReconnecting] = useState<boolean | null>(null);

  const stopWaPolling = () => {
    waPollStoppedRef.current = true;
    waPollSessionRef.current += 1;
    waPollAbortRef.current?.abort();
    waPollAbortRef.current = null;
    waPollCleanupFnsRef.current.forEach((fn) => {
      try {
        fn();
      } catch {
        /* listener removal is best-effort */
      }
    });
    waPollCleanupFnsRef.current = [];
    if (waPollRef.current) {
      clearInterval(waPollRef.current);
      waPollRef.current = null;
    }
  };

  // Logs every mount/unmount of the QR <img>. If React merely swaps the `src`
  // attribute on the same DOM node, the mount counter stays flat and only the
  // src change shows up in the render-observation effect below. A brand-new
  // mount (counter +1) means the QR display was fully rebuilt (e.g. because the
  // img was cleared while the backend reported rendering_qr in between).
  const onWaImgRef = useCallback((el: HTMLImageElement | null) => {
    waImgRef.current = el;
    if (el) {
      waImgMountCountRef.current += 1;
      console.log(
        `[wa-qr][render] <img> MOUNTED #${waImgMountCountRef.current} srcLen=${el.src.length} srcHash=${qrDataChecksum(el.src)}`
      );
    } else {
      console.log('[wa-qr][render] <img> unmounted (QR display cleared)');
    }
  }, []);

  // Trace every GET /api/whatsapp/qr response — the initial fetch right after
  // connect as well as each 2s poll — logging: the qrGeneration value received,
  // whether the image data actually changed vs the previous poll, and whether it
  // is a transitional 'rendering_qr' state or a resolved QR.
  const waTraceQrResponse = (state: WhatsAppConnectionState, source: string) => {
    const gen = state.qrGeneration ?? null;
    const hash = state.qr ? qrDataChecksum(state.qr) : null;
    const prevGen = waLastPollGenRef.current;
    const prevHash = waLastPollHashRef.current;
    const genChanged = prevGen !== null && prevGen !== gen;
    const imgChanged = prevHash !== null && hash !== null && prevHash !== hash;
    console.log(
      `[wa-qr][${source}] poll response: status=${state.status ?? 'qr-resolved'} connected=${!!state.connected}` +
        ` attemptId=${state.connectionAttemptId ?? 'n/a'} gen=${gen} genChanged=${genChanged}` +
        ` qrPresent=${!!state.qr} qrLen=${state.qr?.length ?? 0} qrHash=${hash ?? 'none'} imgChanged=${imgChanged}`
    );
    if (state.status === 'rendering_qr') {
      console.log(
        `[wa-qr][${source}] TRANSITIONAL rendering_qr (gen=${state.qrGeneration ?? '?'}) — no QR served; showing "Confirming connection, please wait..." until the resolved QR replaces the stale image`
      );
    } else if (gen !== null && prevGen !== null && gen < prevGen) {
      console.warn(
        `[wa-qr][${source}] qrGeneration RESET ${prevGen} → ${gen}: full reconnect / fresh QR cycle detected. Verify the modal cleared the old image and displays the fresh QR#${gen}.`
      );
    } else if (state.qr) {
      console.log(
        `[wa-qr][${source}] RESOLVED QR (gen=${gen}) image ${imgChanged ? 'CHANGED' : 'SAME'} vs previous poll`
      );
    }
    waLastPollGenRef.current = gen;
    waLastPollHashRef.current = hash;
  };

  // (STEP 3) Detect a freshly-started backend connection attempt via the
  // connectionAttemptId that the server increments on EVERY connectSocket()
  // call (manual connect OR 408 auto-reconnect). Returns true when it changed,
  // so the caller can fully reset the QR display: drop any cached image, show
  // the "Confirming connection, please wait..." transition, and force React to
  // re-mount the <img> through a fresh key.
  const waHandleFreshAttempt = (attemptId: number | undefined, source: string) => {
    if (attemptId === undefined) return false;
    const prev = waConnectionAttemptIdRef.current;
    if (prev !== null && prev !== attemptId) {
      console.warn(
        `[wa-qr][${source}] NEW CONNECTION ATTEMPT (connectionAttemptId ${prev} → ${attemptId}) — resetting QR display, forcing <img> remount`
      );
      waConnectionAttemptIdRef.current = attemptId;
      setWaQrKey((k) => k + 1);
      return true;
    }
    if (prev === null) {
      waConnectionAttemptIdRef.current = attemptId;
    }
    return false;
  };

  // (STEP 3) Stamp when the current QR image actually arrived so stale-age
  // checks (tab-throttled polling etc.) can decide whether to force a refetch
  // before the user scans.
  const waStampQrReceived = (state: WhatsAppConnectionState) => {
    if (state.qr) {
      waQrReceivedAtRef.current = Date.now();
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

  // STEP 1 diagnostics: reads back the QR <img> DOM node at the exact moment
  // React (re)renders it after a waQr state change — the "rendered <img> src
  // length/hash at render time" the investigation asked for.
  useEffect(() => {
    const imgEl = waImgRef.current;
    if (imgEl) {
      console.log(
        `[wa-qr][render] img observed after waQr change: srcLen=${imgEl.src.length} srcHash=${qrDataChecksum(imgEl.src)} (waQr state len=${(waQr ?? '').length})`
      );
    } else {
      console.log(
        `[wa-qr][render] img ABSENT after waQr change (waQr=${waQr ? `len ${waQr.length}` : 'null'} → placeholder/"Confirming..." shown)`
      );
    }
  }, [waQr]);

  const handleConnect = async (name: "gmail" | "whatsapp") => {
    if (name === "gmail") {
      window.location.href = "http://localhost:3000/auth/google";
      return;
    }

    // Open the readiness screen before starting the Baileys connection.
    setWaModalOpen(true);
    setWaPairingMode(true);
    setWaPairingCode(null);
    setWaReadyGate(false);
    setWaScanning(false);
    setWaReconnecting(null);
    setWaQr(null);
    setWaConfirming(false);
    waQrCountRef.current =  0;
    waAcknowledgedQrGenerationRef.current = null;
    setWaQrCount(0);
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
      waPollStoppedRef.current = false;
      const pollPairingStatus = async () => {
        if (waPollStoppedRef.current || waPollSessionRef.current !== pollSession) return;
        try {
          const state = await getWhatsAppQr();
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
      setWaQr(null);
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

  // Start the Baileys connection. FIRST check whether the backend is resuming a
  // saved session: if valid credentials exist on disk there is NO QR — Baileys
  // auto-reconnects with them, so the UI shows a "Reconnecting…" state instead of
  // ever implying a QR-scan is coming. The QR modal/image only appears when the
  // backend actually returns a fresh QR (meaning no valid saved session existed).
  const handleWhatsAppConnect = async () => {
    const pollSession = waPollSessionRef.current + 1;
    waPollSessionRef.current = pollSession;
    waPollStoppedRef.current = false;
    try {
      stopWaPolling();
      waPollStoppedRef.current = false;
      waPollSessionRef.current = pollSession;
      setWaModalOpen(true);
      // The user is ready, so the backend connection and QR timer may start.
      setWaReadyGate(false);
      setWaScanning(true);
      setWaReconnecting(null);
      setWaQr(null);
      setWaConfirming(false);
      waQrCountRef.current = 0;
      waAcknowledgedQrGenerationRef.current = null;
      setWaQrCount(0);
      setMessage(null);

      await connectWhatsApp();

      const finishConnected = async () => {
        stopWaPolling();
        setWaModalOpen(false);
        setWaQr(null);
        setWaScanning(false);
        setWaConfirming(false);
        setWaReconnecting(null);
        setMessage("WhatsApp connected successfully.");
        await loadStatus();
      };

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
                  onClick={() => handleConnect("gmail")}
                  className="text-sm font-medium text-[#0f0f0f] bg-[#c7d2fe] hover:bg-[#a5b4fc] px-4 py-2 rounded-lg transition-colors"
                >
                  {status.gmail ? "Reconnect" : "Connect"}
                </button>
                {status.gmail && (
                  <button
                    onClick={() => handleDisconnect("gmail")}
                    className="text-sm font-medium text-red-400 bg-[#1a1a1a] hover:bg-red-950/50 border border-red-900/50 px-4 py-2 rounded-lg transition-colors"
                  >
                    Disconnect
                  </button>
                )}
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
                  onClick={() => handleConnect("whatsapp")}
                  className="text-sm font-medium text-[#0f0f0f] bg-[#c7d2fe] hover:bg-[#a5b4fc] px-4 py-2 rounded-lg transition-colors"
                >
                  Connect
                </button>
                {status.whatsapp && (
                  <button
                    onClick={() => handleDisconnect("whatsapp")}
                    className="text-sm font-medium text-red-400 bg-[#1a1a1a] hover:bg-red-950/50 border border-red-900/50 px-4 py-2 rounded-lg transition-colors"
                  >
                    Disconnect
                  </button>
                )}
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
                  Sign out of SignalStream. Your Google &amp; WhatsApp connections
                  are revoked and you&apos;ll return to the sign-in screen.
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
                  Once you delete your account, there is no going back. Please be
                  certain.
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
                {waReconnecting ? "Reconnecting WhatsApp" : "Link your WhatsApp"}
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
                waPairingCode
                  ? "On your phone, open WhatsApp > Settings > Linked Devices > Link a Device > Link with phone number instead, and enter this code."
                  : "Enter your WhatsApp phone number with country code to receive a pairing code."
              ) : waReadyGate ? (
                "On your phone, open WhatsApp > Settings > Linked Devices > Link a Device, and get your camera ready to scan."
              ) : waReconnecting ? (
                "A saved WhatsApp session was found. Reconnecting automatically using it — no QR scan is needed. This usually completes in a few seconds."
              ) : (
                <>
                  Open WhatsApp on your phone → Settings → Linked devices → Link a
                  device, then scan the QR code below. If your phone asks you to
                  confirm linking, tap <span className="text-white">Continue</span>.
                  Keep this window open while WhatsApp completes the pairing.
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
                        Enter this 8-character code on your phone. Keep this window open while WhatsApp completes the pairing.
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
                    <form onSubmit={handlePairingCodeRequest} className="flex flex-col gap-3 py-5">
                      <label htmlFor="whatsapp-phone" className="text-sm font-medium text-gray-300">
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
                        Use the exact number registered on WhatsApp, including country code, with no +, spaces, or leading trunk zero.
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
                  <button
                    type="button"
                    onClick={() => {
                      setWaPairingMode(false);
                      setWaPairingCode(null);
                      setWaReadyGate(true);
                    }}
                    className="w-full text-sm text-teal-300 hover:text-teal-200 underline underline-offset-4"
                  >
                    Scan QR code instead
                  </button>
                </div>
              ) : waReadyGate ? (
                <div className="h-56 w-full flex flex-col items-center justify-center gap-3">
                  <MessageSquare className="w-10 h-10 text-teal-400" />
                  <span className="text-gray-300 text-sm font-medium text-center max-w-xs">
                    Get your phone's camera ready — the QR code will appear the moment
                    you continue.
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
                  {!waReconnecting && (waQrCount >=  3 || waQrCountRef.current >=  3) && (
                    <p className="mt-3 text-xs text-amber-400/80 text-center">
                      Tip: make sure your phone's camera is well lit and steady, and try scanning
                      as soon as a new code appears.
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
              ...(profile.avatar !== undefined ? { avatar: profile.avatar } : {}),
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
