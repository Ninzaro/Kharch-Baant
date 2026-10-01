import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueWrite,
  flushOutbox,
  isQueuedNetworkError,
  listWrites,
  resetOutboxForTests,
  SyncTimeoutError,
} from '../../../lib/outbox';
import type { Transaction } from '../../../types';

const expense = {
  description: 'Dinner',
  amount: 10,
  paidById: 'a',
  split: { mode: 'equal' as const, participants: [{ personId: 'a', value: 1 }] },
  date: '2026-10-01',
  tag: 'Food' as const,
  type: 'expense' as const,
};

describe('outbox', () => {
  beforeEach(() => {
    resetOutboxForTests();
  });

  it('stores a lost request and ignores a money-rule error', () => {
    expect(isQueuedNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isQueuedNetworkError(new SyncTimeoutError())).toBe(true);
    expect(isQueuedNetworkError(new Error('payers must sum exactly to amount'))).toBe(false);
    expect(isQueuedNetworkError({ code: '23514', message: 'payers must sum exactly to amount' })).toBe(false);

    enqueueWrite({ kind: 'add', groupId: 'g1', transactionId: 't1', transaction: expense });
    expect(listWrites().map((write) => write.kind)).toEqual(['add']);
  });

  it('flushes in order, drops a stale settlement, and does not retry a blocked edit', async () => {
    enqueueWrite({ kind: 'add', groupId: 'g1', transactionId: 't1', transaction: expense });
    enqueueWrite({
      kind: 'settle',
      groupId: 'g1',
      transaction: { ...expense, type: 'settlement' },
      context: {
        transactionId: 's1',
        expectedPayerBalanceMinor: 0,
        expectedReceiverBalanceMinor: 0,
      },
    });
    enqueueWrite({
      kind: 'update',
      transactionId: 't2',
      patch: { description: 'Lunch', updatedAt: '2026-10-01T00:00:00.000Z' },
    });

    const order: string[] = [];
    const handlers = {
      add: vi.fn(async () => { order.push('add'); }),
      update: vi.fn(async () => {
        order.push('update');
        throw new Error('This expense was changed by someone else. Reload and try again.');
      }),
      delete: vi.fn(async () => { order.push('delete'); }),
      settle: vi.fn(async () => {
        order.push('settle');
        throw Object.assign(new Error('Balances changed. Reload before recording this settlement.'), { code: '40001' });
      }),
      onBlocked: vi.fn(),
      onSettlementConflict: vi.fn(),
    };

    await flushOutbox(handlers);
    expect(order).toEqual(['add', 'settle', 'update']);
    expect(handlers.onSettlementConflict).toHaveBeenCalledTimes(1);
    expect(handlers.onBlocked).toHaveBeenCalledTimes(1);
    expect(listWrites()).toEqual([
      expect.objectContaining({ kind: 'update', transactionId: 't2', blocked: true }),
    ]);

    handlers.update.mockClear();
    await flushOutbox(handlers);
    expect(handlers.update).not.toHaveBeenCalled();
  });

  it('treats a matching lost update as done when the handler succeeds', async () => {
    const patch: Partial<Omit<Transaction, 'id' | 'groupId'>> = { description: 'Dinner', amount: 10 };
    enqueueWrite({ kind: 'update', transactionId: 't1', patch });
    await flushOutbox({
      add: async () => undefined,
      update: async () => undefined,
      delete: async () => undefined,
      settle: async () => undefined,
      onBlocked: () => undefined,
      onSettlementConflict: () => undefined,
    });
    expect(listWrites()).toEqual([]);
  });
});
