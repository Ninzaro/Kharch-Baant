import React, { useState, useEffect, useRef } from 'react';
import ArchivedGroupsModal from './ArchivedGroupsModal';
import BaseModal from './BaseModal';
import ThemeToggle from './ThemeToggle';
import CurrencySelector from './CurrencySelector';
import LanguageSelector from './LanguageSelector';
import DataExport from './DataExport';
import DangerZone from './DangerZone';
import AboutSection from './AboutSection';
import AdminDeletionRequestsPanel from './AdminDeletionRequestsPanel';
import Avatar from './Avatar';
import * as api from '../services/apiService';
import { Person } from '../types';
import toast from 'react-hot-toast';
import { updateUserAvatar, updatePerson } from '../services/supabaseApiService';
import { useModalContext } from '../contexts/ModalContext';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserId?: string;
  currentUserPerson?: Person | null;
}

const LANGUAGES = ['English', 'Hindi'];
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'];

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, currentUserId, currentUserPerson }) => {
  const { actions } = useModalContext();
  const [showArchivedGroups, setShowArchivedGroups] = useState(false);

  // Placeholder state for demo
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [currency, setCurrency] = useState('INR');
  const [language, setLanguage] = useState('English');

  // Profile State
  const [avatarUrl, setAvatarUrl] = useState<string | null>(currentUserPerson?.avatarUrl || null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (currentUserPerson) {
      setAvatarUrl(currentUserPerson.avatarUrl || null);
    }
  }, [currentUserPerson]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUserId) return;

    if (file.size > 100 * 1024) { // 100KB limit
      toast.error('Image too large. Please use an image under 100KB.');
      return;
    }

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      setAvatarUrl(base64); // Optimistic update
      try {
        await updateUserAvatar(currentUserId, base64);
        toast.success('Profile picture updated!');
      } catch (error) {
        console.error('Failed to update avatar', error);
        toast.error('Failed to update profile picture.');
        setAvatarUrl(currentUserPerson?.avatarUrl || null); // Revert
      } finally {
        setIsUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = async () => {
    if (!currentUserId) return;
    if (!window.confirm('Remove profile picture?')) return;

    setIsUploading(true);
    setAvatarUrl(null); // Optimistic
    try {
      await updateUserAvatar(currentUserId, null);
      toast.success('Profile picture removed.');
    } catch (error) {
      console.error('Failed to remove avatar', error);
      toast.error('Failed to remove profile picture.');
      setAvatarUrl(currentUserPerson?.avatarUrl || null); // Revert
    } finally {
      setIsUploading(false);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  // Placeholder handlers
  const handleExport = () => alert('Exporting data...');
  const handleImport = (file: File) => alert(`Importing from ${file.name}`);
  const handleReset = () => {
    if (window.confirm('Are you sure you want to reset all app data? This cannot be undone.')) {
      alert('App data reset!');
    }
  };
  const handleDeleteAccount = () => {
    if (window.confirm('Are you sure you want to delete your account? This cannot be undone.')) {
      alert('Account deleted!');
    }
  };

  return (
    <BaseModal
      open={isOpen}
      onClose={onClose}
      title="App Settings"
      size="sm"
      description={<span className="text-slate-300 text-sm">Manage app-wide settings and preferences.</span>}
      footer={
        <button type="button" onClick={onClose} className="px-4 py-2 bg-white/10 text-white rounded-md hover:bg-white/20">Close</button>
      }
    >
      <div className="flex flex-col gap-4 py-2">
        {/* Profile Section */}
        {currentUserId && currentUserPerson && (
          <div className="flex flex-col gap-3 bg-slate-800/50 p-4 rounded-xl border border-white/5">
            <label className="text-violet-300 text-sm font-medium uppercase tracking-wider">Profile</label>
            <div className="flex items-center gap-4">
              <Avatar
                person={{ ...currentUserPerson, avatarUrl: avatarUrl }}
                size="lg"
              />
              <div className="flex flex-col gap-2">
                <h3 className="text-white font-medium">{currentUserPerson.name}</h3>
                <div className="flex gap-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept="image/*"
                    onChange={handleFileChange}
                  />
                  <button
                    onClick={triggerFileInput}
                    disabled={isUploading}
                    className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-md transition-colors"
                  >
                    {isUploading ? 'Uploading...' : 'Upload Photo'}
                  </button>
                  {avatarUrl && (
                    <button
                      onClick={handleRemovePhoto}
                      disabled={isUploading}
                      className="px-3 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs rounded-md transition-colors border border-rose-500/30"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-slate-500">Max size 100KB.</p>
              </div>
            </div>
          </div>
        )}

        {/* Admin Panel - Deletion Requests */}
        {currentUserId && (
          <AdminDeletionRequestsPanel
            currentUserId={currentUserId}
            onRequestProcessed={() => {
              // Optionally refresh groups or show notification
            }}
          />
        )}

        {/* Archived Groups Button */}
        <button
          type="button"
          onClick={() => setShowArchivedGroups(true)}
          className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-md text-left border-t border-slate-700 mt-4"
        >
          View Archived Groups
        </button>
        {showArchivedGroups && (
          <ArchivedGroupsModal
            isOpen={showArchivedGroups}
            onClose={() => setShowArchivedGroups(false)}
            currentUserId={currentUserId || "CURRENT_USER_ID"}
          />
        )}

        {/* Theme toggle */}
        <ThemeToggle theme={theme} onChange={setTheme} />

        {/* Currency selector */}
        <CurrencySelector value={currency} onChange={setCurrency} options={CURRENCIES} />

        {/* Notifications (placeholder) */}
        <div className="flex flex-col gap-2">
          <label className="text-slate-300 text-sm font-medium">Notifications</label>
          <div className="text-slate-400 text-xs">(Notification preferences coming soon)</div>
        </div>

        {/* Data management */}
        <DataExport onExport={handleExport} onImport={handleImport} />

        {/* Language selector */}
        <LanguageSelector value={language} onChange={setLanguage} options={LANGUAGES} />

        {/* Manage Payment Sources */}
        <button
          type="button"
          onClick={() => {
            onClose();
            actions.openPaymentSourceManage();
          }}
          className="px-3 py-2 bg-indigo-600/90 hover:bg-indigo-500 text-white text-sm rounded-md text-left"
        >
          Manage Payment Sources
        </button>

        {/* About section */}
        <AboutSection />

        {/* Danger zone */}
        <DangerZone onReset={handleReset} onDeleteAccount={handleDeleteAccount} />
      </div>
    </BaseModal>
  );
};

export default SettingsModal;
