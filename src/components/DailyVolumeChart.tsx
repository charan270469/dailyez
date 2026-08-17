// Small bar-chart panel showing per-day message volume (demo data) in the right sidebar.
import { TrendingUp } from 'lucide-react';
import { chartData } from '../mockData';

export function DailyVolumeChart({ showTrend = false }: { showTrend?: boolean }) {
  return (
    <div className="mt-12 bg-[#111] border border-[#222] rounded-xl p-4">
      <div className="flex items-center mb-6">
        <h3 className="text-white font-semibold text-lg">Daily Volume</h3>
        {showTrend && <span className="text-[10px] text-indigo-400 font-bold tracking-wider ml-3 uppercase">Last 7 Days</span>}
      </div>
      
      <div className="flex items-end justify-between h-32 px-2 space-x-2">
        {chartData.map((data, index) => (
          <div key={index} className="flex flex-col items-center flex-1">
            <div className="w-full h-full flex items-end justify-center">
              <div 
                className={`w-full rounded-t-sm transition-colors ${
                  data.active 
                    ? 'bg-indigo-300 shadow-[0_0_15px_rgba(165,180,252,0.3)]' 
                    : 'bg-[#333] hover:bg-[#444]'
                }`}
                style={{ height: `${data.value}%` }}
              ></div>
            </div>
            <span className="text-[10px] font-semibold text-gray-500 mt-3 tracking-wider">{data.day}</span>
          </div>
        ))}
      </div>

      {showTrend && (
        <div className="mt-5 pt-4 border-t border-[#222] flex items-center text-xs text-gray-400">
          <TrendingUp className="w-3.5 h-3.5 text-green-400 mr-2" />
          <span className="font-medium text-gray-300">12% Increase from last week</span>
        </div>
      )}
    </div>
  );
}
