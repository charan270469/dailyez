import {
  Inbox,
  ListChecks,
  BarChart2,
  Archive,
  AlertTriangle,
  HelpCircle,
} from "lucide-react";

interface SidebarProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
}

export function Sidebar({ currentTab, onTabChange }: SidebarProps) {
  const navItems = [
    { icon: ListChecks, label: "Matched" },
    { icon: Inbox, label: "All Inbox" },
    { icon: BarChart2, label: "Analytics" },
    { icon: Archive, label: "Archive" },
    { icon: AlertTriangle, label: "Priority" },
  ];

  return (
    <aside className="group relative h-full shrink-0 w-[64px] hover:w-[160px] overflow-hidden bg-[#0f0f0f] border-r border-[#222] flex flex-col pt-8 pb-4 text-sm transition-all duration-300 ease-out">
      <nav className="flex-1 px-1 space-y-1 mt-4">
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
              className={`flex items-center gap-3 rounded-lg px-3 py-3 transition-all duration-200 ${
                active
                  ? "bg-[#6366f1] text-white font-medium"
                  : "text-gray-400 hover:text-white hover:bg-[#1a1a1a]"
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" strokeWidth={2} />
              <span className="hidden group-hover:inline truncate">
                {item.label}
              </span>
            </a>
          );
        })}
      </nav>

      <div className="px-1 mt-auto space-y-1">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onTabChange("Help");
          }}
          className={`flex items-center gap-3 rounded-lg px-3 py-3 transition-all duration-200 ${
            currentTab === "Help"
              ? "bg-[#818cf8] text-[#0a0a0a] font-medium"
              : "text-gray-400 hover:text-white hover:bg-[#1a1a1a]"
          }`}
        >
          <HelpCircle className="w-5 h-5 shrink-0" />
          <span className="hidden group-hover:inline truncate">Help</span>
        </a>
      </div>
    </aside>
  );
}
