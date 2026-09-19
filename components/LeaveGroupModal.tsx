import React from 'react';
import BaseModal from './BaseModal';

interface LeaveGroupModalProps {
  isOpen: boolean;
  loading?: boolean;
  onClose: () => void;
  onLeave: () => void;
}

const LeaveGroupModal: React.FC<LeaveGroupModalProps> = ({
  isOpen,
  loading = false,
  onClose,
  onLeave,
}) => (
  <BaseModal
    open={isOpen}
    onClose={onClose}
    title="Leave Group?"
    size="sm"
    description={<span className="text-muted-foreground text-sm">You will lose access to this group.</span>}
    footer={
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onLeave}
          disabled={loading}
          className="px-4 py-2 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-md disabled:opacity-50"
        >
          {loading ? 'Leaving...' : 'Leave Group'}
        </button>
      </div>
    }
  >
    <p className="py-2 text-muted-foreground text-sm">
      Existing expenses will remain in the group history. You will need a new invite to join again.
    </p>
  </BaseModal>
);

export default LeaveGroupModal;
