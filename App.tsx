import React, { useState, useEffect, Suspense } from 'react';
import * as Sentry from '@sentry/react';
import toast, { Toaster } from 'react-hot-toast';
import { Group, Transaction, Person, PaymentSource } from './types';
import * as api from './services/apiService';
import { calculateGroupBalances } from './utils/calculations';
import GroupList from './components/GroupList';
import GroupView from './components/GroupView';
import HomeScreen from './components/HomeScreen';
import ModalShell from './components/ModalShell';
import BaseModal from './components/BaseModal';
import { preloadComponent } from './utils/preload';
import { deleteGroup, archiveGroup, validateInvite, acceptInvite, requestGroupDeletion } from './services/supabaseApiService';
import { assertSupabaseEnvironment } from './services/apiService';
import { SettingsIcon } from './components/icons/Icons';
import { useAuth } from './contexts/SupabaseAuthContext';
import { UserMenu } from './components/auth/UserMenu';
import InvitePage from './components/invite/InvitePage';
import { RealtimeStatus } from './components/RealtimeStatus';

// Lazy-loaded modals — never needed at startup
const TransactionFormModal = React.lazy(() => import('./components/TransactionFormModal'));
const GroupFormModal = React.lazy(() => import('./components/GroupFormModal'));
const ConfirmDeleteModal = React.lazy(() => import('./components/ConfirmDeleteModal'));
const PaymentSourceFormModal = React.lazy(() => import('./components/PaymentSourceFormModal'));
const PaymentSourceManageModal = React.lazy(() => import('./components/PaymentSourceManageModal'));
const SettleUpModal = React.lazy(() => import('./components/SettleUpModal'));
const ArchivePromptModal = React.lazy(() => import('./components/ArchivePromptModal'));
const AddActionModal = React.lazy(() => import('./components/AddActionModal'));
const SettingsModal = React.lazy(() => import('./components/SettingsModal'));
const TransactionDetailModal = React.lazy(() => import('./components/TransactionDetailModal'));

// Preload factories (stable references — defined once at module scope)
const preloadTransactionForm = () => preloadComponent(() => import('./components/TransactionFormModal'));
const preloadGroupForm = () => preloadComponent(() => import('./components/GroupFormModal'));
const preloadSettleUp = () => preloadComponent(() => import('./components/SettleUpModal'));
const preloadSettings = () => preloadComponent(() => import('./components/SettingsModal'));
import { useGroupsQuery, useTransactionsQuery, usePaymentSourcesQuery, usePeopleQuery, useRealtimeGroupsBridge, useRealtimeTransactionsBridge, useRealtimePaymentSourcesBridge, useRealtimePeopleBridge, useRealtimeGroupMembersBridge, qk } from './services/queries';
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
    const { data: transactions = [] } = useTransactionsQuery(person?.id);
    const { data: paymentSources = [] } = usePaymentSourcesQuery(person?.id);
    const { data: people = [] } = usePeopleQuery(person?.id);

    // Identify the user in Sentry so error reports show who was affected
    useEffect(() => {
      if (person) {
        Sentry.setUser({ id: person.id, email: person.email, username: person.name });
      } else {
        Sentry.setUser(null);
      }
    }, [person?.id]);

    // Preload the three most-used modals when the browser is idle
    useEffect(() => {
        if (!('requestIdleCallback' in window)) return;
        const id = requestIdleCallback(() => {
            preloadTransactionForm();
            preloadGroupForm();
            preloadSettleUp();
        });
        return () => cancelIdleCallback(id);
    }, []);

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

    // Apply theme to document; also react to OS preference changes in 'system' mode
    useEffect(() => {
        const root = window.document.documentElement;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');

        const apply = () => {
            const isDark =
                theme === 'dark' ||
                (theme === 'system' && mq.matches);
            root.classList.toggle('dark', isDark);
        };

        apply();

        if (theme === 'system') {
            mq.addEventListener('change', apply);
            return () => mq.removeEventListener('change', apply);
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

    const loading = isLoading || groupsLoading;
    if (loading) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground font-sans">
                <div className="text-center space-y-3">
                    <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent mx-auto" />
                    <p className="text-xl text-muted-foreground">Loading your expenses...</p>
                </div>
            </div>
        );
    }

    const selectedGroup = groups.find(g => g.id === selectedGroupId);
    const groupTransactions = transactions.filter(t => t.groupId === selectedGroupId);
    const groupMembers = selectedGroup ? people.filter(p => selectedGroup.members.includes(p.id)) : [];

    return (
        <div className="h-screen w-screen bg-background text-foreground flex font-sans">
            {selectedGroup ? (
                <>
                    <GroupList
                        groups={activeGroups}
                        people={people}
                        selectedGroupId={selectedGroupId}
                        onSelectGroup={handleSelectGroup}
                        onGoHome={handleGoHome}
                        onAddGroup={handleCreateGroupFromAddAction}
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
                    <header className="flex items-center justify-between px-page py-2 border-b border-border bg-card/80 backdrop-blur-lg safe-area-top">
                        <h1 className="text-lg font-bold text-foreground tracking-tight">Kharch Baant</h1>
                        <div className="flex items-center gap-2">
                            <UserMenu />
                            <button
                                type="button"
                                onClick={() => setIsSettingsModalOpen(true)}
                                onPointerEnter={preloadSettings}
                                className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full transition-colors"
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
                <Suspense fallback={<ModalShell />}>
                    <SettingsModal
                        isOpen={isSettingsModalOpen}
                        onClose={() => setIsSettingsModalOpen(false)}
                        onManagePaymentSources={() => setIsPaymentSourceManageOpen(true)}
                        currentUserId={currentUserId}
                        currentUserPerson={person}
                        theme={theme}
                        onThemeChange={setTheme}
                    />
                </Suspense>
            )}

            {isTransactionModalOpen && selectedGroup && (
                <Suspense fallback={<ModalShell />}>
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
                </Suspense>
            )}

            {isGroupModalOpen && (
                <Suspense fallback={<ModalShell />}>
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
                </Suspense>
            )}

            {isPaymentSourceModalOpen && (
                <Suspense fallback={<ModalShell />}>
                    <PaymentSourceFormModal
                        isOpen={isPaymentSourceModalOpen}
                        onClose={() => setIsPaymentSourceModalOpen(false)}
                        onSave={handleSavePaymentSource}
                    />
                </Suspense>
            )}

            {/* Confirm Delete Transaction Modal */}
            {pendingDeleteTransaction && (
                <Suspense fallback={<ModalShell />}>
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
                </Suspense>
            )}

            {pendingDeletePaymentSource && (
                <Suspense fallback={<ModalShell />}>
                    <ConfirmDeleteModal
                        open={!!pendingDeletePaymentSource}
                        entityType="paymentSource"
                        entityName={pendingDeletePaymentSource.name}
                        impactDescription={`This source is referenced in ${paymentSourceUsageCounts[pendingDeletePaymentSource.id] || 0} transaction(s). ${paymentSourceLastUsed[pendingDeletePaymentSource.id] ? `Last used on ${paymentSourceLastUsed[pendingDeletePaymentSource.id]}. ` : ''}After deletion those transactions will display no payment source. This cannot be undone.`}
                        loading={isDeletingPaymentSource}
                        onCancel={() => setPendingDeletePaymentSource(null)}
                        onConfirm={async () => { await handleConfirmDeletePaymentSource(); }}
                    />
                </Suspense>
            )}


            {isPaymentSourceManageOpen && (
                <Suspense fallback={<ModalShell />}>
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
                </Suspense>
            )}

            {isSettleUpOpen && selectedGroup && (
                <Suspense fallback={<ModalShell />}>
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
                </Suspense>
            )}

            {isTransactionDetailOpen && selectedTransactionForDetail && (
                <Suspense fallback={<ModalShell />}>
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
                </Suspense>
            )}

            <Suspense fallback={null}>
                <AddActionModal
                    open={isAddActionModalOpen}
                    onClose={() => setIsAddActionModalOpen(false)}
                    groups={activeGroups}
                    people={people}
                    onCreateGroup={handleCreateGroupFromAddAction}
                    onSelectGroupForExpense={handleSelectGroupForExpense}
                    currentGroupId={selectedGroupId}
                />
            </Suspense>

            <RealtimeStatus />

            <Toaster position="top-center" reverseOrder={false} />

            {/* Global destructive action confirmations */}
            {isConfirmDeleteModalOpen && editingGroup && (
                <Suspense fallback={<ModalShell />}>
                    <ConfirmDeleteModal
                        open={isConfirmDeleteModalOpen}
                        entityType="group"
                        entityName={editingGroup.name}
                        loading={isProcessingGroupAction}
                        onConfirm={handleConfirmDeleteGroup}
                        onCancel={() => setIsConfirmDeleteModalOpen(false)}
                    />
                </Suspense>
            )}

            {isConfirmArchiveModalOpen && editingGroup && (
                <Suspense fallback={<ModalShell />}>
                    <ArchivePromptModal
                        isOpen={isConfirmArchiveModalOpen}
                        onClose={() => setIsConfirmArchiveModalOpen(false)}
                        onArchive={handleConfirmArchiveGroup}
                    />
                </Suspense>
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
                    description={<span className="text-muted-foreground text-sm">You are removing yourself from this group.</span>}
                    footer={
                        <div className="flex gap-2">
                            <button
                                onClick={() => {
                                    setIsConfirmLeaveModalOpen(false);
                                    setPendingGroupSaveData(null);
                                }}
                                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => executeGroupSave(pendingGroupSaveData, true)}
                                className="px-4 py-2 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-md"
                            >
                                Leave Group
                            </button>
                        </div>
                    }
                >
                    <p className="text-sm text-muted-foreground">You will no longer have access to "{editingGroup.name}" or its transactions. This action cannot be undone unless someone invites you back.</p>
                </BaseModal>
            )}
        </div>
    );
}

// Show sign-in screen when not authenticated
import { AuthenticateWithRedirectCallback } from '@clerk/clerk-react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import AuthScreen from './components/auth/AuthScreen';
import WelcomeScreen from './components/auth/WelcomeScreen';
import { useNativeOAuth } from './hooks/useNativeOAuth';

const AppWithAuth: React.FC = () => {
    const { user, loading, isSyncing } = useAuth();
    const { isNative, openAccountPortal } = useNativeOAuth();
    const [takingLong, setTakingLong] = useState(false);
    const [isSsoCallback, setIsSsoCallback] = useState(() => 
        typeof window !== 'undefined' && (
            window.location.pathname.startsWith('/sso-callback') || 
            window.location.search.includes('__clerk_status') ||
            window.location.hash.includes('__clerk_status')
        )
    );

    useEffect(() => {
        if (!loading) {
            setTakingLong(false);
            return;
        }
        const timer = setTimeout(() => {
            setTakingLong(true);
        }, 6000);
        return () => clearTimeout(timer);
    }, [loading]);

    // Check if there's an invite token in the URL or SSO callback
    const [inviteInfo, setInviteInfo] = useState<{ token: string; groupName?: string } | null>(null);

    useEffect(() => {
        if (!isNative) return;
        let handle: { remove: () => Promise<void> } | undefined;
        const sub = CapacitorApp.addListener('backButton', () => {
            if (user) return;
            if (isSsoCallback || inviteInfo?.token) return;
            CapacitorApp.exitApp();
        });
        sub.then((l) => { handle = l; }).catch(() => {});
        return () => { handle?.remove(); };
    }, [user, isNative, isSsoCallback, inviteInfo]);

    useEffect(() => {
        const syncFromLocation = () => {
            const urlPath = window.location.pathname;
            const inviteMatch = urlPath.match(/^\/invite\/(.+)$/);
            if (inviteMatch) {
                const token = inviteMatch[1];
                localStorage.setItem('pendingInviteToken', token);
                setInviteInfo({ token });
            }
            setIsSsoCallback(
                window.location.pathname.startsWith('/sso-callback') || 
                window.location.search.includes('__clerk_status') ||
                window.location.hash.includes('__clerk_status')
            );
        };
        syncFromLocation();
        window.addEventListener('popstate', syncFromLocation);
        return () => window.removeEventListener('popstate', syncFromLocation);
    }, []);

    if (isSsoCallback) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground font-sans p-6">
                <div className="text-center max-w-sm">
                    <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent mx-auto mb-4" />
                    <p className="text-foreground font-medium mb-1">Completing sign in...</p>
                    <p className="text-xs text-muted-foreground">Please wait a moment</p>
                    <AuthenticateWithRedirectCallback 
                        signInFallbackRedirectUrl="/"
                        signUpFallbackRedirectUrl="/"
                    />
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground font-sans p-6">
                <div className="text-center max-w-sm">
                    <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent mx-auto mb-4" />
                    <p className="text-foreground font-medium mb-1">
                        {isSyncing ? "Syncing profile..." : "Connecting to authentication..."}
                    </p>
                    <p className="text-xs text-muted-foreground">Please wait a moment</p>
                    {takingLong && (
                        <div className="mt-6 p-4 bg-card border border-border rounded-xl text-xs space-y-3">
                            <p className="text-muted-foreground">Taking longer than usual to connect. Please check your internet connection.</p>
                            <button
                                onClick={() => window.location.reload()}
                                className="w-full py-2 px-4 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
                            >
                                Retry / Reload
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Dedicated Invite Acceptance Page (works pre/post auth)
    if (!user && inviteInfo?.token) {
        return <InvitePage />;
    }

    if (!user) {
        if (isNative) {
            return (
                <WelcomeScreen
                    onContinue={() => {
                        void openAccountPortal().catch((err) => {
                            console.error('Could not open Clerk sign-in', err);
                        });
                    }}
                />
            );
        }
        return <AuthScreen />;
    }

    return <App />;
};

export default AppWithAuth;