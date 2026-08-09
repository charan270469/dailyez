import { useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { getAuthStatus } from '../lib/api';

export function ConnectedPlatforms() {
  const [status, setStatus] = useState({ gmail: false, whatsapp: false, discord: false });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadStatus() {
      try {
        setLoading(true);
        const result = await getAuthStatus();
        if (mounted) {
          setStatus({
            gmail: result.gmail,
            whatsapp: result.whatsapp,
            discord: result.discord,
          });
          setError(null);
        }
      } catch (err) {
        console.error(err);
        if (mounted) {
          setError('Unable to fetch connection status');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadStatus();
    return () => {
      mounted = false;
    };
  }, []);

  const platforms = [
    { name: 'Gmail', connected: status.gmail },
    { name: 'WhatsApp', connected: status.whatsapp },
    { name: 'Discord', connected: status.discord },
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
          <div key={p.name} className="flex items-center justify-between bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-2.5 px-3">
            <div className="flex items-center">
              <div className={`w-1.5 h-1.5 rounded-full mr-3 ${p.connected ? 'bg-green-500' : 'bg-gray-500'}`}></div>
              <span className="text-[13px] font-semibold text-white">{p.name}</span>
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded tracking-wider uppercase ${p.connected ? 'text-green-500 bg-green-500/10' : 'text-gray-400 bg-gray-500/10'}`}>
              {loading ? 'Checking' : p.connected ? 'Connected' : 'Not connected'}
            </span>
          </div>
        ))}
      </div>

      {error && <p className="text-[11px] text-red-400 mb-3">{error}</p>}

      <button className="w-full text-xs font-semibold text-white border border-[#333] hover:bg-[#1a1a1a] rounded-lg py-2.5 transition-colors">
        Manage Connections
      </button>
    </div>
  );
}
