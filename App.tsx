import React, { useState, useEffect } from 'react';
import * as Sentry from '@sentry/react';
import toast, { Toaster } from 'react-hot-toast';
import { Group, Transaction, Person, PaymentSource } from './types';
import * as api from './services/apiService';
import { calculateGroupBalances } from './utils/calculations';
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
import { useGroupsQuery, useTransactionsQuery, usePaymentSourcesQuery, usePeopleQuery, useRealtimeGroupsBridge, useRealtimeTransactionsBridge, useRealtimePaymentSourcesBridge, useRealtimePeopleBridge, useRealtimeGroupMembersBridge, useRealtimeConnection, qk } from './services/queries';
import { useQueryClient } from '@tanstack/react-query';
import ConfirmDeleteModal from './components/ConfirmDeleteModal';
import ArchivePromptModal from './components/ArchivePromptModal';
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

    // Identify the user in Sentry so error reports show who was affected
    useEffect(() => {
      if (person) {
        Sentry.setUser({ id: person.id, email: person.email, username: person.name });
      } else {
        Sentry.setUser(null);
      }
    }, [person?.id]);

    // Realtime bridges
    useRealtimeGroupsBridge(person?.id);
    useRealtimeTransactionsBridge(person?.id);
    useRealtimePaymentSourcesBridge(person?.id);
    useRealtimePeopleBridge(person?.id);
    useRealtimeGroupMembersBridge(person?.id);
    const activeGroups = React.useMemo(() => groups.filter(g => !g.isArchived), [groups]);
    // Moved to TanStack Query: transactions, people, paymentSources
    const [isLoading, setIsLoading] = useState(true);
    const selectedGroupId = useAppStore(s => s.selectedGroupId);
    const setSelectedGroupId = useAppStore(s => s.setSelectedGroupId);
    const theme = useAppStore(s => s.theme);
    const setTheme = useAppStore(s => s.setTheme);

    // Apply theme to document
    useEffect(() => {
        const root = window.document.documentElement;
        const isDark = 
            theme === 'dark' || 
            (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        
        if (isDark) {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
    }, [theme]);
    const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
    const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
    const [isConfirmDeleteModalOpen, setIsConfirmDeleteModalOpen] = useState(false);
    const [isConfirmArchiveModalOpen, setIsConfirmArchiveModalOpen] = useState(false);
    const [isConfirmLeaveModalOpen, setIsConfirmLeaveModalOpen] = useState(false);
    const [pendingGroupSaveData, setPendingGroupSaveData] = useState<Omit<Group, 'id'> | null>(null);
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


    const groupBalances = React.useMemo(() => {
        if (!selectedGroupId) return {};
        const groupTxs = transactions.filter(t => t.groupId === selectedGroupId);
        return Object.fromEntries(calculateGroupBalances(groupTxs));
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

    useBackButton(() => {
        if (isTransactionDetailOpen) { setIsTransactionDetailOpen(false); return true; }
        if (isTransactionModalOpen) { setIsTransactionModalOpen(false); return true; }
        if (isGroupModalOpen) { setIsGroupModalOpen(false); return true; }
        if (isAddActionModalOpen) { setIsAddActionModalOpen(false); return true; }
        if (isPaymentSourceModalOpen) { setIsPaymentSourceModalOpen(false); return true; }
        if (isPaymentSourceManageOpen) { setIsPaymentSourceManageOpen(false); return true; }
        if (isSettleUpOpen) { setIsSettleUpOpen(false); return true; }
        if (isSettingsModalOpen) { setIsSettingsModalOpen(false); return true; }
        if (pendingDeleteTransaction) { setPendingDeleteTransaction(null); return true; }
        if (pendingDeletePaymentSource) { setPendingDeletePaymentSource(null); return true; }
        
        // If no modal but a group is selected, go back to home screen
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
            const validation = await validateInvite(inviteToken);

            if (!validation.isValid) {
                toast.error(`Invite link is invalid: ${validation.error}`);
                window.history.replaceState({}, '', '/'); // Clear URL
                return;
            }

            // Accept the invite
            const result = await acceptInvite({
                inviteToken,
                personId
            });

            if (result.success) {
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
            const { groupId } = event.detail;

            try {
                const updatedPeople = await api.getPeople(currentUserId);
                qc.setQueryData(qk.people(currentUserId), updatedPeople);

                const updatedGroups = await api.getGroups(currentUserId);
                qc.setQueryData(qk.groups(currentUserId), updatedGroups);
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
    // Realtime for transactions/payment sources/people/group members handled by bridges

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
            await api.deleteTransaction(pendingDeleteTransaction.id, pendingDeleteTransaction.groupId);
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
        const selectedGroup = groups.find(g => g.id === selectedGroupId);
        if (selectedGroup) {
            setEditingGroup(selectedGroup);
            setIsGroupModalOpen(true);
        }
    };

    const executeGroupSave = async (groupData: Omit<Group, 'id'>, removingSelf: boolean) => {
        if (!editingGroup) return;
        try {
            await api.updateGroup(editingGroup.id, groupData);

            // If cute icons was just turned ON, apply emojis to all existing transactions
            const wasEnabled = editingGroup.enableCuteIcons ?? true;
            const nowEnabled = groupData.enableCuteIcons ?? true;
            if (nowEnabled && !wasEnabled) {
                try {
                    await api.batchApplyEmojisToGroupTransactions(editingGroup.id);
                    await qc.invalidateQueries({ queryKey: qk.transactions(currentUserId) });
                } catch (err) {
                    console.warn('Failed to batch apply emojis to existing transactions:', err);
                }
            }

            // Refresh groups with proper filtering to ensure accurate state
            await qc.invalidateQueries({ queryKey: qk.groups(currentUserId) });

            if (removingSelf) {
                setSelectedGroupId(null);
                setIsGroupModalOpen(false);
                setEditingGroup(null);
                setIsConfirmLeaveModalOpen(false);
                setPendingGroupSaveData(null);
                toast.success(`You have left the group "${editingGroup.name}".`);
            } else {
                setIsGroupModalOpen(false);
                setEditingGroup(null);
            }
        } catch (error) {
            console.error('Failed to save group', error);
            toast.error('Failed to save group updates.');
        }
    };

    const handleSaveGroup = async (groupData: Omit<Group, 'id'>) => {
        try {
            // Validate currentUserId before proceeding
            if (!currentUserId || currentUserId.trim() === '') {
                toast.error('User not properly loaded. Please refresh the page and try again.');
                return;
            }

            if (editingGroup) {
                // Check if user is removing themselves from the group
                const wasUserMember = editingGroup.members.includes(currentUserId);
                const isUserStillMember = groupData.members.includes(currentUserId);
                const removingSelf = wasUserMember && !isUserStillMember;

                if (removingSelf) {
                    setPendingGroupSaveData(groupData);
                    setIsConfirmLeaveModalOpen(true);
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
                    setSelectedGroupId(newGroup.id);
                } else {
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
                        onAddExpense={() => { setEditingTransaction(null); setIsTransactionModalOpen(true); }}
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
                    theme={theme}
                    onThemeChange={setTheme}
                />

            )}

            {isTransactionModalOpen && selectedGroup && (
                <TransactionFormModal
                    isOpen={isTransactionModalOpen}
                    onClose={() => { setIsTransactionModalOpen(false); setEditingTransaction(null); }}
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
                    currentUserName={person?.name || user?.fullName || ''}
                    groupBalances={groupBalances}
                    allSettled={allSettled}
                    userSettled={userSettled}
                    isProcessingGroupAction={isProcessingGroupAction}
                    onDeleteGroup={() => {
                        if (!editingGroup) return;
                        setIsConfirmDeleteModalOpen(true);
                    }}
                    onArchiveGroup={() => {
                        if (!editingGroup) return;
                        setIsConfirmArchiveModalOpen(true);
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
                            // Immediately add to cache so the screen updates without waiting for realtime
                            qc.setQueryData<Transaction[]>(qk.transactions(currentUserId), (prev = []) =>
                                prev.some(t => t.id === created.id) ? prev : [created, ...prev]
                            );
                            return created;
                        }
                    }}
                    onCreated={(_tx: Transaction) => {
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

            <Toaster position="top-center" reverseOrder={false} />

            {/* Global destructive action confirmations */}
            {isConfirmDeleteModalOpen && editingGroup && (
                <ConfirmDeleteModal
                    open={isConfirmDeleteModalOpen}
                    entityType="group"
                    entityName={editingGroup.name}
                    loading={isProcessingGroupAction}
                    onConfirm={handleConfirmDeleteGroup}
                    onCancel={() => setIsConfirmDeleteModalOpen(false)}
                />
            )}

            {isConfirmArchiveModalOpen && editingGroup && (
                <ArchivePromptModal
                    isOpen={isConfirmArchiveModalOpen}
                    onClose={() => setIsConfirmArchiveModalOpen(false)}
                    onArchive={handleConfirmArchiveGroup}
                />
            )}

            {isConfirmLeaveModalOpen && pendingGroupSaveData && editingGroup && (
                <BaseModal
                    open={isConfirmLeaveModalOpen}
                    onClose={() => {
                        setIsConfirmLeaveModalOpen(false);
                        setPendingGroupSaveData(null);
                    }}
                    title="Leave Group?"
                    size="sm"
                    description={<span className="text-slate-300 text-sm">You are removing yourself from this group.</span>}
                    footer={
                        <div className="flex gap-2">
                            <button
                                onClick={() => {
                                    setIsConfirmLeaveModalOpen(false);
                                    setPendingGroupSaveData(null);
                                }}
                                className="px-4 py-2 bg-white/10 text-white rounded-md hover:bg-white/20"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => executeGroupSave(pendingGroupSaveData, true)}
                                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-md"
                            >
                                Leave Group
                            </button>
                        </div>
                    }
                >
                    <p className="text-sm text-slate-300">You will no longer have access to "{editingGroup.name}" or its transactions. This action cannot be undone unless someone invites you back.</p>
                </BaseModal>
            )}
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

    const handleConfirmDeleteGroup = async () => {
        if (!editingGroup) return;
        setIsProcessingGroupAction(true);
        try {
            const isAdmin = editingGroup.createdBy === currentUserId;
            if (isAdmin) {
                await deleteGroup(editingGroup.id, currentUserId, true, allSettled);
                qc.setQueryData<Group[]>(qk.groups(currentUserId), (prev = []) => prev.filter(g => g.id !== editingGroup.id));
                setIsConfirmDeleteModalOpen(false);
                setIsGroupModalOpen(false);
                setSelectedGroupId(null);
            } else {
                const res = await requestGroupDeletion(editingGroup.id, currentUserId);
                toast.success(res.message || 'Deletion request sent to the group admin.');
                setIsConfirmDeleteModalOpen(false);
            }
        } catch (e) {
            toast.error(e.message || 'Failed to delete group.');
        } finally {
            setIsProcessingGroupAction(false);
        }
    };

    const handleConfirmArchiveGroup = async () => {
        if (!editingGroup) return;
        setIsProcessingGroupAction(true);
        try {
            await archiveGroup(editingGroup.id, currentUserId, editingGroup.createdBy === currentUserId, userSettled, allSettled);
            qc.setQueryData<Group[]>(qk.groups(currentUserId), (prev = []) => prev.map(g => g.id === editingGroup.id ? { ...g, isArchived: true } : g));
            setIsConfirmArchiveModalOpen(false);
            setIsGroupModalOpen(false);
        } catch (e) {
            toast.error(e.message || 'Failed to archive group.');
        } finally {
            setIsProcessingGroupAction(false);
        }
    };

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