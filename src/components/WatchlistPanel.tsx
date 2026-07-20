import { MoreVertical, Plus } from 'lucide-react';
import { mockWatchlist } from '../mockData';

export function WatchlistPanel() {
  return (
    <div className="bg-[#111] border border-[#222] rounded-xl p-4 mb-5">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-white font-semibold text-lg">Watchlist</h3>
        <span className="bg-[#222] text-gray-300 text-xs font-medium px-2.5 py-1 rounded-md">
          12 Active
        </span>
      </div>

      <div className="space-y-0">
        {mockWatchlist.map((entry, index) => (
          <div key={entry.id}>
            <div className="flex justify-between items-center py-3 group">
              <div>
                <div className="text-gray-200 font-medium text-[15px]">{entry.keyword}</div>
                <div className="text-gray-500 text-xs mt-0.5">{entry.platforms}</div>
              </div>
              <button className="text-gray-600 hover:text-gray-300 p-1 rounded transition-colors opacity-0 group-hover:opacity-100">
                <MoreVertical className="w-4 h-4" />
              </button>
            </div>
            {index < mockWatchlist.length - 1 && (
              <div className="h-px bg-[#222] w-full" />
            )}
          </div>
        ))}
      </div>

      <button className="w-full mt-4 flex items-center justify-center py-2.5 border border-dashed border-[#333] hover:border-gray-500 text-gray-400 hover:text-gray-200 text-sm font-medium rounded-lg transition-colors">
        <Plus className="w-4 h-4 mr-2" />
        Add New Signal
      </button>
    </div>
  );
}
