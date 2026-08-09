import { Bell, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { getAuthStatus } from "../lib/api";
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

  const handleProfileSave = async (updatedProfile: {
    name: string;
    email: string;
  }) => {
    setProfile((prev) => ({
      ...prev,
      name: updatedProfile.name,
      email: updatedProfile.email,
    }));
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

        <button
          type="button"
          onClick={() => setShowEditProfile(true)}
          className="w-8 h-8 rounded-full bg-gray-700 overflow-hidden ml-2 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
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
        </button>
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
