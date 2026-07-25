import React, { useMemo, useState } from 'react';
import { Group, Transaction, Person } from '../types';
import GroupSummaryCard from './GroupSummaryCard';
import { PlusIcon } from './icons/Icons';
import { getUserFacingDebts } from '../utils/calculations';
import BalanceBreakdownModal from './BalanceBreakdownModal';

interface HomeScreenProps {
    groups: Group[];
    transactions: Transaction[];
    people: Person[];
    currentUserId: string;
    onSelectGroup: (groupId: string) => void;
    onAddGroup: () => void;
}

const HomeScreen: React.FC<HomeScreenProps> = ({ groups, transactions, people, currentUserId, onSelectGroup, onAddGroup }) => {
    const [breakdownType, setBreakdownType] = useState<'owed' | 'owing' | null>(null);

    // Same debt simplification as BalanceBreakdownModal so card totals match modal totals.
    // "Owed" and "owe" can both be non-zero (unlike a single global net).
    const { totalOwedToUser, totalUserOwes, netBalance } = useMemo(() => {
        const debts = getUserFacingDebts(currentUserId, groups, transactions);
        return {
            totalOwedToUser: debts.totalOwedToUser,
            totalUserOwes: debts.totalUserOwes,
            netBalance: debts.netBalance,
        };
    }, [transactions, currentUserId, groups]);

    const formatNumber = (amount: number) => {
        return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
    };

    const groupTransactionsMap = useMemo(() => {
        const map = new Map<string, Transaction[]>();
        transactions.forEach(t => {
            if (!map.has(t.groupId)) {
                map.set(t.groupId, []);
            }
            map.get(t.groupId)!.push(t);
        });
        return map;
    }, [transactions]);

    return (
        <div className="flex-1 w-full h-full overflow-y-auto bg-background text-foreground">
            <header className="bg-card/80 backdrop-blur-lg border-b border-border sticky top-0 z-10 p-page md:px-section md:py-card flex justify-between items-center safe-area-top">
                <h1 className="text-3xl font-bold text-foreground tracking-tight">Dashboard</h1>
                <button
                    type="button"
                    onClick={onAddGroup}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-br from-primary to-accent text-primary-foreground rounded-lg hover:from-primary/90 hover:to-accent/90 transition-colors text-sm font-medium shadow-sm"
                >
                    <PlusIcon className="h-5 w-5" />
                    <span>Add Group</span>
                </button>
            </header>

            <main className="p-page md:p-section space-y-section">
                <section>
                    <h2 className="text-xl font-semibold mb-4 text-muted-foreground">Overall Summary</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                        <button
                            type="button"
                            onClick={() => setBreakdownType('owed')}
                            className="bg-card backdrop-blur-md p-card rounded-2xl shadow-sm border border-border text-left hover:bg-muted/60 hover:border-success/40 transition-colors group"
                        >
                            <h3 className="text-sm font-medium text-muted-foreground group-hover:text-foreground">
                                Total you are owed
                            </h3>
                            <p className="text-3xl font-bold text-success mt-2">{formatNumber(totalOwedToUser)}</p>
                            <p className="text-xs text-muted-foreground mt-1">(tap to see breakdown)</p>
                        </button>
                        <button
                            type="button"
                            onClick={() => setBreakdownType('owing')}
                            className="bg-card backdrop-blur-md p-card rounded-2xl shadow-sm border border-border text-left hover:bg-muted/60 hover:border-destructive/40 transition-colors group"
                        >
                            <h3 className="text-sm font-medium text-muted-foreground group-hover:text-foreground">
                                Total you owe
                            </h3>
                            <p className="text-3xl font-bold text-destructive mt-2">{formatNumber(totalUserOwes)}</p>
                            <p className="text-xs text-muted-foreground mt-1">(tap to see breakdown)</p>
                        </button>
                        <div className="bg-card backdrop-blur-md p-card rounded-2xl shadow-sm border border-border">
                            <h3 className="text-sm font-medium text-muted-foreground">Total Net Balance</h3>
                            <p className={`text-3xl font-bold mt-2 ${netBalance >= 0 ? 'text-success' : 'text-destructive'}`}>
                                {formatNumber(netBalance)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">(across all currencies)</p>
                        </div>
                    </div>
                </section>

                <section>
                    <h2 className="text-xl font-semibold mb-4 text-muted-foreground">Your Groups</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {groups.map(group => (
                            <GroupSummaryCard
                                key={group.id}
                                group={group}
                                transactions={groupTransactionsMap.get(group.id) || []}
                                people={people}
                                currentUserId={currentUserId}
                                onSelectGroup={onSelectGroup}
                            />
                        ))}
                    </div>
                </section>
            </main>

            {breakdownType && (
                <BalanceBreakdownModal
                    isOpen={true}
                    onClose={() => setBreakdownType(null)}
                    type={breakdownType}
                    groups={groups}
                    transactions={transactions}
                    people={people}
                    currentUserId={currentUserId}
                    onSelectGroup={(groupId) => {
                        setBreakdownType(null);
                        onSelectGroup(groupId);
                    }}
                />
            )}
        </div>
    );
};

export default HomeScreen;
