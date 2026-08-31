// Settings tab: shows platform connection status, drives the Gmail and WhatsApp connect
// flows (QR scan), and hosts profile editing plus notifications/account placeholders.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Mail,
  MessageSquare,
  Users,
  ChevronDown,
  User,
  X,
  LogOut,
} from "lucide-react";
import { connectPlatformStub, getAuthStatus, connectWhatsApp, getWhatsAppQr, disconnectPlatform, logoutUser, updateProfile } from "../lib/api";
import { EditProfileModal } from "./EditProfileModal";

export function SettingsTab() {
  const [status, setStatus] = useState({
    gmail: false,
    whatsapp: false,
    discord: false,
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
  const [waQr, setWaQr] = useState<string | null>(null);
  const [waScanning, setWaScanning] = useState(false);
  const [waQrCount, setWaQrCount] = useState(1);
  const waPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // WhatsApp reconnecting mode:
  //   true  → backend is resuming a saved session; NO QR will appear.
  //   false → fresh pairing in progress (QR-scan UI).
  //   null  → first status check hasn't returned yet (show neutral "starting").
  const [waReconnecting, setWaReconnecting] = useState<boolean | null>(null);

  const stopWaPolling = () => {
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
        discord: result.discord,
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

  const handleConnect = async (name: "gmail" | "whatsapp" | "discord") => {
    if (name === "gmail") {
      window.location.href = "http://localhost:3000/auth/google";
      return;
    }

    if (name === "whatsapp") {
      await handleWhatsAppConnect();
      return;
    }

    try {
      const result = await connectPlatformStub(name);
      setMessage(result.message);
    } catch (err) {
      console.error(err);
      setMessage("Unable to connect this platform right now.");
    }
  };

  // Disconnect a connected platform (Gmail revokes OAuth, WhatsApp logs out the
  // Baileys socket, Discord is a no-op until its integration exists).
  const handleDisconnect = async (name: "gmail" | "whatsapp" | "discord") => {
    setMessage(null);
    setError(null);
    if (name === "whatsapp") {
      stopWaPolling();
      setWaModalOpen(false);
      setWaQr(null);
      setWaReconnecting(null);
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
    try {
      stopWaPolling();
      setWaModalOpen(true);
      setWaScanning(true);
      setWaReconnecting(null);
      setWaQr(null);
      setWaQrCount(1);
      setMessage(null);

      await connectWhatsApp();

      const finishConnected = async () => {
        stopWaPolling();
        setWaModalOpen(false);
        setWaQr(null);
        setWaScanning(false);
        setWaReconnecting(null);
        setMessage("WhatsApp connected successfully.");
        await loadStatus();
      };

      // Immediate state check right after connect resolves: the backend already
      // knows whether it is resuming a saved session (status 'reconnecting') or
      // generating a fresh QR ('connecting' + qr) — pick the right UI up front
      // instead of defaulting to the QR-scanning prompt.
      const initialState = await getWhatsAppQr();

      if (initialState.connected) {
        await finishConnected();
        return;
      }
      if (initialState.qr) {
        setWaQr(initialState.qr);
        setWaScanning(false);
        setWaReconnecting(false);
        setWaQrCount(initialState.qrGeneration ?? 1);
      } else if (initialState.status === "reconnecting") {
        setWaReconnecting(true);
        setWaScanning(false);
      } else {
        // Fresh pairing / socket still coming up — QR-scanning UI.
        setWaReconnecting(false);
      }

      const pollWhatsAppState = async () => {
        try {
          const state = await getWhatsAppQr();

          if (state.connected) {
            await finishConnected();
            return;
          }

          if (state.qr) {
            setWaQr(state.qr);
            setWaScanning(false);
            setWaReconnecting(false);
            setWaQrCount(state.qrGeneration ?? 1);
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
            setWaReconnecting(true);
            setWaScanning(false);
            return;
          }

          // Still connecting without a QR yet — keep the QR-scanning UI.
          setWaReconnecting(false);
          setWaScanning(true);
        } catch (err) {
          // Transient network error — keep polling.
          setWaScanning(true);
        }
      };

      await pollWhatsAppState();
      waPollRef.current = setInterval(pollWhatsAppState, 2000);
    } catch (err) {
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
                  <p className="text-gray-400 text-sm">Not connected</p>
                </div>
              </div>
              <div className="flex items-center space-x-6">
                <div
                  className={`flex items-center text-sm font-medium ${status.whatsapp ? "text-emerald-500" : "text-gray-500"}`}
                >
                  <div
                    className={`w-2 h-2 rounded-full mr-2 ${status.whatsapp ? "bg-emerald-500" : "bg-gray-500"}`}
                  ></div>
                  {status.whatsapp ? "Connected" : "Not connected"}
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

            <div className="p-6 flex items-center justify-between">
              <div className="flex items-center">
                <div className="w-12 h-12 rounded-lg bg-indigo-950/40 border border-indigo-900/50 flex items-center justify-center mr-4">
                  <Users className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h4 className="text-white font-medium text-[15px]">
                    Discord
                  </h4>
                  <p className="text-gray-400 text-sm">
                    {status.discord ? "Connected" : "Not connected"}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-6">
                <div
                  className={`flex items-center text-sm font-medium ${status.discord ? "text-emerald-500" : "text-gray-500"}`}
                >
                  <div
                    className={`w-2 h-2 rounded-full mr-2 ${status.discord ? "bg-emerald-500" : "bg-gray-500"}`}
                  ></div>
                  {status.discord ? "Connected" : "Not connected"}
                </div>
                <button
                  onClick={() => handleConnect("discord")}
                  className="text-sm font-medium text-gray-300 bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] px-4 py-2 rounded-lg transition-colors"
                >
                  Connect
                </button>
                {status.discord && (
                  <button
                    onClick={() => handleDisconnect("discord")}
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
          <div className="bg-[#161616] border border-[#2a2a2a] rounded-2xl p-6 max-w-sm w-full">
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
              {waReconnecting ? (
                "A saved WhatsApp session was found. Reconnecting automatically using it — no QR scan is needed. This usually completes in a few seconds."
              ) : (
                <>
                  Open WhatsApp on your phone → Settings → Linked devices → Link a
                  device, then scan the QR code below. If your phone asks you to
                  confirm linking, tap <span className="text-white">Continue</span>{" "}
                  — a second QR will appear here; scan that one to finish.
                </>
              )}
            </p>
            <div className="flex flex-col items-center">
              {waReconnecting ? (
                <div className="h-56 w-full flex flex-col items-center justify-center gap-3">
                  <div className="w-9 h-9 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-gray-300 text-sm font-medium">
                    Reconnecting…
                  </span>
                </div>
              ) : !waQr ? (
                <div className="h-56 w-full flex items-center justify-center text-gray-400 text-sm">
                  {waScanning
                    ? waReconnecting === null
                      ? "Starting WhatsApp…"
                      : "Generating QR code…"
                    : waQrCount > 1
                      ? "Checking for the next QR code…"
                      : "Waiting for QR code…"}
                </div>
              ) : (
                <img
                  src={waQr}
                  alt="WhatsApp QR code"
                  className="w-56 h-56 rounded-lg bg-white p-2"
                />
              )}
              <p className="text-gray-400 text-sm mt-4 text-center">
                {waReconnecting
                  ? "Your phone will show this device as linked once reconnection completes. You can close this window in the meantime."
                  : !waQr
                    ? "Please wait a moment."
                    : waQrCount > 1
                      ? "A new QR code is ready — if your phone asked you to confirm linking, it has been done. Scan this new code to finish."
                      : "Scan this code. If your phone asks to confirm, tap Continue and a new code will appear here."}
              </p>
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
