import React, { useEffect, useState } from 'react';
import BaseModal from './BaseModal';
import { getArchivedGroups, unarchiveGroup } from '../services/supabaseApiService';

interface ArchivedGroupsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserId: string;
}

const ArchivedGroupsModal: React.FC<ArchivedGroupsModalProps> = ({ isOpen, onClose, currentUserId }) => {
  const [archivedGroups, setArchivedGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [unarchivingId, setUnarchivingId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      getArchivedGroups(currentUserId)
        .then(groups => setArchivedGroups(groups))
        .finally(() => setLoading(false));
    }
  }, [isOpen, currentUserId]);

  return (
    <BaseModal
      open={isOpen}
      onClose={onClose}
      title="Archived Groups"
      size="sm"
      description={<span className="text-muted-foreground text-sm">Groups you have archived after settling up. You can restore or view details here.</span>}
      footer={<button onClick={onClose} className="px-4 py-2 bg-foreground/10 text-foreground rounded-md hover:bg-foreground/20">Close</button>}
    >
      <div className="flex flex-col gap-2 py-2">
        {loading ? (
          <div className="text-muted-foreground text-xs">Loading archived groups...</div>
        ) : archivedGroups.length === 0 ? (
          <div className="text-muted-foreground text-xs">No archived groups.</div>
        ) : (
          <ul className="space-y-2">
            {archivedGroups.map(g => (
              <li key={g.id} className="bg-foreground/5 rounded p-2 flex flex-col gap-1">
                <span className="font-medium text-foreground">{g.name}</span>
                <span className="text-xs text-muted-foreground">Currency: {g.currency}</span>
                <button
                  className="mt-1 px-3 py-1 bg-success/90 hover:bg-success text-success-foreground text-xs rounded disabled:opacity-50 w-max"
                  disabled={unarchivingId === g.id}
                  onClick={async () => {
                    setUnarchivingId(g.id);
                    try {
                      await unarchiveGroup(g.id);
                      setArchivedGroups(prev => prev.filter(gr => gr.id !== g.id));
                    } catch (e) {
                      alert(e.message || 'Failed to unarchive group.');
                    } finally {
                      setUnarchivingId(null);
                    }
                  }}
                >
                  {unarchivingId === g.id ? 'Restoring...' : 'Unarchive'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </BaseModal>
  );
};

export default ArchivedGroupsModal;
