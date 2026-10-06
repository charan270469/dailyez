// Right-side watchlist (signals) panel: lists, adds, edits toggles, and deletes signals,
// and lets the user trigger a manual Gmail re-fetch so new matches appear immediately.
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { MoreVertical, Plus, X, Pencil, RefreshCw } from "lucide-react";
import {
  addSignal,
  deleteSignal,
  patchSignal,
  getSignals,
  triggerGmailFetch,
  type Signal,
} from "../lib/api";

interface WatchlistPanelProps {
  activeSignalIds?: string[];
  onActiveSignalsChange?: Dispatch<SetStateAction<string[]>>;
  onSignalCountChange?: (count: number) => void;
  onSignalsChanged?: () => void;
}

export function WatchlistPanel({
  activeSignalIds = [],
  onActiveSignalsChange,
  onSignalCountChange,
  onSignalsChanged,
}: WatchlistPanelProps) {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingSignal, setEditingSignal] = useState<Signal | null>(null);
  const [context, setContext] = useState("");
  const [excludedCriteria, setExcludedCriteria] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState("");
  const [alertMe, setAlertMe] = useState(false);
  const [alertSameSender, setAlertSameSender] = useState(false);
  const [alertSimilar, setAlertSimilar] = useState(false);
  const [alertTarget, setAlertTarget] = useState("");
  const [alertPlatform, setAlertPlatform] = useState<"gmail" | "whatsapp">(
    "gmail",
  );
  const [pdfParsingEnabled, setPdfParsingEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    loadSignals();
    // Refresh every 30 seconds
    const interval = setInterval(loadSignals, 30000);
    return () => clearInterval(interval);
  }, []);

  async function loadSignals() {
    try {
      setLoading(true);
      const data = await getSignals();
      setSignals(data);
      onSignalCountChange?.(data.length);
      // Initialize toggles to "all on" only once (e.g. on first mount) so that
      // the user's off/on choices persist across periodic refreshes.
      if (!initializedRef.current && onActiveSignalsChange) {
        initializedRef.current = true;
        onActiveSignalsChange(
          data.map((s) => s._id || s.id).filter(Boolean) as string[],
        );
      }
    } catch (err) {
      console.error("Failed to load signals for panel", err);
    } finally {
      setLoading(false);
    }
  }

  // Manually fetch new Gmail messages, re-match them against the signals,
  // and then refresh the Matched feed so new matched mails show up without
  // waiting for the periodic (2-min) server fetch.
  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await triggerGmailFetch();
      await loadSignals();
      // Bump the refresh key so the Matched tab reloads the new matches.
      onSignalsChanged?.();
    } catch (err) {
      console.error("Failed to refresh matched mails", err);
      setError("Failed to refresh matched mails");
    } finally {
      setRefreshing(false);
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
    setExcludedCriteria("");
    setKeywords([]);
    setKeywordInput("");
    setAlertMe(false);
    setAlertSameSender(false);
    setAlertSimilar(false);
    setAlertTarget("");
    setAlertPlatform("gmail");
    setPdfParsingEnabled(false);
    setEditingSignal(null);
    setIsAddModalOpen(true);
  }

  function openEditModal(signal: Signal) {
    setEditingSignal(signal);
    const ctx = signal.context || "";
    // Auto-headline ("Alerts for messages from X") means exact-only; anything
    // else the user typed counts as real AI intent.
    const hasRealContext =
      !!ctx.trim() && !ctx.startsWith("Alerts for messages from ");
    setContext(ctx);
    setExcludedCriteria(signal.excludedCriteria || "");
    setKeywords(signal.keywords || []);
    setKeywordInput("");
    setAlertMe(signal.alertEnabled ?? false);
    setAlertSameSender(!!signal.alertTarget);
    setAlertSimilar(hasRealContext);
    setAlertTarget(signal.alertTarget || "");
    setAlertPlatform(signal.alertPlatform || "gmail");
    setPdfParsingEnabled(signal.pdfParsingEnabled ?? false);
    setActiveMenuId(null);
    setIsAddModalOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedAlertTarget = alertTarget.trim();
    // tick-box 1 needs a sender to match against; tick-box 2 needs the real
    // "what matters" intent above. Either alone is saveable.
    if (
      !context.trim() &&
      keywords.length === 0 &&
      !(alertMe && alertSameSender && trimmedAlertTarget) &&
      !(alertMe && alertSimilar && context.trim())
    )
      return;

    try {
      setSubmitting(true);
      // Exact-only alert (no real intent typed) gets a readable headline the
      // same way the one-click quick-alert does server-side, so the watchlist
      // row and Matched cards aren't blank.
      const effectiveContext =
        context.trim() ||
        (alertMe && alertSameSender && trimmedAlertTarget
          ? `Alerts for messages from ${trimmedAlertTarget}`
          : "");
      // The edit form always sends the alert trio so an ON→OFF toggle is
      // persisted (the server keeps the target but flags it disabled).
      // Same-sender OFF (or no sender typed) clears the target; similar-mail
      // OFF drops back to exact-only via the auto-headline above.
      const alertFields = {
        alertEnabled: alertMe && (alertSameSender || alertSimilar),
        alertTarget:
          alertMe && alertSameSender ? trimmedAlertTarget : "",
        alertPlatform,
      };
      if (editingSignal) {
        const id = editingSignal._id || editingSignal.id;
        if (!id) return;
        await patchSignal(id, {
          context: effectiveContext,
          excludedCriteria: excludedCriteria.trim(),
          keywords,
          ...alertFields,
          pdfParsingEnabled,
        });
      } else {
        const created = await addSignal({
          context: effectiveContext,
          excludedCriteria: excludedCriteria.trim(),
          keywords,
          pdfParsingEnabled,
          // New signals record the alert section only when actually used.
          ...((alertMe && alertSameSender && trimmedAlertTarget) ||
          (alertMe && alertSimilar && effectiveContext)
            ? alertFields
            : {}),
        });
        // New signals are turned on by default so their matches show up.
        const newId = created?._id || created?.id;
        if (newId && onActiveSignalsChange) {
          onActiveSignalsChange((prev) =>
            Array.from(new Set<string>([...prev, String(newId)])),
          );
        }
      }
      setContext("");
      setExcludedCriteria("");
      setKeywords([]);
      setKeywordInput("");
      setAlertMe(false);
      setAlertSameSender(false);
      setAlertSimilar(false);
      setAlertTarget("");
      setAlertPlatform("gmail");
      setPdfParsingEnabled(false);
      setEditingSignal(null);
      setIsAddModalOpen(false);
      await loadSignals();
      // Tell the Matched tab to reload so the new/edited signal's matches appear.
      onSignalsChanged?.();
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
      if (onActiveSignalsChange) {
        onActiveSignalsChange((prev) => prev.filter((x) => x !== id));
      }
      await loadSignals();
      onSignalsChanged?.();
    } catch (err) {
      console.error(err);
      setError("Unable to delete the signal");
    }
  }

  function handleToggle(id: string, turnOn: boolean) {
    if (!onActiveSignalsChange) return;
    onActiveSignalsChange((prev) => {
      const set = new Set(prev);
      if (turnOn) set.add(id);
      else set.delete(id);
      return Array.from(set);
    });
  }

  return (
    <div
      data-matched-watchlist-dark
      className="min-h-full bg-white px-5 pb-8 pt-6"
    >
      <div className="flex justify-between items-center border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[#0f2742] font-bold text-base">Watchlist</h3>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh matched mails — fetch new Gmail messages now"
            className={`text-gray-500 hover:text-indigo-400 p-1 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              refreshing ? "animate-spin" : ""
            }`}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        <span className="border border-blue-200 bg-blue-50 text-[#2563eb] text-[10px] font-semibold px-2 py-0.5 rounded-md">
          {loading ? "..." : `${activeSignalIds.length}/${signals.length} on`}
        </span>
      </div>
      {error && (
        <div className="mb-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {loading ? (
          <div className="py-3 text-sm text-gray-500">Loading signals...</div>
        ) : signals.length === 0 ? (
          <div className="py-3 text-sm text-gray-500">
            No signals yet. Add one below.
          </div>
        ) : (
          signals.map((signal, index) => (
            <div
              key={signal._id || signal.id || index}
              className="rounded-lg border border-slate-200 bg-white px-3"
            >
              <div className="flex justify-between items-center py-3 group">
                <div>
                  <div className="text-[#0f2742] font-semibold text-xs truncate max-w-[178px]">
                    {signal.context}
                  </div>
                  <div className="text-[#58708d] text-[10px] mt-0.5">
                    {signal.platform} · {signal.matchCount ?? 0} matches
                    {signal.keywords && signal.keywords.length > 0 && (
                      <span className="ml-1.5 text-indigo-400">
                        · {signal.keywords.length} kw
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={activeSignalIds.includes(
                      signal._id || signal.id || "",
                    )}
                    onClick={() =>
                      handleToggle(
                        signal._id || signal.id || "",
                        !activeSignalIds.includes(
                          signal._id || signal.id || "",
                        ),
                      )
                    }
                    className={`w-9 h-5 rounded-full relative transition-colors duration-200 ease-out shrink-0 ${
                      activeSignalIds.includes(signal._id || signal.id || "")
                        ? "bg-[#6366f1]"
                        : "bg-[#333]"
                    }`}
                    title={
                      activeSignalIds.includes(signal._id || signal.id || "")
                        ? "Showing matched emails for this signal"
                        : "Hidden from Matched"
                    }
                  >
                    <div
                      className={`absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ease-out motion-reduce:transition-none ${
                        activeSignalIds.includes(signal._id || signal.id || "")
                          ? "translate-x-4"
                          : "translate-x-0"
                      }`}
                    />
                  </button>
                  <div className="relative">
                    <button
                      onClick={() =>
                        setActiveMenuId(
                          activeMenuId === (signal._id || signal.id)
                            ? null
                            : (signal._id || signal.id)!,
                        )
                      }
                      className="text-gray-600 hover:text-gray-300 p-1 rounded transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                    {activeMenuId === (signal._id || signal.id) && (
                      <div className="absolute right-0 top-8 z-20 bg-[#1a1a1a] border border-[#333] rounded-lg shadow-lg py-1 min-w-[120px]">
                        <button
                          onClick={() => openEditModal(signal)}
                          className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-[#222]"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(signal._id || signal.id)}
                          className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-[#222]"
                        >
                          <X className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <button
        onClick={openAddModal}
        className="w-full mt-3 flex items-center justify-center py-2 border border-dashed border-slate-300 hover:border-blue-300 text-[#29425f] hover:text-[#2563eb] text-xs font-semibold rounded-lg transition-colors"
      >
        <Plus className="w-4 h-4 mr-2" />
        Add New Signal
      </button>

      {error && <p className="text-sm text-red-400 mt-3">{error}</p>}

      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#1a1a1a] border border-[#333] rounded-xl w-full max-w-[860px] overflow-hidden shadow-2xl">
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
            <form onSubmit={handleSubmit} className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  What matters to you?
                </label>
                <textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder="e.g. Alert me when I receive a genuine interview invitation, not newsletters that mention interviews."
                  rows={2}
                  className="w-full bg-[#111] border border-[#333] text-white rounded-lg px-4 py-2.5 focus:outline-none focus:border-indigo-500 placeholder-gray-600 resize-none text-sm leading-relaxed"
                />
                <p className="text-xs text-gray-500 mt-1.5">
                  Describe what kind of messages you want to be alerted about.
                  The AI will match based on intent, not just keywords.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  What should the AI exclude?{" "}
                  <span className="text-gray-500 font-normal">(optional)</span>
                </label>
                <textarea
                  value={excludedCriteria}
                  onChange={(e) => setExcludedCriteria(e.target.value)}
                  placeholder="e.g. Job posts without a specific, working application link or a verifiable online listing."
                  rows={2}
                  className="w-full bg-[#111] border border-[#333] text-white rounded-lg px-4 py-2.5 focus:outline-none focus:border-indigo-500 placeholder-gray-600 resize-none text-sm leading-relaxed"
                />
                <p className="text-xs text-gray-500 mt-1.5">
                  Messages matching these exclusions will not count as a signal match.
                </p>
              </div>

              <label className="flex items-center gap-2.5 text-sm text-gray-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={pdfParsingEnabled}
                  onChange={(e) => setPdfParsingEnabled(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#6366f1] cursor-pointer"
                />
                Allow PDF parsing for this signal
              </label>

              <div className="border border-dashed border-[#333] rounded-lg p-3 bg-[#151515]">
                <label className="flex items-center gap-2.5 text-sm text-gray-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={alertMe}
                    onChange={(e) => setAlertMe(e.target.checked)}
                    className="w-4 h-4 rounded accent-[#6366f1] cursor-pointer"
                  />
                  <span className="font-semibold">
                    Alert me{" "}
                    <span className="text-gray-500 font-normal">
                      (optional)
                    </span>
                  </span>
                </label>
                {alertMe && (
                  <div className="mt-2.5 ml-6 flex flex-col gap-2">
                    <label className="flex items-center gap-2.5 text-sm text-gray-400 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={alertSameSender}
                        onChange={(e) => setAlertSameSender(e.target.checked)}
                        className="w-4 h-4 rounded accent-[#6366f1] cursor-pointer"
                      />
                      Alert me when I get a mail or message from the same sender
                    </label>
                    <label className="flex items-center gap-2.5 text-sm text-gray-400 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={alertSimilar}
                        onChange={(e) => setAlertSimilar(e.target.checked)}
                        className="w-4 h-4 rounded accent-[#6366f1] cursor-pointer"
                      />
                      Alert me on mails and messages similar to this
                    </label>
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
                          ? "Type the mail ID you want alerts from"
                          : "Type the number, contact or group you want alerts from"
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
