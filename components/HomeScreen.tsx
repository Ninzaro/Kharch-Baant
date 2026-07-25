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
        <div className="flex-1 w-full h-full overflow-y-auto">
            <header className="bg-overlay/30 backdrop-blur-lg border-b border-border sticky top-0 z-10 p-4 md:p-6 flex justify-between items-center safe-area-top">
                <h1 className="text-3xl font-bold">Dashboard</h1>
                 <button
                    onClick={onAddGroup}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-br from-primary to-accent text-foreground rounded-md hover:from-primary/90 hover:to-accent/90 transition-colors text-sm font-medium"
                >
                    <PlusIcon className="h-5 w-5" />
                    <span className="text-black">Add Group</span>
                </button>
            </header>
            <main className="p-4 md:p-6 space-y-8">
                <section>
                    <h2 className="text-xl font-semibold mb-4 text-muted-foreground">Overall Summary</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                        <button
                            onClick={() => setBreakdownType('owed')}
                            className="bg-foreground/5 backdrop-blur-md p-6 rounded-2xl shadow-lg border border-border text-left hover:bg-foreground/10 hover:border-success/30 transition-colors group"
                        >
                            <h3 className="text-sm font-medium text-black group-hover:text-muted-foreground">Total you are owed</h3>
                            <p className="text-3xl font-bold text-success mt-2">{formatNumber(totalOwedToUser)}</p>
                            <p className="text-xs text-muted-foreground">(tap to see breakdown)</p>
                        </button>
                        <button
                            onClick={() => setBreakdownType('owing')}
                            className="bg-foreground/5 backdrop-blur-md p-6 rounded-2xl shadow-lg border border-border text-left hover:bg-foreground/10 hover:border-destructive/30 transition-colors group"
                        >
                            <h3 className="text-sm font-medium text-muted-foreground group-hover:text-muted-foreground">Total you owe</h3>
                            <p className="text-3xl font-bold text-destructive mt-2">{formatNumber(totalUserOwes)}</p>
                            <p className="text-xs text-muted-foreground">(tap to see breakdown)</p>
                        </button>
                        <div className="bg-foreground/5 backdrop-blur-md p-6 rounded-2xl shadow-lg border border-border">
                            <h3 className="text-sm font-medium text-muted-foreground">Total Net Balance</h3>
                            <p className={`text-3xl font-bold mt-2 ${netBalance >= 0 ? 'text-success' : 'text-destructive'}`}>
                                {formatNumber(netBalance)}
                            </p>
                            <p className="text-xs text-muted-foreground">(across all currencies)</p>
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
