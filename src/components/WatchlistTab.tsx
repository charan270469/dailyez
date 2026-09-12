// Full-page watchlist/signals tab: lists, adds, edits, and deletes user signals
// (an alternate, full-screen view of the WatchlistPanel functionality).
import { useEffect, useState, type FormEvent } from "react";
import { Search, Plus, MoreVertical, X, Pencil } from "lucide-react";
import {
  addSignal,
  deleteSignal,
  patchSignal,
  getSignals,
  type Signal,
} from "../lib/api";

export function WatchlistTab() {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingSignal, setEditingSignal] = useState<Signal | null>(null);
  const [rows, setRows] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState("");
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [alertTarget, setAlertTarget] = useState("");
  const [alertPlatform, setAlertPlatform] = useState<"gmail" | "whatsapp">("gmail");
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

  function handleAddKeyword() {
    const trimmed = keywordInput.trim();
    if (!trimmed) return;
    if (trimmed.length > 50) return; // Max 50 chars per keyword
    // Dedupe case-insensitively
    const exists = keywords.some(
      (k) => k.toLowerCase() === trimmed.toLowerCase(),
    );
    if (exists) return;
    setKeywords((prev) => [...prev, trimmed]);
    setKeywordInput("");
  }

  function handleRemoveKeyword(keyword: string) {
    setKeywords((prev) => prev.filter((k) => k !== keyword));
  }

  function handleKeywordKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddKeyword();
    }
  }

  function openAddModal() {
    setContext("");
    setKeywords([]);
    setKeywordInput("");
    setAlertEnabled(false);
    setAlertTarget("");
    setAlertPlatform("gmail");
    setEditingSignal(null);
    setIsAddModalOpen(true);
  }

  function openEditModal(signal: Signal) {
    setEditingSignal(signal);
    setContext(signal.context || "");
    setKeywords(signal.keywords || []);
    setKeywordInput("");
    setAlertEnabled(signal.alertEnabled ?? false);
    setAlertTarget(signal.alertTarget || "");
    setAlertPlatform(signal.alertPlatform || "gmail");
    setActiveMenuId(null);
    setIsAddModalOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedAlertTarget = alertTarget.trim();
    if (!context.trim() && keywords.length === 0 && !(alertEnabled && trimmedAlertTarget)) return;

    try {
      setSubmitting(true);
      // An alert-only signal (no freeform context) gets a readable headline the
      // same way the one-click quick-alert does server-side, so the watchlist
      // row and Matched cards aren't blank.
      const effectiveContext =
        context.trim() ||
        (alertEnabled && trimmedAlertTarget
          ? `Alerts for messages from ${trimmedAlertTarget}`
          : "");
      // The edit form always sends the alert trio so an ON→OFF toggle is
      // persisted (the server keeps the target but flags it disabled).
      const alertFields = {
        alertEnabled,
        alertTarget: trimmedAlertTarget,
        alertPlatform,
      };
      if (editingSignal) {
        const id = editingSignal._id || editingSignal.id;
        if (!id) return;
        await patchSignal(id, { context: effectiveContext, keywords, ...alertFields });
      } else {
        await addSignal({
          context: effectiveContext,
          keywords,
          // New signals record the alert section only when actually used.
          ...(alertEnabled && trimmedAlertTarget ? alertFields : {}),
        });
      }
      setContext("");
      setKeywords([]);
      setKeywordInput("");
      setAlertEnabled(false);
      setAlertTarget("");
      setAlertPlatform("gmail");
      setEditingSignal(null);
      setIsAddModalOpen(false);
      await loadRows();
    } catch (err) {
      console.error(err);
      setError(
        editingSignal
          ? "Unable to save the edited signal"
          : "Unable to save the new signal",
      );
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
          onClick={openAddModal}
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
                              onClick={() => openEditModal(item)}
                              className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-[#222]"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(item._id || item.id)}
                              className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-[#222]"
                            >
                              <X className="w-3.5 h-3.5" />
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
                {editingSignal ? "Edit Signal" : "Add New Signal"}
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
                  rows={4}
                  className="w-full bg-[#111] border border-[#333] text-white rounded-lg px-4 py-3 focus:outline-none focus:border-indigo-500 placeholder-gray-600 resize-none text-sm leading-relaxed"
                />
                <p className="text-xs text-gray-500 mt-1.5">
                  Describe what kind of messages you want to be alerted about.
                  The AI will match based on intent, not just keywords.
                </p>
              </div>

              <div className="border border-dashed border-[#333] rounded-lg p-3.5 bg-[#151515]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-300">
                      Alert me{" "}
                      <span className="text-gray-500 font-normal">
                        (optional)
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Exact-match alerts for one specific sender — checked
                      instantly, no AI call.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={alertEnabled}
                    onClick={() => setAlertEnabled(!alertEnabled)}
                    className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${
                      alertEnabled ? "bg-[#6366f1]" : "bg-[#333]"
                    }`}
                    title={
                      alertEnabled
                        ? "Disable alerts for this sender"
                        : "Enable alerts for this sender"
                    }
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                        alertEnabled ? "left-[18px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
                {alertEnabled && (
                  <div className="mt-3 flex flex-col gap-2">
                    <div className="flex gap-2">
                      {(["gmail", "whatsapp"] as const).map((platform) => (
                        <button
                          key={platform}
                          type="button"
                          onClick={() => setAlertPlatform(platform)}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                            alertPlatform === platform
                              ? "bg-indigo-500/20 border border-indigo-500/40 text-indigo-300"
                              : "bg-[#222] border border-[#333] text-gray-400 hover:text-gray-200"
                          }`}
                        >
                          {platform === "gmail" ? "Gmail" : "WhatsApp"}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      value={alertTarget}
                      onChange={(e) => setAlertTarget(e.target.value)}
                      placeholder={
                        alertPlatform === "gmail"
                          ? "Enter email address"
                          : "Enter phone number, contact name, or group name"
                      }
                      className="w-full bg-[#111] border border-[#333] text-white rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 placeholder-gray-600 text-sm"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2.5">
                  Keywords{" "}
                  <span className="text-gray-500 font-normal">(optional)</span>
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {keywords.map((kw) => (
                    <span
                      key={kw}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-sm rounded-full"
                    >
                      {kw}
                      <button
                        type="button"
                        onClick={() => handleRemoveKeyword(kw)}
                        className="text-indigo-400 hover:text-indigo-200 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={handleKeywordKeyDown}
                    placeholder="Type a keyword and press Enter..."
                    className="flex-1 bg-[#111] border border-[#333] text-white rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 placeholder-gray-600 text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleAddKeyword}
                    className="px-3 py-2 text-sm font-semibold bg-indigo-200 text-indigo-900 rounded-lg hover:bg-indigo-300 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1.5">
                  Emails matching any of these keywords will also show in All
                  Inbox.
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
                  {submitting
                    ? "Saving..."
                    : editingSignal
                      ? "Save Changes"
                      : "Save Signal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
