import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import SettleUpModal from '../../../components/SettleUpModal';
import type { Person, PaymentSource, Transaction } from '../../../types';

// Mock dynamic import of apiService used inside the modal
vi.mock('../../../services/apiService', () => ({
  addTransaction: vi.fn(async (_groupId: string, data: any) => {
    const created: Transaction = {
      id: 'tx_new',
      groupId: _groupId,
      description: data.description,
      amount: data.amount,
      paidById: data.paidById,
      date: data.date,
      tag: data.tag,
      paymentSourceId: data.paymentSourceId,
      comment: data.comment,
      type: data.type,
      split: data.split,
    };
    return created;
  })
}));

describe('SettleUpModal', () => {
  const members: Person[] = [
    { id: 'p1', name: 'Alice', avatarUrl: '' },
    { id: 'p2', name: 'Bob', avatarUrl: '' },
    { id: 'p3', name: 'Cara', avatarUrl: '' },
  ];
  const paymentSources: PaymentSource[] = [
    { id: 'ps1', name: 'Cash', type: 'Cash', isActive: true },
    { id: 'ps2', name: 'Card', type: 'Credit Card', isActive: true },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure modal portal root is clean between tests
    const existing = document.getElementById('modal-root');
    if (existing) existing.remove();
  });

  it('disables submit when payer == receiver or amount invalid', () => {
    render(
      <SettleUpModal
        open
        onClose={() => {}}
        groupId="g1"
        members={members}
        paymentSources={paymentSources}
        transactions={[]}
        currency="USD"
        onCreated={() => {}}
      />
    );

    const recordBtn = screen.getByRole('button', { name: /record settlement/i });
    expect(recordBtn).toBeDisabled(); // nothing selected

    const payerSel = screen.getByLabelText(/payer/i) as HTMLSelectElement;
    const receiverSel = screen.getByLabelText(/receiver/i) as HTMLSelectElement;

    fireEvent.change(payerSel, { target: { value: 'p1' } });
    fireEvent.change(receiverSel, { target: { value: 'p1' } }); // same as payer

    // amount still empty, but show validation message
    expect(screen.getByText(/cannot be the same/i)).toBeInTheDocument();
    expect(recordBtn).toBeDisabled();

    // Now set valid different receiver but zero amount
    fireEvent.change(receiverSel, { target: { value: 'p2' } });
    const amountInput = screen.getByLabelText(/amount/i) as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: '0' } });
    expect(recordBtn).toBeDisabled();
  });

  it('creates settlement transaction via api and calls onCreated', async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const { addTransaction } = await import('../../../services/apiService');

    render(
      <SettleUpModal
        open
        onClose={onClose}
        groupId="g1"
        members={members}
        paymentSources={paymentSources}
        transactions={[]}
        currency="USD"
        onCreated={onCreated}
        defaultPayerId="p1"
        defaultReceiverId="p2"
      />
    );

    const amountInput = screen.getByLabelText(/amount/i) as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: '25.50' } });

    const recordBtn = screen.getByRole('button', { name: /record settlement/i });
    expect(recordBtn).not.toBeDisabled();
    fireEvent.click(recordBtn);

  await waitFor(() => expect(addTransaction).toHaveBeenCalledTimes(1));
    expect(addTransaction).toHaveBeenCalledWith(
      'g1',
      expect.objectContaining({
        type: 'settlement',
        amount: 25.50,
        // The payer (who hands the money over) is recorded as paidById; the
        // split then credits the receiver with the full amount.
        paidById: 'p1',
        split: expect.objectContaining({ mode: 'unequal' })
      })
    );

    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('edit mode does not double-count an existing settlement in the preview', async () => {
    // Alice paid 100 equal with Bob → Alice +50, Bob −50
    const expense: Transaction = {
      id: 'tx_exp',
      groupId: 'g1',
      description: 'Dinner',
      amount: 100,
      paidById: 'p1',
      date: '2024-01-01',
      tag: 'Food',
      type: 'expense',
      split: {
        mode: 'equal',
        participants: [
          { personId: 'p1', value: 1 },
          { personId: 'p2', value: 1 },
        ],
      },
    };
    // Bob already settled 50 to Alice → both at 0
    const settlement: Transaction = {
      id: 'tx_set',
      groupId: 'g1',
      description: 'Settlement: Bob → Alice',
      amount: 50,
      paidById: 'p2',
      date: '2024-01-02',
      tag: 'Other',
      type: 'settlement',
      split: {
        mode: 'unequal',
        participants: [
          { personId: 'p2', value: 0 },
          { personId: 'p1', value: 50 },
        ],
      },
    };

    const onSubmit = vi.fn(async (data: any) => ({
      ...settlement,
      ...data,
      id: settlement.id,
      groupId: 'g1',
    }));

    render(
      <SettleUpModal
        open
        onClose={() => {}}
        groupId="g1"
        members={members}
        paymentSources={paymentSources}
        transactions={[expense, settlement]}
        currency="INR"
        initialTransaction={settlement}
        onSubmit={onSubmit}
        onCreated={() => {}}
      />
    );

    // Same amount as booked → no further change
    expect(screen.getByText(/balances unchanged/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /edit settlement/i })).toBeInTheDocument();

    // Change 50 → 40: only the delta should apply (Alice −10, Bob +10 from current 0)
    const amountInput = screen.getByLabelText(/amount/i) as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: '40' } });

    expect(screen.getByText(/after saving changes/i)).toBeInTheDocument();
    // Alice (receiver p1): base without settlement is +50, after 40 → +10
    // Bob (payer p2): base −50, after +40 → −10
    // Current live was 0/0 so we should see struck 0 → new values
    expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'settlement',
        amount: 40,
        paidById: 'p2',
        split: expect.objectContaining({
          participants: expect.arrayContaining([
            expect.objectContaining({ personId: 'p1', value: 40 }),
          ]),
        }),
      })
    );
  });
});
