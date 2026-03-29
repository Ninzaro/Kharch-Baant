import React, { useState, useEffect } from 'react';
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
import { SettingsIcon } from './components/icons/Icons';
import { useAuth } from './contexts/SupabaseAuthContext';
import { UserMenu } from './components/auth/UserMenu';
// imports removed
import * as emailService from './services/emailService';
import InvitePage from './components/invite/InvitePage';
import { RealtimeStatus } from './components/RealtimeStatus';
import { useGroupsQuery, useTransactionsQuery, usePaymentSourcesQuery, usePeopleQuery, useRealtimeGroupsBridge, useRealtimeTransactionsBridge, useRealtimePaymentSourcesBridge, useRealtimePeopleBridge, qk } from './services/queries';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from './store/appStore';

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
    const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
    const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
    const [isAddActionModalOpen, setIsAddActionModalOpen] = useState(false);
    const [isPaymentSourceModalOpen, setIsPaymentSourceModalOpen] = useState(false);
    const [isPaymentSourceManageOpen, setIsPaymentSourceManageOpen] = useState(false);
    const [isSettleUpOpen, setIsSettleUpOpen] = useState(false);
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
    const [editingGroup, setEditingGroup] = useState<Group | null>(null);
    const [isProcessingGroupAction, setIsProcessingGroupAction] = useState(false);
    const [isTransactionDetailOpen, setIsTransactionDetailOpen] = useState(false);
    const [selectedTransactionForDetail, setSelectedTransactionForDetail] = useState<Transaction | null>(null);
    const [defaultSettlePayer, setDefaultSettlePayer] = useState<string | undefined>(undefined);
    const [defaultSettleReceiver, setDefaultSettleReceiver] = useState<string | undefined>(undefined);
    const [defaultSettleAmount, setDefaultSettleAmount] = useState<number | undefined>(undefined);


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
    const [pendingDeleteTransaction, setPendingDeleteTransaction] = useState<Transaction | null>(null);
    const [isDeletingTransaction, setIsDeletingTransaction] = useState(false);
    const [pendingDeletePaymentSource, setPendingDeletePaymentSource] = useState<PaymentSource | null>(null);
    const [isDeletingPaymentSource, setIsDeletingPaymentSource] = useState(false);

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
            if (!person) return;
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

    const handleAddTransactionClick = () => {
        setEditingTransaction(null);
        setIsTransactionModalOpen(true);
    };

    const handleEditTransactionClick = (transaction: Transaction) => {
        setEditingTransaction(transaction);
        if (transaction.type === 'settlement') {
            setIsSettleUpOpen(true);
        } else {
            setIsTransactionModalOpen(true);
        }
    };

    const requestDeleteTransaction = (id: string) => {
        const tx = transactions.find(t => t.id === id) || null;
        setPendingDeleteTransaction(tx);
    };

    const handleConfirmDeleteTransaction = async () => {
        if (!pendingDeleteTransaction) return;
        setIsDeletingTransaction(true);
        try {
            await api.deleteTransaction(pendingDeleteTransaction.id);
            qc.setQueryData<Transaction[]>(qk.transactions(currentUserId), (prev = []) => prev.filter(t => t.id !== pendingDeleteTransaction.id));
            setPendingDeleteTransaction(null);
        } catch (error) {
            console.error('Failed to delete transaction', error);
        } finally {
            setIsDeletingTransaction(false);
        }
    };

    const handleSaveTransaction = async (transactionData: Omit<Transaction, 'id' | 'groupId'>) => {
        if (!selectedGroupId && !editingTransaction) return;
        try {
            if (editingTransaction) {
                const updatedTransaction = await api.updateTransaction(editingTransaction.id, transactionData);
                qc.setQueryData<Transaction[]>(qk.transactions(currentUserId), (prev = []) => prev.map(t => t.id === editingTransaction.id ? updatedTransaction : t));
            } else if (selectedGroupId) {
                // Just add to DB; realtime bridge will update cache for all users consistently
                await api.addTransaction(selectedGroupId, transactionData);
            }
            setIsTransactionModalOpen(false);
            setEditingTransaction(null);
        } catch (error) {
            console.error('Failed to save transaction', error);
        }
    };

    const handleAddGroupClick = () => {
        setEditingGroup(null);
        setIsGroupModalOpen(true);
    };

    const handleEditGroupClick = () => {
        console.log('handleEditGroupClick called, selectedGroupId:', selectedGroupId);
        const selectedGroup = groups.find(g => g.id === selectedGroupId);
        console.log('Found group:', selectedGroup);
        if (selectedGroup) {
            setEditingGroup(selectedGroup);
            setIsGroupModalOpen(true);
            console.log('Modal should now be open with editingGroup:', selectedGroup);
        } else {
            console.log('No group found with id:', selectedGroupId);
        }
    };

    const handleSaveGroup = async (groupData: Omit<Group, 'id'>) => {
        try {
            // Validate currentUserId before proceeding
            if (!currentUserId || currentUserId.trim() === '') {
                toast.error('User not properly loaded. Please refresh the page and try again.');
                return;
            }

            console.log('🔍 handleSaveGroup - currentUserId:', currentUserId);
            console.log('🔍 handleSaveGroup - groupData.members:', groupData.members);

            if (editingGroup) {
                console.log('Updating group:', editingGroup.id, 'with data:', groupData);

                // Check if user is removing themselves from the group
                const wasUserMember = editingGroup.members.includes(currentUserId);
                const isUserStillMember = groupData.members.includes(currentUserId);
                const removingSelf = wasUserMember && !isUserStillMember;

                if (removingSelf) {
                    // Confirm self-removal
                    const confirmed = window.confirm(
                        'You are removing yourself from this group. You will no longer have access to it. Are you sure?'
                    );
                    if (!confirmed) {
                        return; // Cancel the operation
                    }
                }

                await api.updateGroup(editingGroup.id, groupData);
                console.log('Group updated successfully');

                // Refresh groups with proper filtering to ensure accurate state
                await qc.invalidateQueries({ queryKey: qk.groups(currentUserId) });
                console.log('Groups refreshed after update');

                if (removingSelf) {
                    // User removed themselves - redirect to home
                    setSelectedGroupId(null);
                    setIsGroupModalOpen(false);
                    setEditingGroup(null);
                    toast.success(`You have left the group "${editingGroup.name}".`);
                    console.log('User removed themselves from group, redirected to home');
                } else {
                    // Normal update - close modal
                    setIsGroupModalOpen(false);
                    setEditingGroup(null);
                    console.log('Group updated, modal closed');
                }
            } else {
                console.log('Adding new group with data:', groupData);
                console.log('🔍 Creating group with currentUserId:', currentUserId);

                if (!currentUserId) {
                    toast.error('User data not loaded properly. Please refresh the page and try again.');
                    return;
                }

                const newGroup = await api.addGroup(groupData, currentUserId);
                console.log('New group result:', newGroup);

                // OPTIMISTIC UPDATE: Add the new group to cache immediately to prevent blank screen
                qc.setQueryData<Group[]>(qk.groups(currentUserId), (prev = []) => {
                    // Check if group already exists (from realtime bridge)
                    if (prev.some(g => g.id === newGroup.id)) {
                        console.log('Group already in cache, skipping duplicate');
                        return prev; // Already there, don't duplicate
                    }
                    console.log('Adding new group to cache:', newGroup.id);
                    return [...prev, newGroup]; // Add new group to cache
                });

                // Close modal first
                setIsGroupModalOpen(false);
                setEditingGroup(null);

                // Wait for next tick to ensure cache update is processed, then select group
                // This ensures React Query has updated the groups array before we try to find it
                await new Promise(resolve => setTimeout(resolve, 0));

                // Verify group exists in cache before selecting
                const cachedGroups = qc.getQueryData<Group[]>(qk.groups(currentUserId)) || [];
                const groupExists = cachedGroups.some(g => g.id === newGroup.id);

                if (groupExists) {
                    console.log('Group found in cache, selecting it');
                    setSelectedGroupId(newGroup.id);
                } else {
                    console.warn('Group not in cache immediately, invalidating and refetching...');
                    // Fallback: invalidate and refetch, then select
                    await qc.invalidateQueries({ queryKey: qk.groups(currentUserId) });
                    await qc.refetchQueries({ queryKey: qk.groups(currentUserId) });
                    setSelectedGroupId(newGroup.id);
                }
            }
        } catch (error) {
            console.error("Failed to save group", error);
            toast.error(`Error saving group: ${error?.message || error}`);
            // Don't close the modal if there's an error
            return;
        }
    };

    // Add Action Modal handlers
    const handleAddActionClick = () => {
        setIsAddActionModalOpen(true);
    };

    const handleSelectGroupForExpense = (groupId: string) => {
        setSelectedGroupId(groupId);
        setEditingTransaction(null);
        setIsTransactionModalOpen(true);
    };

    const handleCreateGroupFromAddAction = () => {
        setEditingGroup(null);
        setIsGroupModalOpen(true);
    };

    const handleSavePaymentSource = async (sourceData: Omit<PaymentSource, 'id'>) => {
        try {
            await api.addPaymentSource(sourceData, person?.id);
            // Let realtime bridge add to cache for consistency
            setIsPaymentSourceModalOpen(false);
        } catch (error) {
            console.error("Failed to save payment source", error);
        }
    };

    const requestDeletePaymentSource = (id: string) => {
        const src = paymentSources.find(p => p.id === id) || null;
        if (src) setPendingDeletePaymentSource(src);
    };

    const handleArchivePaymentSource = async (id: string) => {
        try {
            await api.archivePaymentSource(id);
            qc.setQueryData<PaymentSource[]>(qk.paymentSources(currentUserId), (prev = []) => prev.map(ps => ps.id === id ? { ...ps, isActive: false } : ps));
        } catch (error) {
            console.error('Failed to archive payment source', error);
        }
    };

    const handleConfirmDeletePaymentSource = async () => {
        if (!pendingDeletePaymentSource) return;
        setIsDeletingPaymentSource(true);
        try {
            // Optional pre-check: ensure no transactions reference it. For now we allow deletion even if referenced.
            await api.deletePaymentSource(pendingDeletePaymentSource.id);
            qc.setQueryData<PaymentSource[]>(qk.paymentSources(currentUserId), (prev = []) => prev.filter(ps => ps.id !== pendingDeletePaymentSource.id));
            // Also clear from any editing transaction state (defensive) in cache
            qc.setQueryData<Transaction[]>(qk.transactions(currentUserId), (prev = []) => prev.map(t => t.paymentSourceId === pendingDeletePaymentSource.id ? { ...t, paymentSourceId: undefined } as Transaction : t));
            setPendingDeletePaymentSource(null);
        } catch (error) {
            console.error('Failed to delete payment source', error);
            toast.error('Failed to delete payment source. It might be referenced by transactions.');
        } finally {
            setIsDeletingPaymentSource(false);
        }
    };

    const handleViewTransactionDetail = (transaction: Transaction) => {
        setSelectedTransactionForDetail(transaction);
        setIsTransactionDetailOpen(true);
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
                        onAddExpense={() => setIsTransactionModalOpen(true)}
                        onSettleUp={() => {
                            setEditingTransaction(null);
                            setIsSettleUpOpen(true);
                        }}
                        onEditTransaction={handleEditTransactionClick}
                        onDeleteTransaction={requestDeleteTransaction}
                        onEditGroup={handleEditGroupClick}
                        onGoHome={handleGoHome}
                        onViewDetails={handleViewTransactionDetail}
                    />
                </>
            ) : (
                <div className="flex-1 flex flex-col">
                    <header className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900 safe-area-top">
                        <h1 className="text-lg font-bold text-white">Kharch Baant</h1>
                        <div className="flex items-center gap-2">
                            <UserMenu />
                            <button
                                onClick={() => setIsSettingsModalOpen(true)}
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
                            onAddGroup={handleCreateGroupFromAddAction}
                        />
                    </div>
                </div>
            )}
            {isSettingsModalOpen && (
                <SettingsModal
                    isOpen={isSettingsModalOpen}
                    onClose={() => setIsSettingsModalOpen(false)}
                    onManagePaymentSources={() => setIsPaymentSourceManageOpen(true)}
                    currentUserId={currentUserId}
                    currentUserPerson={person}
                />
            )}

            {isTransactionModalOpen && selectedGroup && (
                <TransactionFormModal
                    isOpen={isTransactionModalOpen}
                    onClose={() => setIsTransactionModalOpen(false)}
                    onSave={handleSaveTransaction}
                    transaction={editingTransaction}
                    people={groupMembers}
                    currentUserId={currentUserId}
                    paymentSources={paymentSources}
                    onAddNewPaymentSource={() => setIsPaymentSourceModalOpen(true)}
                    enableCuteIcons={selectedGroup.enableCuteIcons ?? true}
                />
            )}

            {isGroupModalOpen && (
                <GroupFormModal
                    isOpen={isGroupModalOpen}
                    onClose={() => setIsGroupModalOpen(false)}
                    onSave={handleSaveGroup}
                    group={editingGroup}
                    allPeople={people}
                    currentUserId={currentUserId}
                    groupBalances={groupBalances}
                    allSettled={allSettled}
                    userSettled={userSettled}
                    isProcessingGroupAction={isProcessingGroupAction}
                    onDeleteGroup={async () => {
                        if (!editingGroup) return;
                        if (!window.confirm('Are you sure you want to delete this group? This cannot be undone.')) return;
                        setIsProcessingGroupAction(true);
                        try {
                            const isAdmin = editingGroup.createdBy === currentUserId;
                            if (isAdmin) {
                                await deleteGroup(editingGroup.id, currentUserId, true, allSettled);
                                qc.setQueryData<Group[]>(qk.groups(currentUserId), (prev = []) => prev.filter(g => g.id !== editingGroup.id));
                                setIsGroupModalOpen(false);
                                setSelectedGroupId(null);
                            } else {
                                const res = await requestGroupDeletion(editingGroup.id, currentUserId);
                                toast.success(res.message || 'Deletion request sent to the group admin.');
                            }
                        } catch (e) {
                            toast.error(e.message || 'Failed to delete group.');
                        } finally {
                            setIsProcessingGroupAction(false);
                        }
                    }}
                    onArchiveGroup={async () => {
                        if (!editingGroup) return;
                        if (!window.confirm('Archive this group? You can find archived groups in App Settings.')) return;
                        setIsProcessingGroupAction(true);
                        try {
                            await archiveGroup(editingGroup.id, currentUserId, editingGroup.createdBy === currentUserId, userSettled, allSettled);
                            qc.setQueryData<Group[]>(qk.groups(currentUserId), (prev = []) => prev.map(g => g.id === editingGroup.id ? { ...g, isArchived: true } : g));
                            setIsGroupModalOpen(false);
                        } catch (e) {
                            toast.error(e.message || 'Failed to archive group.');
                        } finally {
                            setIsProcessingGroupAction(false);
                        }
                    }}
                    onOpenPaymentSources={() => {
                        setIsGroupModalOpen(false);
                        setIsPaymentSourceManageOpen(true);
                    }}
                />
            )}

            {isPaymentSourceModalOpen && (
                <PaymentSourceFormModal
                    isOpen={isPaymentSourceModalOpen}
                    onClose={() => setIsPaymentSourceModalOpen(false)}
                    onSave={handleSavePaymentSource}
                />
            )}

            {/* Confirm Delete Transaction Modal */}
            {pendingDeleteTransaction && (
                <ConfirmDeleteModal
                    open={!!pendingDeleteTransaction}
                    entityType="transaction"
                    entityName={pendingDeleteTransaction.description}
                    impactDescription="Balances will recalculate after deletion. This cannot be undone."
                    onCancel={() => setPendingDeleteTransaction(null)}
                    onConfirm={async () => {
                        await handleConfirmDeleteTransaction();
                    }}
                />
            )}

            {pendingDeletePaymentSource && (
                <ConfirmDeleteModal
                    open={!!pendingDeletePaymentSource}
                    entityType="paymentSource"
                    entityName={pendingDeletePaymentSource.name}
                    impactDescription={`This source is referenced in ${paymentSourceUsageCounts[pendingDeletePaymentSource.id] || 0} transaction(s). ${paymentSourceLastUsed[pendingDeletePaymentSource.id] ? `Last used on ${paymentSourceLastUsed[pendingDeletePaymentSource.id]}. ` : ''}After deletion those transactions will display no payment source. This cannot be undone.`}
                    loading={isDeletingPaymentSource}
                    onCancel={() => setPendingDeletePaymentSource(null)}
                    onConfirm={async () => { await handleConfirmDeletePaymentSource(); }}
                />
            )}


            {isPaymentSourceManageOpen && (
                <PaymentSourceManageModal
                    isOpen={isPaymentSourceManageOpen}
                    onClose={() => setIsPaymentSourceManageOpen(false)}
                    paymentSources={paymentSources}
                    usageCounts={paymentSourceUsageCounts}
                    lastUsedMap={paymentSourceLastUsed}
                    onAddNew={() => {
                        setIsPaymentSourceManageOpen(false);
                        setIsPaymentSourceModalOpen(true);
                    }}
                    onRequestDelete={(id) => requestDeletePaymentSource(id)}
                    onArchive={(id) => handleArchivePaymentSource(id)}
                />
            )}

            {isSettleUpOpen && selectedGroup && (
                <SettleUpModal
                    open={isSettleUpOpen}
                    onClose={() => {
                        setIsSettleUpOpen(false);
                        setEditingTransaction(null);
                    }}
                    groupId={selectedGroup.id}
                    members={groupMembers}
                    paymentSources={paymentSources}
                    transactions={groupTransactions}
                    currency={selectedGroup.currency}
                    defaultPayerId={defaultSettlePayer}
                    defaultReceiverId={defaultSettleReceiver}
                    defaultAmount={defaultSettleAmount}
                    initialTransaction={editingTransaction?.type === 'settlement' ? editingTransaction : undefined}
                    onSubmit={async (tx) => {
                        if (editingTransaction && editingTransaction.type === 'settlement') {
                            const updated = await api.updateTransaction(editingTransaction.id, tx);
                            qc.setQueryData<Transaction[]>(qk.transactions(currentUserId), (prev = []) => prev.map(t => t.id === editingTransaction.id ? updated : t));
                            return updated;
                        } else {
                            const created = await api.addTransaction(selectedGroup.id, tx);
                            // Let realtime bridge add to cache for consistency, but return it here for modal
                            return created;
                        }
                    }}
                    onCreated={(tx) => {
                        // Let realtime bridge add to cache for consistency
                        setIsSettleUpOpen(false);
                        setDefaultSettleAmount(undefined);
                        setEditingTransaction(null);
                    }}
                />
            )}

            {isTransactionDetailOpen && selectedTransactionForDetail && (
                <TransactionDetailModal
                    transaction={selectedTransactionForDetail}
                    onClose={() => {
                        setIsTransactionDetailOpen(false);
                        setSelectedTransactionForDetail(null);
                    }}
                    groupMembers={groupMembers}
                    paymentSources={paymentSources}
                    onEdit={(transaction) => {
                        setEditingTransaction(transaction);
                        setIsTransactionModalOpen(true);
                        setIsTransactionDetailOpen(false);
                        setSelectedTransactionForDetail(null);
                    }}
                    onDelete={(transaction) => {
                        setPendingDeleteTransaction(transaction);
                        setIsTransactionDetailOpen(false);
                        setSelectedTransactionForDetail(null);
                    }}
                />
            )}

            <AddActionModal
                open={isAddActionModalOpen}
                onClose={() => setIsAddActionModalOpen(false)}
                groups={activeGroups}
                people={people}
                onCreateGroup={handleCreateGroupFromAddAction}
                onSelectGroupForExpense={handleSelectGroupForExpense}
                currentGroupId={selectedGroupId}
            />



            {/* <ApiStatusIndicator /> removed per user request */}
            {/* <DebugPanel groups={groups} transactions={transactions} /> removed per user request */}
            <RealtimeStatus />
        </div>
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