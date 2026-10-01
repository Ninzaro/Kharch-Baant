import { describe, expect, it } from 'vitest';
import { storedTransactionMatchesUpdate } from '../../../lib/expenseMatch';

describe('storedTransactionMatchesUpdate', () => {
  it('matches a write whose response was lost after the row changed updated_at', () => {
    expect(storedTransactionMatchesUpdate(
      {
        description: 'Dinner',
        amount: '10.00',
        payers: [{ personId: 'a', amount: 10 }],
        split_participants: [{ personId: 'a', value: 1 }],
      },
      {
        description: 'Dinner',
        amount: 10,
        payers: [{ amount: 10, personId: 'a' }],
        split_participants: [{ personId: 'a', value: 1 }],
      },
    )).toBe(true);
  });

  it('rejects a row someone else changed', () => {
    expect(storedTransactionMatchesUpdate(
      { description: 'Lunch', amount: 10 },
      { description: 'Dinner', amount: 10 },
    )).toBe(false);
  });
});
