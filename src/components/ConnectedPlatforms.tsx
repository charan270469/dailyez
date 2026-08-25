// Right-side "Connected Platforms" panel (shown in All Inbox): lists Gmail/WhatsApp/Discord
// connection status fetched from the backend auth-status endpoint.
import { useEffect, useState } from 'react';
import { MoreHorizontal, Loader2, RefreshCw } from 'lucide-react';
import { getAuthStatus, disconnectPlatform, resyncWhatsApp, getWhatsAppResyncState, type PlatformName } from '../lib/api';

export function ConnectedPlatforms() {
  const [status, setStatus] = useState({ gmail: false, whatsapp: false, discord: false });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<PlatformName | null>(null);
  const [resyncing, setResyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const result = await getAuthStatus();
      setStatus({
        gmail: result.gmail,
        whatsapp: result.whatsapp,
        discord: result.discord,
      });
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Unable to fetch connection status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    // Poll so status stays in sync with the connect/disconnect actions in Settings.
    loadStatus();
    const interval = setInterval(() => {
      if (mounted) loadStatus();
    }, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDisconnect = async (name: PlatformName) => {
    setDisconnecting(name);
    setMessage(null);
    try {
      const result = await disconnectPlatform(name);
      setMessage(result.message || `${name} disconnected`);
    } catch (err: any) {
      console.error(err);
      setMessage(err?.message || `Unable to disconnect ${name}.`);
    } finally {
      setDisconnecting(null);
      await loadStatus();
    }
  };

  const handleResync = async () => {
    setResyncing(true);
    setMessage(null);
    try {
      const result = await resyncWhatsApp();
      setMessage(
        result.resyncing
          ? 'WhatsApp resync started — waiting for history sync…'
          : 'WhatsApp resync finished.',
      );
      if (result.resyncing) {
        // Wait for the actual history sync to complete before reloading the inbox so
        // labels/messages are fresh.
        try {
          await waitForResyncComplete();
          setMessage(`WhatsApp resynced — refreshed ${result.cleared ?? 0} message(s).`);
        } catch {
          setMessage(`WhatsApp resync requested — still syncing (timed out).`);
        }
      } else {
        setMessage(`WhatsApp resync complete — refreshed ${result.cleared ?? 0} message(s).`);
      }
      // Tell the inbox to reload after the history sync has settled.
      window.dispatchEvent(new CustomEvent('whatsapp-resynced'));
    } catch (err: any) {
      console.error(err);
      setMessage(err?.message || 'Unable to resync WhatsApp.');
    } finally {
      setResyncing(false);
      await loadStatus();
    }
  };

  /** Poll the backend until a resync is no longer in its history-sync phase. */
  const waitForResyncComplete = async (timeoutMs = 180000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await getWhatsAppResyncState();
      if (!state.resyncing) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  };

  const platforms: { id: PlatformName; name: string; connected: boolean }[] = [
    { id: 'gmail', name: 'Gmail', connected: status.gmail },
    { id: 'whatsapp', name: 'WhatsApp', connected: status.whatsapp },
    { id: 'discord', name: 'Discord', connected: status.discord },
  ];

  return (
    <div className="mt-12 bg-[#111] border border-[#222] rounded-xl p-4 mb-5">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-white font-semibold text-lg">Connected Platforms</h3>
        <button className="text-gray-500 hover:text-white transition-colors">
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2.5 mb-4">
        {platforms.map(p => (
          <div key={p.id} className="flex items-center justify-between bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-2.5 px-3">
            <div className="flex items-center">
              <div className={`w-1.5 h-1.5 rounded-full mr-3 ${p.connected ? 'bg-green-500' : 'bg-gray-500'}`}></div>
              <span className="text-[13px] font-semibold text-white">{p.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded tracking-wider uppercase ${p.connected ? 'text-green-500 bg-green-500/10' : 'text-gray-400 bg-gray-500/10'}`}>
                {loading ? 'Checking' : p.connected ? 'Connected' : 'Not connected'}
              </span>
              {p.connected && p.id === 'whatsapp' && (
                <button
                  onClick={handleResync}
                  disabled={resyncing}
                  title="Delete all stored WhatsApp messages and fetch them again (applies saved contact names + group names, drops statuses)"
                  className="text-[10px] font-bold px-2 py-0.5 rounded tracking-wider uppercase text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {resyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  {resyncing ? 'Resyncing…' : 'Resync'}
                </button>
              )}
              {p.connected && (
                <button
                  onClick={() => handleDisconnect(p.id)}
                  disabled={disconnecting === p.id}
                  className="text-[10px] font-bold px-2 py-0.5 rounded tracking-wider uppercase text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {disconnecting === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  {disconnecting === p.id ? '…' : 'Disconnect'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {error && <p className="text-[11px] text-red-400 mb-3">{error}</p>}
      {message && <p className="text-[11px] text-amber-400 mb-3">{message}</p>}

      <button className="w-full text-xs font-semibold text-white border border-[#333] hover:bg-[#1a1a1a] rounded-lg py-2.5 transition-colors">
        Manage Connections
      </button>
    </div>
  );
}
