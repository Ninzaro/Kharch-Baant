import React from 'react';

interface DangerZoneProps {
  onReset: () => void;
  onDeleteAccount?: () => void;
}

const DangerZone: React.FC<DangerZoneProps> = ({ onReset, onDeleteAccount }) => (
  <div className="flex flex-col gap-2 mt-4 border-t border-destructive/50 pt-4">
    <label className="text-destructive text-sm font-medium">Danger Zone</label>
    <button
      type="button"
      className="px-3 py-2 bg-destructive/90 hover:bg-destructive text-destructive-foreground text-sm rounded-md"
      onClick={onReset}
    >
      Reset All App Data
    </button>
    {onDeleteAccount && (
      <button
        type="button"
        className="px-3 py-2 bg-destructive hover:bg-destructive/90 text-destructive-foreground text-sm rounded-md border border-destructive"
        onClick={onDeleteAccount}
      >
        Delete Account
      </button>
    )}
  </div>
);

export default DangerZone;
