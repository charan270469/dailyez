import { useEffect, useState } from "react";
import {
  Archive,
  BarChart2,
  Inbox,
  ListChecks,
  Moon,
  PanelLeft,
  Settings,
  Sun,
} from "lucide-react";

interface SidebarProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
  collapsed?: boolean;
  onCollapse?: () => void;
  matchedCount?: number | null;
}

export function Sidebar({
  currentTab,
  onTabChange,
  collapsed = false,
  onCollapse,
  matchedCount = null,
}: SidebarProps) {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const navItems = [
    { icon: ListChecks, label: "Matched" },
    { icon: Inbox, label: "All Inbox" },
    { icon: BarChart2, label: "Analytics" },
    { icon: Archive, label: "Archive" },
  ];

  return (
    <aside
      className={`relative h-full shrink-0 overflow-hidden border-r border-slate-200 bg-white transition-[width] duration-200 ${collapsed ? "w-[72px]" : "w-[240px]"}`}
    >
      <div
        className={`flex h-[80px] items-center ${collapsed ? "justify-center" : "justify-between px-6"}`}
      >
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 text-left"
          onClick={() => onTabChange("Matched")}
          aria-label="DailyEz home"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#2563eb] text-[11px] font-bold text-white">
            DE
          </span>
          {!collapsed && (
            <span className="min-w-0 leading-tight">
              <span className="block text-sm font-bold tracking-tight text-[#0f2742]">
                DailyEz
              </span>
              <span className="block text-xs text-slate-500">Workspace</span>
            </span>
          )}
        </button>
        {!collapsed && (
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-50 hover:text-[#2563eb]"
            title="Collapse sidebar"
          >
            <PanelLeft className="h-[18px] w-[18px]" />
          </button>
        )}
        {collapsed && (
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-50 hover:text-[#2563eb]"
            title="Expand sidebar"
          >
            <PanelLeft className="h-[18px] w-[18px] rotate-180" />
          </button>
        )}
      </div>

      <nav className="space-y-1 px-4 pt-2">
        {navItems.map(({ icon: Icon, label }) => {
          const active = label === currentTab;
          return (
            <button
              key={label}
              type="button"
              onClick={() => onTabChange(label)}
              title={label}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${active ? "bg-[#eff6ff] font-semibold text-[#2563eb]" : "text-[#29425f] hover:bg-slate-50"}`}
            >
              <Icon
                className="h-[18px] w-[18px] shrink-0"
                strokeWidth={active ? 2.2 : 1.8}
              />
              {!collapsed && (
                <span>
                  {label === "All Inbox"
                    ? "Inbox"
                    : label === "Archive"
                      ? "Signals"
                      : label}
                </span>
              )}
              {label === "Matched" && !collapsed && matchedCount !== null && (
                <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-blue-100 px-1 text-[10px] font-bold text-[#2563eb]">
                  {matchedCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div
        className={`absolute inset-x-4 bottom-5 space-y-1 border-t border-slate-100 pt-4 ${collapsed ? "px-0" : ""}`}
      >
        <button
          type="button"
          onClick={() => setDark((v) => !v)}
          title={dark ? "Light theme" : "Dark theme"}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#29425f] hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {dark ? (
            <Sun className="h-[18px] w-[18px] shrink-0" />
          ) : (
            <Moon className="h-[18px] w-[18px] shrink-0" />
          )}
          {!collapsed && <span>{dark ? "Light" : "Dark"}</span>}
        </button>
        <button
          type="button"
          onClick={() => onTabChange("Settings")}
          title="Settings"
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${currentTab === "Settings" ? "bg-[#eff6ff] font-semibold text-[#2563eb]" : "text-[#29425f] hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"}`}
        >
          <Settings className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && <span>Settings</span>}
        </button>
      </div>
    </aside>
  );
}
