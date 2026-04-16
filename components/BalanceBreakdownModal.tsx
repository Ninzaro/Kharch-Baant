import React, { useMemo } from 'react';
import BaseModal from './BaseModal';
import { Group, Transaction, Person } from '../types';
import { calculateShares } from '../utils/calculations';
import Avatar from './Avatar';

interface BalanceBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'owed' | 'owing';
  groups: Group[];
  transactions: Transaction[];
  people: Person[];
  currentUserId: string;
  onSelectGroup: (groupId: string) => void;
}

interface PersonBalance {
  personId: string;
  person: Person;
  amount: number;
  groupId: string;
  groupName: string;
}

const BalanceBreakdownModal: React.FC<BalanceBreakdownModalProps> = ({
  isOpen,
  onClose,
  type,
  groups,
  transactions,
  people,
  currentUserId,
  onSelectGroup
}) => {
  const balanceData = useMemo(() => {
    const personBalances: PersonBalance[] = [];

    try {
      const activeGroups = groups.filter(g => !g.isArchived);
      
      transactions.forEach(transaction => {
        const shares = calculateShares(transaction);
        const group = activeGroups.find(g => g.id === transaction.groupId);
        if (!group) return;
        
        const userShare = shares.get(currentUserId) || 0;
        
        if (transaction.paidById === currentUserId) {
          // Current user paid, others owe them
          shares.forEach((shareAmount, personId) => {
            if (personId !== currentUserId) {
              const person = people.find(p => p.id === personId);
              if (person && shareAmount > 0.01) {
                if (type === 'owed') {
                  personBalances.push({
                    personId,
                    person,
                    amount: shareAmount,
                    groupId: group.id,
                    groupName: group.name
                  });
                }
              }
            }
          });
        } else {
          // Someone else paid, current user owes them
          const payer = people.find(p => p.id === transaction.paidById);
          if (payer && userShare > 0.01) {
            if (type === 'owing') {
              personBalances.push({
                personId: transaction.paidById,
                person: payer,
                amount: userShare,
                groupId: group.id,
                groupName: group.name
              });
            }
          }
        }
      });
      
      // Sort by amount descending
      return personBalances.sort((a, b) => b.amount - a.amount);
    } catch (error) {
      console.error('BalanceBreakdownModal: Error calculating balances', error);
      return [];
    }
  }, [groups, transactions, people, currentUserId, type]);

  const totalAmount = balanceData.reduce((sum, item) => sum + item.amount, 0);

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const handleGroupClick = (groupId: string) => {
    onClose();
    onSelectGroup(groupId);
  };

  if (!isOpen) return null;

  return (
    <BaseModal
      open={isOpen}
      onClose={onClose}
      title={type === 'owed' ? 'Amount You Are Owed' : 'Amount You Owe'}
      size="md"
      description={
        <span className="text-slate-300 text-sm">
          {type === 'owed' 
            ? 'People who owe you money across all groups' 
            : 'People you owe money to across all groups'
          }
        </span>
      }
      footer={
        <div className="flex justify-between items-center w-full">
          <div className="text-slate-300">
            <span className="text-lg font-semibold">
              Total: {formatAmount(totalAmount)}
            </span>
            <span className="text-xs text-slate-500 ml-2">(across all currencies)</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white/10 text-white rounded-md hover:bg-white/20"
          >
            Close
          </button>
        </div>
      }
    >
      <div className="space-y-3 max-h-96 overflow-y-auto">
        <div className="text-slate-300 text-sm mb-4">
          Debug: Type = {type}, Data count = {balanceData.length}, Total = {totalAmount}
        </div>
        
        {balanceData.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            <p>No outstanding {type === 'owed' ? 'amounts owed to you' : 'amounts you owe'}</p>
            <p className="text-xs mt-2">
              Groups: {groups.length}, Transactions: {transactions.length}, People: {people.length}
            </p>
          </div>
        ) : (
          balanceData.map((item, index) => (
            <div
              key={`${item.personId}-${item.groupId}`}
              className="bg-white/5 rounded-lg p-4 hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Avatar name={item.person.name} size="sm" />
                  <div>
                    <div className="font-medium text-slate-200">
                      {item.person.name}
                    </div>
                    <button
                      onClick={() => handleGroupClick(item.groupId)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 hover:underline"
                    >
                      from {item.groupName}
                    </button>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-semibold ${
                    type === 'owed' ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {formatAmount(item.amount)}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </BaseModal>
  );
};

export default BalanceBreakdownModal;