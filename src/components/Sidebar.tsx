import { Inbox, Star, Eye, BarChart2, Archive, HelpCircle, Settings, Monitor } from 'lucide-react';

interface SidebarProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
}

export function Sidebar({ currentTab, onTabChange }: SidebarProps) {
  const navItems = [
    { icon: Inbox, label: 'All Inbox' },
    { icon: Star, label: 'Important' },
    { icon: Eye, label: 'Watchlist' },
    { icon: BarChart2, label: 'Analytics' },
    { icon: Archive, label: 'Archive' },
  ];

  return (
    <aside className="w-[260px] shrink-0 bg-[#0f0f0f] border-r border-[#222] flex flex-col pt-6 pb-6 text-sm h-full">
      <div className="px-6 mb-8">
        <h1 className="text-white font-bold text-[20px] tracking-tight text-indigo-400">SignalStream</h1>
        <p className="text-gray-400 text-xs mt-0.5">AI Aggregator</p>
      </div>

      <nav className="flex-1 px-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = item.label === currentTab;
          
          return (
            <a
              key={item.label}
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onTabChange(item.label);
              }}
              className={`flex items-center px-4 py-2.5 rounded-lg transition-colors ${
                active
                  ? 'bg-[#6366f1] text-white font-medium'
                  : 'text-gray-400 hover:text-white hover:bg-[#1a1a1a]'
              }`}
            >
              <Icon className="w-5 h-5 mr-3" strokeWidth={2} />
              {item.label}
            </a>
          );
        })}
      </nav>

      <div className="px-4 mt-auto space-y-1">
        <a 
          href="#" 
          onClick={(e) => {
            e.preventDefault();
            onTabChange('Help');
          }}
          className={`flex items-center px-4 py-2.5 rounded-lg transition-colors ${
            currentTab === 'Help'
              ? 'bg-[#818cf8] text-[#0a0a0a] font-medium'
              : 'text-gray-400 hover:text-white hover:bg-[#1a1a1a]'
          }`}
        >
          <HelpCircle className="w-5 h-5 mr-3" />
          Help
        </a>
        <div className="pt-2">
          <button className="w-full bg-[#c7d2fe] hover:bg-[#a5b4fc] text-[#0a0a0a] font-semibold py-2.5 rounded-lg transition-colors text-sm">
            Upgrade Plan
          </button>
        </div>
      </div>
    </aside>
  );
}
