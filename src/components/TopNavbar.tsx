import { Bell, Settings, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { getAuthStatus } from "../lib/api";

interface TopNavbarProps {
  onSettingsClick?: () => void;
}

export function TopNavbar({ onSettingsClick }: TopNavbarProps) {
  const [profile, setProfile] = useState<{
    name: string | null;
    email: string | null;
    avatar: string | null;
  }>({ name: null, email: null, avatar: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProfile() {
      try {
        const result = await getAuthStatus();
        if (result.user) {
          setProfile(result.user);
        }
      } catch (err) {
        console.error("Failed to load profile", err);
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, []);

  const initials = profile.name
    ? profile.name.charAt(0).toUpperCase()
    : profile.email
      ? profile.email.charAt(0).toUpperCase()
      : "?";

  return (
    <header className="h-[64px] border-b border-[#222] bg-[#0f0f0f] flex items-center justify-between px-6 shrink-0">
      {/* Left Navigation / Search */}
      <div className="flex items-center w-full max-w-lg">
        <div className="relative w-full">
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search SignalStream..."
            className="w-full bg-[#1a1a1a] border border-[#2a2a2a] text-gray-200 text-sm rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center space-x-5">
        <button className="text-gray-400 hover:text-white transition-colors">
          <Bell className="w-5 h-5" />
        </button>
        <button
          className="text-gray-400 hover:text-white transition-colors"
          onClick={onSettingsClick}
        >
          <Settings className="w-5 h-5" />
        </button>

        <div className="w-8 h-8 rounded-full bg-gray-700 overflow-hidden ml-2 border border-gray-600">
          {!loading && profile.avatar ? (
            <img
              src={profile.avatar}
              alt="User avatar"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs font-bold text-white bg-indigo-600">
              {initials}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
