import { useEffect, useState } from "react";
import { MoreVertical, Plus } from "lucide-react";
import { getSignals, type Signal } from "../lib/api";

export function WatchlistPanel() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSignals() {
      try {
        setLoading(true);
        const data = await getSignals();
        setSignals(data);
      } catch (err) {
        console.error("Failed to load signals for panel", err);
      } finally {
        setLoading(false);
      }
    }

    loadSignals();
    // Refresh every 30 seconds
    const interval = setInterval(loadSignals, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-[#111] border border-[#222] rounded-xl p-4 mb-5">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-white font-semibold text-lg">Watchlist</h3>
        <span className="bg-[#222] text-gray-300 text-xs font-medium px-2.5 py-1 rounded-md">
          {loading ? "..." : `${signals.length} Active`}
        </span>
      </div>

      <div className="space-y-0">
        {loading ? (
          <div className="py-3 text-sm text-gray-500">Loading signals...</div>
        ) : signals.length === 0 ? (
          <div className="py-3 text-sm text-gray-500">
            No signals yet. Add one in the Watchlist tab.
          </div>
        ) : (
          signals.map((signal, index) => (
            <div key={signal._id || signal.id || index}>
              <div className="flex justify-between items-center py-3 group">
                <div>
                  <div className="text-gray-200 font-medium text-[15px] truncate max-w-[200px]">
                    {signal.context}
                  </div>
                  <div className="text-gray-500 text-xs mt-0.5">
                    {signal.platform} · {signal.matchCount ?? 0} matches
                    {signal.keywords && signal.keywords.length > 0 && (
                      <span className="ml-1.5 text-indigo-400">
                        · {signal.keywords.length} kw
                      </span>
                    )}
                  </div>
                </div>
                <button className="text-gray-600 hover:text-gray-300 p-1 rounded transition-colors opacity-0 group-hover:opacity-100">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
              {index < signals.length - 1 && (
                <div className="h-px bg-[#222] w-full" />
              )}
            </div>
          ))
        )}
      </div>

      <button className="w-full mt-4 flex items-center justify-center py-2.5 border border-dashed border-[#333] hover:border-gray-500 text-gray-400 hover:text-gray-200 text-sm font-medium rounded-lg transition-colors">
        <Plus className="w-4 h-4 mr-2" />
        Add New Signal
      </button>
    </div>
  );
}
