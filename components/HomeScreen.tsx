import React, { useMemo, useState } from 'react';
import { Group, Transaction, Person } from '../types';
import GroupSummaryCard from './GroupSummaryCard';
import { PlusIcon } from './icons/Icons';
import { getUserFacingDebts } from '../utils/calculations';
import { formatMoney } from '../utils/money';
import BalanceBreakdownModal from './BalanceBreakdownModal';

interface HomeScreenProps {
    groups: Group[];
    transactions: Transaction[];
    people: Person[];
    currentUserId: string;
    onSelectGroup: (groupId: string) => void;
    onAddGroup: () => void;
    onSettleLine?: (args: { groupId: string; payerId: string; receiverId: string; amount: number }) => void;
}

const HomeScreen: React.FC<HomeScreenProps> = ({ groups, transactions, people, currentUserId, onSelectGroup, onAddGroup, onSettleLine }) => {
    const [breakdownType, setBreakdownType] = useState<'owed' | 'owing' | null>(null);

    // Same debt simplification as BalanceBreakdownModal so card totals match modal totals.
    // "Owed" and "owe" can both be non-zero (unlike a single global net).
    const { netBalance, byCurrency } = useMemo(() => {
        const debts = getUserFacingDebts(currentUserId, groups, transactions);
        return {
            netBalance: debts.netBalance,
            byCurrency: debts.byCurrency,
        };
    }, [transactions, currentUserId, groups]);

    const renderAmounts = (pick: (b: { code: string; owedToUser: number; userOwes: number; net: number }) => number) => {
        if (byCurrency.length === 0) return formatMoney(0, groups[0]?.currency || 'INR');
        if (byCurrency.length === 1) return formatMoney(pick(byCurrency[0]), byCurrency[0].code);
        return (
            <span className="flex flex-col gap-1">
                {byCurrency.map((b) => (
                    <span key={b.code}>{formatMoney(pick(b), b.code)}</span>
                ))}
            </span>
        );
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
                            <p className="text-3xl font-bold text-success mt-2">{renderAmounts((b) => b.owedToUser)}</p>
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
                            <p className="text-3xl font-bold text-destructive mt-2">{renderAmounts((b) => b.userOwes)}</p>
                            <p className="text-xs text-muted-foreground mt-1">(tap to see breakdown)</p>
                        </button>
                        <div className="bg-card backdrop-blur-md p-card rounded-2xl shadow-sm border border-border">
                            <h3 className="text-sm font-medium text-muted-foreground">Total Net Balance</h3>
                            <p className={`text-3xl font-bold mt-2 ${byCurrency.length > 1 ? 'text-foreground' : netBalance >= 0 ? 'text-success' : 'text-destructive'}`}>
                                {renderAmounts((b) => b.net)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                                {byCurrency.length > 1 ? '(per currency)' : '(tap a group for details)'}
                            </p>
                        </div>
                    </div>
                </section>

                <section>
                    <h2 className="text-xl font-semibold mb-4 text-muted-foreground">Your Groups</h2>
                    {groups.length === 0 ? (
                        <div className="bg-card border border-border rounded-2xl p-8 md:p-10 text-center max-w-lg">
                            <p className="text-lg font-semibold text-foreground">No groups yet</p>
                            <p className="text-sm text-muted-foreground mt-2">
                                Create a trip, household, or shared wallet. Invite friends with a link and split expenses in seconds.
                            </p>
                            <button
                                type="button"
                                onClick={onAddGroup}
                                className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-br from-primary to-accent text-primary-foreground rounded-lg text-sm font-medium shadow-sm"
                            >
                                <PlusIcon className="h-5 w-5" />
                                Create your first group
                            </button>
                        </div>
                    ) : (
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
                    )}
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
                    onSettleLine={
                        onSettleLine
                            ? (args) => {
                                setBreakdownType(null);
                                onSettleLine(args);
                            }
                            : undefined
                    }
                />
            )}
        </div>
    );
};

export default HomeScreen;
