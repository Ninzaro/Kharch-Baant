import { render, screen, cleanup } from '@testing-library/react';
import GroupBalancesModal from './GroupBalancesModal';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Person, Transaction, Group } from '../types';

// Mock console.log to see the output in the test runner
const consoleLogSpy = vi.spyOn(console, 'log');

describe('GroupBalancesModal', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('calculates and displays balances correctly for a mix of expenses and settlements', () => {
    const pawan: Person = { id: 'pawan', name: 'Pawan', avatarUrl: '' };
    const ninad: Person = { id: 'ninad', name: 'Ninad', avatarUrl: '' };
    const people = [pawan, ninad];

    const group: Group = {
      id: 'group1',
      name: 'Test Group',
      members: ['pawan', 'ninad'],
      currency: 'INR',
      groupType: 'other',
    };

    const transactions: Transaction[] = [
      {
        id: 'txn1',
        groupId: 'group1',
        description: 'Noodles',
        amount: 3000,
        paidById: 'pawan',
        date: '2025-10-31',
        type: 'expense',
        tag: 'Food',
        split: {
          mode: 'equal',
          participants: [
            { personId: 'pawan', value: 1 },
            { personId: 'ninad', value: 1 },
          ],
        },
      },
      {
        id: 'txn2',
        groupId: 'group1',
        description: 'Settlement',
        amount: 1000,
        paidById: 'ninad',
        date: '2025-10-31',
        type: 'settlement',
        tag: 'Other',
        split: {
          mode: 'unequal',
          participants: [
            { personId: 'ninad', value: 0 },
            { personId: 'pawan', value: 1000 },
          ],
        },
      },
    ];

    const { rerender } = render(
      <GroupBalancesModal
        isOpen={true}
        onClose={() => {}}
        group={group}
        transactions={transactions}
        people={people}
        currentUserId="ninad"
      />
    );

    const ninadBalanceElement = screen.getByText(/Total change in balance/i).nextElementSibling;
    expect(ninadBalanceElement).toHaveTextContent(/500.00/);
    expect(ninadBalanceElement).toHaveClass('text-destructive');

    // Test for Pawan's view
    rerender(
      <GroupBalancesModal
        isOpen={true}
        onClose={() => {}}
        group={group}
        transactions={transactions}
        people={people}
        currentUserId="pawan"
      />
    );

    const pawanBalanceElement = screen.getByText(/Total change in balance/i).nextElementSibling;
    expect(pawanBalanceElement).toHaveTextContent(/\+500.00/);
    expect(pawanBalanceElement).toHaveClass('text-success');
  });
});
