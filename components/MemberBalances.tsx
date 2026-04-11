import React, { useMemo } from 'react';
import { Transaction, Person, Currency } from '../types';
import Avatar from './Avatar';
import { calculateGroupBalances } from '../utils/calculations';

interface MemberBalancesProps {
    transactions: Transaction[];
    people: Person[];
    currency: Currency;
    currentUserId: string;
    currentUserPerson: Person | null;
}

const MemberBalances: React.FC<MemberBalancesProps> = ({ transactions, people, currency, currentUserId, currentUserPerson }) => {
    const balances = useMemo(() => {
        const b = calculateGroupBalances(transactions);
        people.forEach(p => b.set(p.id, b.get(p.id) ?? 0));
        return b;
    }, [transactions, people]);

    const peopleMap = useMemo(() => new Map<string, Person>(people.map(p => [p.id, p])), [people]);
    
    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency }).format(amount);
    };

    return (
        <div className="bg-white/5 backdrop-blur-md p-4 md:p-6 rounded-2xl shadow-lg border border-white/10">
            <h3 className="text-lg font-semibold text-white mb-4">Member Balances</h3>
            <ul className="space-y-3">
                {Array.from(balances.entries())
                    .sort(([, a], [, b]) => b - a)
                    .map(([personId, balance]) => {
                        const person = peopleMap.get(personId);
                        if (!person) return null;
                        
                        const isCurrentUser = personId === currentUserId;
                        return (
                            <li key={personId} className="flex justify-between items-center text-sm min-w-0">
                               <div className="flex items-center gap-3 min-w-0 flex-1">
                                   <Avatar person={person} size="md" />
                                   <span className={`font-medium truncate ${isCurrentUser ? 'text-indigo-400' : 'text-slate-300'}`}>{person.name}</span>
                               </div>
                                <span className={`font-semibold ml-2 flex-shrink-0 ${balance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} title={formatCurrency(balance)}>
                                    {formatCurrency(balance)}
                                </span>
                            </li>
                        );
                })}
            </ul>
        </div>
    );
};

export default MemberBalances;