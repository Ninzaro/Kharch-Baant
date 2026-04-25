import React from 'react';
import { Transaction, Person, Group, PaymentSource } from '../types';
import { calculateShares } from '../utils/calculations';
import Avatar from './Avatar';
import { TAGS } from '../types';
import { useModalContext } from '../contexts/ModalContext';

interface TransactionDetailModalProps {
    transaction: Transaction;
    groupMembers: Person[];
    paymentSources: PaymentSource[];
    onClose: () => void;
}

const TransactionDetailModal: React.FC<TransactionDetailModalProps> = ({
    transaction,
    groupMembers,
    paymentSources,
    onClose,
}) => {
    const { actions } = useModalContext();
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-700">
                    <div>
                        <h1 className="text-xl font-semibold text-white">Transaction Details</h1>
                        <p className="text-sm text-slate-400">{formatDate(transaction.date)}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-white text-2xl"
                    >
                        ×
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    {/* Basic Info */}
                    <div className="bg-slate-700/50 rounded-lg p-4">
                        <h2 className="text-lg font-medium text-white mb-4">Transaction Information</h2>
                        <div className="space-y-3">
                            <div>
                                <label className="text-sm text-slate-400">Description</label>
                                <p className="text-white font-medium">{transaction.description}</p>
                            </div>
                            <div>
                                <label className="text-sm text-slate-400">Amount</label>
                                <p className="text-2xl font-bold text-emerald-400">
                                    {formatAmount(transaction.amount)}
                                </p>
                            </div>
                            <div>
                                <label className="text-sm text-slate-400">Category</label>
                                <p className="text-white">{transaction.tag}</p>
                            </div>
                            <div>
                                <label className="text-sm text-slate-400">Type</label>
                                <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${transaction.type === 'expense' ? 'bg-red-500/20 text-red-300' :
                                        transaction.type === 'settlement' ? 'bg-green-500/20 text-green-300' :
                                            'bg-yellow-500/20 text-yellow-300'
                                    }`}>
                                    {transaction.type}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Payer Info */}
                    <div className="bg-slate-700/50 rounded-lg p-4">
                        <h3 className="text-lg font-medium text-white mb-3">Paid By</h3>

                        {transaction.payers && transaction.payers.length > 0 ? (
                            <div className="space-y-3">
                                {transaction.payers.map((p, idx) => {
                                    const person = groupMembers.find(m => m.id === p.personId);
                                    return (
                                        <div key={p.personId} className="flex items-center gap-3">
                                            <Avatar person={person || { id: '', name: 'Unknown', avatarUrl: null }} size="sm" />
                                            <div>
                                                <p className="text-white font-medium">{person?.name || 'Unknown'}</p>
                                                <p className="text-sm text-slate-400">
                                                    Paid {formatAmount(p.amount)}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                                <div className="border-t border-slate-600 pt-2 mt-2">
                                    <p className="text-sm text-slate-300">Total: {formatAmount(transaction.amount)}</p>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3">
                                <Avatar person={payer || { id: '', name: 'Unknown', avatarUrl: null }} size="md" />
                                <div>
                                    <p className="text-white font-medium">{payer?.name || 'Unknown'}</p>
                                    <p className="text-sm text-slate-400">
                                        Paid {formatAmount(transaction.amount)}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Payment Source */}
                    {paymentSource && (
                        <div className="bg-slate-700/50 rounded-lg p-4">
                            <h3 className="text-lg font-medium text-white mb-3">Payment Method</h3>
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-blue-500/20">
                                    <span className="text-sm">💳</span>
                                </div>
                                <div>
                                    <p className="text-white font-medium">{paymentSource.name}</p>
                                    <p className="text-sm text-slate-400">{paymentSource.type}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Split Details */}
                    <div className="bg-slate-700/50 rounded-lg p-4">
                        <h3 className="text-lg font-medium text-white mb-3">Split Details</h3>
                        <p className="text-slate-300">Split method: {transaction.split.mode}</p>
                        <p className="text-slate-300">Participants: {transaction.split.participants.length}</p>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between p-6 border-t border-slate-700 bg-slate-800/50">
                    <div className="text-sm text-slate-400">
                        ID: {transaction.id.slice(0, 8)}...
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => {
                                actions.requestDeleteTransaction(transaction);
                                actions.closeTransactionDetail();
                            }}
                            className="px-4 py-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                        >
                            Delete
                        </button>
                        <button
                            onClick={() => {
                                if (transaction.type === 'settlement') {
                                    actions.openSettleUp({ initialTransaction: transaction });
                                } else {
                                    actions.openTransactionForm(transaction);
                                }
                                actions.closeTransactionDetail();
                            }}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
                        >
                            Edit
                        </button>
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg transition-colors"
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