import React, { useState, useCallback } from 'react';
import { Transaction, Group, PaymentSource } from '../types';

interface ModalState {
  // Transaction modals
  transactionForm: {
    isOpen: boolean;
    editing: Transaction | null;
  };
  transactionDetail: {
    isOpen: boolean;
    transaction: Transaction | null;
  };
  // Group modals
  groupForm: {
    isOpen: boolean;
    editing: Group | null;
  };
  shareModal: {
    isOpen: boolean;
    groupId: string | null;
  };
  memberInvite: {
    isOpen: boolean;
    groupId: string | null;
  };
  archivedGroups: {
    isOpen: boolean;
  };
  archivePrompt: {
    isOpen: boolean;
    groupId: string | null;
  };

  // Payment modals
  paymentSourceForm: {
    isOpen: boolean;
  };
  paymentSourceManage: {
    isOpen: boolean;
  };

  // Settlement & Balance
  settleUp: {
    isOpen: boolean;
    defaultPayer?: string;
    defaultReceiver?: string;
    defaultAmount?: number;
    initialTransaction?: Transaction;
  };
  balanceBreakdown: {
    isOpen: boolean;
    groupId: string | null;
    personId: string | null;
  };

  // Filters & Views
  calendar: {
    isOpen: boolean;
    selectedDate?: Date;
  };
  dateFilter: {
    isOpen: boolean;
    startDate?: Date;
    endDate?: Date;
  };

  // Utility modals
  addAction: {
    isOpen: boolean;
  };
  settings: {
    isOpen: boolean;
  };

  // Delete confirmations
  deleteTransaction: {
    isOpen: boolean;
    transaction: Transaction | null;
    isDeleting: boolean;
  };
  deletePaymentSource: {
    isOpen: boolean;
    paymentSource: PaymentSource | null;
    isDeleting: boolean;
  };

  // Group confirmation modals
  confirmDeleteGroup: {
    isOpen: boolean;
    group: Group | null;
    isProcessing: boolean;
  };
  confirmArchiveGroup: {
    isOpen: boolean;
    group: Group | null;
    isProcessing: boolean;
  };
  confirmLeaveGroup: {
    isOpen: boolean;
    group: Group | null;
    pendingSaveData: Omit<Group, 'id'> | null;
    isProcessing: boolean;
  };
}

interface ModalActions {
  // Transaction actions
  openTransactionForm: (editing?: Transaction | null) => void;
  closeTransactionForm: () => void;
  openTransactionDetail: (transaction: Transaction) => void;
  closeTransactionDetail: () => void;

  // Group actions
  openGroupForm: (editing?: Group | null) => void;
  closeGroupForm: () => void;
  openShareModal: (groupId: string) => void;
  closeShareModal: () => void;
  openMemberInvite: (groupId: string) => void;
  closeMemberInvite: () => void;
  openArchivedGroups: () => void;
  closeArchivedGroups: () => void;
  openArchivePrompt: (groupId: string) => void;
  closeArchivePrompt: () => void;

  // Payment actions
  openPaymentSourceForm: () => void;
  closePaymentSourceForm: () => void;
  openPaymentSourceManage: () => void;
  closePaymentSourceManage: () => void;

  // Settlement & Balance actions
  openSettleUp: (config?: {
    defaultPayer?: string;
    defaultReceiver?: string;
    defaultAmount?: number;
    initialTransaction?: Transaction;
  }) => void;
  closeSettleUp: () => void;
  openBalanceBreakdown: (groupId: string, personId: string) => void;
  closeBalanceBreakdown: () => void;

  // Filter & View actions
  openCalendar: (selectedDate?: Date) => void;
  closeCalendar: () => void;
  openDateFilter: (startDate?: Date, endDate?: Date) => void;
  closeDateFilter: () => void;

  // Utility actions
  openAddAction: () => void;
  closeAddAction: () => void;
  openSettings: () => void;
  closeSettings: () => void;

  // Delete confirmations
  requestDeleteTransaction: (transaction: Transaction) => void;
  confirmDeleteTransaction: () => Promise<void>;
  cancelDeleteTransaction: () => void;
  requestDeletePaymentSource: (paymentSource: PaymentSource) => void;
  confirmDeletePaymentSource: () => Promise<void>;
  cancelDeletePaymentSource: () => void;

  // Group confirmation actions
  requestConfirmDeleteGroup: (group: Group) => void;
  confirmDeleteGroup: () => Promise<void>;
  cancelConfirmDeleteGroup: () => void;
  requestConfirmArchiveGroup: (group: Group) => void;
  confirmArchiveGroup: () => Promise<void>;
  cancelConfirmArchiveGroup: () => void;
  requestConfirmLeaveGroup: (group: Group, pendingSaveData: Omit<Group, 'id'>) => void;
  confirmLeaveGroup: () => Promise<void>;
  cancelConfirmLeaveGroup: () => void;

  // Utility
  closeAll: () => void;
}

const initialState: ModalState = {
  transactionForm: { isOpen: false, editing: null },
  transactionDetail: { isOpen: false, transaction: null },
  groupForm: { isOpen: false, editing: null },
  shareModal: { isOpen: false, groupId: null },
  memberInvite: { isOpen: false, groupId: null },
  archivedGroups: { isOpen: false },
  archivePrompt: { isOpen: false, groupId: null },
  paymentSourceForm: { isOpen: false },
  paymentSourceManage: { isOpen: false },
  settleUp: { isOpen: false, defaultPayer: undefined, defaultReceiver: undefined, defaultAmount: undefined, initialTransaction: undefined },
  balanceBreakdown: { isOpen: false, groupId: null, personId: null },
  calendar: { isOpen: false, selectedDate: undefined },
  dateFilter: { isOpen: false, startDate: undefined, endDate: undefined },
  addAction: { isOpen: false },
  settings: { isOpen: false },
  deleteTransaction: { isOpen: false, transaction: null, isDeleting: false },
  deletePaymentSource: { isOpen: false, paymentSource: null, isDeleting: false },
  confirmDeleteGroup: { isOpen: false, group: null, isProcessing: false },
  confirmArchiveGroup: { isOpen: false, group: null, isProcessing: false },
  confirmLeaveGroup: { isOpen: false, group: null, pendingSaveData: null, isProcessing: false },
};

export function useModals(
  onDeleteTransaction?: (id: string) => Promise<void>,
  onDeletePaymentSource?: (id: string) => Promise<void>,
  onDeleteGroup?: (group: Group) => Promise<void>,
  onArchiveGroup?: (group: Group) => Promise<void>,
  onLeaveGroup?: (group: Group, saveData: Omit<Group, 'id'>) => Promise<void>,
) {
  const [state, setState] = useState<ModalState>(initialState);
  const stateRef = React.useRef(state);
  // Always keep ref in sync
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // ── Simple open/close helpers ───────────────────────────────────────────

  // Transaction form
  const openTransactionForm = useCallback((editing?: Transaction | null) => {
    setState(s => ({ ...s, transactionForm: { isOpen: true, editing: editing ?? null } }));
  }, []);
  const closeTransactionForm = useCallback(() => {
    setState(s => ({ ...s, transactionForm: initialState.transactionForm }));
  }, []);

  // Transaction detail
  const openTransactionDetail = useCallback((transaction: Transaction) => {
    setState(s => ({ ...s, transactionDetail: { isOpen: true, transaction } }));
  }, []);
  const closeTransactionDetail = useCallback(() => {
    setState(s => ({ ...s, transactionDetail: initialState.transactionDetail }));
  }, []);

  // Group form
  const openGroupForm = useCallback((editing?: Group | null) => {
    setState(s => ({ ...s, groupForm: { isOpen: true, editing: editing ?? null } }));
  }, []);
  const closeGroupForm = useCallback(() => {
    setState(s => ({ ...s, groupForm: initialState.groupForm }));
  }, []);

  // Share modal
  const openShareModal = useCallback((groupId: string) => {
    setState(s => ({ ...s, shareModal: { isOpen: true, groupId } }));
  }, []);
  const closeShareModal = useCallback(() => {
    setState(s => ({ ...s, shareModal: initialState.shareModal }));
  }, []);

  // Member invite
  const openMemberInvite = useCallback((groupId: string) => {
    setState(s => ({ ...s, memberInvite: { isOpen: true, groupId } }));
  }, []);
  const closeMemberInvite = useCallback(() => {
    setState(s => ({ ...s, memberInvite: initialState.memberInvite }));
  }, []);

  // Archived groups
  const openArchivedGroups = useCallback(() => {
    setState(s => ({ ...s, archivedGroups: { isOpen: true } }));
  }, []);
  const closeArchivedGroups = useCallback(() => {
    setState(s => ({ ...s, archivedGroups: initialState.archivedGroups }));
  }, []);

  // Archive prompt
  const openArchivePrompt = useCallback((groupId: string) => {
    setState(s => ({ ...s, archivePrompt: { isOpen: true, groupId } }));
  }, []);
  const closeArchivePrompt = useCallback(() => {
    setState(s => ({ ...s, archivePrompt: initialState.archivePrompt }));
  }, []);

  // Payment source form
  const openPaymentSourceForm = useCallback(() => {
    setState(s => ({ ...s, paymentSourceForm: { isOpen: true } }));
  }, []);
  const closePaymentSourceForm = useCallback(() => {
    setState(s => ({ ...s, paymentSourceForm: initialState.paymentSourceForm }));
  }, []);

  // Payment source manage
  const openPaymentSourceManage = useCallback(() => {
    setState(s => ({ ...s, paymentSourceManage: { isOpen: true } }));
  }, []);
  const closePaymentSourceManage = useCallback(() => {
    setState(s => ({ ...s, paymentSourceManage: initialState.paymentSourceManage }));
  }, []);

  // Settle up
  const openSettleUp = useCallback((config?: {
    defaultPayer?: string;
    defaultReceiver?: string;
    defaultAmount?: number;
    initialTransaction?: Transaction;
  }) => {
    setState(s => ({
      ...s,
      settleUp: {
        isOpen: true,
        defaultPayer: config?.defaultPayer,
        defaultReceiver: config?.defaultReceiver,
        defaultAmount: config?.defaultAmount,
        initialTransaction: config?.initialTransaction,
      },
    }));
  }, []);
  const closeSettleUp = useCallback(() => {
    setState(s => ({ ...s, settleUp: initialState.settleUp }));
  }, []);

  // Balance breakdown
  const openBalanceBreakdown = useCallback((groupId: string, personId: string) => {
    setState(s => ({ ...s, balanceBreakdown: { isOpen: true, groupId, personId } }));
  }, []);
  const closeBalanceBreakdown = useCallback(() => {
    setState(s => ({ ...s, balanceBreakdown: initialState.balanceBreakdown }));
  }, []);

  // Calendar
  const openCalendar = useCallback((selectedDate?: Date) => {
    setState(s => ({ ...s, calendar: { isOpen: true, selectedDate } }));
  }, []);
  const closeCalendar = useCallback(() => {
    setState(s => ({ ...s, calendar: initialState.calendar }));
  }, []);

  // Date filter
  const openDateFilter = useCallback((startDate?: Date, endDate?: Date) => {
    setState(s => ({ ...s, dateFilter: { isOpen: true, startDate, endDate } }));
  }, []);
  const closeDateFilter = useCallback(() => {
    setState(s => ({ ...s, dateFilter: initialState.dateFilter }));
  }, []);

  // Add action
  const openAddAction = useCallback(() => {
    setState(s => ({ ...s, addAction: { isOpen: true } }));
  }, []);
  const closeAddAction = useCallback(() => {
    setState(s => ({ ...s, addAction: initialState.addAction }));
  }, []);

  // Settings
  const openSettings = useCallback(() => {
    setState(s => ({ ...s, settings: { isOpen: true } }));
  }, []);
  const closeSettings = useCallback(() => {
    setState(s => ({ ...s, settings: initialState.settings }));
  }, []);

  // ── Delete confirmations ────────────────────────────────────────────────

  const requestDeleteTransaction = useCallback((transaction: Transaction) => {
    if (!transaction || typeof transaction !== 'object' || !transaction.id) {
      console.warn('requestDeleteTransaction: Invalid transaction', transaction);
      return;
    }
    setState(s => ({
      ...s,
      deleteTransaction: { isOpen: true, transaction, isDeleting: false },
    }));
  }, []);

  const confirmDeleteTransaction = useCallback(async () => {
    const transaction = stateRef.current.deleteTransaction.transaction;
    if (!transaction || !onDeleteTransaction) return;
    setState(s => ({
      ...s,
      deleteTransaction: { ...s.deleteTransaction, isDeleting: true },
    }));
    try {
      await onDeleteTransaction(transaction.id);
      setState(s => ({
        ...s,
        deleteTransaction: { isOpen: false, transaction: null, isDeleting: false },
      }));
    } catch (error) {
      setState(s => ({
        ...s,
        deleteTransaction: { ...s.deleteTransaction, isDeleting: false },
      }));
      throw error;
    }
  }, [onDeleteTransaction]);

  const cancelDeleteTransaction = useCallback(() => {
    setState(s => ({
      ...s,
      deleteTransaction: initialState.deleteTransaction,
    }));
  }, []);

  const requestDeletePaymentSource = useCallback((paymentSource: PaymentSource) => {
    if (!paymentSource || typeof paymentSource !== 'object' || !paymentSource.id) {
      console.warn('requestDeletePaymentSource: Invalid paymentSource', paymentSource);
      return;
    }
    setState(s => ({
      ...s,
      deletePaymentSource: { isOpen: true, paymentSource, isDeleting: false },
    }));
  }, []);

  const confirmDeletePaymentSource = useCallback(async () => {
    const paymentSource = stateRef.current.deletePaymentSource.paymentSource;
    if (!paymentSource || !onDeletePaymentSource) return;
    setState(s => ({
      ...s,
      deletePaymentSource: { ...s.deletePaymentSource, isDeleting: true },
    }));
    try {
      await onDeletePaymentSource(paymentSource.id);
      setState(s => ({
        ...s,
        deletePaymentSource: { isOpen: false, paymentSource: null, isDeleting: false },
      }));
    } catch (error) {
      setState(s => ({
        ...s,
        deletePaymentSource: { ...s.deletePaymentSource, isDeleting: false },
      }));
      throw error;
    }
  }, [onDeletePaymentSource]);

  const cancelDeletePaymentSource = useCallback(() => {
    setState(s => ({
      ...s,
      deletePaymentSource: initialState.deletePaymentSource,
    }));
  }, []);

  // ── Group confirmation actions ──────────────────────────────────────────

  const requestConfirmDeleteGroup = useCallback((group: Group) => {
    setState(s => ({
      ...s,
      confirmDeleteGroup: { isOpen: true, group, isProcessing: false },
    }));
  }, []);

  const confirmDeleteGroup = useCallback(async () => {
    const group = stateRef.current.confirmDeleteGroup.group;
    if (!group || !onDeleteGroup) return;
    setState(s => ({
      ...s,
      confirmDeleteGroup: { ...s.confirmDeleteGroup, isProcessing: true },
    }));
    try {
      await onDeleteGroup(group);
      setState(s => ({
        ...s,
        confirmDeleteGroup: { isOpen: false, group: null, isProcessing: false },
        groupForm: initialState.groupForm,
      }));
    } catch (error) {
      setState(s => ({
        ...s,
        confirmDeleteGroup: { ...s.confirmDeleteGroup, isProcessing: false },
      }));
      throw error;
    }
  }, [onDeleteGroup]);

  const cancelConfirmDeleteGroup = useCallback(() => {
    setState(s => ({
      ...s,
      confirmDeleteGroup: initialState.confirmDeleteGroup,
    }));
  }, []);

  const requestConfirmArchiveGroup = useCallback((group: Group) => {
    setState(s => ({
      ...s,
      confirmArchiveGroup: { isOpen: true, group, isProcessing: false },
    }));
  }, []);

  const confirmArchiveGroup = useCallback(async () => {
    const group = stateRef.current.confirmArchiveGroup.group;
    if (!group || !onArchiveGroup) return;
    setState(s => ({
      ...s,
      confirmArchiveGroup: { ...s.confirmArchiveGroup, isProcessing: true },
    }));
    try {
      await onArchiveGroup(group);
      setState(s => ({
        ...s,
        confirmArchiveGroup: { isOpen: false, group: null, isProcessing: false },
        groupForm: initialState.groupForm,
      }));
    } catch (error) {
      setState(s => ({
        ...s,
        confirmArchiveGroup: { ...s.confirmArchiveGroup, isProcessing: false },
      }));
      throw error;
    }
  }, [onArchiveGroup]);

  const cancelConfirmArchiveGroup = useCallback(() => {
    setState(s => ({
      ...s,
      confirmArchiveGroup: initialState.confirmArchiveGroup,
    }));
  }, []);

  const requestConfirmLeaveGroup = useCallback((group: Group, pendingSaveData: Omit<Group, 'id'>) => {
    setState(s => ({
      ...s,
      confirmLeaveGroup: { isOpen: true, group, pendingSaveData, isProcessing: false },
    }));
  }, []);

  const confirmLeaveGroup = useCallback(async () => {
    const { group, pendingSaveData } = stateRef.current.confirmLeaveGroup;
    if (!group || !pendingSaveData || !onLeaveGroup) return;
    setState(s => ({
      ...s,
      confirmLeaveGroup: { ...s.confirmLeaveGroup, isProcessing: true },
    }));
    try {
      await onLeaveGroup(group, pendingSaveData);
      setState(s => ({
        ...s,
        confirmLeaveGroup: { isOpen: false, group: null, pendingSaveData: null, isProcessing: false },
      }));
    } catch (error) {
      setState(s => ({
        ...s,
        confirmLeaveGroup: { ...s.confirmLeaveGroup, isProcessing: false },
      }));
      throw error;
    }
  }, [onLeaveGroup]);

  const cancelConfirmLeaveGroup = useCallback(() => {
    setState(s => ({
      ...s,
      confirmLeaveGroup: initialState.confirmLeaveGroup,
    }));
  }, []);

  const closeAll = useCallback(() => {
    setState(initialState);
  }, []);

  const actions: ModalActions = {
    openTransactionForm,
    closeTransactionForm,
    openTransactionDetail,
    closeTransactionDetail,
    openGroupForm,
    closeGroupForm,
    openShareModal,
    closeShareModal,
    openMemberInvite,
    closeMemberInvite,
    openArchivedGroups,
    closeArchivedGroups,
    openArchivePrompt,
    closeArchivePrompt,
    openPaymentSourceForm,
    closePaymentSourceForm,
    openPaymentSourceManage,
    closePaymentSourceManage,
    openSettleUp,
    closeSettleUp,
    openBalanceBreakdown,
    closeBalanceBreakdown,
    openCalendar,
    closeCalendar,
    openDateFilter,
    closeDateFilter,
    openAddAction,
    closeAddAction,
    openSettings,
    closeSettings,
    requestDeleteTransaction,
    confirmDeleteTransaction,
    cancelDeleteTransaction,
    requestDeletePaymentSource,
    confirmDeletePaymentSource,
    cancelDeletePaymentSource,
    requestConfirmDeleteGroup,
    confirmDeleteGroup,
    cancelConfirmDeleteGroup,
    requestConfirmArchiveGroup,
    confirmArchiveGroup,
    cancelConfirmArchiveGroup,
    requestConfirmLeaveGroup,
    confirmLeaveGroup,
    cancelConfirmLeaveGroup,
    closeAll,
  };

  return {
    modals: state,
    actions,
  };
}
