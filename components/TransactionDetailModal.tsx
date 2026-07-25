import React, { useMemo } from 'react';
import { Transaction, Person, Group, PaymentSource } from '../types';
import { calculateShares } from '../utils/calculations';
import Avatar from './Avatar';
import { TAGS } from '../types';

interface TransactionDetailModalProps {
    transaction: Transaction;
    groupMembers: Person[];
    paymentSources: PaymentSource[];
    onClose: () => void;
    onEdit?: (transaction: Transaction) => void;
    onDelete?: (transaction: Transaction) => void;
}

const TransactionDetailModal: React.FC<TransactionDetailModalProps> = ({
    transaction,
    groupMembers,
    paymentSources,
    onClose,
    onEdit,
    onDelete
}) => {
    if (!transaction) return null;

    // Find the payer
    const payer = groupMembers.find(p => p.id === transaction.paidById);

    // Find payment source
    const paymentSource = paymentSources.find(ps => ps.id === transaction.paymentSourceId);

    // Simple amount formatting
    const formatAmount = (amount: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR'
        }).format(amount);
    };

    // Simple date formatting
    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-IN');
    };

    return (
        <div className="fixed inset-0 bg-overlay/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-border">
                    <div>
                        <h1 className="text-xl font-semibold text-foreground">Transaction Details</h1>
                        <p className="text-sm text-muted-foreground">{formatDate(transaction.date)}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-muted-foreground hover:text-foreground text-2xl"
                    >
                        ×
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    {/* Basic Info */}
                    <div className="bg-muted/50 rounded-lg p-4">
                        <h2 className="text-lg font-medium text-foreground mb-4">Transaction Information</h2>
                        <div className="space-y-3">
                            <div>
                                <label className="text-sm text-muted-foreground">Description</label>
                                <p className="text-foreground font-medium">{transaction.description}</p>
                            </div>
                            <div>
                                <label className="text-sm text-muted-foreground">Amount</label>
                                <p className="text-2xl font-bold text-success">
                                    {formatAmount(transaction.amount)}
                                </p>
                            </div>
                            <div>
                                <label className="text-sm text-muted-foreground">Category</label>
                                <p className="text-foreground">{transaction.tag}</p>
                            </div>
                            <div>
                                <label className="text-sm text-muted-foreground">Type</label>
                                <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${transaction.type === 'expense' ? 'bg-destructive/20 text-destructive' :
                                        transaction.type === 'settlement' ? 'bg-success/20 text-success' :
                                            'bg-warning/20 text-warning'
                                    }`}>
                                    {transaction.type}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Payer Info */}
                    <div className="bg-muted/50 rounded-lg p-4">
                        <h3 className="text-lg font-medium text-foreground mb-3">Paid By</h3>

                        {transaction.payers && transaction.payers.length > 0 ? (
                            <div className="space-y-3">
                                {transaction.payers.map((p, idx) => {
                                    const person = groupMembers.find(m => m.id === p.personId);
                                    return (
                                        <div key={p.personId} className="flex items-center gap-3">
                                            <Avatar person={person || { id: '', name: 'Unknown', avatarUrl: null }} size="sm" />
                                            <div>
                                                <p className="text-foreground font-medium">{person?.name || 'Unknown'}</p>
                                                <p className="text-sm text-muted-foreground">
                                                    Paid {formatAmount(p.amount)}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                                <div className="border-t border-border pt-2 mt-2">
                                    <p className="text-sm text-muted-foreground">Total: {formatAmount(transaction.amount)}</p>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3">
                                <Avatar person={payer || { id: '', name: 'Unknown', avatarUrl: null }} size="md" />
                                <div>
                                    <p className="text-foreground font-medium">{payer?.name || 'Unknown'}</p>
                                    <p className="text-sm text-muted-foreground">
                                        Paid {formatAmount(transaction.amount)}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Payment Source */}
                    {paymentSource && (
                        <div className="bg-muted/50 rounded-lg p-4">
                            <h3 className="text-lg font-medium text-foreground mb-3">Payment Method</h3>
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-primary/20">
                                    <span className="text-sm">💳</span>
                                </div>
                                <div>
                                    <p className="text-foreground font-medium">{paymentSource.name}</p>
                                    <p className="text-sm text-muted-foreground">{paymentSource.type}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Split Details */}
                    <div className="bg-muted/50 rounded-lg p-4">
                        <h3 className="text-lg font-medium text-foreground mb-3">Split Details</h3>
                        <p className="text-muted-foreground">Split method: {transaction.split.mode}</p>
                        <p className="text-muted-foreground">Participants: {transaction.split.participants.length}</p>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between p-6 border-t border-border bg-card/50">
                    <div className="text-sm text-muted-foreground">
                        ID: {transaction.id.slice(0, 8)}...
                    </div>
                    <div className="flex items-center gap-3">
                        {onDelete && (
                            <button
                                onClick={() => onDelete(transaction)}
                                className="px-4 py-2 text-destructive hover:bg-destructive/20 rounded-lg transition-colors"
                            >
                                Delete
                            </button>
                        )}
                        {onEdit && (
                            <button
                                onClick={() => onEdit(transaction)}
                                className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors"
                            >
                                Edit
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-muted hover:bg-muted text-foreground rounded-lg transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TransactionDetailModal;