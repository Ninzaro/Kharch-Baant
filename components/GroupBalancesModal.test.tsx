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

  it('CASE 1: multi-payer equal split uses payers[] (A +10, B −10)', () => {
    const a: Person = { id: 'A', name: 'A', avatarUrl: '' };
    const b: Person = { id: 'B', name: 'B', avatarUrl: '' };
    const people = [a, b];
    const group: Group = {
      id: 'g1',
      name: 'Dinner',
      members: ['A', 'B'],
      currency: 'INR',
      groupType: 'other',
    };
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
      <GroupBalancesModal
        isOpen={true}
        onClose={() => {}}
        group={group}
        transactions={transactions}
        people={people}
        currentUserId="A"
      />
    );

    const aBalance = screen.getByText(/Total change in balance/i).nextElementSibling;
    expect(aBalance).toHaveTextContent(/\+10.00/);
    expect(aBalance).toHaveClass('text-success');

    rerender(
      <GroupBalancesModal
        isOpen={true}
        onClose={() => {}}
        group={group}
        transactions={transactions}
        people={people}
        currentUserId="B"
      />
    );

    const bBalance = screen.getByText(/Total change in balance/i).nextElementSibling;
    expect(bBalance).toHaveTextContent(/10.00/);
    expect(bBalance).not.toHaveTextContent(/\+/);
    expect(bBalance).toHaveClass('text-destructive');
  });

  it('CASE 2: payer who is not a participant is credited from payers[] (A +100)', () => {
    const people: Person[] = [
      { id: 'A', name: 'A', avatarUrl: '' },
      { id: 'B', name: 'B', avatarUrl: '' },
      { id: 'C', name: 'C', avatarUrl: '' },
    ];
    const group: Group = {
      id: 'g1',
      name: 'Taxi',
      members: ['A', 'B', 'C'],
      currency: 'INR',
      groupType: 'other',
    };
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
      <GroupBalancesModal
        isOpen={true}
        onClose={() => {}}
        group={group}
        transactions={transactions}
        people={people}
        currentUserId="A"
      />
    );

    const aBalance = screen.getByText(/Total change in balance/i).nextElementSibling;
    expect(aBalance).toHaveTextContent(/\+100.00/);
    expect(aBalance).toHaveClass('text-success');
  });
});
