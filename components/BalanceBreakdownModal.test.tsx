import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import BalanceBreakdownModal from './BalanceBreakdownModal';
import { Group, Person, Transaction } from '../types';

describe('BalanceBreakdownModal', () => {
  it('footer total equals the sum of rendered rows (unknown person dropped)', () => {
    const people: Person[] = [{ id: 'you', name: 'You', avatarUrl: '' }, { id: 'a', name: 'A', avatarUrl: '' }];
    const groups: Group[] = [
      { id: 'g1', name: 'G', members: ['you', 'a'], currency: 'INR', groupType: 'other' },
    ];
    const txs: Transaction[] = [
      {
        id: 't1',
        groupId: 'g1',
        description: 'x',
        amount: 90,
        paidById: 'you',
        date: '2024-01-01',
        tag: 'Food',
        type: 'expense',
        split: {
          mode: 'equal',
          participants: [
            { personId: 'you', value: 1 },
            { personId: 'a', value: 1 },
            { personId: 'ghost', value: 1 },
          ],
        },
      },
    ];

    render(
      <BalanceBreakdownModal
        isOpen={true}
        onClose={() => {}}
        type="owed"
        groups={groups}
        transactions={txs}
        people={people}
        currentUserId="you"
        onSelectGroup={() => {}}
      />
    );

    expect(screen.getByText(/Total:/)).toHaveTextContent(/Total:.*30\.00/);
    expect(screen.queryByText(/ghost/i)).not.toBeInTheDocument();
  });
});
