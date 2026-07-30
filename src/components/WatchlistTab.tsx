import { useEffect, useState, type FormEvent } from "react";
import { Search, Plus, MoreVertical, X } from "lucide-react";
import { addSignal, deleteSignal, getSignals, type Signal } from "../lib/api";

export function WatchlistTab() {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [rows, setRows] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  useEffect(() => {
    loadRows();
  }, []);

  async function loadRows() {
    try {
      setLoading(true);
      const data = await getSignals();
      setRows(data);
      setError(null);
    } catch (err) {
      console.error(err);
      setError("Unable to load signals");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!context.trim()) return;

    try {
      setSubmitting(true);
      await addSignal({ context: context.trim() });
      setContext("");
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
      await deleteSignal(id);
      setActiveMenuId(null);
      await loadRows();
    } catch (err) {
      console.error(err);
      setError("Unable to delete the signal");
    }
  }

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
              : `${rows.length} active signal${rows.length !== 1 ? "s" : ""}`}
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
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      <div className="border border-[#2a2a2a] rounded-xl overflow-hidden bg-[#161616]">
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-[#161616] z-10">
              <tr className="border-b border-[#2a2a2a] text-[11px] font-semibold text-gray-500 tracking-wider uppercase">
                <th className="px-6 py-4">Signal Context</th>
                <th className="px-6 py-4">Platform</th>
                <th className="px-6 py-4">Matches</th>
                <th className="px-6 py-4">Last Matched</th>
                <th className="px-4 py-4 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a2a2a]">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-sm text-gray-400">
                    Loading signals...
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
                  return (
                    <tr
                      key={item._id || item.id}
                      className="hover:bg-[#1a1a1a] transition-colors group cursor-pointer"
                    >
                      <td className="px-6 py-3.5">
                        <div className="text-[15px] font-semibold text-gray-100 max-w-md truncate">
                          {item.context}
                        </div>
                      </td>
                      <td className="px-6 py-3.5 whitespace-nowrap">
                        <span className="bg-[#2a2a2a] border border-[#333] text-gray-400 text-[10px] font-bold px-2.5 py-1 rounded tracking-widest uppercase">
                          {item.platform}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 whitespace-nowrap text-[14px] text-gray-300">
                        {item.matchCount ?? 0}
                      </td>
                      <td className="px-6 py-3.5 whitespace-nowrap text-[14px] text-gray-300">
                        {item.lastMatched
                          ? new Date(item.lastMatched).toLocaleString()
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
              Showing {rows.length} signal{rows.length !== 1 ? "s" : ""}
            </span>
            <div className="w-px h-4 bg-[#333]"></div>
            <div className="flex items-center text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
              LLM matching active
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
          <div className="bg-[#1a1a1a] border border-[#333] rounded-xl w-full max-w-[540px] overflow-hidden shadow-2xl">
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
                <label className="block text-sm font-semibold text-gray-300 mb-2.5">
                  What matters to you?
                </label>
                <textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder="e.g. Alert me when I receive a genuine interview invitation, not newsletters that mention interviews."
                  rows={5}
                  className="w-full bg-[#111] border border-[#333] text-white rounded-lg px-4 py-3 focus:outline-none focus:border-indigo-500 placeholder-gray-600 resize-none text-sm leading-relaxed"
                />
                <p className="text-xs text-gray-500 mt-1.5">
                  Describe what kind of messages you want to be alerted about.
                  The AI will match based on intent, not just keywords.
                </p>
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
