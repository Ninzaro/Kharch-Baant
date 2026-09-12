import { render, screen, cleanup } from '@testing-library/react';
import GroupSummaryCard from './GroupSummaryCard';
import { describe, it, expect, afterEach } from 'vitest';
import { Person, Transaction, Group } from '../types';

const group: Group = {
  id: 'g1',
  name: 'Test Group',
  members: ['A', 'B', 'C'],
  currency: 'INR',
  groupType: 'other',
};

describe('GroupSummaryCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('CASE 1: multi-payer equal split shows canonical net (A owed 10, B owes 10)', () => {
    const people: Person[] = [
      { id: 'A', name: 'A', avatarUrl: '' },
      { id: 'B', name: 'B', avatarUrl: '' },
    ];
    const transactions: Transaction[] = [
      {
        id: 'dinner',
        groupId: 'g1',
        description: 'Dinner',
        amount: 100,
        paidById: 'A',
        payers: [
          { personId: 'A', amount: 60 },
          { personId: 'B', amount: 40 },
        ],
        date: '2026-01-01',
        type: 'expense',
        tag: 'Food',
        split: {
          mode: 'equal',
          participants: [
            { personId: 'A', value: 1 },
            { personId: 'B', value: 1 },
          ],
        },
      },
    ];

    const { rerender } = render(
      <GroupSummaryCard
        group={group}
        transactions={transactions}
        people={people}
        currentUserId="A"
        onSelectGroup={() => {}}
      />
    );
    expect(screen.getByText(/You are owed/i)).toBeInTheDocument();
    expect(screen.getByText(/10\.00/)).toBeInTheDocument();

    rerender(
      <GroupSummaryCard
        group={group}
        transactions={transactions}
        people={people}
        currentUserId="B"
        onSelectGroup={() => {}}
      />
    );
    expect(screen.getByText(/You owe/i)).toBeInTheDocument();
    expect(screen.getByText(/10\.00/)).toBeInTheDocument();
  });

  it('CASE 2: payer who is not a participant is owed their paid amount (A +100, not settled)', () => {
    const people: Person[] = [
      { id: 'A', name: 'A', avatarUrl: '' },
      { id: 'B', name: 'B', avatarUrl: '' },
      { id: 'C', name: 'C', avatarUrl: '' },
    ];
    const transactions: Transaction[] = [
      {
        id: 'taxi',
        groupId: 'g1',
        description: 'Taxi',
        amount: 300,
        paidById: 'B',
        payers: [
          { personId: 'A', amount: 100 },
          { personId: 'B', amount: 200 },
        ],
        date: '2026-01-01',
        type: 'expense',
        tag: 'Transport',
        split: {
          mode: 'equal',
          participants: [
            { personId: 'B', value: 1 },
            { personId: 'C', value: 1 },
          ],
        },
      },
    ];

    render(
      <GroupSummaryCard
        group={group}
        transactions={transactions}
        people={people}
        currentUserId="A"
        onSelectGroup={() => {}}
      />
    );
    expect(screen.getByText(/You are owed/i)).toBeInTheDocument();
    expect(screen.getByText(/100\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/You are settled up/i)).not.toBeInTheDocument();
  });
});
