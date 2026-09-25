import { Bell, CircleHelp } from "lucide-react";

interface TopNavbarProps { onSettingsClick?: () => void; }

export function TopNavbar({ onSettingsClick }: TopNavbarProps) {
  return (
    <header className="pointer-events-none absolute right-6 top-6 z-20 flex items-center gap-2">
      <button type="button" className="pointer-events-auto grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-blue-200 hover:text-[#2563eb]" aria-label="Notifications"><Bell className="h-4 w-4" /></button>
      <button type="button" onClick={onSettingsClick} className="pointer-events-auto grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-blue-200 hover:text-[#2563eb]" aria-label="Help and settings"><CircleHelp className="h-4 w-4" /></button>
    </header>
  );
}
