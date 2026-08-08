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
  Mail,
} from "lucide-react";
import { getInboxMessages, getSignals } from "../lib/api";

// ─── Analytics helpers — all derived from the real API data ───

const DAY_MS = 24 * 60 * 60 * 1000;

const PLATFORM_COLORS: Record<string, string> = {
  gmail: "#10b981", // emerald-500
  discord: "#6366f1", // indigo-500
  whatsapp: "#ef4444", // red-500
  slack: "#f59e0b", // amber-500
  system: "#a855f7", // purple-500
  default: "#6b7280", // gray-500
};

function pctChange(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function msgTime(msg: any): number {
  const t = msg?.timestamp;
  return t ? new Date(t).getTime() : 0;
}

function isMatched(msg: any): boolean {
  return msg?.matched === true || msg?.keywordMatched === true;
}

/**
 * Signal Volume — split the last 30 days into 7 equal buckets and count how
 * many incoming messages landed in each bucket.
 */
function buildSignalVolumeData(messages: any[]) {
  const now = Date.now();
  const span = 30 * DAY_MS;
  const start = now - span;
  const bucketMs = span / 7;
  const counts = new Array(7).fill(0);

  for (const m of messages) {
    const t = msgTime(m);
    if (!t || t < start || t > now) continue;
    const idx = Math.min(6, Math.floor((t - start) / bucketMs));
    counts[idx]++;
  }

  return counts.map((value, i) => {
    const d = new Date(start + (i + 0.5) * bucketMs);
    const day = d.getDate();
    const mon = d.toLocaleString("en", { month: "short" }).toUpperCase();
    return { day: `${day} ${mon}`, value };
  });
}

/** Platform Distribution — count messages per platform, largest first. */
function buildPlatformData(messages: any[]) {
  const counts: Record<string, number> = {};
  for (const m of messages) {
    const name = String(m?.platform || m?.source || "gmail").toLowerCase();
    counts[name] = (counts[name] || 0) + 1;
  }
  const data = Object.entries(counts)
    .map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value,
      color: PLATFORM_COLORS[name] || PLATFORM_COLORS.default,
    }))
    .sort((a, b) => b.value - a.value);
  return { data, total: messages.length, top: data[0]?.name || "—" };
}

/**
 * Top Performing Signals — rank signals by cumulative real match count, with a
 * 24h match count and a week-over-week-in-24h-window trend for the table.
 */
function buildTopSignals(signals: any[], messages: any[]) {
  const now = Date.now();
  return signals
    .map((s: any) => {
      const id = String(s._id || s.id || "");
      let cur = 0;
      let prev = 0;
      for (const m of messages) {
        const refs = m?.signalMatches || [];
        const hit = refs.some(
          (r: any) => r && String(r.matchedSignalId || "") === id
        );
        if (!hit) continue;
        const t = msgTime(m);
        if (t >= now - DAY_MS) cur++;
        else if (t >= now - 2 * DAY_MS) prev++;
      }
      const platform = String(s.platform || "gmail").toLowerCase();
      return {
        id,
        name: s.context || s.keywords?.[0] || "Untitled signal",
        platform: platform.charAt(0).toUpperCase() + platform.slice(1),
        matches: cur,
        trend: pctChange(cur, prev),
        matchCount: s.matchCount ?? 0,
      };
    })
    .sort((a, b) => b.matchCount - a.matchCount || b.matches - a.matches)
    .slice(0, 6);
}

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
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [analytics, setAnalytics] = useState({
    totalSignals: 0,
    totalMessages: 0,
    matched24h: 0,
    signalsDelta: 0, // +N this week
    matchesDelta: 0, // % trend, last 24h vs prior 24h
    messagesDelta: 0, // % trend, messages this week vs prior week
    mostActivePlatform: "—",
    platformTotal: 0,
    signalVolumeData: [] as { day: string; value: number }[],
    platformData: [] as { name: string; value: number; color: string }[],
    topSignals: [] as {
      id: string;
      name: string;
      platform: string;
      matches: number;
      trend: number;
      matchCount: number;
    }[],
  });

  useEffect(() => {
    async function loadData() {
      try {
        const [messages, signals] = await Promise.all([
          getInboxMessages(),
          getSignals(),
        ]);

        const now = Date.now();
        const matched = messages.filter(isMatched);

        // TOTAL SIGNALS — delta: signals created this week vs last week
        const sigTime = (s: any) =>
          s?.createdAt ? new Date(s.createdAt).getTime() : 0;
        const sigThisWeek = signals.filter(
          (s) => sigTime(s) >= now - 7 * DAY_MS
        ).length;
        const sigLastWeek = signals.filter((s) => {
          const t = sigTime(s);
          return t >= now - 14 * DAY_MS && t < now - 7 * DAY_MS;
        }).length;

        // TOTAL MATCHES (24H) — matched messages in last 24h vs prior 24h
        const matched24h = matched.filter((m) => {
          const t = msgTime(m);
          return t >= now - DAY_MS;
        }).length;
        const matchedPrev24h = matched.filter((m) => {
          const t = msgTime(m);
          return t >= now - 2 * DAY_MS && t < now - DAY_MS;
        }).length;

        // TOTAL MESSAGES — arrival trend this week vs prior week
        const msgThisWeek = messages.filter(
          (m) => msgTime(m) >= now - 7 * DAY_MS
        ).length;
        const msgLastWeek = messages.filter((m) => {
          const t = msgTime(m);
          return t >= now - 14 * DAY_MS && t < now - 7 * DAY_MS;
        }).length;

        const platform = buildPlatformData(messages);

        setLastUpdated(new Date().toLocaleTimeString());
        setAnalytics({
          totalSignals: signals.length,
          totalMessages: messages.length,
          matched24h,
          signalsDelta: sigThisWeek - sigLastWeek,
          matchesDelta: pctChange(matched24h, matchedPrev24h),
          messagesDelta: pctChange(msgThisWeek, msgLastWeek),
          mostActivePlatform: platform.top,
          platformTotal: platform.total,
          signalVolumeData: buildSignalVolumeData(messages),
          platformData: platform.data,
          topSignals: buildTopSignals(signals, messages),
        });
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
          Insights and trends across your {analytics.totalSignals} active signals
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
              {analytics.totalSignals}
            </span>
            <span className={`text-sm font-medium ${analytics.signalsDelta >= 0 ? "text-emerald-500" : "text-red-500"}`}>
              {analytics.signalsDelta >= 0 ? "+" : ""}
              {analytics.signalsDelta} this week
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
              {analytics.matched24h.toLocaleString()}
            </span>
            <span className={`text-sm font-medium flex items-center ${analytics.matchesDelta < 0 ? "text-red-500" : "text-emerald-500"}`}>
              {analytics.matchesDelta >= 0 ? (
                <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" />
              ) : (
                <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />
              )}
              {Math.abs(analytics.matchesDelta)}%
            </span>
          </div>
        </div>
        <div className="bg-[#161616] border border-[#2a2a2a] rounded-xl p-5 flex flex-col justify-between">
          <span className="text-[11px] font-bold tracking-widest text-gray-400 uppercase mb-4 flex items-center">
            <Mail className="w-3.5 h-3.5 mr-2 text-gray-500" /> TOTAL MESSAGES
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-bold text-white">
              {analytics.totalMessages.toLocaleString()}
            </span>
            <span className={`text-sm font-medium flex items-center ${analytics.messagesDelta < 0 ? "text-red-500" : "text-emerald-500"}`}>
              {analytics.messagesDelta >= 0 ? (
                <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" />
              ) : (
                <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />
              )}
              {Math.abs(analytics.messagesDelta)}%
            </span>
          </div>
        </div>
        <div className="bg-[#161616] border border-[#2a2a2a] rounded-xl p-5 flex flex-col justify-between">
          <span className="text-[11px] font-bold tracking-widest text-gray-400 uppercase mb-4 flex items-center">
            <span className="mr-2 text-gray-500">💬</span> MOST ACTIVE PLATFORM
          </span>
          <div className="flex items-center justify-between">
            <span className="text-3xl font-bold text-white">
              {analytics.mostActivePlatform}
            </span>
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
                data={analytics.signalVolumeData}
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
                  data={analytics.platformData}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={90}
                  paddingAngle={0}
                  dataKey="value"
                  stroke="none"
                >
                  {analytics.platformData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none flex-col">
              <span className="text-2xl font-bold text-white">
                {analytics.platformTotal.toLocaleString()}
              </span>
              <span className="text-[10px] font-bold tracking-wider text-gray-500 mt-1 uppercase">
                Total Hits
              </span>
            </div>
          </div>
          <div className="flex justify-between mt-6 px-4">
            {analytics.platformData.map((p) => (
              <div key={p.name} className="flex flex-col items-center">
                <div
                  className="w-2 h-2 rounded-full mb-2"
                  style={{ backgroundColor: p.color }}
                ></div>
                <span className="text-[11px] text-gray-400 mb-1">{p.name}</span>
                <span className="text-sm font-bold text-white">
                  {analytics.platformTotal > 0
                    ? Math.round((p.value / analytics.platformTotal) * 100)
                    : 0}
                  %
                </span>
              </div>
            ))}
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
              {analytics.topSignals.map((s) => (
                <tr key={s.id} className="hover:bg-[#1a1a1a] transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="w-8 h-8 rounded-lg bg-indigo-950/40 border border-indigo-900/50 flex items-center justify-center mr-3 text-indigo-400">
                        <Megaphone className="w-4 h-4" />
                      </div>
                      <span className="font-semibold text-gray-200">
                        {s.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="bg-[#222] border border-[#333] text-gray-400 text-[11px] font-semibold px-2.5 py-1 rounded">
                      {s.platform}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-300">
                    {s.matches}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <span
                      className={`flex items-center justify-end text-sm font-medium ${
                        s.trend >= 0 ? "text-emerald-500" : "text-red-500"
                      }`}
                    >
                      {s.trend >= 0 ? (
                        <TrendingUp className="w-3.5 h-3.5 mr-1" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5 mr-1" />
                      )}
                      {Math.abs(s.trend)}%
                    </span>
                  </td>
                </tr>
              ))}
              {analytics.topSignals.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-8 text-center text-gray-500 text-sm"
                  >
                    No signals yet — add one from the Signals tab to see
                    performance here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
