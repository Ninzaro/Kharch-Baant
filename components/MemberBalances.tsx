import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Transaction, Person, Currency } from '../types';
import Avatar from './Avatar';
import { calculateGroupBalances, simplifyGroupDebts, SimplifiedTransfer } from '../utils/calculations';

interface MemberBalancesProps {
    transactions: Transaction[];
    people: Person[];
    currency: Currency;
    currentUserId: string;
    currentUserPerson?: Person | null;
    onSettlePair?: (payerId: string, receiverId: string, amount: number) => void;
}

function nameOf(peopleMap: Map<string, Person>, id: string): string {
    return peopleMap.get(id)?.name ?? 'Former member';
}

const MemberBalances: React.FC<MemberBalancesProps> = ({ transactions, people, currency, currentUserId, onSettlePair }) => {
    const [openId, setOpenId] = useState<string | null>(null);
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
            <ul className="space-y-2">
                {Array.from(balances.entries())
                    .sort(([, a], [, b]) => b - a)
                    .map(([personId, balance]) => {
                        const person = peopleMap.get(personId) ?? {
                            id: personId,
                            name: 'Former member',
                            avatarUrl: '',
                        };
                        const isCurrentUser = personId === currentUserId;
                        const lines = pairTransfers.filter((t) => t.from === personId || t.to === personId);
                        const open = openId === personId;
                        return (
                            <li key={personId} className="text-sm min-w-0">
                                <div className="flex justify-between items-center gap-2">
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <Avatar person={person} size="md" />
                                        <span className={`font-medium truncate ${isCurrentUser ? 'text-primary' : 'text-muted-foreground'}`}>{person.name}</span>
                                    </div>
                                    <span className={`font-semibold flex-shrink-0 ${balance >= 0 ? 'text-success' : 'text-destructive'}`} title={formatCurrency(balance)}>
                                        {formatCurrency(balance)}
                                    </span>
                                    {lines.length > 0 && (
                                        <button
                                            type="button"
                                            aria-expanded={open}
                                            aria-label={`${open ? 'Hide' : 'Show'} payments for ${person.name}`}
                                            className="p-1 rounded-full text-muted-foreground hover:bg-muted"
                                            onClick={() => setOpenId(open ? null : personId)}
                                        >
                                            <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                                        </button>
                                    )}
                                </div>
                                {open && (
                                    <ul className="mt-2 space-y-2">
                                        {lines.map((transfer) => (
                                            <PaymentArrow
                                                key={`${transfer.from}-${transfer.to}`}
                                                transfer={transfer}
                                                fromName={nameOf(peopleMap, transfer.from)}
                                                toName={nameOf(peopleMap, transfer.to)}
                                                amountLabel={formatCurrency(transfer.amount)}
                                                onSettle={onSettlePair ? () => onSettlePair(transfer.from, transfer.to, transfer.amount) : undefined}
                                            />
                                        ))}
                                    </ul>
                                )}
                            </li>
                        );
                })}
            </ul>
        </div>
    );
};

function PaymentArrow({
    transfer,
    fromName,
    toName,
    amountLabel,
    onSettle,
}: {
    transfer: SimplifiedTransfer;
    fromName: string;
    toName: string;
    amountLabel: string;
    onSettle?: () => void;
}) {
    return (
        <li className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-2.5 py-2 min-w-0">
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate font-medium text-foreground">{fromName}</span>
                    <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0 text-primary" aria-hidden="true">
                        <path d="M2 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="truncate font-medium text-foreground">{toName}</span>
                </div>
                <div className="mt-0.5 text-xs font-semibold text-foreground">{amountLabel}</div>
            </div>
            {onSettle && (
                <button type="button" className="shrink-0 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold" onClick={onSettle}>
                    Settle
                </button>
            )}
            <span className="sr-only">{fromName} pays {toName} {amountLabel} for transfer {transfer.from}</span>
        </li>
    );
}

export default MemberBalances;