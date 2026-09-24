// Main dashboard shell: tracks the active tab, renders the navbar + sidebar, and swaps in
// each tab's content (Matched, All Inbox, Analytics, Archive, Settings, Help) plus the right panel.
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
  return (
    <div className="h-screen w-screen overflow-hidden bg-slate-50 text-slate-900 font-sans flex flex-col">
      <TopNavbar
        onSettingsClick={() => setActiveTab("Settings")}
        onSidebarToggle={() => setSidebarCollapsed((collapsed) => !collapsed)}
      />

      <main className="h-[calc(100vh-64px)] flex overflow-hidden pt-0 pb-0 pl-0 pr-6 gap-6 min-h-0 bg-slate-50">
        <Sidebar
          currentTab={activeTab}
          onTabChange={setActiveTab}
          collapsed={sidebarCollapsed}
        />

        <div className="flex-1 flex flex-col h-full min-w-0">
          {activeTab === "Matched" ? (
            <MatchedTab
              refreshKey={matchedRefreshKey}
              activeSignalIds={activeSignalIds}
              onManageConnections={() => setActiveTab("Settings")}
            />
          ) : activeTab === "All Inbox" ? (
            <InboxFeed onManageConnections={() => setActiveTab("Settings")} />
          ) : activeTab === "Analytics" ? (
            <AnalyticsTab />
          ) : activeTab === "Archive" ? (
            <ArchiveTab />
          ) : activeTab === "Settings" ? (
            <SettingsTab />
          ) : activeTab === "Help" ? (
            <HelpTab />
          ) : (
            <MatchedTab
              refreshKey={matchedRefreshKey}
              activeSignalIds={activeSignalIds}
              onManageConnections={() => setActiveTab("Settings")}
            />
          )}
        </div>

        {/* Right sidebar */}
        {activeTab !== "Analytics" &&
          activeTab !== "Archive" &&
          activeTab !== "Settings" &&
          activeTab !== "Help" &&
          activeTab !== "All Inbox" && (
            <aside className="w-[330px] shrink-0 flex flex-col h-full overflow-y-auto pb-20 no-scrollbar pr-2">
              <WatchlistPanel
                activeSignalIds={activeSignalIds}
                onActiveSignalsChange={setActiveSignalIds}
                onSignalsChanged={() => setMatchedRefreshKey((k) => k + 1)}
              />
            </aside>
          )}
      </main>

      <VoiceAgentChat onNavigate={setActiveTab} />
    </div>
  );
}
