import React, { useMemo } from 'react';
import { Transaction, Person, Currency } from '../types';
import Avatar from './Avatar';
import { calculateGroupBalances, simplifyGroupDebts } from '../utils/calculations';

interface MemberBalancesProps {
    transactions: Transaction[];
    people: Person[];
    currency: Currency;
    currentUserId: string;
    currentUserPerson?: Person | null;
    onSettlePair?: (payerId: string, receiverId: string, amount: number) => void;
}

const MemberBalances: React.FC<MemberBalancesProps> = ({ transactions, people, currency, currentUserId, onSettlePair }) => {
    const balances = useMemo(() => {
        const b = calculateGroupBalances(transactions);
        people.forEach(p => b.set(p.id, b.get(p.id) ?? 0));
        return b;
    }, [transactions, people]);

    const peopleMap = useMemo(() => new Map<string, Person>(people.map(p => [p.id, p])), [people]);
    const pairTransfers = useMemo(() => simplifyGroupDebts(balances), [balances]);
    
    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency }).format(amount);
    };

    return (
        <div className="bg-card backdrop-blur-md p-4 md:p-6 rounded-2xl shadow-sm border border-border">
            <h3 className="text-lg font-semibold text-foreground mb-4">Member Balances</h3>
            <ul className="space-y-3">
                {Array.from(balances.entries())
                    .sort(([, a], [, b]) => b - a)
                    .map(([personId, balance]) => {
                        const person = peopleMap.get(personId) ?? {
                            id: personId,
                            name: 'Former member',
                            avatarUrl: '',
                        };
                        const isCurrentUser = personId === currentUserId;
                        const pair = pairTransfers.find(
                            (t) =>
                                (t.from === currentUserId && t.to === personId) ||
                                (t.from === personId && t.to === currentUserId)
                        );
                        return (
                            <li key={personId} className="flex justify-between items-center text-sm min-w-0">
                               <div className="flex items-center gap-3 min-w-0 flex-1">
                                   <Avatar person={person} size="md" />
                                   <span className={`font-medium truncate ${isCurrentUser ? 'text-primary' : 'text-muted-foreground'}`}>{person.name}</span>
                               </div>
                                {onSettlePair && pair && !isCurrentUser ? (
                                    <button
                                        type="button"
                                        className={`font-semibold ml-2 flex-shrink-0 ${balance >= 0 ? 'text-success' : 'text-destructive'} hover:underline`}
                                        title={`Settle ${formatCurrency(pair.amount)}`}
                                        onClick={() => onSettlePair(pair.from, pair.to, pair.amount)}
                                    >
                                        {formatCurrency(balance)}
                                    </button>
                                ) : (
                                <span className={`font-semibold ml-2 flex-shrink-0 ${balance >= 0 ? 'text-success' : 'text-destructive'}`} title={formatCurrency(balance)}>
                                    {formatCurrency(balance)}
                                </span>
                                )}
                            </li>
                        );
                })}
            </ul>
        </div>
    );
};

export default MemberBalances;