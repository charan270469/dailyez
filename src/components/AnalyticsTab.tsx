import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
  AreaChart,
  Area,
} from "recharts";
import {
  Diamond,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Megaphone,
  User,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { getInboxMessages, getWatchlist } from "../lib/api";

const signalVolumeData = [
  { day: "1 OCT", value: 300 },
  { day: "5 OCT", value: 450 },
  { day: "10 OCT", value: 400 },
  { day: "15 OCT", value: 600 },
  { day: "20 OCT", value: 1200 },
  { day: "25 OCT", value: 400 },
  { day: "30 OCT", value: 900 },
];

const platformData = [
  { name: "Discord", value: 48, color: "#6366f1" }, // indigo-500
  { name: "Gmail", value: 32, color: "#10b981" }, // emerald-500
  { name: "WhatsApp", value: 20, color: "#ef4444" }, // red-500
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#1a1a1a] border border-[#333] p-3 rounded-lg shadow-xl">
        <p className="text-gray-300 font-medium mb-2">{label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center space-x-2 text-sm">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: entry.color || entry.stroke }}
            />
            <span className="text-gray-400">{entry.name}:</span>
            <span className="text-white font-medium">{entry.value}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export function AnalyticsTab() {
  const [totalSignals, setTotalSignals] = useState(0);
  const [totalMessages, setTotalMessages] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  useEffect(() => {
    async function loadData() {
      try {
        const [messages, watchlist] = await Promise.all([
          getInboxMessages(),
          getWatchlist(),
        ]);
        setTotalMessages(messages.length);
        setTotalSignals(watchlist.length);
        setLastUpdated(new Date().toLocaleTimeString());
      } catch (err) {
        console.error("Failed to load analytics data", err);
      }
    }

    loadData();
    // Realtime polling every 30 seconds
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar pb-10">
      <div className="mb-8 shrink-0">
        <h2 className="text-[28px] font-bold text-white mb-1.5 tracking-tight">
          Analytics
        </h2>
        <p className="text-gray-400 text-sm">
          Insights and trends across your {totalSignals} active signals
          {lastUpdated && (
            <span className="ml-2 text-gray-500">
              · Last updated {lastUpdated}
            </span>
          )}
        </p>
      </div>

      {/* TOP ROW */}
      <div className="grid grid-cols-4 gap-6 mb-6">
        <div className="bg-[#161616] border border-[#2a2a2a] rounded-xl p-5 flex flex-col justify-between">
          <span className="text-[11px] font-bold tracking-widest text-gray-400 uppercase mb-4 flex items-center">
            <span className="mr-2 text-gray-500">((•))</span> TOTAL SIGNALS
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-bold text-white">
              {totalSignals}
            </span>
            <span className="text-emerald-500 text-sm font-medium">
              +2 this week
            </span>
          </div>
        </div>
        <div className="bg-[#161616] border border-[#2a2a2a] rounded-xl p-5 flex flex-col justify-between">
          <span className="text-[11px] font-bold tracking-widest text-gray-400 uppercase mb-4 flex items-center">
            <TrendingUp className="w-3.5 h-3.5 mr-2 text-gray-500" /> TOTAL
            MATCHES (24H)
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-bold text-white">
              {totalMessages.toLocaleString()}
            </span>
            <span className="text-emerald-500 text-sm font-medium flex items-center">
              <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> 12%
            </span>
          </div>
        </div>
        <div className="bg-[#161616] border border-[#2a2a2a] rounded-xl p-5 flex flex-col justify-between">
          <span className="text-[11px] font-bold tracking-widest text-gray-400 uppercase mb-4 flex items-center">
            <span className="mr-2 text-gray-500">⏱</span> AVG. RESPONSE TIME
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-bold text-white">
              4.2 <span className="text-xl text-gray-500 font-medium">min</span>
            </span>
            <span className="text-emerald-500 text-sm font-medium flex items-center">
              <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" /> 0.8m
            </span>
          </div>
        </div>
        <div className="bg-[#161616] border border-[#2a2a2a] rounded-xl p-5 flex flex-col justify-between">
          <span className="text-[11px] font-bold tracking-widest text-gray-400 uppercase mb-4 flex items-center">
            <span className="mr-2 text-gray-500">💬</span> MOST ACTIVE PLATFORM
          </span>
          <div className="flex items-center justify-between">
            <span className="text-3xl font-bold text-white">Discord</span>
            <div className="w-8 h-8 rounded-full bg-indigo-500/10 flex items-center justify-center">
              <Diamond className="w-4 h-4 text-indigo-400" />
            </div>
          </div>
        </div>
      </div>

      {/* SECOND ROW */}
      <div className="grid grid-cols-3 gap-6 mb-6">
        <div className="col-span-2 bg-[#161616] border border-[#2a2a2a] rounded-xl p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-white font-semibold text-lg">Signal Volume</h3>
            <div className="flex items-center space-x-2 text-xs font-semibold bg-[#111] border border-[#2a2a2a] p-1 rounded-lg">
              <button className="px-3 py-1.5 text-gray-400 rounded-md">
                7D
              </button>
              <button className="px-3 py-1.5 text-indigo-400 bg-indigo-500/10 rounded-md">
                30D
              </button>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={signalVolumeData}
                margin={{ top: 10, right: 0, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#666", fontSize: 10, fontWeight: 600 }}
                  dy={10}
                />
                <Tooltip
                  content={<CustomTooltip />}
                  cursor={{
                    stroke: "#333",
                    strokeWidth: 1,
                    strokeDasharray: "4 4",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#6366f1"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorValue)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-[#161616] border border-[#2a2a2a] rounded-xl p-6 flex flex-col">
          <h3 className="text-white font-semibold text-lg mb-6">
            Platform Distribution
          </h3>
          <div className="h-48 relative flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={platformData}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={90}
                  paddingAngle={0}
                  dataKey="value"
                  stroke="none"
                >
                  {platformData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none flex-col">
              <span className="text-2xl font-bold text-white">1.4k</span>
              <span className="text-[10px] font-bold tracking-wider text-gray-500 mt-1 uppercase">
                Total Hits
              </span>
            </div>
          </div>
          <div className="flex justify-between mt-6 px-4">
            <div className="flex flex-col items-center">
              <div className="w-2 h-2 rounded-full bg-indigo-500 mb-2"></div>
              <span className="text-[11px] text-gray-400 mb-1">Discord</span>
              <span className="text-sm font-bold text-white">48%</span>
            </div>
            <div className="flex flex-col items-center">
              <div className="w-2 h-2 rounded-full bg-emerald-500 mb-2"></div>
              <span className="text-[11px] text-gray-400 mb-1">Gmail</span>
              <span className="text-sm font-bold text-white">32%</span>
            </div>
            <div className="flex flex-col items-center">
              <div className="w-2 h-2 rounded-full bg-red-500 mb-2"></div>
              <span className="text-[11px] text-gray-400 mb-1">WhatsApp</span>
              <span className="text-sm font-bold text-white">20%</span>
            </div>
          </div>
        </div>
      </div>

      {/* THIRD ROW - Top Performing Signals Table */}
      <div className="bg-[#161616] border border-[#2a2a2a] rounded-xl overflow-hidden">
        <div className="flex justify-between items-center p-6 border-b border-[#2a2a2a]">
          <h3 className="text-white font-semibold text-lg">
            Top Performing Signals
          </h3>
          <button className="text-sm font-medium text-indigo-400 hover:text-indigo-300 flex items-center transition-colors">
            View Detailed Report <ChevronRight className="w-4 h-4 ml-1" />
          </button>
        </div>
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead className="bg-[#161616]">
              <tr className="border-b border-[#2a2a2a] text-[11px] font-bold text-gray-500 tracking-wider uppercase">
                <th className="px-6 py-4">KEYWORD/CONTACT</th>
                <th className="px-6 py-4">PLATFORM</th>
                <th className="px-6 py-4">MATCHES (24H)</th>
                <th className="px-6 py-4 text-right">TREND</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a2a2a]">
              <tr className="hover:bg-[#1a1a1a] transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="w-8 h-8 rounded-lg bg-indigo-950/40 border border-indigo-900/50 flex items-center justify-center mr-3 text-indigo-400">
                      <Megaphone className="w-4 h-4" />
                    </div>
                    <span className="font-semibold text-gray-200">
                      Project Alpha
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="bg-[#222] border border-[#333] text-gray-400 text-[11px] font-semibold px-2.5 py-1 rounded">
                    Discord
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-gray-300">
                  412
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <span className="flex items-center justify-end text-emerald-500 text-sm font-medium">
                    <TrendingUp className="w-3.5 h-3.5 mr-1" /> 14%
                  </span>
                </td>
              </tr>
              <tr className="hover:bg-[#1a1a1a] transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="w-8 h-8 rounded-lg bg-gray-800/50 border border-gray-700/50 flex items-center justify-center mr-3 text-gray-400">
                      <User className="w-4 h-4" />
                    </div>
                    <span className="font-semibold text-gray-200">
                      CEO Office
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="bg-[#222] border border-[#333] text-gray-400 text-[11px] font-semibold px-2.5 py-1 rounded">
                    Gmail
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-gray-300">
                  24
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <span className="flex items-center justify-end text-emerald-500 text-sm font-medium">
                    <TrendingUp className="w-3.5 h-3.5 mr-1" /> 8%
                  </span>
                </td>
              </tr>
              <tr className="hover:bg-[#1a1a1a] transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="w-8 h-8 rounded-lg bg-red-950/40 border border-red-900/50 flex items-center justify-center mr-3 text-red-500">
                      <AlertCircle className="w-4 h-4" />
                    </div>
                    <span className="font-semibold text-gray-200">
                      Urgent Fix
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="bg-[#222] border border-[#333] text-gray-400 text-[11px] font-semibold px-2.5 py-1 rounded">
                    Slack
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-gray-300">
                  86
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <span className="flex items-center justify-end text-red-500 text-sm font-medium">
                    <TrendingDown className="w-3.5 h-3.5 mr-1" /> 4%
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
