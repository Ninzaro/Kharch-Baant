import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import ArchivedGroupsModal from './ArchivedGroupsModal';
import BaseModal from './BaseModal';
import ThemeToggle from './ThemeToggle';
import CurrencySelector from './CurrencySelector';
import LanguageSelector from './LanguageSelector';
import DataExport from './DataExport';
import DangerZone from './DangerZone';
import AboutSection from './AboutSection';
import AdminDeletionRequestsPanel from './AdminDeletionRequestsPanel';
import Avatar, { isStockAvatarUrl } from './Avatar';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import * as api from '../services/apiService';
import { Person, Theme } from '../types';
import toast from 'react-hot-toast';
import { updateUserAvatar, updatePerson } from '../services/supabaseApiService';
import { useAuth } from '../contexts/SupabaseAuthContext';
import { qk } from '../services/queries';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onManagePaymentSources: () => void;
  currentUserId?: string;
  currentUserPerson?: Person | null;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}


const SettingsModal: React.FC<SettingsModalProps> = ({ 
  isOpen, 
  onClose, 
  onManagePaymentSources, 
  currentUserId, 
  currentUserPerson,
  theme,
  onThemeChange
}) => {
  const { updateLocalPerson } = useAuth();
  const queryClient = useQueryClient();
  const [showArchivedGroups, setShowArchivedGroups] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isDeleteAccountModalOpen, setIsDeleteAccountModalOpen] = useState(false);

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

  const syncAvatarToCaches = (nextAvatar: string) => {
    if (!currentUserPerson) return;
    const updated: Person = { ...currentUserPerson, avatarUrl: nextAvatar };
    updateLocalPerson(updated);
    // Keep people lists in sync so Add Expense / GroupView show the new photo immediately
    queryClient.setQueriesData<Person[]>({ queryKey: ['people'] }, (old) => {
      if (!old) return old;
      return old.map((p) => (p.id === updated.id ? { ...p, avatarUrl: nextAvatar } : p));
    });
    void queryClient.invalidateQueries({ queryKey: qk.people(currentUserPerson.id) });
  };

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
        syncAvatarToCaches(base64);
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

    setIsUploading(true);
    setAvatarUrl(null); // Optimistic — Avatar component shows CSS initials for null/empty
    try {
      await updateUserAvatar(currentUserId, null); // Service stores '' to satisfy NOT NULL
      syncAvatarToCaches('');
      toast.success('Now showing initials.');
    } catch (error) {
      console.error('Failed to remove avatar', error);
      toast.error('Failed to update profile picture.');
      setAvatarUrl(currentUserPerson?.avatarUrl || null); // Revert
    } finally {
      setIsUploading(false);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  // Placeholder handlers
  const handleExport = () => toast.success('Exporting data...');
  const handleImport = (file: File) => toast.success(`Importing from ${file.name}`);
  const handleReset = () => setIsResetModalOpen(true);
  const handleDeleteAccount = () => setIsDeleteAccountModalOpen(true);

  return (
    <>
      <BaseModal
        open={isOpen}
        onClose={onClose}
        title="App Settings"
        size="sm"
        description={<span className="text-muted-foreground text-sm">Manage app-wide settings and preferences.</span>}
        footer={
          <button type="button" onClick={onClose} className="px-4 py-2 bg-foreground/10 text-foreground rounded-md hover:bg-foreground/20">Close</button>
        }
      >
        <div className="flex flex-col gap-4 py-2">
          {/* Profile Section */}
          {currentUserId && currentUserPerson && (
            <div className="flex flex-col gap-3 bg-muted bg-card/50 p-4 rounded-xl border border-border">
              <label className="text-violet-600 dark:text-violet-300 text-sm font-medium uppercase tracking-wider">Profile</label>
              <div className="flex items-center gap-4">
                <Avatar
                  person={{ ...currentUserPerson, avatarUrl: avatarUrl }}
                  size="lg"
                />
                <div className="flex flex-col gap-2">
                  <h3 className="text-foreground font-medium">{currentUserPerson.name}</h3>
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
                      className="px-3 py-1 bg-primary hover:bg-primary/90 text-primary-foreground text-xs rounded-md transition-colors"
                    >
                      {isUploading ? 'Uploading...' : 'Upload Photo'}
                    </button>
                    {avatarUrl && avatarUrl.trim() !== '' && !isStockAvatarUrl(avatarUrl) && (
                      <button
                        onClick={handleRemovePhoto}
                        disabled={isUploading}
                        className="px-3 py-1 bg-destructive/20 hover:bg-destructive/30 text-destructive text-xs rounded-md transition-colors border border-destructive/30"
                      >
                        Use Initials
                      </button>
                    )}
                    {avatarUrl && isStockAvatarUrl(avatarUrl) && (
                      <button
                        onClick={handleRemovePhoto}
                        disabled={isUploading}
                        className="px-3 py-1 bg-destructive/20 hover:bg-destructive/30 text-destructive text-xs rounded-md transition-colors border border-destructive/30"
                      >
                        Clear stock photo
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    No photo → initials. Upload optional (max 100KB).
                  </p>
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
            className="px-3 py-2 bg-muted hover:bg-muted text-foreground text-sm rounded-md text-left border-t border-border mt-4"
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
          <ThemeToggle theme={theme} onChange={onThemeChange} />

          {/* Currency selector — UI placeholder, not yet persisted */}
          <CurrencySelector value={currency} onChange={setCurrency} options={['INR', 'USD', 'EUR', 'GBP']} />

          {/* Notifications (placeholder) */}
          <div className="flex flex-col gap-2">
            <label className="text-muted-foreground text-sm font-medium">Notifications</label>
            <div className="text-muted-foreground text-xs">(Notification preferences coming soon)</div>
          </div>

          {/* Data management */}
          <DataExport onExport={handleExport} onImport={handleImport} />

          {/* Language selector — UI placeholder, not yet persisted */}
          <LanguageSelector value={language} onChange={setLanguage} options={['English', 'Hindi']} />

          {/* Manage Payment Sources */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onManagePaymentSources();
            }}
            className="px-3 py-2 bg-primary/90 hover:bg-primary/90 text-primary-foreground text-sm rounded-md text-left"
          >
            Manage Payment Sources
          </button>

          {/* About section */}
          <AboutSection />

          {/* Danger zone */}
          <DangerZone onReset={handleReset} onDeleteAccount={handleDeleteAccount} />
        </div>
      </BaseModal>

      {/* Confirmation Modals */}
      <ConfirmDeleteModal
        open={isResetModalOpen}
        entityType="transaction" // Reuse styling but change text
        entityName="All App Data"
        onConfirm={() => {
          toast.success('App data reset!');
          setIsResetModalOpen(false);
        }}
        onCancel={() => setIsResetModalOpen(false)}
        impactDescription="This will permanently delete all your local settings, cached data, and preferences. This action is irreversible."
      />

      <ConfirmDeleteModal
        open={isDeleteAccountModalOpen}
        entityType="transaction"
        entityName="Your Account"
        onConfirm={() => {
          toast.success('Account deleted!');
          setIsDeleteAccountModalOpen(false);
        }}
        onCancel={() => setIsDeleteAccountModalOpen(false)}
        impactDescription="This will permanently delete your profile and remove you from all groups. This action cannot be undone."
      />
    </>
  );
};

export default SettingsModal;
