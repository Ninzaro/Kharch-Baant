import React, { useState } from 'react';
import BaseModal from './BaseModal';
import { Group, Person } from '../types';
import { PlusIcon, UsersIcon } from './icons/Icons';
import GroupSelectionList from './GroupSelectionList';

interface AddActionModalProps {
  open: boolean;
  onClose: () => void;
  groups: Group[];
  onCreateGroup: () => void;
  onSelectGroupForExpense: (groupId: string) => void;
  currentGroupId?: string; // If viewing a specific group, this will be set
}

const AddActionModal: React.FC<AddActionModalProps> = ({
  open,
  onClose,
  groups,
  onCreateGroup,
  onSelectGroupForExpense,
  currentGroupId
}) => {
  const [showGroupSelection, setShowGroupSelection] = useState(false);

  const handleCreateGroup = () => {
    onClose();
    onCreateGroup();
  };

  const handleSelectGroup = (groupId: string) => {
    onClose();
    onSelectGroupForExpense(groupId);
  };

  const handleAddExpenseClick = () => {
    if (currentGroupId) {
      // If we're viewing a specific group, default to adding expense to it
      handleSelectGroup(currentGroupId);
    } else if (groups.length === 1) {
      // If only one group exists, use it directly
      handleSelectGroup(groups[0].id);
    } else {
      // Show group selection
      setShowGroupSelection(true);
    }
  };

  const handleBackToMain = () => {
    setShowGroupSelection(false);
  };

  // No groups scenario
  if (groups.length === 0) {
    return (
      <BaseModal
        open={open}
        onClose={onClose}
        title="Get Started"
        size="sm"
        description="Create your first group to start tracking expenses together."
        footer={
          <>
            <button 
              onClick={onClose} 
              className="px-4 py-2 bg-foreground/10 text-foreground rounded-md hover:bg-foreground/20"
            >
              Cancel
            </button>
            <button 
              onClick={handleCreateGroup}
              className="px-4 py-2 bg-gradient-to-br from-primary to-accent text-foreground rounded-md hover:from-primary/90 hover:to-accent/90"
            >
              Create First Group
            </button>
          </>
        }
      >
        <div className="text-center py-8">
          <div className="w-16 h-16 bg-gradient-to-br from-primary to-accent rounded-full flex items-center justify-center mx-auto mb-4">
            <UsersIcon className="h-8 w-8 text-foreground" />
          </div>
          <p className="text-muted-foreground text-sm">
            Groups help you organize expenses with family, friends, or colleagues. 
            Create your first group to get started!
          </p>
        </div>
      </BaseModal>
    );
  }

  // Group selection view
  if (showGroupSelection) {
    return (
      <BaseModal
        open={open}
        onClose={onClose}
        title="Select Group"
        size="md"
        description="Choose which group to add the expense to."
        footer={
          <>
            <button 
              onClick={handleBackToMain} 
              className="px-4 py-2 bg-foreground/10 text-foreground rounded-md hover:bg-foreground/20"
            >
              Back
            </button>
            <button 
              onClick={handleCreateGroup}
              className="px-4 py-2 bg-gradient-to-br from-success to-success text-success-foreground rounded-md hover:from-success/90 hover:to-success/80"
            >
              Create New Group
            </button>
          </>
        }
      >
        <GroupSelectionList
          groups={groups}
          people={people}
          onSelectGroup={handleSelectGroup}
          currentGroupId={currentGroupId}
        />
      </BaseModal>
    );
  }

  // Main action selection view
  const currentGroup = currentGroupId ? groups.find(g => g.id === currentGroupId) : null;

  return (
    <BaseModal
      open={open}
      onClose={onClose}
      title="Add New"
      size="sm"
      description="What would you like to do?"
      footer={
        <button 
          onClick={onClose} 
          className="px-4 py-2 bg-foreground/10 text-foreground rounded-md hover:bg-foreground/20"
        >
          Cancel
        </button>
      }
    >
      <div className="space-y-3">
        {/* Add Expense Option */}
        <button
          onClick={handleAddExpenseClick}
          className="w-full p-4 bg-gradient-to-br from-primary to-accent hover:from-primary/90 hover:to-accent/90 rounded-lg transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-foreground/20 rounded-lg flex items-center justify-center">
              <PlusIcon className="h-5 w-5 text-foreground" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">Add Expense</h3>
              <p className="text-foreground/80 text-sm">
                {currentGroup 
                  ? `Add to "${currentGroup.name}"`
                  : groups.length === 1 
                    ? `Add to "${groups[0].name}"`
                    : `Choose from ${groups.length} groups`
                }
              </p>
            </div>
          </div>
        </button>

        {/* Create Group Option */}
        <button
          onClick={handleCreateGroup}
          className="w-full p-4 bg-gradient-to-br from-success to-success hover:from-success/90 hover:to-success/80 rounded-lg transition-colors text-left text-success-foreground"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-foreground/20 rounded-lg flex items-center justify-center">
              <UsersIcon className="h-5 w-5 text-foreground" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">Create New Group</h3>
              <p className="text-foreground/80 text-sm">
                Start tracking expenses with a new group
              </p>
            </div>
          </div>
        </button>
      </div>
    </BaseModal>
  );
};

export default AddActionModal;