import React, { useMemo } from 'react';
import { Group, Transaction, Person } from '../types';
import { calculateShares } from '../utils/calculations';
import { X } from 'lucide-react';

interface GroupBalancesModalProps {
  group: Group;
  transactions: Transaction[];
  people: Person[];
  currentUserId: string;
  isOpen: boolean;
  onClose: () => void;
}

const GroupBalancesModal: React.FC<GroupBalancesModalProps> = ({
  group,
  transactions,
  people,
  currentUserId,
  isOpen,
  onClose
}) => {
  const balanceData = useMemo(() => {
    const balances: { [key: string]: number } = {};
    people.forEach(p => balances[p.id] = 0);

    transactions.forEach(transaction => {
        if (transaction.type === 'settlement') {
            const payerId = transaction.paidById;
            const recipientParticipant = transaction.split.participants.find(p => p.personId !== payerId);
            if (recipientParticipant) {
                const recipientId = recipientParticipant.personId;
                // Payer's balance increases (owes less), Receiver's balance decreases (is owed less)
                balances[payerId] += transaction.amount;
                balances[recipientId] -= transaction.amount;
            }
        } else { // expense
            if (transaction.split) {
                const shares = calculateShares(transaction);
                balances[transaction.paidById] += transaction.amount;
                shares.forEach((share, personId) => {
                    balances[personId] -= share;
                });
            }
        }
    });

    const currentUserBalance = balances[currentUserId] || 0;

    const totalGroupSpending = transactions
        .filter(t => t.type === 'expense')
        .reduce((sum, transaction) => sum + transaction.amount, 0);

    const totalUserPaidFor = transactions
        .filter(t => t.paidById === currentUserId && t.type === 'expense')
        .reduce((sum, transaction) => sum + transaction.amount, 0);

    let userTotalShare = 0;
    transactions.filter(t => t.type === 'expense' && t.split).forEach(transaction => {
        const shares = calculateShares(transaction);
        userTotalShare += shares.get(currentUserId) || 0;
    });

    const settleTransactions = transactions.filter(t => t.type === 'settlement');
    const paymentsMade = settleTransactions
        .filter(t => t.paidById === currentUserId)
        .reduce((sum, t) => sum + t.amount, 0);

    const paymentsReceived = settleTransactions
        .filter(t => t.split.participants.some(p => p.personId === currentUserId) && t.paidById !== currentUserId)
        .reduce((sum, t) => sum + t.amount, 0);

    return {
        totalGroupSpending,
        totalUserPaidFor,
        userTotalShare,
        paymentsMade,
        paymentsReceived,
        totalChangeInBalance: currentUserBalance
    };
}, [transactions, people, currentUserId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-overlay/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gradient-to-br from-success/10 to-success/5 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-success to-success text-success-foreground p-4 flex items-center justify-between">
          <div>
            <button 
              onClick={onClose}
              className="text-foreground/80 hover:text-foreground text-sm"
            >
              Cancel
            </button>
          </div>
          <h2 className="text-lg font-semibold">Group spending summary</h2>
          <button
            onClick={onClose}
            className="text-foreground/80 hover:text-foreground p-1"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Group Name */}
          <div className="text-center">
            <h3 className="text-xl font-bold text-gray-800">{group.name}</h3>
          </div>

          {/* Time Period Tabs */}
          <div className="flex bg-gray-200 rounded-lg p-1">
            <button className="flex-1 py-2 px-4 text-sm font-medium text-gray-600 bg-white rounded-md shadow-sm">
              This month
            </button>
            <button className="flex-1 py-2 px-4 text-sm font-medium text-gray-500">
              Last month
            </button>
            <button className="flex-1 py-2 px-4 text-sm font-medium text-gray-500">
              All time
            </button>
          </div>

          {/* Balance Items */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-700 font-medium">Total group spending</span>
              <span className="font-bold text-gray-800">
                {balanceData.totalGroupSpending.toFixed(2)} {group.currency}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-gray-700 font-medium">Total you paid for</span>
              <span className="font-bold text-gray-800">
                {balanceData.totalUserPaidFor.toFixed(2)} {group.currency}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-gray-700 font-medium">Your total share</span>
              <span className="font-bold text-success">
                {balanceData.userTotalShare.toFixed(2)} {group.currency}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-gray-700 font-medium">Payments made</span>
              <span className="font-bold text-gray-800">
                {balanceData.paymentsMade.toFixed(2)} {group.currency}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-gray-700 font-medium">Payments received</span>
              <span className="font-bold text-gray-800">
                {balanceData.paymentsReceived.toFixed(2)} {group.currency}
              </span>
            </div>

            <hr className="border-gray-300" />

            <div className="flex justify-between items-center">
              <span className="text-gray-700 font-bold">Total change in balance</span>
              <span className={`font-bold text-lg ${
                balanceData.totalChangeInBalance >= 0 ? 'text-success' : 'text-red-600'
              }`}>
                {balanceData.totalChangeInBalance >= 0 ? '+' : ''}
                {Math.abs(balanceData.totalChangeInBalance).toFixed(2)} {group.currency}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GroupBalancesModal;
