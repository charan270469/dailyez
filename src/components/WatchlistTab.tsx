import { useEffect, useState, type FormEvent } from "react";
import {
  Search,
  Plus,
  MoreVertical,
  Key,
  AtSign,
  Phone,
  User,
  Contact,
  AlertCircle,
  X,
  ChevronDown,
} from "lucide-react";
import {
  addWatchlistEntry,
  deleteWatchlistEntry,
  getWatchlist,
} from "../lib/api";

interface WatchlistRow {
  _id?: string;
  id?: string;
  type: string;
  platform: string;
  value: string;
  createdAt?: string;
}

export function WatchlistTab() {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    type: "keyword",
    platform: "all",
    value: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const getIcon = (type: string) => {
    switch (type) {
      case "key":
        return (
          <div className="w-10 h-10 rounded-xl bg-indigo-950/40 border border-indigo-900/50 flex items-center justify-center text-indigo-400">
            <Key className="w-4 h-4" />
          </div>
        );
      case "at":
        return (
          <div className="w-10 h-10 rounded-xl bg-amber-950/30 border border-amber-900/40 flex items-center justify-center text-amber-500/80">
            <AtSign className="w-4 h-4" />
          </div>
        );
      case "phone":
        return (
          <div className="w-10 h-10 rounded-xl bg-green-950/30 border border-green-900/40 flex items-center justify-center text-green-500/80">
            <Phone className="w-4 h-4" />
          </div>
        );
      case "user":
        return (
          <div className="w-10 h-10 rounded-xl bg-gray-800/50 border border-gray-700/50 flex items-center justify-center text-gray-400">
            <User className="w-4 h-4" />
          </div>
        );
      case "contact":
        return (
          <div className="w-10 h-10 rounded-xl bg-rose-950/30 border border-rose-900/40 flex items-center justify-center text-rose-400">
            <Contact className="w-4 h-4" />
          </div>
        );
      case "alert":
        return (
          <div className="w-10 h-10 rounded-xl bg-red-950/40 border border-red-900/50 flex items-center justify-center text-red-500">
            <AlertCircle className="w-4 h-4" />
          </div>
        );
      default:
        return null;
    }
  };

  useEffect(() => {
    loadRows();
  }, []);

  async function loadRows() {
    try {
      setLoading(true);
      const data = await getWatchlist();
      setRows(data);
      setError(null);
    } catch (err) {
      console.error(err);
      setError("Unable to load watchlist entries");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.value.trim()) return;

    try {
      setSubmitting(true);
      await addWatchlistEntry({
        type: form.type.toLowerCase(),
        platform: form.platform.toLowerCase(),
        value: form.value.trim(),
      });
      setForm({ type: "keyword", platform: "all", value: "" });
      setIsAddModalOpen(false);
      await loadRows();
    } catch (err) {
      console.error(err);
      setError("Unable to save the new signal");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id?: string) {
    if (!id) return;
    try {
      await deleteWatchlistEntry(id);
      setActiveMenuId(null);
      await loadRows();
    } catch (err) {
      console.error(err);
      setError("Unable to delete the signal");
    }
  }

  const statusColorClass = (color: string) => {
    switch (color) {
      case "green":
        return "bg-emerald-500";
      case "red":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar pb-10">
      <div className="flex justify-between items-start mb-6 shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1.5 tracking-tight">
            Watchlist
          </h2>
          <p className="text-gray-400 text-sm">
            {loading
              ? "Loading..."
              : `${rows.length} active signal${rows.length !== 1 ? "s" : ""} across ${new Set(rows.map((r) => r.platform)).size} platform${new Set(rows.map((r) => r.platform)).size !== 1 ? "s" : ""}`}
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center text-sm font-semibold text-indigo-900 bg-indigo-200 hover:bg-indigo-300 px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4 mr-2" strokeWidth={2.5} />
          Add New Signal
        </button>
      </div>

      <div className="flex items-center justify-between mb-6 shrink-0">
        <div className="relative w-80">
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 transform -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filter active signals..."
            className="w-full bg-[#111] border border-[#2a2a2a] text-gray-300 text-sm rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        <div className="flex items-center space-x-2 text-sm">
          <span className="text-gray-500 mr-2">Quick filters:</span>
          <button className="px-3 py-1.5 rounded-full border border-[#444] bg-[#222] text-gray-200 text-xs font-medium">
            All Items
          </button>
          <button className="px-3 py-1.5 rounded-full border border-[#2a2a2a] hover:border-[#444] text-gray-400 hover:text-gray-200 text-xs font-medium transition-colors">
            Keywords
          </button>
          <button className="px-3 py-1.5 rounded-full border border-[#2a2a2a] hover:border-[#444] text-gray-400 hover:text-gray-200 text-xs font-medium transition-colors">
            Users
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      <div className="border border-[#2a2a2a] rounded-xl overflow-hidden bg-[#161616]">
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-[#161616] z-10">
              <tr className="border-b border-[#2a2a2a] text-[11px] font-semibold text-gray-500 tracking-wider uppercase">
                <th className="px-6 py-4">Signal Entry</th>
                <th className="px-6 py-4">Scope</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Recent Match</th>
                <th className="px-4 py-4 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a2a2a]">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-sm text-gray-400">
                    Loading watchlist...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-sm text-gray-400">
                    No active signals yet.
                  </td>
                </tr>
              ) : (
                rows.map((item) => {
                  const iconType =
                    item.type === "email"
                      ? "at"
                      : item.type === "phone"
                        ? "phone"
                        : item.type === "keyword"
                          ? "key"
                          : "user";
                  const displayType =
                    item.type.charAt(0).toUpperCase() + item.type.slice(1);
                  const scope =
                    item.platform === "all"
                      ? "All Platforms"
                      : item.platform.charAt(0).toUpperCase() +
                        item.platform.slice(1);
                  return (
                    <tr
                      key={item._id || item.id}
                      className="hover:bg-[#1a1a1a] transition-colors group cursor-pointer"
                    >
                      <td className="px-6 py-3.5 whitespace-nowrap">
                        <div className="flex items-center">
                          {getIcon(iconType)}
                          <div className="ml-4">
                            <div className="text-[15px] font-semibold text-gray-100">
                              {item.value}
                            </div>
                            <div className="text-[13px] text-gray-500 mt-0.5">
                              {displayType}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-3.5 whitespace-nowrap">
                        <span className="bg-[#2a2a2a] border border-[#333] text-gray-400 text-[10px] font-bold px-2.5 py-1 rounded tracking-widest uppercase">
                          {scope}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 whitespace-nowrap">
                        <div className="flex items-center text-[14px] text-gray-200">
                          <span
                            className={`w-2 h-2 rounded-full mr-2.5 ${statusColorClass("green")}`}
                          ></span>
                          Active
                        </div>
                      </td>
                      <td className="px-6 py-3.5 whitespace-nowrap text-[14px] text-gray-300">
                        {item.createdAt
                          ? new Date(item.createdAt).toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-4 py-3.5 text-right relative">
                        <button
                          onClick={() =>
                            setActiveMenuId(
                              activeMenuId === (item._id || item.id)
                                ? null
                                : (item._id || item.id)!,
                            )
                          }
                          className="p-1 text-gray-500 hover:text-white rounded-lg transition-colors"
                        >
                          <MoreVertical className="w-5 h-5" />
                        </button>
                        {activeMenuId === (item._id || item.id) && (
                          <div className="absolute right-4 top-10 z-20 bg-[#1a1a1a] border border-[#333] rounded-lg shadow-lg py-1 min-w-[120px]">
                            <button
                              onClick={() => handleDelete(item._id || item.id)}
                              className="block w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-[#222]"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer */}
        <div className="px-6 py-4 border-t border-[#2a2a2a] bg-[#111] flex items-center justify-between shrink-0">
          <div className="flex items-center text-sm text-gray-400 space-x-6">
            <span>
              Showing {rows.length} entr{rows.length !== 1 ? "ies" : "y"}
            </span>
            <div className="w-px h-4 bg-[#333]"></div>
            <div className="flex items-center text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
              System syncing...
            </div>
          </div>

          <div className="flex items-center space-x-2 text-sm">
            <button className="px-3 py-1.5 border border-[#333] text-gray-400 rounded hover:bg-[#222] hover:text-gray-200 transition-colors">
              Previous
            </button>
            <button className="px-3 py-1.5 border border-[#444] bg-[#2a2a2a] text-gray-200 rounded">
              1
            </button>
            <button className="px-3 py-1.5 border border-[#333] text-gray-400 rounded hover:bg-[#222] hover:text-gray-200 transition-colors">
              2
            </button>
            <button className="px-3 py-1.5 border border-[#333] text-gray-400 rounded hover:bg-[#222] hover:text-gray-200 transition-colors">
              Next
            </button>
          </div>
        </div>
      </div>

      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#1a1a1a] border border-[#333] rounded-xl w-full max-w-[440px] overflow-hidden shadow-2xl">
            <div className="flex justify-between items-center p-5 border-b border-[#333]">
              <h3 className="text-white font-semibold text-lg">
                Add New Signal
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-6">
              <div>
                <label className="block text-xs font-semibold text-gray-400 tracking-wider mb-2.5">
                  SIGNAL TYPE
                </label>
                <div className="relative">
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="w-full bg-[#111] border border-[#333] text-white rounded-lg px-4 py-3 appearance-none focus:outline-none focus:border-indigo-500 font-medium"
                  >
                    <option value="email">Email</option>
                    <option value="keyword">Keyword</option>
                    <option value="name">Name</option>
                    <option value="phone">Phone</option>
                    <option value="username">Username</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-gray-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 tracking-wider mb-2.5">
                  PLATFORM
                </label>
                <div className="relative">
                  <select
                    value={form.platform}
                    onChange={(e) =>
                      setForm({ ...form, platform: e.target.value })
                    }
                    className="w-full bg-[#111] border border-[#333] text-white rounded-lg px-4 py-3 appearance-none focus:outline-none focus:border-indigo-500 font-medium"
                  >
                    <option value="all">All Platforms</option>
                    <option value="gmail">Gmail</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="discord">Discord</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-gray-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 tracking-wider mb-2.5">
                  VALUE
                </label>
                <input
                  type="text"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                  placeholder="e.g. hello@example.com or @handle"
                  className="w-full bg-[#111] border border-[#333] text-white rounded-lg px-4 py-3 focus:outline-none focus:border-indigo-500 placeholder-gray-600"
                />
              </div>
              <div className="p-5 flex justify-end space-x-3 mt-2 -mx-5 -mb-5 border-t border-[#333] pt-4">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-5 py-2.5 text-sm font-medium text-gray-300 hover:text-white border border-[#444] rounded-lg hover:bg-[#222] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 text-sm font-semibold bg-indigo-200 text-indigo-900 rounded-lg hover:bg-indigo-300 transition-colors shadow-lg shadow-indigo-500/20 disabled:opacity-60"
                >
                  {submitting ? "Saving..." : "Save Signal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
