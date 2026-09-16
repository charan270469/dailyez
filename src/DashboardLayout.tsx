// Main dashboard shell: tracks the active tab, renders the navbar + sidebar, and swaps in
// each tab's content (Matched, All Inbox, Analytics, Archive, Settings, Help) plus the right panel.
import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { TopNavbar } from "./components/TopNavbar";
import { PriorityFeed } from "./components/PriorityFeed";
import { EmptyPriorityFeed } from "./components/EmptyPriorityFeed";
import { WatchlistPanel } from "./components/WatchlistPanel";
import { VoiceAgentChat } from "./components/VoiceAgentChat";
import { InboxFeed } from "./components/InboxFeed";
import { MatchedTab } from "./components/MatchedTab";
import { AnalyticsTab } from "./components/AnalyticsTab";
import { ArchiveTab } from "./components/ArchiveTab";
import { SettingsTab } from "./components/SettingsTab";
import { HelpTab } from "./components/HelpTab";

export default function DashboardLayout() {
  const [activeTab, setActiveTab] = useState("Matched");
  const [matchedRefreshKey, setMatchedRefreshKey] = useState(0);
  const [activeSignalIds, setActiveSignalIds] = useState<string[]>([]);
  const hasMessages = true; // Toggle to false to see empty state

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0a0a0a] text-gray-200 font-sans flex flex-col">
      <TopNavbar onSettingsClick={() => setActiveTab("Settings")} />

      <main className="h-[calc(100vh-64px)] flex overflow-hidden pt-0 pb-0 pl-0 pr-6 gap-6 min-h-0">
        <Sidebar currentTab={activeTab} onTabChange={setActiveTab} />

        <div className="flex-1 flex flex-col h-full min-w-0">
          {activeTab === "Matched" ? (
            <MatchedTab
              refreshKey={matchedRefreshKey}
              activeSignalIds={activeSignalIds}
            />
          ) : activeTab === "All Inbox" ? (
            <InboxFeed />
          ) : activeTab === "Analytics" ? (
            <AnalyticsTab />
          ) : activeTab === "Archive" ? (
            <ArchiveTab />
          ) : activeTab === "Settings" ? (
            <SettingsTab />
          ) : activeTab === "Help" ? (
            <HelpTab />
          ) : activeTab === "Priority" ? (
            <PriorityFeed />
          ) : hasMessages ? (
            <PriorityFeed />
          ) : (
            <EmptyPriorityFeed />
          )}
        </div>

        {/* Right sidebar */}
        {activeTab !== "Analytics" &&
          activeTab !== "Archive" &&
          activeTab !== "Settings" &&
          activeTab !== "Help" && (
            <aside className="w-[330px] shrink-0 flex flex-col h-full overflow-y-auto pb-20 no-scrollbar pr-2">
              {activeTab === "All Inbox" ? (
                <button
                  type="button"
                  onClick={() => setActiveTab("Settings")}
                  className="mt-12 w-full rounded-xl border border-indigo-400/20 bg-indigo-500/10 px-4 py-3 text-left text-sm font-semibold text-indigo-200 transition-colors hover:bg-indigo-500/20"
                >
                  Manage connections
                </button>
              ) : (
                <WatchlistPanel
                  activeSignalIds={activeSignalIds}
                  onActiveSignalsChange={setActiveSignalIds}
                  onSignalsChanged={() => setMatchedRefreshKey((k) => k + 1)}
                />
              )}
            </aside>
          )}
      </main>

      <VoiceAgentChat onNavigate={setActiveTab} />
    </div>
  );
}
