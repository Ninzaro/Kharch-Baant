import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Group, Transaction, Person, PaymentSource } from './types';
import * as api from './services/apiService';
import GroupList from './components/GroupList';
import GroupView from './components/GroupView';
import TransactionFormModal from './components/TransactionFormModal';
import GroupFormModal from './components/GroupFormModal';
import { deleteGroup, archiveGroup, validateInvite, acceptInvite, requestGroupDeletion } from './services/supabaseApiService';
import ConfirmDeleteModal from './components/ConfirmDeleteModal';
import HomeScreen from './components/HomeScreen';
import PaymentSourceFormModal from './components/PaymentSourceFormModal';
import PaymentSourceManageModal from './components/PaymentSourceManageModal';
import SettleUpModal from './components/SettleUpModal';
import ArchivePromptModal from './components/ArchivePromptModal';
import ApiStatusIndicator from './components/ApiStatusIndicator';
import DebugPanel from './components/DebugPanel';
import AddActionModal from './components/AddActionModal';
import { assertSupabaseEnvironment } from './services/apiService';
import SettingsModal from './components/SettingsModal';
import TransactionDetailModal from './components/TransactionDetailModal';
import BaseModal from './components/BaseModal';
import { SettingsIcon } from './components/icons/Icons';
import { useAuth } from './contexts/SupabaseAuthContext';
import { ModalContext } from './contexts/ModalContext';
import { useModals } from './hooks/useModals';
import { UserMenu } from './components/auth/UserMenu';
// imports removed
import * as emailService from './services/emailService';
import InvitePage from './components/invite/InvitePage';
import { RealtimeStatus } from './components/RealtimeStatus';
import { useGroupsQuery, useTransactionsQuery, usePaymentSourcesQuery, usePeopleQuery, useRealtimeGroupsBridge, useRealtimeTransactionsBridge, useRealtimePaymentSourcesBridge, useRealtimePeopleBridge, useRealtimeConnection, qk } from './services/queries';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from './store/appStore';
import { useBackButton } from './hooks/useBackButton';

const App: React.FC = () => {
    if (import.meta.env.DEV) {
        assertSupabaseEnvironment();
    }

    const { user, person, isSyncing } = useAuth();
    const currentUserId = person?.id || '';

    const qc = useQueryClient();
    const { data: groups = [], isLoading: groupsLoading } = useGroupsQuery(person?.id);
    const { data: transactions = [], isLoading: txLoading } = useTransactionsQuery(person?.id);
    const { data: paymentSources = [], isLoading: psLoading } = usePaymentSourcesQuery(person?.id);
    const { data: people = [], isLoading: peopleLoading } = usePeopleQuery(person?.id);

    // Prime the Realtime WebSocket connection with the Clerk JWT FIRST
    useRealtimeConnection(person?.id);

    // Realtime bridges
    useRealtimeGroupsBridge(person?.id);
    useRealtimeTransactionsBridge(person?.id);
    useRealtimePaymentSourcesBridge(person?.id);
    useRealtimePeopleBridge(person?.id);
    const activeGroups = React.useMemo(() => groups.filter(g => !g.isArchived), [groups]);
    // Moved to TanStack Query: transactions, people, paymentSources
    const [isLoading, setIsLoading] = useState(true);
    const selectedGroupId = useAppStore(s => s.selectedGroupId);
    const setSelectedGroupId = useAppStore(s => s.setSelectedGroupId);

    // Calculate balances for selected group (simple sum for demo; replace with real logic)
    const groupBalances = React.useMemo(() => {
        if (!selectedGroupId) return {};
        const groupTxs = transactions.filter(t => t.groupId === selectedGroupId);
        // TODO: Replace with real balance calculation
        const balances: Record<string, number> = {};
        groupTxs.forEach(t => {
            balances[t.paidById] = (balances[t.paidById] || 0) + t.amount;
            t.split.participants.forEach(p => {
                balances[p.personId] = (balances[p.personId] || 0) - (t.amount / t.split.participants.length);
            });
        });
        return balances;
    }, [transactions, selectedGroupId]);

    // All settled if all balances are zero (within epsilon)
    const allSettled = Object.values(groupBalances ?? {}).every(b => typeof b === 'number' && Math.abs(b) < 0.01);
    const userSettled = currentUserId && Math.abs((groupBalances?.[currentUserId] ?? 0)) < 0.01;

    const paymentSourceUsageCounts = React.useMemo(() => {
        const counts: Record<string, number> = {};
        transactions.forEach(t => {
            if (t.paymentSourceId) {
                counts[t.paymentSourceId] = (counts[t.paymentSourceId] || 0) + 1;
            }
        });
        return counts;
    }, [transactions]);

    const paymentSourceLastUsed = React.useMemo(() => {
        const last: Record<string, string> = {};
        transactions.forEach(t => {
            if (t.paymentSourceId) {
                const prev = last[t.paymentSourceId];
                if (!prev || prev < t.date) {
                    last[t.paymentSourceId] = t.date; // dates are YYYY-MM-DD so lexical compare works
                }
            }
        });
        return last;
    }, [transactions]);

    // ── Modal async callbacks (closed over App-level state) ────────────────
    const executeGroupSaveRef = React.useRef<((data: Omit<Group, 'id'>, removingSelf: boolean) => Promise<void>) | null>(null);

    const handleDeleteTransactionCb = useCallback(async (id: string) => {
        const tx = transactions.find(t => t.id === id);
        if (!tx) return;
        await api.deleteTransaction(tx.id);
        qc.setQueryData<Transaction[]>(qk.transactions(currentUserId), (prev = []) =>
            prev.filter(t => t.id !== tx.id)
        );
    }, [transactions, currentUserId, qc]);

    const handleDeletePaymentSourceCb = useCallback(async (id: string) => {
        await api.deletePaymentSource(id);
        qc.setQueryData<PaymentSource[]>(qk.paymentSources(currentUserId), (prev = []) =>
            prev.filter(ps => ps.id !== id)
        );
        qc.setQueryData<Transaction[]>(qk.transactions(currentUserId), (prev = []) =>
            prev.map(t => t.paymentSourceId === id ? { ...t, paymentSourceId: undefined } as Transaction : t)
        );
    }, [currentUserId, qc]);

    const handleDeleteGroupCb = useCallback(async (group: Group) => {
        const isAdmin = group.createdBy === currentUserId;
        if (isAdmin) {
            await deleteGroup(group.id, currentUserId, true, allSettled);
            qc.setQueryData<Group[]>(qk.groups(currentUserId), (prev = []) =>
                prev.filter(g => g.id !== group.id)
            );
            setSelectedGroupId(null);
        } else {
            const res = await requestGroupDeletion(group.id, currentUserId);
            toast.success(res.message || 'Deletion request sent to the group admin.');
        }
    }, [currentUserId, allSettled, qc, setSelectedGroupId]);

    const handleArchiveGroupCb = useCallback(async (group: Group) => {
        await archiveGroup(group.id, currentUserId, group.createdBy === currentUserId, userSettled, allSettled);
        qc.setQueryData<Group[]>(qk.groups(currentUserId), (prev = []) =>
            prev.map(g => g.id === group.id ? { ...g, isArchived: true } : g)
        );
    }, [currentUserId, userSettled, allSettled, qc]);

    const handleLeaveGroupCb = useCallback(async (_group: Group, saveData: Omit<Group, 'id'>) => {
        await executeGroupSaveRef.current?.(saveData, true);
    }, []);

    // ── Single modal state source ──────────────────────────────────────────
    const { modals, actions } = useModals(
        handleDeleteTransactionCb,
        handleDeletePaymentSourceCb,
        handleDeleteGroupCb,
        handleArchiveGroupCb,
        handleLeaveGroupCb,
    );

    // Derive isProcessingGroupAction from modal state
    const isProcessingGroupAction = modals.confirmDeleteGroup.isProcessing || modals.confirmArchiveGroup.isProcessing;

    useBackButton(() => {
        if (modals.transactionDetail.isOpen) { actions.closeTransactionDetail(); return true; }
        if (modals.transactionForm.isOpen) { actions.closeTransactionForm(); return true; }
        if (modals.groupForm.isOpen) { actions.closeGroupForm(); return true; }
        if (modals.addAction.isOpen) { actions.closeAddAction(); return true; }
        if (modals.paymentSourceForm.isOpen) { actions.closePaymentSourceForm(); return true; }
        if (modals.paymentSourceManage.isOpen) { actions.closePaymentSourceManage(); return true; }
        if (modals.settleUp.isOpen) { actions.closeSettleUp(); return true; }
        if (modals.settings.isOpen) { actions.closeSettings(); return true; }
        if (modals.deleteTransaction.isOpen) { actions.cancelDeleteTransaction(); return true; }
        if (modals.deletePaymentSource.isOpen) { actions.cancelDeletePaymentSource(); return true; }

        if (selectedGroupId) {
            setSelectedGroupId(null);
            return true;
        }

        return false;
    });

    // Ensure selected group remains valid across reloads/user switches
    useEffect(() => {
        // If user logs out, clear selection
        if (!person && selectedGroupId) {
            setSelectedGroupId(null);
            return;
        }
        // If persisted selection isn't in current groups (e.g., removed/left), clear it
        if (selectedGroupId && groups.length > 0 && !groups.some(g => g.id === selectedGroupId)) {
            setSelectedGroupId(null);
        }
    }, [person, groups, selectedGroupId, setSelectedGroupId]);

    // Handle invite acceptance
    const handleInviteAcceptance = async (inviteToken: string, personId: string) => {
        try {
            console.log('🎫 Validating invite token:', inviteToken);
            const validation = await validateInvite(inviteToken);

            if (!validation.isValid) {
                toast.error(`Invite link is invalid: ${validation.error}`);
                window.history.replaceState({}, '', '/'); // Clear URL
                return;
            }

            console.log('✅ Invite is valid for group:', validation.group?.name);

            // Accept the invite
            const result = await acceptInvite({
                inviteToken,
                personId
            });

            if (result.success) {
                console.log('✅ Successfully joined group:', result.group?.name);

                // Clear the invite URL
                window.history.replaceState({}, '', '/');

                // Refresh groups to include the new one
                await qc.invalidateQueries({ queryKey: qk.groups(personId) });

                // Select the newly joined group
                if (result.group?.id) {
                    setSelectedGroupId(result.group.id);
                }

                toast.success(`Successfully joined group "${result.group?.name}"!`);
            } else {
                toast.error(`Failed to join group: ${result.error}`);
                // Clear the invite URL
                window.history.replaceState({}, '', '/');
            }
        } catch (error) {
            console.error('❌ Error handling invite:', error);
            toast.error(`Failed to process invite: ${error.message || error}`);
            window.history.replaceState({}, '', '/');
        }
    };



    useEffect(() => {
        const fetchData = async () => {
            if (!person) {
                setIsLoading(false);
                return;
            }
            setIsLoading(true);
            try {
                // Data now fetched via TanStack Query hooks. Only handle invite acceptance here.

                const urlPath = window.location.pathname;
                const inviteMatch = urlPath.match(/^\/invite\/(.+)$/);
                let inviteToken: string | null = inviteMatch ? inviteMatch[1] : localStorage.getItem('pendingInviteToken');

                if (inviteToken) {
                    localStorage.removeItem('pendingInviteToken');
                    await handleInviteAcceptance(inviteToken, person.id);
                }
            } catch (error) {
                console.error("Failed to fetch initial data", error);
                toast.error(`Error loading data: ${error?.message || error}`);
            } finally {
                setIsLoading(false);
            }
        };

        if (user && !isSyncing) {
            fetchData();
        } else if (!user) {
            setIsLoading(false);
            // Query caches will clear based on person context
        }
    }, [user, person, isSyncing]);

    // Listen for group member additions to refresh data
    useEffect(() => {
        const handleGroupMemberAdded = async (event: CustomEvent) => {
            const { groupId, person } = event.detail;
            console.log('🔄 Group member added, refreshing data...', { groupId, person });

            try {
                // Refresh people data to include the new member
                const updatedPeople = await api.getPeople(currentUserId);
                qc.setQueryData(qk.people(currentUserId), updatedPeople);

                // Refresh groups data to get updated member lists
                const updatedGroups = await api.getGroups(currentUserId);
                qc.setQueryData(qk.groups(currentUserId), updatedGroups);

                console.log('✅ Data refreshed after member addition');
            } catch (error) {
                console.error('❌ Failed to refresh data after member addition:', error);
            }
        };

        window.addEventListener('groupMemberAdded', handleGroupMemberAdded as EventListener);

        return () => {
            window.removeEventListener('groupMemberAdded', handleGroupMemberAdded as EventListener);
        };
    }, [currentUserId, qc]);

    // Groups realtime handled via useRealtimeGroupsBridge in Query layer

    // Realtime for transactions/payment sources/people handled by bridges

    // Realtime: Membership changes — refresh groups and people
    useEffect(() => {
        if (!person) return;
        const gmSubscription = api.subscribeToGroupMembers(person.id, async (payload) => {
            console.log('📡 Group members realtime event:', payload.eventType, payload);
            try {
                console.log('🔄 Refreshing groups and people after membership change...');
                const [updatedGroups, updatedPeople] = await Promise.all([
                    api.getGroups(person.id),
                    api.getPeople(person.id),
                ]);
                qc.setQueryData(qk.groups(person.id), updatedGroups);
                qc.setQueryData(qk.people(person.id), updatedPeople);
                console.log('✅ Refreshed after membership change');
            } catch (err) {
                console.error('Failed to refresh after membership change', err);
            }
        });
        return () => {
            console.log('🔌 Unsubscribing from group members realtime');
            gmSubscription.unsubscribe();
        };
    }, [person, qc]);

    const handleSelectGroup = (groupId: string) => {
        setSelectedGroupId(groupId);
    };

    const handleGoHome = () => {
        setSelectedGroupId(null);
    };

    const handleEditTransactionClick = (transaction: Transaction) => {
        if (transaction.type === 'settlement') {
            actions.openSettleUp({ initialTransaction: transaction });
        } else {
            actions.openTransactionForm(transaction);
        }
    };

    const requestDeleteTransaction = (id: string) => {
        const tx = transactions.find(t => t.id === id) || null;
        if (tx) actions.requestDeleteTransaction(tx);
    };

    const handleSaveTransaction = async (transactionData: Omit<Transaction, 'id' | 'groupId'>) => {
        const editingTransaction = modals.transactionForm.editing;
        if (!selectedGroupId && !editingTransaction) return;
        try {
            if (editingTransaction) {
                const updatedTransaction = await api.updateTransaction(editingTransaction.id, transactionData);
                qc.setQueryData<Transaction[]>(qk.transactions(currentUserId), (prev = []) => prev.map(t => t.id === editingTransaction.id ? updatedTransaction : t));
            } else if (selectedGroupId) {
                await api.addTransaction(selectedGroupId, transactionData);
            }
            actions.closeTransactionForm();
        } catch (error) {
            console.error('Failed to save transaction', error);
        }
    };

    const handleEditGroupClick = () => {
        const selectedGroup = groups.find(g => g.id === selectedGroupId);
        if (selectedGroup) actions.openGroupForm(selectedGroup);
    };

    const executeGroupSave = useCallback(async (groupData: Omit<Group, 'id'>, removingSelf: boolean) => {
        const editingGroup = modals.groupForm.editing;
        if (!editingGroup) return;
        try {
            await api.updateGroup(editingGroup.id, groupData);

            await qc.invalidateQueries({ queryKey: qk.groups(currentUserId) });

            if (removingSelf) {
                setSelectedGroupId(null);
                actions.closeGroupForm();
                actions.cancelConfirmLeaveGroup();
                toast.success(`You have left the group "${editingGroup.name}".`);
            } else {
                actions.closeGroupForm();
            }
        } catch (error) {
            console.error('Failed to save group', error);
            toast.error('Failed to save group updates.');
        }
    }, [modals.groupForm.editing, currentUserId, qc, setSelectedGroupId, actions]);

    // Keep the ref in sync for handleLeaveGroupCb
    React.useEffect(() => { executeGroupSaveRef.current = executeGroupSave; }, [executeGroupSave]);

    const handleSaveGroup = async (groupData: Omit<Group, 'id'>) => {
        try {
            if (!currentUserId || currentUserId.trim() === '') {
                toast.error('User not properly loaded. Please refresh the page and try again.');
                return;
            }

            const editingGroup = modals.groupForm.editing;

            if (editingGroup) {
                const wasUserMember = editingGroup.members.includes(currentUserId);
                const isUserStillMember = groupData.members.includes(currentUserId);
                const removingSelf = wasUserMember && !isUserStillMember;

                if (removingSelf) {
                    actions.requestConfirmLeaveGroup(editingGroup, groupData);
                    return;
                }

                await executeGroupSave(groupData, false);
            } else {
                if (!currentUserId) {
                    toast.error('User data not loaded properly. Please refresh the page and try again.');
                    return;
                }

                const newGroup = await api.addGroup(groupData, currentUserId);

                qc.setQueryData<Group[]>(qk.groups(currentUserId), (prev = []) => {
                    if (prev.some(g => g.id === newGroup.id)) return prev;
                    return [...prev, newGroup];
                });

                actions.closeGroupForm();

                await new Promise(resolve => setTimeout(resolve, 0));

                const cachedGroups = qc.getQueryData<Group[]>(qk.groups(currentUserId)) || [];
                const groupExists = cachedGroups.some(g => g.id === newGroup.id);

                if (groupExists) {
                    setSelectedGroupId(newGroup.id);
                } else {
                    await qc.invalidateQueries({ queryKey: qk.groups(currentUserId) });
                    await qc.refetchQueries({ queryKey: qk.groups(currentUserId) });
                    setSelectedGroupId(newGroup.id);
                }
            }
        } catch (error) {
            console.error("Failed to save group", error);
            toast.error(`Error saving group: ${error?.message || error}`);
        }
    };

    const handleSelectGroupForExpense = (groupId: string) => {
        setSelectedGroupId(groupId);
        actions.openTransactionForm();
    };

    const handleSavePaymentSource = async (sourceData: Omit<PaymentSource, 'id'>) => {
        try {
            await api.addPaymentSource(sourceData, person?.id);
            actions.closePaymentSourceForm();
        } catch (error) {
            console.error("Failed to save payment source", error);
        }
    };

    const requestDeletePaymentSource = (id: string) => {
        const src = paymentSources.find(p => p.id === id) || null;
        if (src) actions.requestDeletePaymentSource(src);
    };

    const handleArchivePaymentSource = async (id: string) => {
        try {
            await api.archivePaymentSource(id);
            qc.setQueryData<PaymentSource[]>(qk.paymentSources(currentUserId), (prev = []) => prev.map(ps => ps.id === id ? { ...ps, isActive: false } : ps));
        } catch (error) {
            console.error('Failed to archive payment source', error);
        }
    };

    const handleViewTransactionDetail = (transaction: Transaction) => {
        actions.openTransactionDetail(transaction);
    };

    const loading = isLoading || groupsLoading;
    if (loading) {
        return (
            <div className="h-screen w-screen flex items-center justify-center">
                <p className="text-xl">Loading your expenses...</p>
            </div>
        );
    }

    const selectedGroup = groups.find(g => g.id === selectedGroupId);
    const groupTransactions = transactions.filter(t => t.groupId === selectedGroupId);
    const groupMembers = selectedGroup ? people.filter(p => selectedGroup.members.includes(p.id)) : [];

    return (
      <ModalContext.Provider value={{ modals, actions }}>
        <div className="h-screen w-screen text-slate-200 flex font-sans">
            {selectedGroup ? (
                <>
                    <GroupList
                        groups={activeGroups}
                        people={people}
                        selectedGroupId={selectedGroupId}
                        onSelectGroup={handleSelectGroup}
                        onGoHome={handleGoHome}
                    />
                    <GroupView
                        group={selectedGroup}
                        transactions={groupTransactions}
                        people={people}
                        currentUserId={currentUserId}
                        onEditGroup={handleEditGroupClick}
                        onGoHome={handleGoHome}
                    />
                </>
            ) : (
                <div className="flex-1 flex flex-col">
                    <header className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900 safe-area-top">
                        <h1 className="text-lg font-bold text-white">Kharch Baant</h1>
                        <div className="flex items-center gap-2">
                            <UserMenu />
                            <button
                                onClick={() => actions.openSettings()}
                                className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                                aria-label="Open App Settings"
                            >
                                <SettingsIcon />
                            </button>
                        </div>
                    </header>
                    <div className="flex-1">
                        <HomeScreen
                            groups={activeGroups}
                            transactions={transactions}
                            people={people}
                            currentUserId={currentUserId}
                            onSelectGroup={handleSelectGroup}
                            onAddGroup={() => actions.openGroupForm()}
                        />
                    </div>
                </div>
            )}
            {modals.settings.isOpen && (
                <SettingsModal
                    isOpen={modals.settings.isOpen}
                    onClose={actions.closeSettings}
                    onManagePaymentSources={() => {
                        actions.closeSettings();
                        actions.openPaymentSourceManage();
                    }}
                    currentUserId={currentUserId}
                    currentUserPerson={person}
                />
            )}

            {modals.transactionForm.isOpen && selectedGroup && (
                <TransactionFormModal
                    isOpen={modals.transactionForm.isOpen}
                    onClose={actions.closeTransactionForm}
                    onSave={handleSaveTransaction}
                    transaction={modals.transactionForm.editing}
                    people={groupMembers}
                    currentUserId={currentUserId}
                    paymentSources={paymentSources}
                    onAddNewPaymentSource={() => actions.openPaymentSourceForm()}
                    enableCuteIcons={selectedGroup.enableCuteIcons ?? true}
                />
            )}

            {modals.groupForm.isOpen && (
                <GroupFormModal
                    isOpen={modals.groupForm.isOpen}
                    onClose={actions.closeGroupForm}
                    onSave={handleSaveGroup}
                    group={modals.groupForm.editing}
                    allPeople={people}
                    currentUserId={currentUserId}
                    groupBalances={groupBalances}
                    allSettled={allSettled}
                    userSettled={userSettled}
                    isProcessingGroupAction={isProcessingGroupAction}
                    onDeleteGroup={() => {
                        const g = modals.groupForm.editing;
                        if (g) actions.requestConfirmDeleteGroup(g);
                    }}
                    onArchiveGroup={() => {
                        const g = modals.groupForm.editing;
                        if (g) actions.requestConfirmArchiveGroup(g);
                    }}
                    onOpenPaymentSources={() => {
                        actions.closeGroupForm();
                        actions.openPaymentSourceManage();
                    }}
                />
            )}

            {modals.paymentSourceForm.isOpen && (
                <PaymentSourceFormModal
                    isOpen={modals.paymentSourceForm.isOpen}
                    onClose={actions.closePaymentSourceForm}
                    onSave={handleSavePaymentSource}
                />
            )}

            {/* Confirm Delete Transaction Modal */}
            {modals.deleteTransaction.isOpen && (
                <ConfirmDeleteModal
                    open={modals.deleteTransaction.isOpen}
                    entityType="transaction"
                    entityName={modals.deleteTransaction.transaction?.description ?? ''}
                    impactDescription="Balances will recalculate after deletion. This cannot be undone."
                    loading={modals.deleteTransaction.isDeleting}
                    onCancel={actions.cancelDeleteTransaction}
                    onConfirm={actions.confirmDeleteTransaction}
                />
            )}

            {modals.deletePaymentSource.isOpen && (
                <ConfirmDeleteModal
                    open={modals.deletePaymentSource.isOpen}
                    entityType="paymentSource"
                    entityName={modals.deletePaymentSource.paymentSource?.name ?? ''}
                    impactDescription={`This source is referenced in ${paymentSourceUsageCounts[modals.deletePaymentSource.paymentSource?.id ?? ''] || 0} transaction(s). ${paymentSourceLastUsed[modals.deletePaymentSource.paymentSource?.id ?? ''] ? `Last used on ${paymentSourceLastUsed[modals.deletePaymentSource.paymentSource?.id ?? '']}. ` : ''}After deletion those transactions will display no payment source. This cannot be undone.`}
                    loading={modals.deletePaymentSource.isDeleting}
                    onCancel={actions.cancelDeletePaymentSource}
                    onConfirm={actions.confirmDeletePaymentSource}
                />
            )}

            {modals.paymentSourceManage.isOpen && (
                <PaymentSourceManageModal
                    isOpen={modals.paymentSourceManage.isOpen}
                    onClose={actions.closePaymentSourceManage}
                    paymentSources={paymentSources}
                    usageCounts={paymentSourceUsageCounts}
                    lastUsedMap={paymentSourceLastUsed}
                    onAddNew={() => {
                        actions.closePaymentSourceManage();
                        actions.openPaymentSourceForm();
                    }}
                    onRequestDelete={(id) => requestDeletePaymentSource(id)}
                    onArchive={(id) => handleArchivePaymentSource(id)}
                />
            )}

            {modals.settleUp.isOpen && selectedGroup && (
                <SettleUpModal
                    open={modals.settleUp.isOpen}
                    onClose={() => { actions.closeSettleUp(); }}
                    groupId={selectedGroup.id}
                    members={groupMembers}
                    paymentSources={paymentSources}
                    transactions={groupTransactions}
                    currency={selectedGroup.currency}
                    defaultPayerId={modals.settleUp.defaultPayer}
                    defaultReceiverId={modals.settleUp.defaultReceiver}
                    defaultAmount={modals.settleUp.defaultAmount}
                    initialTransaction={modals.settleUp.initialTransaction}
                    onSubmit={async (tx) => {
                        const initialTx = modals.settleUp.initialTransaction;
                        if (initialTx) {
                            const updated = await api.updateTransaction(initialTx.id, tx);
                            qc.setQueryData<Transaction[]>(qk.transactions(currentUserId), (prev = []) =>
                                prev.map(t => t.id === initialTx.id ? updated : t)
                            );
                            return updated;
                        } else {
                            const created = await api.addTransaction(selectedGroup.id, tx);
                            qc.setQueryData<Transaction[]>(qk.transactions(currentUserId), (prev = []) =>
                                prev.some(t => t.id === created.id) ? prev : [created, ...prev]
                            );
                            return created;
                        }
                    }}
                    onCreated={(_tx: Transaction) => { actions.closeSettleUp(); }}
                />
            )}

            {modals.transactionDetail.isOpen && modals.transactionDetail.transaction && (
                <TransactionDetailModal
                    transaction={modals.transactionDetail.transaction}
                    onClose={actions.closeTransactionDetail}
                    groupMembers={groupMembers}
                    paymentSources={paymentSources}
                />
            )}

            <AddActionModal
                open={modals.addAction.isOpen}
                onClose={actions.closeAddAction}
                groups={activeGroups}
                people={people}
                onCreateGroup={() => actions.openGroupForm()}
                onSelectGroupForExpense={handleSelectGroupForExpense}
                currentGroupId={selectedGroupId}
            />

            {/* Confirm Delete Group */}
            {modals.confirmDeleteGroup.isOpen && modals.confirmDeleteGroup.group && (
                <ConfirmDeleteModal
                    open={modals.confirmDeleteGroup.isOpen}
                    entityType="group"
                    entityName={modals.confirmDeleteGroup.group.name}
                    loading={modals.confirmDeleteGroup.isProcessing}
                    onConfirm={actions.confirmDeleteGroup}
                    onCancel={actions.cancelConfirmDeleteGroup}
                />
            )}

            {/* Confirm Archive Group */}
            {modals.confirmArchiveGroup.isOpen && modals.confirmArchiveGroup.group && (
                <ArchivePromptModal
                    isOpen={modals.confirmArchiveGroup.isOpen}
                    onClose={actions.cancelConfirmArchiveGroup}
                    onArchive={actions.confirmArchiveGroup}
                />
            )}

            {/* Confirm Leave Group */}
            {modals.confirmLeaveGroup.isOpen && modals.confirmLeaveGroup.group && modals.confirmLeaveGroup.pendingSaveData && (
                <BaseModal
                    open={modals.confirmLeaveGroup.isOpen}
                    onClose={actions.cancelConfirmLeaveGroup}
                    title="Leave Group?"
                    size="sm"
                    description={<span className="text-slate-300 text-sm">You are removing yourself from this group.</span>}
                    footer={
                        <div className="flex gap-2">
                            <button
                                onClick={actions.cancelConfirmLeaveGroup}
                                className="px-4 py-2 bg-white/10 text-white rounded-md hover:bg-white/20"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={actions.confirmLeaveGroup}
                                disabled={modals.confirmLeaveGroup.isProcessing}
                                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-md disabled:opacity-50"
                            >
                                {modals.confirmLeaveGroup.isProcessing ? 'Leaving...' : 'Leave Group'}
                            </button>
                        </div>
                    }
                >
                    <p className="text-sm text-slate-300">
                        You will no longer have access to "{modals.confirmLeaveGroup.group.name}" or its transactions.
                        This action cannot be undone unless someone invites you back.
                    </p>
                </BaseModal>
            )}

            {/* <ApiStatusIndicator /> removed per user request */}
            {/* <DebugPanel groups={groups} transactions={transactions} /> removed per user request */}
            <RealtimeStatus />
        </div>
      </ModalContext.Provider>
    );
}

// Show sign-in screen when not authenticated
import { SignIn } from '@clerk/clerk-react';

const AppWithAuth: React.FC = () => {
    const { user, loading, isSyncing } = useAuth();

    // Check if there's an invite token in the URL
    const [inviteInfo, setInviteInfo] = useState<{ token: string; groupName?: string } | null>(null);

    useEffect(() => {
        const urlPath = window.location.pathname;
        const inviteMatch = urlPath.match(/^\/invite\/(.+)$/);
        if (inviteMatch) {
            const token = inviteMatch[1];
            localStorage.setItem('pendingInviteToken', token);
            // Defer to dedicated InvitePage for UI/acceptance flow
            setInviteInfo({ token });
        }
    }, []);

    if (loading) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-slate-900">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                    <p className="text-slate-400">Loading...</p>
                </div>
            </div>
        );
    }

    // Dedicated Invite Acceptance Page (works pre/post auth)
    if (!user && inviteInfo?.token) {
        return <InvitePage />;
    }

    if (!user) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
               <SignIn />
            </div>
        );
    }

    return <App />;
};

export default AppWithAuth;
