import React, { useMemo } from 'react';
import BaseModal from './BaseModal';
import { Group, Transaction, Person } from '../types';
import { getUserFacingDebts } from '../utils/calculations';
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
  const { lines, totalAmount } = useMemo(() => {
    try {
      const debts = getUserFacingDebts(currentUserId, groups, transactions);
      const raw = type === 'owed' ? debts.owedToUser : debts.userOwes;
      const peopleMap = new Map(people.map(p => [p.id, p]));
      const groupMap = new Map(groups.map(g => [g.id, g]));

      const lines = raw
        .map(line => {
          const person = peopleMap.get(line.personId);
          const group = groupMap.get(line.groupId);
          if (!person || !group || group.isArchived) return null;
          return {
            personId: line.personId,
            person,
            amount: line.amount,
            groupId: line.groupId,
            groupName: group.name,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      const totalAmount = type === 'owed' ? debts.totalOwedToUser : debts.totalUserOwes;
      return { lines, totalAmount };
    } catch (error) {
      console.error('BalanceBreakdownModal: Error calculating balances', error);
      return { lines: [], totalAmount: 0 };
    }
  }, [groups, transactions, people, currentUserId, type]);

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
        <span className="text-black text-sm">
          {type === 'owed'
            ? 'Net amounts people owe you (per group, after settlements)'
            : 'Net amounts you owe people (per group, after settlements)'
          }
        </span>
      }
      footer={
        <div className="flex justify-between items-center w-full">
          <div className="text-muted-foreground">
            <span className="text-lg font-semibold text-success">
              Total: {formatAmount(totalAmount)}
            </span>
            <span className="text-xs text-muted-foreground ml-2">(across all currencies)</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-foreground/10 text-foreground rounded-md hover:bg-foreground/20"
          >
            Close
          </button>
        </div>
      }
    >
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {lines.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No outstanding {type === 'owed' ? 'amounts owed to you' : 'amounts you owe'}</p>
          </div>
        ) : (
          lines.map((item) => (
            <div
              key={`${item.personId}-${item.groupId}-${type}`}
              className="bg-foreground/5 rounded-lg p-4 hover:bg-foreground/10 transition-colors"
            >
              <div className="flex items-center justify-between gap-3 min-w-0">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar person={item.person} size="sm" />
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">
                      {item.person.name}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleGroupClick(item.groupId)}
                      className="text-xs text-primary hover:text-primary hover:underline"
                    >
                      from {item.groupName}
                    </button>
                  </div>
                </div>
                <div className={`shrink-0 font-semibold ${
                  type === 'owed' ? 'text-success' : 'text-destructive'
                }`}>
                  {formatAmount(item.amount)}
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
