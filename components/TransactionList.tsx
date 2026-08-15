import React from 'react';
import { Transaction, Person, Currency } from '../types';
import TransactionItem from './TransactionItem';

interface TransactionListProps {
    transactions: Transaction[];
    people: Person[];
    currentUserId: string;
    currency: Currency;
    onEdit: (transaction: Transaction) => void;
    onDelete: (id: string) => void;
    onViewDetails: (transaction: Transaction) => void;
}

const TransactionList: React.FC<TransactionListProps> = ({ transactions, people, currentUserId, currency, onEdit, onDelete, onViewDetails }) => {
    if (transactions.length === 0) {
        return (
            <div className="text-center py-10 px-4 bg-card/50 border border-dashed border-border rounded-xl">
                <p className="font-medium text-foreground">No expenses yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                    Add a bill or settlement to see it here. If you set filters, try clearing them.
                </p>
            </div>
        );
    }

    // Use all people (current user is already included in people array)
    const peopleMap = new Map(people.map(p => [p.id, p]));

    return (
        <div className="space-y-3">
            {transactions.map(transaction => (
                <TransactionItem
                    key={transaction.id}
                    transaction={transaction}
                    peopleMap={peopleMap}
                    currentUserId={currentUserId}
                    currency={currency}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onViewDetails={onViewDetails}
                />
            ))}
        </div>
    );
};

export default TransactionList;
