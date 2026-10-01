import toast from 'react-hot-toast';
import * as api from './apiService';
import { flushOutbox } from '../lib/outbox';

/** Replay money writes saved on this device. Stops on a lost connection. */
export async function flushPendingMoneyWrites(): Promise<void> {
  await flushOutbox({
    add: (write) => api.addTransaction(write.groupId, write.transaction, write.transactionId),
    update: (write) => api.updateTransaction(write.transactionId, write.patch),
    delete: (write) => api.deleteTransaction(write.transactionId),
    settle: (write) => api.settleUp(write.groupId, write.transaction, write.context),
    onBlocked: () => {
      toast.error('An offline edit could not sync because the expense changed. Reload and edit it again.');
    },
    onSettlementConflict: () => {
      toast.error('A settlement could not sync because balances changed. Enter it again.');
    },
  });
}
