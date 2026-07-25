import React from 'react';
import BaseModal from './BaseModal';

interface ArchivePromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onArchive: () => void;
}

const ArchivePromptModal: React.FC<ArchivePromptModalProps> = ({ isOpen, onClose, onArchive }) => (
  <BaseModal
    open={isOpen}
    onClose={onClose}
    title="Archive Group?"
    size="sm"
    description={<span className="text-muted-foreground text-sm">All balances are settled. Would you like to archive this group? You can find archived groups in App Settings.</span>}
    footer={
      <div className="flex gap-2">
        <button onClick={onClose} className="px-4 py-2 bg-foreground/10 text-foreground rounded-md hover:bg-foreground/20">Not Now</button>
        <button onClick={onArchive} className="px-4 py-2 bg-yellow-600/90 hover:bg-yellow-500 text-foreground rounded-md">Archive Group</button>
      </div>
    }
  >
    <div className="py-2 text-muted-foreground text-sm">
      Archiving will hide this group from your main view. You can always access archived groups from App Settings.
    </div>
  </BaseModal>
);

export default ArchivePromptModal;
