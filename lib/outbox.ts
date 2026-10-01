import type { QueryClient } from '@tanstack/react-query';
import type { Transaction } from '../types';
import type { SettlementWriteContext } from '../services/supabaseApiService';

const KEY = 'kb-outbox-v1';
const MAX = 200;
const TIMEOUT_MS = 20_000;

export class SyncTimeoutError extends Error {
  constructor() {
    super('Sync timed out');
    this.name = 'SyncTimeoutError';
  }
}

export type MoneyWrite =
  | {
      kind: 'add';
      groupId: string;
      transactionId: string;
      transaction: Omit<Transaction, 'id' | 'groupId'>;
    }
  | {
      kind: 'update';
      transactionId: string;
      patch: Partial<Omit<Transaction, 'id' | 'groupId'>>;
      blocked?: boolean;
    }
  | { kind: 'delete'; transactionId: string }
  | {
      kind: 'settle';
      groupId: string;
      transaction: Omit<Transaction, 'id' | 'groupId'>;
      context: SettlementWriteContext;
    };

type StoredWrite = MoneyWrite & { id: string; at: number };

let sessionOnly = false;
let memory: StoredWrite[] | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function load(): StoredWrite[] {
  if (sessionOnly && memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) as StoredWrite[] : [];
    memory = Array.isArray(parsed) ? parsed : [];
    return memory;
  } catch {
    sessionOnly = true;
    memory = memory ?? [];
    return memory;
  }
}

function save(items: StoredWrite[]): boolean {
  const next = items.slice(-MAX);
  memory = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    sessionOnly = false;
    notify();
    return true;
  } catch {
    sessionOnly = true;
    notify();
    return false;
  }
}

export function outboxKeepsAfterRestart(): boolean {
  load();
  return !sessionOnly;
}

export function pendingCount(): number {
  return load().length;
}

export function listWrites(): MoneyWrite[] {
  return load().map(({ at: _at, id: _id, ...write }) => write);
}

/** A failed request that never reached a definite server answer. */
export function isQueuedNetworkError(error: unknown): boolean {
  if (error instanceof SyncTimeoutError) return true;
  if (error instanceof TypeError) return true;
  if (!error || typeof error !== 'object') return false;
  const named = error as { name?: string; message?: string; code?: string; status?: number };
  if (named.code) return false;
  if (typeof named.status === 'number' && named.status >= 400) return false;
  if (named.name === 'AuthRetryableFetchError') return true;
  const message = named.message ?? '';
  return /failed to fetch|networkerror|network request failed|load failed|the internet connection appears to be offline/i.test(message);
}

export function withSyncTimeout<T>(work: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new SyncTimeoutError()), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function offlineSavedMessage(): string {
  return outboxKeepsAfterRestart()
    ? 'Saved on this phone. It will sync when you are back online.'
    : 'Saved until you close the app. Allow site data for SplitFool to keep offline changes after a restart.';
}

function writeId(write: MoneyWrite): string {
  return write.kind === 'settle' ? write.context.transactionId : write.transactionId;
}

export function enqueueWrite(write: MoneyWrite): { persisted: boolean } {
  const items = load();
  const id = writeId(write);
  if (write.kind === 'delete' && items.some((item) => item.kind === 'add' && item.transactionId === id)) {
    return { persisted: save(items.filter((item) => writeId(item) !== id)) };
  }
  if (write.kind === 'update') {
    const add = items.find((item) => item.kind === 'add' && item.transactionId === id);
    if (add && add.kind === 'add') {
      return {
        persisted: save(items.map((item) => (
          item.kind === 'add' && item.transactionId === id
            ? { ...item, transaction: { ...item.transaction, ...write.patch } }
            : item
        ))),
      };
    }
  }
  const rest = items.filter((item) => writeId(item) !== id);
  return { persisted: save([...rest, { ...write, id: crypto.randomUUID(), at: Date.now() }]) };
}

export function overlayPendingTransactions(rows: Transaction[]): Transaction[] {
  let next = rows.slice();
  for (const write of load()) {
    if (write.kind === 'delete') {
      next = next.filter((row) => row.id !== write.transactionId);
      continue;
    }
    if (write.kind === 'update') {
      next = next.map((row) => (
        row.id === write.transactionId ? { ...row, ...write.patch, pendingSync: true } : row
      ));
      continue;
    }
    const pendingId = writeId(write);
    if (!next.some((row) => row.id === pendingId)) {
      next.unshift({
        ...write.transaction,
        id: pendingId,
        groupId: write.groupId,
        pendingSync: true,
      });
    } else {
      next = next.map((row) => (
        row.id === pendingId ? { ...row, pendingSync: true } : row
      ));
    }
  }
  return next;
}

export function reapplyPendingToCache(queryClient: QueryClient): void {
  const entries = queryClient.getQueriesData<Transaction[]>({ queryKey: ['transactions'] });
  for (const [key, rows] of entries) {
    if (!rows) continue;
    queryClient.setQueryData(key, overlayPendingTransactions(rows));
  }
}

export interface FlushHandlers {
  add(write: Extract<MoneyWrite, { kind: 'add' }>): Promise<unknown>;
  update(write: Extract<MoneyWrite, { kind: 'update' }>): Promise<unknown>;
  delete(write: Extract<MoneyWrite, { kind: 'delete' }>): Promise<unknown>;
  settle(write: Extract<MoneyWrite, { kind: 'settle' }>): Promise<unknown>;
  onBlocked(): void;
  onSettlementConflict(): void;
}

function isBalanceConflict(error: unknown): boolean {
  const named = error as { code?: string; message?: string };
  return named?.code === '40001' || /balances changed/i.test(named?.message ?? '');
}

function isEditConflict(error: unknown): boolean {
  return /changed by someone else/i.test((error as { message?: string })?.message ?? '');
}

export async function flushOutbox(handlers: FlushHandlers): Promise<void> {
  const items = load();
  for (const item of items) {
    if (item.kind === 'update' && item.blocked) continue;
    try {
      if (item.kind === 'add') await handlers.add(item);
      else if (item.kind === 'update') await handlers.update(item);
      else if (item.kind === 'delete') await handlers.delete(item);
      else await handlers.settle(item);
      save(load().filter((stored) => stored.id !== item.id));
    } catch (error) {
      if (item.kind === 'settle' && isBalanceConflict(error)) {
        save(load().filter((stored) => stored.id !== item.id));
        handlers.onSettlementConflict();
        continue;
      }
      if (item.kind === 'update' && isEditConflict(error)) {
        save(load().map((stored) => (
          stored.id === item.id && stored.kind === 'update' ? { ...stored, blocked: true } : stored
        )));
        handlers.onBlocked();
        continue;
      }
      if (isQueuedNetworkError(error)) return;
      if (item.kind === 'update') {
        save(load().map((stored) => (
          stored.id === item.id && stored.kind === 'update' ? { ...stored, blocked: true } : stored
        )));
        handlers.onBlocked();
        continue;
      }
      return;
    }
  }
}

/** Test helper. */
export function resetOutboxForTests(): void {
  sessionOnly = false;
  memory = [];
  try {
    localStorage.removeItem(KEY);
  } catch {
    sessionOnly = true;
  }
  notify();
}
