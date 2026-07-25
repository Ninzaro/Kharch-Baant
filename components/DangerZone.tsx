import React from 'react';

interface DangerZoneProps {
  onReset: () => void;
  onDeleteAccount?: () => void;
}

const DangerZone: React.FC<DangerZoneProps> = ({ onReset, onDeleteAccount }) => (
  <div className="flex flex-col gap-2 mt-4 border-t border-red-500 pt-4">
    <label className="text-red-400 text-sm font-medium">Danger Zone</label>
    <button
      className="px-3 py-2 bg-red-600/90 hover:bg-red-500 text-foreground text-sm rounded-md"
      onClick={onReset}
    >
      Reset All App Data
    </button>
    {onDeleteAccount && (
      <button
        className="px-3 py-2 bg-red-800/90 hover:bg-red-700 text-foreground text-sm rounded-md"
        onClick={onDeleteAccount}
      >
        Delete Account
      </button>
    )}
  </div>
);

export default DangerZone;
