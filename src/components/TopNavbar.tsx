// Top app bar: shows the DailyEz brand, the profile avatar/initials, and opens the
// settings/profile modals. Loads the user profile from the backend auth status.
import { Bell, Settings, LogOut, User, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getAuthStatus, logoutUser, updateProfile } from "../lib/api";
import { EditProfileModal } from "./EditProfileModal";

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
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Close the dropdown when the user clicks outside it.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const initials = profile.name
    ? profile.name.charAt(0).toUpperCase()
    : profile.email
      ? profile.email.charAt(0).toUpperCase()
      : "?";

  const handleProfileSave = async (updated: { name: string; avatar: string | null }) => {
    const resp = await updateProfile({
      name: updated.name,
      ...(updated.avatar !== undefined ? { avatar: updated.avatar } : {}),
    });
    if (resp.user) {
      setProfile(resp.user);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logoutUser();
      // Mark signed-out in local storage so the app returns to the login screen.
      localStorage.setItem("signalstream-logged-out", "1");
    } catch (err) {
      console.error("Logout failed", err);
    } finally {
      setLoggingOut(false);
    }
    window.location.href = "/";
  };

  return (
    <header className="h-[64px] border-b border-[#222] bg-[#0f0f0f] flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500 text-white font-bold text-lg">
          DE
        </div>
        <div>
          <h1 className="text-white font-semibold text-[16px]">DailyEz</h1>
        </div>
      </div>

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

        {/* Profile avatar + dropdown menu (edit / logout) */}
        <div className="relative ml-2" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <span className="w-10 h-10 rounded-full overflow-hidden border border-gray-600 inline-flex">
              {!loading && profile.avatar ? (
                <img
                  src={profile.avatar}
                  alt="User avatar"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="w-full h-full flex items-center justify-center text-xs font-bold text-white bg-indigo-600">
                  {initials}
                </span>
              )}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-[#1a1a1a] border border-[#333] rounded-xl shadow-2xl py-1.5 z-50">
              <div className="px-4 py-2.5 border-b border-[#333]">
                <p className="text-sm font-semibold text-white truncate">
                  {profile.name || "User"}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {profile.email || "Not connected"}
                </p>
              </div>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setShowEditProfile(true);
                }}
                className="w-full text-left flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-200 hover:bg-[#222] transition-colors"
              >
                <User className="w-4 h-4 text-gray-400" />
                Edit profile
              </button>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="w-full text-left flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-400 hover:bg-red-950/40 transition-colors disabled:opacity-60"
              >
                <LogOut className="w-4 h-4" />
                {loggingOut ? "Logging out…" : "Log out"}
              </button>
            </div>
          )}
        </div>
      </div>
      {showEditProfile && (
        <EditProfileModal
          profile={profile}
          onSave={handleProfileSave}
          onClose={() => setShowEditProfile(false)}
        />
      )}
    </header>
  );
}
