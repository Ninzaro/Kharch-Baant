import React from 'react';
import { Transaction, Person, Currency } from '../types';
import { EditIcon, DeleteIcon } from './icons/Icons';

// Simple eye icon for view details
const EyeIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
);

interface TransactionItemProps {
    transaction: Transaction;
    peopleMap: Map<string, Person>;
    currentUserId: string;
    currency: Currency;
    onEdit: (transaction: Transaction) => void;
    onDelete: (id: string) => void;
    onViewDetails?: (transaction: Transaction) => void;
}

const TransactionItem: React.FC<TransactionItemProps> = ({ transaction, peopleMap, currentUserId, currency, onEdit, onDelete, onViewDetails }) => {
    const paidBy = peopleMap.get(transaction.paidById);
    const isSettlement = transaction.type === 'settlement';

    const formatDate = (dateString: string) => {
        const d = new Date(dateString + 'T00:00:00');
        return {
            month: d.toLocaleDateString('en-US', { month: 'short' }),
            day: d.getDate()
        };
    };

    const { month, day } = formatDate(transaction.date);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency, maximumFractionDigits: 0 }).format(amount);
    };

    // Clean up description for display
    let displayDescription = transaction.description;
    if (isSettlement && displayDescription.startsWith('Settlement: ')) {
        displayDescription = displayDescription.replace('Settlement: ', '');
    }

    // Settlement Flow Data
    const receiverId = isSettlement
        ? transaction.split?.participants?.find(p => p.personId !== transaction.paidById)?.personId
        : null;
    const receiver = receiverId ? peopleMap.get(receiverId) : null;

    return (
        <div className="group relative bg-card/40 hover:bg-card/80 rounded-xl border border-border p-2.5 transition-all duration-200">
            {/*
              Three fixed columns: date | middle (truncates) | amount (never shrinks).
              Long settlement names must not wrap under the amount.
            */}
            <div className="flex items-center gap-3 min-w-0">

                {/* 1. Date Column */}
                <div className="flex flex-col items-center justify-center w-12 h-12 bg-muted/50 rounded-lg border border-border shrink-0">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-none mb-0.5">{month}</span>
                    <span className="text-lg font-bold text-foreground leading-none">{day}</span>
                </div>

                {/* 2. Main Content — min-w-0 so truncate works inside flex */}
                <div className="flex-1 min-w-0 space-y-0.5">
                    {isSettlement && receiver ? (
                        <div className="min-w-0" title={`${paidBy?.name ?? '?'} → ${receiver.name}`}>
                            <div className="text-[10px] uppercase font-bold tracking-wider text-success/80 leading-none mb-1">
                                Settlement
                            </div>
                            <div className="flex items-center gap-1.5 min-w-0 text-sm font-bold">
                                <span className="min-w-0 truncate text-success drop-shadow-[0_0_8px_hsl(var(--success)/0.6)] capitalize">
                                    {paidBy?.name}
                                </span>
                                <span className="shrink-0 text-success" aria-hidden>
                                    →
                                </span>
                                <span className="min-w-0 truncate text-foreground capitalize">
                                    {receiver.name}
                                </span>
                            </div>
                        </div>
                    ) : (
                        <>
                            <h3 className="text-sm font-semibold text-foreground truncate capitalize">
                                {displayDescription}
                            </h3>
                            <div className="text-xs text-muted-foreground leading-snug truncate">
                                {transaction.payers && transaction.payers.length > 0 ? (
                                    <span className="truncate block">
                                        {transaction.payers.map((p, i) => (
                                            <span key={p.personId}>
                                                {i > 0 && ', '}
                                                <span className="text-muted-foreground font-medium capitalize">{peopleMap.get(p.personId)?.name}</span> paid {formatCurrency(p.amount)}
                                            </span>
                                        ))}
                                    </span>
                                ) : (
                                    <span>
                                        Paid by <span className="text-muted-foreground font-medium capitalize">{paidBy?.name}</span>
                                    </span>
                                )}
                            </div>
                        </>
                    )}

                    {/* Comment */}
                    {transaction.comment && (
                        <p className="text-[10px] text-muted-foreground italic truncate before:content-['❝'] before:mr-0.5">
                            {transaction.comment}
                        </p>
                    )}
                </div>

                {/* 3. Amount & Actions — fixed width side, never pushed down */}
                <div className="flex flex-col items-end gap-1 shrink-0 self-center pl-1">
                    <span className={`text-base font-bold tabular-nums whitespace-nowrap ${isSettlement ? 'text-success drop-shadow-[0_0_8px_hsl(var(--success)/0.4)]' : 'text-foreground'}`}>
                        {formatCurrency(transaction.amount)}
                    </span>

                    <div className="flex items-center gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                        {onViewDetails && (
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onViewDetails(transaction); }}
                                className="p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded transition-colors"
                            >
                                <EyeIcon />
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onEdit(transaction); }}
                            className="p-1 text-muted-foreground hover:text-foreground hover:bg-foreground/10 rounded transition-colors"
                        >
                            <EditIcon width="16" height="16" />
                        </button>
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onDelete(transaction.id); }}
                            className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                        >
                            <DeleteIcon width="16" height="16" />
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default TransactionItem;