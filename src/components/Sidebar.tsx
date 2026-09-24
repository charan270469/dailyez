import {
  Inbox,
  ListChecks,
  BarChart2,
  Archive,
  HelpCircle,
  ArrowUp,
} from "lucide-react";

interface SidebarProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
  collapsed?: boolean;
}

export function Sidebar({ currentTab, onTabChange, collapsed = false }: SidebarProps) {
  const navItems = [
    { icon: ListChecks, label: "Matched" },
    { icon: Inbox, label: "All Inbox" },
    { icon: BarChart2, label: "Analytics" },
    { icon: Archive, label: "Archive" },
  ];

  return (
    <aside
      className={`group relative h-full shrink-0 overflow-hidden bg-white border-r border-slate-200 flex flex-col pt-5 pb-4 text-sm transition-[width] duration-200 ease-out ${collapsed ? "w-[72px]" : "w-[204px]"}`}
    >
      <nav className="flex-1 px-3 space-y-1 mt-2">
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
                  ? "bg-indigo-50 text-indigo-700 font-semibold"
                  : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" strokeWidth={2} />
              <span className={`${collapsed ? "hidden" : "inline"} truncate`}>
                {item.label}
              </span>
            </a>
          );
        })}
      </nav>

      <div className="px-3 mt-auto space-y-3">
        <button
          type="button"
          onClick={() => onTabChange("Settings")}
          className={`${collapsed ? "px-3" : "px-4"} w-full flex items-center justify-center gap-2 rounded-lg border border-slate-300 py-2.5 text-slate-600 hover:border-indigo-300 hover:text-indigo-700 transition-colors`}
          title="Upgrade plan"
        >
          <ArrowUp className="w-4 h-4" />
          {!collapsed && <span className="truncate">Upgrade plan</span>}
        </button>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onTabChange("Help");
          }}
          className={`flex items-center gap-3 rounded-lg px-3 py-3 transition-all duration-200 ${
            currentTab === "Help"
              ? "bg-indigo-50 text-indigo-700 font-semibold"
              : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
          }`}
        >
          <HelpCircle className="w-5 h-5 shrink-0" />
          <span className={`${collapsed ? "hidden" : "inline"} truncate`}>Help</span>
        </a>
      </div>
    </aside>
  );
}
