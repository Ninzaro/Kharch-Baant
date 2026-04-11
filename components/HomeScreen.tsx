import React, { useMemo } from 'react';
import { Group, Transaction, Person } from '../types';
import GroupSummaryCard from './GroupSummaryCard';
import { PlusIcon } from './icons/Icons';
import { calculateGroupBalances } from '../utils/calculations';

interface HomeScreenProps {
    groups: Group[];
    transactions: Transaction[];
    people: Person[];
    currentUserId: string;
    onSelectGroup: (groupId: string) => void;
    onAddGroup: () => void;
}

const HomeScreen: React.FC<HomeScreenProps> = ({ groups, transactions, people, currentUserId, onSelectGroup, onAddGroup }) => {
    
    const { totalOwedToUser, totalUserOwes, netBalance } = useMemo(() => {
        const balances = calculateGroupBalances(transactions);
        const net = balances.get(currentUserId) ?? 0;
        return {
            totalOwedToUser: net > 0 ? net : 0,
            totalUserOwes: net < 0 ? Math.abs(net) : 0,
            netBalance: net,
        };
    }, [transactions, currentUserId]);
    
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
            <header className="bg-black/30 backdrop-blur-lg border-b border-white/10 sticky top-0 z-10 p-4 md:p-6 flex justify-between items-center safe-area-top">
                <h1 className="text-3xl font-bold">Dashboard</h1>
                 <button
                    onClick={onAddGroup}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-md hover:from-indigo-600 hover:to-purple-700 transition-colors text-sm font-medium"
                >
                    <PlusIcon className="h-5 w-5" />
                    <span className="">Add Group</span>
                </button>
            </header>
            <main className="p-4 md:p-6 space-y-8">
                <section>
                    <h2 className="text-xl font-semibold mb-4 text-slate-300">Overall Summary</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                        <div className="bg-white/5 backdrop-blur-md p-6 rounded-2xl shadow-lg border border-white/10">
                            <h3 className="text-sm font-medium text-slate-400">Total you are owed</h3>
                            <p className="text-3xl font-bold text-emerald-400 mt-2">{formatNumber(totalOwedToUser)}</p>
                            <p className="text-xs text-slate-500">(across all currencies)</p>
                        </div>
                        <div className="bg-white/5 backdrop-blur-md p-6 rounded-2xl shadow-lg border border-white/10">
                            <h3 className="text-sm font-medium text-slate-400">Total you owe</h3>
                            <p className="text-3xl font-bold text-rose-400 mt-2">{formatNumber(totalUserOwes)}</p>
                             <p className="text-xs text-slate-500">(across all currencies)</p>
                        </div>
                        <div className="bg-white/5 backdrop-blur-md p-6 rounded-2xl shadow-lg border border-white/10">
                            <h3 className="text-sm font-medium text-slate-400">Total Net Balance</h3>
                            <p className={`text-3xl font-bold mt-2 ${netBalance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {formatNumber(netBalance)}
                            </p>
                             <p className="text-xs text-slate-500">(across all currencies)</p>
                        </div>
                    </div>
                </section>
                
                <section>
                    <h2 className="text-xl font-semibold mb-4 text-slate-300">Your Groups</h2>
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
        </div>
    );
};

export default HomeScreen;