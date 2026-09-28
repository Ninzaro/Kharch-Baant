import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import MemberBalances from './MemberBalances';
import { Person, Transaction } from '../types';

const people: Person[] = [
  { id: 'A', name: 'Asha', avatarUrl: '' },
  { id: 'B', name: 'Bala', avatarUrl: '' },
  { id: 'C', name: 'Chitra', avatarUrl: '' },
  { id: 'D', name: 'Dev', avatarUrl: '' },
];

function expense(id: string, payerId: string): Transaction {
  return {
    id,
    groupId: 'g1',
    description: id,
    amount: 100,
    paidById: payerId,
    payers: [{ personId: payerId, amount: 100 }],
    date: '2026-01-01',
    type: 'expense',
    tag: 'Food',
    split: {
      mode: 'equal',
      participants: people.map((person) => ({ personId: person.id, value: 1 })),
    },
  };
}

describe('MemberBalances suggested payments', () => {
  afterEach(() => cleanup());

  it('lists simplified payments when two people are owed and two owe', () => {
    render(
      <MemberBalances
        transactions={[expense('a', 'A'), expense('b', 'B')]}
        people={people}
        currency="INR"
        currentUserId="A"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show payments for Asha' }));
    const detail = screen.getByRole('button', { name: 'Hide payments for Asha' }).closest('li')?.textContent ?? '';
    expect(detail).toContain('Chitra');
    expect(detail).toContain('Asha');
    expect(detail).toContain('₹50.00');
    expect(screen.queryByText('Suggested payments')).toBeNull();
  });

  it('says nothing to settle when balances are zero', () => {
    render(
      <MemberBalances
        transactions={[]}
        people={people}
        currency="INR"
        currentUserId="A"
      />,
    );
    expect(screen.queryByRole('button', { name: /payments for/ })).toBeNull();
  });
});
