import React, { useMemo, useState } from 'react';
import { Group, Transaction, Person } from '../types';
import GroupSummaryCard from './GroupSummaryCard';
import { PlusIcon } from './icons/Icons';
import { calculateGroupBalances, getUserFacingDebts } from '../utils/calculations';
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
        const nets = new Map<string, number>();
        for (const group of groups) {
            if (group.isArchived) continue;
            const groupTxs = transactions.filter((t) => t.groupId === group.id);
            const net = calculateGroupBalances(groupTxs).get(currentUserId) ?? 0;
            const code = group.currency || 'INR';
            nets.set(code, (nets.get(code) ?? 0) + net);
        }
        const byCurrency = debts.byCurrency.map((bucket) => ({
            ...bucket,
            net: Math.round((nets.get(bucket.code) ?? 0) * 100) / 100,
        }));
        const netBalance = byCurrency.length === 1 ? byCurrency[0].net : byCurrency.reduce((sum, bucket) => sum + bucket.net, 0);
        return { netBalance, byCurrency };
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
            <header className="bg-background/80 backdrop-blur-sm border-b border-border sticky top-0 z-10 px-4 py-4 md:px-8 flex justify-between items-center gap-3 safe-area-top">
                <div className="min-w-0">
                    <h1 className="text-2xl font-semibold tracking-tight text-foreground">Home</h1>
                    <p className="text-sm text-muted-foreground">Your groups and what you owe.</p>
                </div>
                <button
                    type="button"
                    onClick={onAddGroup}
                    className="inline-flex shrink-0 items-center gap-2 h-9 px-3 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <PlusIcon className="h-4 w-4" />
                    <span>New group</span>
                </button>
            </header>

            <main className="px-4 py-6 md:px-8 md:py-8 space-y-8">
                <section className="space-y-3">
                    <h2 className="text-sm font-medium text-muted-foreground">Summary</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <button
                            type="button"
                            onClick={() => setBreakdownType('owed')}
                            className="bg-card p-5 rounded-xl border border-border text-left shadow-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <h3 className="text-sm font-medium text-muted-foreground">You are owed</h3>
                            <p className="text-2xl font-semibold tracking-tight text-success mt-2">{renderAmounts((b) => b.owedToUser)}</p>
                            <p className="text-xs text-muted-foreground mt-2">See breakdown</p>
                        </button>
                        <button
                            type="button"
                            onClick={() => setBreakdownType('owing')}
                            className="bg-card p-5 rounded-xl border border-border text-left shadow-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <h3 className="text-sm font-medium text-muted-foreground">You owe</h3>
                            <p className="text-2xl font-semibold tracking-tight text-destructive mt-2">{renderAmounts((b) => b.userOwes)}</p>
                            <p className="text-xs text-muted-foreground mt-2">See breakdown</p>
                        </button>
                        <div className="bg-card p-5 rounded-xl border border-border shadow-sm">
                            <h3 className="text-sm font-medium text-muted-foreground">Net</h3>
                            <p className={`text-2xl font-semibold tracking-tight mt-2 ${byCurrency.length > 1 ? 'text-foreground' : netBalance >= 0 ? 'text-success' : 'text-destructive'}`}>
                                {renderAmounts((b) => b.net)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-2">
                                {byCurrency.length > 1 ? 'Per currency' : 'Open a group for details'}
                            </p>
                        </div>
                    </div>
                </section>

                <section className="space-y-3">
                    <h2 className="text-sm font-medium text-muted-foreground">Groups</h2>
                    {groups.length === 0 ? (
                        <div className="bg-card border border-dashed border-border rounded-xl p-8 text-center max-w-lg">
                            <p className="text-base font-semibold text-foreground">No groups yet</p>
                            <p className="text-sm text-muted-foreground mt-2">
                                Create a trip, household, or shared wallet. Invite friends with a link and split expenses in seconds.
                            </p>
                            <button
                                type="button"
                                onClick={onAddGroup}
                                className="mt-6 inline-flex items-center gap-2 h-9 px-3 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90"
                            >
                                <PlusIcon className="h-4 w-4" />
                                Create your first group
                            </button>
                        </div>
                    ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
