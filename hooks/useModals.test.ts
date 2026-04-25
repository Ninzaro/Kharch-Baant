import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useModals } from './useModals';
import type { Transaction, Group, PaymentSource } from '../types';

// Mock data
const mockTransaction: Transaction = {
  id: 'txn-1',
  groupId: 'group-1',
  description: 'Lunch',
  amount: 50,
  paidById: 'person-1',
  split: {
    mode: 'equal',
    participants: [
      { personId: 'person-1', value: 1 },
      { personId: 'person-2', value: 1 },
    ],
  },
  date: '2025-01-15',
  tag: 'Food',
  type: 'expense',
};

const mockGroup: Group = {
  id: 'group-1',
  name: 'Test Group',
  members: ['person-1', 'person-2'],
  currency: 'USD',
  groupType: 'other',
};

const mockPaymentSource: PaymentSource = {
  id: 'ps-1',
  name: 'My Credit Card',
  type: 'Credit Card',
  isActive: true,
};

describe('useModals', () => {
  describe('Transaction Modals', () => {
    it('should open and close transaction form modal', () => {
      const { result } = renderHook(() => useModals());

      expect(result.current.modals.transactionForm.isOpen).toBe(false);

      act(() => {
        result.current.actions.openTransactionForm();
      });

      expect(result.current.modals.transactionForm.isOpen).toBe(true);
      expect(result.current.modals.transactionForm.editing).toBeNull();

      act(() => {
        result.current.actions.closeTransactionForm();
      });

      expect(result.current.modals.transactionForm.isOpen).toBe(false);
    });

    it('should open transaction form with editing data', () => {
      const { result } = renderHook(() => useModals());

      act(() => {
        result.current.actions.openTransactionForm(mockTransaction);
      });

      expect(result.current.modals.transactionForm.isOpen).toBe(true);
      expect(result.current.modals.transactionForm.editing).toEqual(mockTransaction);
    });

    it('should open and close transaction detail modal', () => {
      const { result } = renderHook(() => useModals());

      act(() => {
        result.current.actions.openTransactionDetail(mockTransaction);
      });

      expect(result.current.modals.transactionDetail.isOpen).toBe(true);
      expect(result.current.modals.transactionDetail.transaction).toEqual(mockTransaction);

      act(() => {
        result.current.actions.closeTransactionDetail();
      });

      expect(result.current.modals.transactionDetail.isOpen).toBe(false);
      expect(result.current.modals.transactionDetail.transaction).toBeNull();
    });
  });

  describe('Group Modals', () => {
    it('should open and close group form modal', () => {
      const { result } = renderHook(() => useModals());

      act(() => {
        result.current.actions.openGroupForm();
      });

      expect(result.current.modals.groupForm.isOpen).toBe(true);
      expect(result.current.modals.groupForm.editing).toBeNull();

      act(() => {
        result.current.actions.closeGroupForm();
      });

      expect(result.current.modals.groupForm.isOpen).toBe(false);
    });

    it('should open group form with editing data', () => {
      const { result } = renderHook(() => useModals());

      act(() => {
        result.current.actions.openGroupForm(mockGroup);
      });

      expect(result.current.modals.groupForm.editing).toEqual(mockGroup);
    });

    it('should handle share modal', () => {
      const { result } = renderHook(() => useModals());

      act(() => {
        result.current.actions.openShareModal('group-123');
      });

      expect(result.current.modals.shareModal.isOpen).toBe(true);
      expect(result.current.modals.shareModal.groupId).toBe('group-123');

      act(() => {
        result.current.actions.closeShareModal();
      });

      expect(result.current.modals.shareModal.isOpen).toBe(false);
      expect(result.current.modals.shareModal.groupId).toBeNull();
    });

    it('should handle member invite modal', () => {
      const { result } = renderHook(() => useModals());

      act(() => {
        result.current.actions.openMemberInvite('group-456');
      });

      expect(result.current.modals.memberInvite.isOpen).toBe(true);
      expect(result.current.modals.memberInvite.groupId).toBe('group-456');

      act(() => {
        result.current.actions.closeMemberInvite();
      });

      expect(result.current.modals.memberInvite.isOpen).toBe(false);
    });

    it('should handle archived groups modal', () => {
      const { result } = renderHook(() => useModals());

      act(() => {
        result.current.actions.openArchivedGroups();
      });

      expect(result.current.modals.archivedGroups.isOpen).toBe(true);

      act(() => {
        result.current.actions.closeArchivedGroups();
      });

      expect(result.current.modals.archivedGroups.isOpen).toBe(false);
    });

    it('should handle archive prompt modal', () => {
      const { result } = renderHook(() => useModals());

      act(() => {
        result.current.actions.openArchivePrompt('group-789');
      });

      expect(result.current.modals.archivePrompt.isOpen).toBe(true);
      expect(result.current.modals.archivePrompt.groupId).toBe('group-789');

      act(() => {
        result.current.actions.closeArchivePrompt();
      });

      expect(result.current.modals.archivePrompt.isOpen).toBe(false);
    });
  });

  describe('Payment Modals', () => {
    it('should handle payment source form modal', () => {
      const { result } = renderHook(() => useModals());

      act(() => {
        result.current.actions.openPaymentSourceForm();
      });

      expect(result.current.modals.paymentSourceForm.isOpen).toBe(true);

      act(() => {
        result.current.actions.closePaymentSourceForm();
      });

      expect(result.current.modals.paymentSourceForm.isOpen).toBe(false);
    });

    it('should handle payment source manage modal', () => {
      const { result } = renderHook(() => useModals());

      act(() => {
        result.current.actions.openPaymentSourceManage();
      });

      expect(result.current.modals.paymentSourceManage.isOpen).toBe(true);

      act(() => {
        result.current.actions.closePaymentSourceManage();
      });

      expect(result.current.modals.paymentSourceManage.isOpen).toBe(false);
    });
  });

  describe('Settlement & Balance Modals', () => {
    it('should open settle up modal with default config', () => {
      const { result } = renderHook(() => useModals());

      act(() => {
        result.current.actions.openSettleUp({
          defaultPayer: 'person-1',
          defaultReceiver: 'person-2',
          defaultAmount: 100,
        });
      });

      expect(result.current.modals.settleUp.isOpen).toBe(true);
      expect(result.current.modals.settleUp.defaultPayer).toBe('person-1');
      expect(result.current.modals.settleUp.defaultReceiver).toBe('person-2');
      expect(result.current.modals.settleUp.defaultAmount).toBe(100);

      act(() => {
        result.current.actions.closeSettleUp();
      });

      expect(result.current.modals.settleUp.isOpen).toBe(false);
    });

    it('should handle balance breakdown modal', () => {
      const { result } = renderHook(() => useModals());

      act(() => {
        result.current.actions.openBalanceBreakdown('group-1', 'person-1');
      });

      expect(result.current.modals.balanceBreakdown.isOpen).toBe(true);
      expect(result.current.modals.balanceBreakdown.groupId).toBe('group-1');
      expect(result.current.modals.balanceBreakdown.personId).toBe('person-1');

      act(() => {
        result.current.actions.closeBalanceBreakdown();
      });

      expect(result.current.modals.balanceBreakdown.isOpen).toBe(false);
      expect(result.current.modals.balanceBreakdown.groupId).toBeNull();
      expect(result.current.modals.balanceBreakdown.personId).toBeNull();
    });
  });

  describe('Filter & View Modals', () => {
    it('should handle calendar modal', () => {
      const { result } = renderHook(() => useModals());
      const testDate = new Date('2025-01-15');

      act(() => {
        result.current.actions.openCalendar(testDate);
      });

      expect(result.current.modals.calendar.isOpen).toBe(true);
      expect(result.current.modals.calendar.selectedDate).toEqual(testDate);

      act(() => {
        result.current.actions.closeCalendar();
      });

      expect(result.current.modals.calendar.isOpen).toBe(false);
    });

    it('should handle date filter modal', () => {
      const { result } = renderHook(() => useModals());
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-31');

      act(() => {
        result.current.actions.openDateFilter(startDate, endDate);
      });

      expect(result.current.modals.dateFilter.isOpen).toBe(true);
      expect(result.current.modals.dateFilter.startDate).toEqual(startDate);
      expect(result.current.modals.dateFilter.endDate).toEqual(endDate);

      act(() => {
        result.current.actions.closeDateFilter();
      });

      expect(result.current.modals.dateFilter.isOpen).toBe(false);
    });
  });

  describe('Utility Modals', () => {
    it('should handle add action modal', () => {
      const { result } = renderHook(() => useModals());

      act(() => {
        result.current.actions.openAddAction();
      });

      expect(result.current.modals.addAction.isOpen).toBe(true);

      act(() => {
        result.current.actions.closeAddAction();
      });

      expect(result.current.modals.addAction.isOpen).toBe(false);
    });

    it('should handle settings modal', () => {
      const { result } = renderHook(() => useModals());

      act(() => {
        result.current.actions.openSettings();
      });

      expect(result.current.modals.settings.isOpen).toBe(true);

      act(() => {
        result.current.actions.closeSettings();
      });

      expect(result.current.modals.settings.isOpen).toBe(false);
    });
  });

  describe('Delete Confirmations', () => {
    it('should handle transaction delete request and cancellation', () => {
      const { result } = renderHook(() => useModals());

      act(() => {
        result.current.actions.requestDeleteTransaction(mockTransaction);
      });

      expect(result.current.modals.deleteTransaction.isOpen).toBe(true);
      expect(result.current.modals.deleteTransaction.transaction).toEqual(mockTransaction);
      expect(result.current.modals.deleteTransaction.isDeleting).toBe(false);

      act(() => {
        result.current.actions.cancelDeleteTransaction();
      });

      expect(result.current.modals.deleteTransaction.isOpen).toBe(false);
      expect(result.current.modals.deleteTransaction.transaction).toBeNull();
    });

    it('should successfully delete transaction', async () => {
      const mockDeleteFn = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useModals(mockDeleteFn));

      act(() => {
        result.current.actions.requestDeleteTransaction(mockTransaction);
      });

      expect(result.current.modals.deleteTransaction.transaction).toEqual(mockTransaction);

      await act(async () => {
        await result.current.actions.confirmDeleteTransaction();
      });

      expect(mockDeleteFn).toHaveBeenCalledWith('txn-1');
      expect(result.current.modals.deleteTransaction.isOpen).toBe(false);
      expect(result.current.modals.deleteTransaction.transaction).toBeNull();
      expect(result.current.modals.deleteTransaction.isDeleting).toBe(false);
    });

    it('should handle transaction delete error', async () => {
      const mockDeleteFn = vi.fn().mockRejectedValue(new Error('Delete failed'));
      const { result } = renderHook(() => useModals(mockDeleteFn));

      act(() => {
        result.current.actions.requestDeleteTransaction(mockTransaction);
      });

      await expect(async () => {
        await act(async () => {
          await result.current.actions.confirmDeleteTransaction();
        });
      }).rejects.toThrow('Delete failed');

      expect(mockDeleteFn).toHaveBeenCalledWith('txn-1');
      expect(result.current.modals.deleteTransaction.isOpen).toBe(true);
      expect(result.current.modals.deleteTransaction.isDeleting).toBe(false);
    });

    it('should handle payment source delete request and cancellation', () => {
      const { result } = renderHook(() => useModals());

      act(() => {
        result.current.actions.requestDeletePaymentSource(mockPaymentSource);
      });

      expect(result.current.modals.deletePaymentSource.isOpen).toBe(true);
      expect(result.current.modals.deletePaymentSource.paymentSource).toEqual(mockPaymentSource);

      act(() => {
        result.current.actions.cancelDeletePaymentSource();
      });

      expect(result.current.modals.deletePaymentSource.isOpen).toBe(false);
      expect(result.current.modals.deletePaymentSource.paymentSource).toBeNull();
    });

    it('should successfully delete payment source', async () => {
      const mockDeleteFn = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useModals(undefined, mockDeleteFn));

      act(() => {
        result.current.actions.requestDeletePaymentSource(mockPaymentSource);
      });

      await act(async () => {
        await result.current.actions.confirmDeletePaymentSource();
      });

      expect(mockDeleteFn).toHaveBeenCalledWith('ps-1');
      expect(result.current.modals.deletePaymentSource.isOpen).toBe(false);
      expect(result.current.modals.deletePaymentSource.paymentSource).toBeNull();
    });

    it('should handle payment source delete error', async () => {
      const mockDeleteFn = vi.fn().mockRejectedValue(new Error('Delete failed'));
      const { result } = renderHook(() => useModals(undefined, mockDeleteFn));

      act(() => {
        result.current.actions.requestDeletePaymentSource(mockPaymentSource);
      });

      await expect(async () => {
        await act(async () => {
          await result.current.actions.confirmDeletePaymentSource();
        });
      }).rejects.toThrow('Delete failed');

      expect(result.current.modals.deletePaymentSource.isOpen).toBe(true);
      expect(result.current.modals.deletePaymentSource.isDeleting).toBe(false);
    });

    it('should not delete if callback is not provided', async () => {
      const { result } = renderHook(() => useModals());

      act(() => {
        result.current.actions.requestDeleteTransaction(mockTransaction);
      });

      await act(async () => {
        await result.current.actions.confirmDeleteTransaction();
      });

      // Should remain open since no delete callback
      expect(result.current.modals.deleteTransaction.isOpen).toBe(true);
    });
  });

  describe('Close All', () => {
    it('should close all modals at once', () => {
      const { result } = renderHook(() => useModals());

      // Open multiple modals
      act(() => {
        result.current.actions.openTransactionForm();
        result.current.actions.openGroupForm();
        result.current.actions.openSettings();
        result.current.actions.openShareModal('group-1');
      });

      expect(result.current.modals.transactionForm.isOpen).toBe(true);
      expect(result.current.modals.groupForm.isOpen).toBe(true);
      expect(result.current.modals.settings.isOpen).toBe(true);
      expect(result.current.modals.shareModal.isOpen).toBe(true);

      // Close all
      act(() => {
        result.current.actions.closeAll();
      });

      expect(result.current.modals.transactionForm.isOpen).toBe(false);
      expect(result.current.modals.groupForm.isOpen).toBe(false);
      expect(result.current.modals.settings.isOpen).toBe(false);
      expect(result.current.modals.shareModal.isOpen).toBe(false);
    });
  });

  describe('Stale Closure Prevention', () => {
    it('should use fresh state in delete confirmation', async () => {
      const mockDeleteFn = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useModals(mockDeleteFn));

      // Request delete for first transaction
      act(() => {
        result.current.actions.requestDeleteTransaction(mockTransaction);
      });

      // Update to different transaction
      const secondTransaction = { ...mockTransaction, id: 'txn-2', description: 'Dinner' };
      act(() => {
        result.current.actions.requestDeleteTransaction(secondTransaction);
      });

      // Confirm delete - should delete the second transaction
      await act(async () => {
        await result.current.actions.confirmDeleteTransaction();
      });

      expect(mockDeleteFn).toHaveBeenCalledWith('txn-2');
      expect(mockDeleteFn).not.toHaveBeenCalledWith('txn-1');
    });
  });

  describe('Group Confirmation Modals', () => {
    it('requestConfirmDeleteGroup opens modal with the group', () => {
      const { result } = renderHook(() => useModals());
      expect(result.current.modals.confirmDeleteGroup.isOpen).toBe(false);

      act(() => {
        result.current.actions.requestConfirmDeleteGroup(mockGroup);
      });

      expect(result.current.modals.confirmDeleteGroup.isOpen).toBe(true);
      expect(result.current.modals.confirmDeleteGroup.group).toEqual(mockGroup);
      expect(result.current.modals.confirmDeleteGroup.isProcessing).toBe(false);
    });

    it('cancelConfirmDeleteGroup resets state', () => {
      const { result } = renderHook(() => useModals());
      act(() => { result.current.actions.requestConfirmDeleteGroup(mockGroup); });
      act(() => { result.current.actions.cancelConfirmDeleteGroup(); });

      expect(result.current.modals.confirmDeleteGroup.isOpen).toBe(false);
      expect(result.current.modals.confirmDeleteGroup.group).toBeNull();
    });

    it('confirmDeleteGroup calls onDeleteGroup and resets state on success', async () => {
      const onDeleteGroup = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useModals(undefined, undefined, onDeleteGroup));

      act(() => { result.current.actions.requestConfirmDeleteGroup(mockGroup); });
      await act(async () => { await result.current.actions.confirmDeleteGroup(); });

      expect(onDeleteGroup).toHaveBeenCalledWith(mockGroup);
      expect(result.current.modals.confirmDeleteGroup.isOpen).toBe(false);
      expect(result.current.modals.confirmDeleteGroup.isProcessing).toBe(false);
    });

    it('requestConfirmArchiveGroup opens modal with the group', () => {
      const { result } = renderHook(() => useModals());
      act(() => { result.current.actions.requestConfirmArchiveGroup(mockGroup); });

      expect(result.current.modals.confirmArchiveGroup.isOpen).toBe(true);
      expect(result.current.modals.confirmArchiveGroup.group).toEqual(mockGroup);
    });

    it('confirmArchiveGroup calls onArchiveGroup and resets state on success', async () => {
      const onArchiveGroup = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useModals(undefined, undefined, undefined, onArchiveGroup));

      act(() => { result.current.actions.requestConfirmArchiveGroup(mockGroup); });
      await act(async () => { await result.current.actions.confirmArchiveGroup(); });

      expect(onArchiveGroup).toHaveBeenCalledWith(mockGroup);
      expect(result.current.modals.confirmArchiveGroup.isOpen).toBe(false);
      expect(result.current.modals.confirmArchiveGroup.isProcessing).toBe(false);
    });

    it('confirmDeleteGroup re-throws error and resets isProcessing on failure', async () => {
      const onDeleteGroup = vi.fn().mockRejectedValue(new Error('Delete group failed'));
      const { result } = renderHook(() => useModals(undefined, undefined, onDeleteGroup));

      act(() => { result.current.actions.requestConfirmDeleteGroup(mockGroup); });

      await expect(async () => {
        await act(async () => { await result.current.actions.confirmDeleteGroup(); });
      }).rejects.toThrow('Delete group failed');

      expect(result.current.modals.confirmDeleteGroup.isOpen).toBe(true);
      expect(result.current.modals.confirmDeleteGroup.isProcessing).toBe(false);
    });

    it('confirmArchiveGroup re-throws error and resets isProcessing on failure', async () => {
      const onArchiveGroup = vi.fn().mockRejectedValue(new Error('Archive group failed'));
      const { result } = renderHook(() => useModals(undefined, undefined, undefined, onArchiveGroup));

      act(() => { result.current.actions.requestConfirmArchiveGroup(mockGroup); });

      await expect(async () => {
        await act(async () => { await result.current.actions.confirmArchiveGroup(); });
      }).rejects.toThrow('Archive group failed');

      expect(result.current.modals.confirmArchiveGroup.isOpen).toBe(true);
      expect(result.current.modals.confirmArchiveGroup.isProcessing).toBe(false);
    });

    it('confirmLeaveGroup re-throws error and resets isProcessing on failure', async () => {
      const onLeaveGroup = vi.fn().mockRejectedValue(new Error('Leave group failed'));
      const saveData: Omit<Group, 'id'> = { name: 'Test Group', members: ['person-2'], currency: 'USD', groupType: 'other' };
      const { result } = renderHook(() =>
        useModals(undefined, undefined, undefined, undefined, onLeaveGroup)
      );

      act(() => { result.current.actions.requestConfirmLeaveGroup(mockGroup, saveData); });

      await expect(async () => {
        await act(async () => { await result.current.actions.confirmLeaveGroup(); });
      }).rejects.toThrow('Leave group failed');

      expect(result.current.modals.confirmLeaveGroup.isOpen).toBe(true);
      expect(result.current.modals.confirmLeaveGroup.isProcessing).toBe(false);
    });

    it('requestConfirmLeaveGroup opens modal with group and saveData', () => {
      const saveData: Omit<Group, 'id'> = {
        name: 'Test Group',
        members: ['person-2'],
        currency: 'USD',
        groupType: 'other',
      };
      const { result } = renderHook(() => useModals());
      act(() => { result.current.actions.requestConfirmLeaveGroup(mockGroup, saveData); });

      expect(result.current.modals.confirmLeaveGroup.isOpen).toBe(true);
      expect(result.current.modals.confirmLeaveGroup.group).toEqual(mockGroup);
      expect(result.current.modals.confirmLeaveGroup.pendingSaveData).toEqual(saveData);
    });

    it('confirmLeaveGroup calls onLeaveGroup with group and saveData', async () => {
      const onLeaveGroup = vi.fn().mockResolvedValue(undefined);
      const saveData: Omit<Group, 'id'> = { name: 'Test Group', members: ['person-2'], currency: 'USD', groupType: 'other' };
      const { result } = renderHook(() =>
        useModals(undefined, undefined, undefined, undefined, onLeaveGroup)
      );

      act(() => { result.current.actions.requestConfirmLeaveGroup(mockGroup, saveData); });
      await act(async () => { await result.current.actions.confirmLeaveGroup(); });

      expect(onLeaveGroup).toHaveBeenCalledWith(mockGroup, saveData);
      expect(result.current.modals.confirmLeaveGroup.isOpen).toBe(false);
    });

    it('settleUp can carry an initialTransaction', () => {
      const { result } = renderHook(() => useModals());
      act(() => {
        result.current.actions.openSettleUp({ initialTransaction: mockTransaction });
      });

      expect(result.current.modals.settleUp.isOpen).toBe(true);
      expect(result.current.modals.settleUp.initialTransaction).toEqual(mockTransaction);
    });
  });
});
