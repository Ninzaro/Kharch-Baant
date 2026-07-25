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
        return <p className="text-center text-muted-foreground py-8">No transactions found for the selected filters.</p>;
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
