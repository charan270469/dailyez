import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopNavbar } from './components/TopNavbar';
import { PriorityFeed } from './components/PriorityFeed';
import { EmptyPriorityFeed } from './components/EmptyPriorityFeed';
import { WatchlistPanel } from './components/WatchlistPanel';
import { DailyVolumeChart } from './components/DailyVolumeChart';
import { FloatingChat } from './components/FloatingChat';
import { InboxFeed } from './components/InboxFeed';
import { ConnectedPlatforms } from './components/ConnectedPlatforms';
import { WatchlistTab } from './components/WatchlistTab';
import { AnalyticsTab } from './components/AnalyticsTab';
import { ArchiveTab } from './components/ArchiveTab';
import { SettingsTab } from './components/SettingsTab';

export default function DashboardLayout() {
  const [activeTab, setActiveTab] = useState('Watchlist');
  const hasMessages = true; // Toggle to false to see empty state

  return (
    <div className="h-full w-full overflow-hidden bg-[#0a0a0a] text-gray-200 font-sans flex">
      <Sidebar currentTab={activeTab} onTabChange={setActiveTab} />
      
      <div className="flex-1 flex flex-col h-full min-w-0">
        <TopNavbar onSettingsClick={() => setActiveTab('Settings')} />
        
        <main className="flex-1 flex overflow-hidden p-6 gap-6">
          {/* Main content area */}
          <div className="flex-1 h-full flex flex-col min-w-0">
            {activeTab === 'All Inbox' ? (
              <InboxFeed />
            ) : activeTab === 'Watchlist' ? (
              <WatchlistTab />
            ) : activeTab === 'Analytics' ? (
              <AnalyticsTab />
            ) : activeTab === 'Archive' ? (
              <ArchiveTab />
            ) : activeTab === 'Settings' ? (
              <SettingsTab />
            ) : (
              hasMessages ? <PriorityFeed /> : <EmptyPriorityFeed />
            )}
          </div>
          
          {/* Right sidebar */}
          {activeTab !== 'Watchlist' && activeTab !== 'Analytics' && activeTab !== 'Archive' && activeTab !== 'Settings' && (
            <aside className="w-[300px] shrink-0 flex flex-col h-full overflow-y-auto pb-20 no-scrollbar pr-2">
              {activeTab === 'All Inbox' ? (
                <>
                  <ConnectedPlatforms />
                  <DailyVolumeChart showTrend={true} />
                </>
              ) : (
                <>
                  <WatchlistPanel />
                  <DailyVolumeChart showTrend={false} />
                </>
              )}
            </aside>
          )}
        </main>
      </div>

      <FloatingChat />
    </div>
  );
}
