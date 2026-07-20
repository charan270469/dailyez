import { Star, Plus } from 'lucide-react';

export function EmptyPriorityFeed() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-4 h-full">
      <div className="w-16 h-16 rounded-2xl bg-[#111] border border-[#222] flex items-center justify-center mb-6">
        <Star className="w-8 h-8 text-gray-600" />
      </div>
      
      <h2 className="text-xl font-bold text-white mb-2">No priority signals yet</h2>
      <p className="text-gray-400 max-w-sm mb-8 text-sm">
        Add a keyword, email, or contact to your watchlist to start monitoring.
      </p>
      
      <button className="flex items-center bg-indigo-500 hover:bg-indigo-600 text-white font-medium px-6 py-2.5 rounded-lg transition-colors">
        <Plus className="w-4 h-4 mr-2" />
        Add watchlist
      </button>
    </div>
  );
}
