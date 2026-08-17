// Modal for editing the user's profile (name/email/avatar) — submits updates to the
// profile endpoint.
import { useState, type FormEvent } from "react";
import { X, User, Mail, Camera } from "lucide-react";

interface EditProfileModalProps {
  profile: {
    name: string | null;
    email: string | null;
    avatar: string | null;
  };
  onSave: (profile: { name: string; email: string }) => Promise<void>;
  onClose: () => void;
}

export function EditProfileModal({
  profile,
  onSave,
  onClose,
}: EditProfileModalProps) {
  const [name, setName] = useState(profile.name || "");
  const [email, setEmail] = useState(profile.email || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      await onSave({ name: name.trim(), email: email.trim() });
      onClose();
    } catch (err) {
      setError("Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const initials = name
    ? name.charAt(0).toUpperCase()
    : email
      ? email.charAt(0).toUpperCase()
      : "?";

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1a1a] border border-[#333] rounded-xl w-full max-w-md overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-[#333]">
          <h3 className="text-white font-semibold text-lg">Edit Profile</h3>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white hover:bg-[#222] rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-6">
          {/* Avatar */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-indigo-600 overflow-hidden border-2 border-[#444] flex items-center justify-center">
                {profile.avatar ? (
                  <img
                    src={profile.avatar}
                    alt="Avatar"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-white text-2xl font-bold">
                    {initials}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="absolute bottom-0 right-0 w-7 h-7 bg-[#6366f1] rounded-full flex items-center justify-center border-2 border-[#1a1a1a]"
              >
                <Camera className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-red-400 text-center">{error}</p>}

          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 tracking-wider mb-2.5">
              FULL NAME
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                className="w-full bg-[#111] border border-[#333] text-white rounded-lg pl-10 pr-4 py-3 focus:outline-none focus:border-indigo-500 placeholder-gray-600"
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 tracking-wider mb-2.5">
              EMAIL
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full bg-[#111] border border-[#333] text-white rounded-lg pl-10 pr-4 py-3 focus:outline-none focus:border-indigo-500 placeholder-gray-600"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-medium text-gray-300 hover:text-white border border-[#444] rounded-lg hover:bg-[#222] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 text-sm font-semibold bg-indigo-200 text-indigo-900 rounded-lg hover:bg-indigo-300 transition-colors shadow-lg shadow-indigo-500/20 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
