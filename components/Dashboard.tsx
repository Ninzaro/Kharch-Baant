import React, { useMemo, useState } from 'react';
import { Transaction, Person, Currency } from '../types';
import { calculateGroupBalances, simplifyGroupDebts } from '../utils/calculations';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface DashboardProps {
    transactions: Transaction[];
    currentUserId: string;
    people: Person[];
    currency: Currency;
}

const Dashboard: React.FC<DashboardProps> = ({ transactions, currentUserId, people, currency }) => {
    const [isBreakdownOpen, setIsBreakdownOpen] = useState(false);

    // Single-group context: simplify nets so "you are owed" and "you owe" can both show.
    const { totalOwedToUser, totalUserOwes, netBalance } = useMemo(() => {
        if (!currentUserId) return { totalOwedToUser: 0, totalUserOwes: 0, netBalance: 0 };
        const balances = calculateGroupBalances(transactions);
        const transfers = simplifyGroupDebts(balances);
        let owed = 0;
        let owe = 0;
        for (const t of transfers) {
            if (t.to === currentUserId) owed += t.amount;
            else if (t.from === currentUserId) owe += t.amount;
        }
        return {
            totalOwedToUser: Math.round(owed * 100) / 100,
            totalUserOwes: Math.round(owe * 100) / 100,
            netBalance: Math.round((owed - owe) * 100) / 100,
        };
    }, [transactions, currentUserId]);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency }).format(amount);
    };

    return (
        <div className="flex flex-col gap-4">
            {/* Hero Card: Total Balance */}
            <div className="bg-foreground/5 backdrop-blur-md p-6 rounded-2xl shadow-lg border border-border text-center">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Balance</h3>
                <p className={`text-4xl sm:text-5xl font-extrabold mt-2 break-words truncate ${netBalance >= 0 ? 'text-success' : 'text-destructive'}`} title={formatCurrency(netBalance)}>
                    {formatCurrency(netBalance)}
                </p>

                <button
                    onClick={() => setIsBreakdownOpen(!isBreakdownOpen)}
                    className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mx-auto"
                >
                    {isBreakdownOpen ? 'Hide breakdown' : 'View breakdown'}
                    {isBreakdownOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
            </div>

            {/* Collapsible Breakdown */}
            {isBreakdownOpen && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-4 duration-200">
                    <div className="bg-foreground/5 backdrop-blur-md p-4 rounded-xl shadow border border-border">
                        <h3 className="text-xs font-medium text-muted-foreground uppercase">You are owed</h3>
                        <p className="text-xl font-bold text-success mt-1 break-words truncate" title={formatCurrency(totalOwedToUser)}>
                            {formatCurrency(totalOwedToUser)}
                        </p>
                    </div>
                    <div className="bg-foreground/5 backdrop-blur-md p-4 rounded-xl shadow border border-border">
                        <h3 className="text-xs font-medium text-muted-foreground uppercase">You owe</h3>
                        <p className="text-xl font-bold text-destructive mt-1 break-words truncate" title={formatCurrency(totalUserOwes)}>
                            {formatCurrency(totalUserOwes)}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;