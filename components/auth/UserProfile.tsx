import React, { useState } from 'react';
import { useAuth } from '../../contexts/SupabaseAuthContext';
import { updatePerson } from '../../services/apiService';

interface UserProfileProps {
  onClose: () => void;
}

const UserProfile: React.FC<UserProfileProps> = ({ onClose }) => {
  const { user, person, signOut, updateLocalPerson } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const displayName = person?.name || user?.fullName || user?.primaryEmailAddress?.emailAddress?.split('@')[0] || 'User';
  const email = person?.email || user?.primaryEmailAddress?.emailAddress;

  const handleSignOut = async () => {
    setIsSigningOut(true);
    await signOut();
    setIsSigningOut(false);
    onClose();
  };

  const startEditing = () => {
    setEditName(displayName);
    setEditEmail(email || '');
    setSaveError(null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!person) return;
    if (!editName.trim()) {
      setSaveError('Name is required');
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updatePerson(person.id, {
        name: editName.trim(),
        email: editEmail.trim().toLowerCase() || undefined,
      });
      updateLocalPerson(updated);
      setIsEditing(false);
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-md">
        {/* Avatar + name header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full mx-auto mb-4 flex items-center justify-center">
            <span className="text-white text-xl font-bold">
              {displayName.charAt(0).toUpperCase()}
            </span>
          </div>
          {!isEditing && (
            <>
              <h2 className="text-xl font-bold text-white">{displayName}</h2>
              {email && <p className="text-slate-300 text-sm mt-0.5">{email}</p>}
            </>
          )}
        </div>

        <div className="space-y-4">
          {/* Edit form */}
          {isEditing ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Display name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full bg-black/30 border border-slate-600 rounded-md px-3 py-2 text-white placeholder-slate-500 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  placeholder="Your name"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Email</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  className="w-full bg-black/30 border border-slate-600 rounded-md px-3 py-2 text-white placeholder-slate-500 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  placeholder="your@email.com"
                />
                <p className="mt-1 text-xs text-slate-500">Used to connect with others who add you by email.</p>
              </div>
              {saveError && (
                <p className="text-sm text-rose-400 bg-rose-900/30 border border-rose-700/40 rounded-md px-3 py-2">
                  {saveError}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 bg-gradient-to-br from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 disabled:opacity-50 text-white font-medium py-2 px-4 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
                >
                  {saving && <span className="animate-spin h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full" />}
                  Save
                </button>
                <button
                  onClick={cancelEditing}
                  disabled={saving}
                  className="flex-1 bg-slate-600 hover:bg-slate-700 disabled:opacity-50 text-white font-medium py-2 px-4 rounded-lg transition-colors text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Account info */}
              <div className="bg-slate-700/50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-white font-medium text-sm">Account Info</h3>
                  {person && (
                    <button
                      onClick={startEditing}
                      className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      Edit profile
                    </button>
                  )}
                </div>
                <div className="text-sm text-slate-300 space-y-1">
                  {person?.isClaimed && (
                    <p><span className="text-slate-400">Status:</span> <span className="text-emerald-400">Claimed account</span></p>
                  )}
                  <p><span className="text-slate-400">Member since:</span> {new Date(user?.createdAt || '').toLocaleDateString()}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-3">
                <button
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="w-full bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-medium py-3 px-4 rounded-lg transition-colors"
                >
                  {isSigningOut ? 'Signing out...' : 'Sign Out'}
                </button>

                <button
                  onClick={onClose}
                  className="w-full bg-slate-600 hover:bg-slate-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserProfile;
