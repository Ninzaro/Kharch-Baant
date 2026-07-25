import React, { useMemo } from 'react';
import { Group, Transaction, Person, GROUP_TYPES } from '../types';
import Avatar from './Avatar';
import { calculateShares } from '../utils/calculations';

interface GroupSummaryCardProps {
    group: Group;
    transactions: Transaction[];
    people: Person[];
    currentUserId: string;
    onSelectGroup: (groupId: string) => void;
}

const GroupSummaryCard: React.FC<GroupSummaryCardProps> = ({ group, transactions, people, currentUserId, onSelectGroup }) => {
    
    const { userBalance } = useMemo(() => {
        let balance = 0;
        transactions.forEach(t => {
            const shares = calculateShares(t);
            const userShare = shares.get(currentUserId) || 0;
            
            if (t.paidById === currentUserId) {
                balance += (t.amount - userShare);
            } else {
                balance -= userShare;
            }
        });
        return { userBalance: balance };
    }, [transactions, currentUserId]);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: group.currency, signDisplay: 'auto' }).format(amount);
    };
    
    // Safety check: ensure group.members exists and is an array
    const members = people.filter(p => (group.members || []).includes(p.id));

    const groupTypeLabel = useMemo(() => {
        return GROUP_TYPES.find(option => option.value === group.groupType)?.label || 'Other';
    }, [group.groupType]);

    const tripRange = useMemo(() => {
        if (!group.tripStartDate || !group.tripEndDate) return '';
        const start = new Date(group.tripStartDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const end = new Date(group.tripEndDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `${start} - ${end}`;
    }, [group.tripStartDate, group.tripEndDate]);

    let balanceText = "You are settled up";
    let balanceColor = "text-muted-foreground";

    if (userBalance > 0.01) {
        balanceText = `You are owed ${formatCurrency(userBalance)}`;
        balanceColor = "text-success";
    } else if (userBalance < -0.01) {
        balanceText = `You owe ${formatCurrency(Math.abs(userBalance))}`;
        balanceColor = "text-destructive";
    }

    return (
        <button 
            onClick={() => onSelectGroup(group.id)}
            className="bg-foreground/5 backdrop-blur-md p-6 rounded-2xl shadow-lg text-left w-full h-full flex flex-col justify-between hover:bg-foreground/10 border border-border hover:border-border transition-all focus:outline-none focus:ring-2 focus:ring-ring"
        >
            <div>
                <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-bold text-foreground truncate">{group.name}</h3>
                        {tripRange && (
                            <span className="text-xs font-medium text-muted-foreground bg-foreground/5 px-2 py-1 rounded-full border border-border">
                                {tripRange}
                            </span>
                        )}
                    </div>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">{groupTypeLabel}</span>
                </div>
                <div className="flex items-center mt-3 -space-x-2">
                    {members.slice(0, 5).map(member => (
                       <Avatar key={member.id} id={member.id} name={member.name} avatarUrl={member.avatarUrl} size="md" />
                    ))}
                    {members.length > 5 && (
                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground ring-2 ring-border">
                            +{members.length - 5}
                        </div>
                    )}
                </div>
            </div>
            <div className="mt-4 pt-4 border-t border-border">
                <p className={`font-semibold ${balanceColor}`}>{balanceText}</p>
            </div>
        </button>
    );
};

export default GroupSummaryCard;
