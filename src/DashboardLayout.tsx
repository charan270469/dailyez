// Main workspace shell: keeps the navigation, results and signal controls in a fixed desktop frame.
import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { TopNavbar } from "./components/TopNavbar";
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [matchedRefreshKey, setMatchedRefreshKey] = useState(0);
  const [activeSignalIds, setActiveSignalIds] = useState<string[]>([]);
  const [matchedCount, setMatchedCount] = useState<number | null>(null);
  const [signalCount, setSignalCount] = useState<number | null>(null);
  const showsWatchlist = activeTab === "Matched";

  return (
    <div className="h-screen w-screen overflow-hidden bg-white font-sans text-[#0f2742] flex">
      <Sidebar
        currentTab={activeTab}
        onTabChange={setActiveTab}
        collapsed={sidebarCollapsed}
        matchedCount={matchedCount}
        onCollapse={() => setSidebarCollapsed((collapsed) => !collapsed)}
      />

      <main className="relative flex min-w-0 flex-1 overflow-hidden">
        <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <TopNavbar onSettingsClick={() => setActiveTab("Settings")} />
          {activeTab === "Matched" ? (
            <MatchedTab
              refreshKey={matchedRefreshKey}
              activeSignalIds={activeSignalIds}
              onManageConnections={() => setActiveTab("Settings")}
              onMatchedCountChange={setMatchedCount}
              hasSignals={signalCount === null ? null : signalCount > 0}
            />
          ) : activeTab === "All Inbox" ? (
            <InboxFeed onManageConnections={() => setActiveTab("Settings")} />
          ) : activeTab === "Analytics" ? (
            <AnalyticsTab />
          ) : activeTab === "Archive" ? (
            <ArchiveTab />
          ) : activeTab === "Settings" ? (
            <SettingsTab />
          ) : <HelpTab />}
        </section>

        {showsWatchlist && (
          <aside className="w-[320px] shrink-0 overflow-y-auto border-l border-slate-200 bg-white no-scrollbar">
            <WatchlistPanel
              activeSignalIds={activeSignalIds}
              onActiveSignalsChange={setActiveSignalIds}
              onSignalCountChange={setSignalCount}
              onSignalsChanged={() => setMatchedRefreshKey((key) => key + 1)}
            />
          </aside>
        )}
      </main>

      <VoiceAgentChat onNavigate={setActiveTab} />
    </div>
  );
}
