import React, { useState, useEffect, useMemo, useRef } from 'react';
import BaseModal from './BaseModal';
import { Person, Transaction, PaymentSource } from '../types';
import { addTransaction } from '../services/apiService';
import { calculateGroupBalances } from '../utils/calculations';
import { ArrowRightIcon, ChevronDownIcon, CalendarIcon } from './icons/Icons';
import toast from 'react-hot-toast';

interface SettleUpModalProps {
  open: boolean;
  onClose(): void;
  groupId: string;
  members: Person[];
  paymentSources: PaymentSource[];
  transactions: Transaction[];
  currency?: string;
  onCreated?(tx: Transaction): void; // Optional callback after success
  defaultPayerId?: string;
  defaultReceiverId?: string;
  defaultAmount?: number;
  initialTransaction?: Transaction; // For editing
  onSubmit?(transaction: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>): Promise<Transaction>; // Override internal API call
}

const SettleUpModal: React.FC<SettleUpModalProps> = ({ open, onClose, groupId, members, paymentSources, transactions, currency = 'USD', onCreated, defaultPayerId, defaultReceiverId, defaultAmount, initialTransaction, onSubmit }) => {
  // --- STATE ---
  // If editing, use initialTransaction to seed state
  const [payerId, setPayerId] = useState<string>(initialTransaction?.paidById || defaultPayerId || '');

  // For receiver, if editing, find the participant who isn't the payer
  const derivedReceiverId = useMemo(() => {
    if (initialTransaction && initialTransaction.type === 'settlement') {
      const p = initialTransaction.split.participants.find(p => p.personId !== initialTransaction.paidById);
      return p?.personId || '';
    }
    return defaultReceiverId || '';
  }, [initialTransaction, defaultReceiverId]);

  const [receiverId, setReceiverId] = useState<string>(derivedReceiverId);
  const [amount, setAmount] = useState<string>(initialTransaction ? String(initialTransaction.amount) : '');
  const [note, setNote] = useState(initialTransaction?.comment || '');
  const [date, setDate] = useState<string>(initialTransaction?.date || (() => new Date().toISOString().split('T')[0]));
  const [paymentSourceId, setPaymentSourceId] = useState<string | undefined>(initialTransaction?.paymentSourceId);
  const [submitting, setSubmitting] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const amountInputRef = useRef<HTMLInputElement>(null);

  // Seed state when modal opens: use initialTransaction for edit mode, or defaults for new settlement
  useEffect(() => {
    if (!open) return;

    if (initialTransaction) {
      // EDIT MODE: populate from existing transaction
      setPayerId(initialTransaction.paidById);
      const p = initialTransaction.split.participants.find(p => p.personId !== initialTransaction.paidById);
      setReceiverId(p?.personId || '');
      setAmount(String(initialTransaction.amount));
      setNote(initialTransaction.comment || '');
      setDate(initialTransaction.date);
      setPaymentSourceId(initialTransaction.paymentSourceId);
      setIsAdvancedOpen(false);
    } else {
      // NEW SETTLEMENT MODE: populate from defaults
      setPayerId(defaultPayerId || '');
      setReceiverId(defaultReceiverId || '');
      setAmount(defaultAmount && defaultAmount > 0 ? String(defaultAmount.toFixed(2)) : '');
      setNote('');
      setDate(new Date().toISOString().split('T')[0]);
      setIsAdvancedOpen(false);

      // Default to Cash payment source for new settlements
      const cash = paymentSources.find(p => p.type === 'Cash' && p.isActive !== false);
      setPaymentSourceId(cash?.id);
    }

    // Auto-focus the amount input
    setTimeout(() => {
      amountInputRef.current?.focus();
    }, 100);
  }, [open, initialTransaction, defaultPayerId, defaultReceiverId, defaultAmount, paymentSources]);

  const amountNumber = parseFloat(amount) || 0;
  const isEditing = Boolean(initialTransaction?.id);
  const isSelfSelect = payerId && receiverId && payerId === receiverId;
  const isValid = payerId && receiverId && !isSelfSelect && amountNumber > 0 && !submitting;

  // --- CALCULATIONS (Live Preview) ---
  // When editing, exclude the settlement being edited so we don't double-count it.
  // Projection = balances without this settlement + the (new) amount once.
  // Changing 5k → 4k only moves balances by the delta (−1k for payer, +1k for receiver).
  const transactionsForBase = useMemo(() => {
    if (!initialTransaction?.id) return transactions;
    return transactions.filter(t => t.id !== initialTransaction.id);
  }, [transactions, initialTransaction?.id]);

  const baseBalances = useMemo(
    () => calculateGroupBalances(transactionsForBase),
    [transactionsForBase],
  );

  // Live balances still include the existing settlement (edit mode) — used as the "from" side
  const liveBalances = useMemo(
    () => calculateGroupBalances(transactions),
    [transactions],
  );

  const { displayFromPayer, displayFromReceiver, payerAfter, receiverAfter, balancesUnchanged } = useMemo(() => {
    // Settlement effect: payer +amount, receiver −amount
    const afterPayer = (baseBalances.get(payerId) ?? 0) + amountNumber;
    const afterReceiver = (baseBalances.get(receiverId) ?? 0) - amountNumber;

    // Edit: show current booked balances → projected after save
    // New: show current (= base) → projected after first booking
    const fromPayer = isEditing ? (liveBalances.get(payerId) ?? 0) : (baseBalances.get(payerId) ?? 0);
    const fromReceiver = isEditing ? (liveBalances.get(receiverId) ?? 0) : (baseBalances.get(receiverId) ?? 0);

    const unchanged =
      Math.abs(fromPayer - afterPayer) < 0.01 &&
      Math.abs(fromReceiver - afterReceiver) < 0.01;

    return {
      displayFromPayer: fromPayer,
      displayFromReceiver: fromReceiver,
      payerAfter: afterPayer,
      receiverAfter: afterReceiver,
      balancesUnchanged: unchanged,
    };
  }, [baseBalances, liveBalances, payerId, receiverId, amountNumber, isEditing]);

  const format = (v: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v);
  };

  const getColor = (val: number) => {
    if (Math.abs(val) < 0.01) return 'text-muted-foreground';
    return val > 0 ? 'text-success' : 'text-destructive';
  };

  const handleSubmit = async () => {
    if (!isValid) return;
    setSubmitting(true);
    try {
      // Build settlement transaction
      const txBase: Omit<Transaction, 'id' | 'groupId'> = {
        description: `Settlement: ${members.find(m => m.id === payerId)?.name} → ${members.find(m => m.id === receiverId)?.name}`,
        amount: amountNumber,
        paidById: payerId,
        date,
        tag: 'Other',
        paymentSourceId: paymentSourceId || undefined,
        comment: note || undefined,
        split: {
          mode: 'unequal',
          participants: [
            { personId: payerId, value: 0 },
            { personId: receiverId, value: amountNumber },
          ],
        },
        type: 'settlement',
      };

      let created: Transaction;
      if (onSubmit) {
        created = await onSubmit(txBase);
      } else {
        created = await addTransaction(groupId, txBase);
      }

      toast.success(initialTransaction ? 'Settlement updated ✓' : 'Settlement recorded ✓');
      if (onCreated) onCreated(created);
      onClose();
    } catch (e) {
      console.error('Failed to record settlement', e);
      toast.error(initialTransaction ? 'Failed to update' : 'Failed to record');
    } finally {
      setSubmitting(false);
    }
  };

  // --- RENDER ---
  return (
    <BaseModal
      open={open}
      onClose={() => !submitting && onClose()}
      title={isEditing ? 'Edit Settlement' : 'Record Settlement'}
      size="md"
      description={
        <span className="text-muted-foreground">
          {isEditing
            ? 'Update this settlement. Balances are adjusted by the change only — not booked again.'
            : 'This directly updates balances. No expense will be added.'}
        </span>
      }
      footer={
        <div className="flex w-full gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 px-4 py-3 bg-muted text-muted-foreground rounded-xl hover:bg-muted/80 transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid}
            className="flex-[2] px-4 py-3 bg-success text-success-foreground rounded-xl hover:bg-success/90 transition-colors font-bold shadow-lg shadow-success/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <span className="w-5 h-5 border-2 border-success-foreground/30 border-t-success-foreground rounded-full animate-spin" />
            ) : isEditing ? (
              <>Save changes <ArrowRightIcon width="16" height="16" /></>
            ) : (
              <>Record settlement <ArrowRightIcon width="16" height="16" /></>
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-6">

        {/* 1. AMOUNT (Hero) */}
        <div className="relative flex justify-center py-2">
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-muted-foreground">
              {currency === 'INR' ? '₹' : (currency === 'USD' ? '$' : currency)}
            </span>
            <input
              ref={amountInputRef}
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              min="1"
              className="w-full bg-transparent text-center text-5xl font-bold text-foreground placeholder:text-muted-foreground focus:outline-none p-2 pl-8"
              aria-label="Settlement Amount"
            />
          </div>
        </div>

        {/* 2. PAYER -> RECEIVER FLOW */}
        <div className="bg-muted/40 rounded-xl p-4 flex flex-col sm:flex-row items-center gap-4 relative border border-border">
          {/* Payer */}
          <div className="flex-1 w-full space-y-1.5">
            <label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground pl-1">Who is paying</label>
            <div className="relative">
              <select
                value={payerId}
                onChange={e => setPayerId(e.target.value)}
                aria-label="Payer"
                className="w-full appearance-none bg-muted hover:bg-muted/80 text-foreground p-3 rounded-lg border border-border focus:border-success focus:ring-1 focus:ring-success transition-all font-medium"
              >
                <option value="" disabled>Select payer</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              {/* Tiny Chevron for select */}
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                <ChevronDownIcon width="14" height="14" />
              </div>
            </div>
          </div>

          {/* Arrow visual */}
          <div className="text-muted-foreground flex-shrink-0 pt-4">
            <div className="p-2 bg-card rounded-full border border-border">
              <ArrowRightIcon className="text-success" />
            </div>
          </div>

          {/* Receiver */}
          <div className="flex-1 w-full space-y-1.5">
            <label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground pl-1">Who is receiving</label>
            <div className="relative">
              <select
                value={receiverId}
                onChange={e => setReceiverId(e.target.value)}
                aria-label="Receiver"
                className="w-full appearance-none bg-muted hover:bg-muted/80 text-foreground p-3 rounded-lg border border-border focus:border-success focus:ring-1 focus:ring-success transition-all font-medium"
              >
                <option value="" disabled>Select receiver</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                <ChevronDownIcon width="14" height="14" />
              </div>
            </div>
          </div>
        </div>

        {/* Validation Errors */}
        {isSelfSelect && (
          <div className="text-center p-2 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-xs font-medium animate-pulse">
            Payer and receiver cannot be the same person.
          </div>
        )}

        {/* 3. LIVE BALANCE PREVIEW */}
        {payerId && receiverId && amountNumber > 0 && !isSelfSelect && (
          <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-2">
              <div className="h-px bg-card flex-1"></div>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                {isEditing
                  ? (balancesUnchanged ? 'Balances unchanged' : 'After saving changes')
                  : 'After this settlement'}
              </span>
              <div className="h-px bg-card flex-1"></div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Payer Impact */}
              <div className="bg-card/30 rounded-lg p-3 border border-dashed border-border text-center space-y-1">
                <p className="text-xs text-muted-foreground truncate">{members.find(m => m.id === payerId)?.name}'s Balance</p>
                {balancesUnchanged ? (
                  <div className={`text-sm font-bold ${getColor(payerAfter)}`}>{format(payerAfter)}</div>
                ) : (
                  <div className="flex items-center justify-center gap-2 text-sm flex-wrap">
                    <span className={`${getColor(displayFromPayer)} line-through opacity-50`}>{format(displayFromPayer)}</span>
                    <ArrowRightIcon width="12" height="12" className="text-muted-foreground shrink-0" />
                    <span className={`font-bold ${getColor(payerAfter)}`}>{format(payerAfter)}</span>
                  </div>
                )}
              </div>

              {/* Receiver Impact */}
              <div className="bg-card/30 rounded-lg p-3 border border-dashed border-border text-center space-y-1">
                <p className="text-xs text-muted-foreground truncate">{members.find(m => m.id === receiverId)?.name}'s Balance</p>
                {balancesUnchanged ? (
                  <div className={`text-sm font-bold ${getColor(receiverAfter)}`}>{format(receiverAfter)}</div>
                ) : (
                  <div className="flex items-center justify-center gap-2 text-sm flex-wrap">
                    <span className={`${getColor(displayFromReceiver)} line-through opacity-50`}>{format(displayFromReceiver)}</span>
                    <ArrowRightIcon width="12" height="12" className="text-muted-foreground shrink-0" />
                    <span className={`font-bold ${getColor(receiverAfter)}`}>{format(receiverAfter)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 4. ADVANCED OPTIONS (Progressive Disclosure) */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
            className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDownIcon
              width="14"
              height="14"
              className={`transition-transform duration-200 ${isAdvancedOpen ? 'rotate-180' : ''}`}
            />
            Advanced options (Date, Note, Payment Source)
          </button>

          {/* Collapsible Content */}
          <div className={`grid transition-all duration-300 ease-in-out overflow-hidden ${isAdvancedOpen ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0'}`}>
            <div className="min-h-0 space-y-4 bg-card/30 p-4 rounded-xl border border-border">
              {/* Date */}
              <div>
                <label className="block mb-1.5 text-muted-foreground text-xs font-medium" htmlFor="settle-date">Date</label>
                <div className="relative">
                  <input
                    id="settle-date"
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="w-full bg-background text-foreground rounded-lg p-2.5 border border-border focus:ring-success focus:border-success text-sm"
                  />
                  <CalendarIcon className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" width="16" />
                </div>
              </div>
              {/* Payment Source */}
              <div>
                <label className="block mb-1.5 text-muted-foreground text-xs font-medium" htmlFor="settle-ps">Payment Source</label>
                <select
                  id="settle-ps"
                  value={paymentSourceId || ''}
                  onChange={e => setPaymentSourceId(e.target.value || undefined)}
                  className="w-full bg-background text-foreground rounded-lg p-2.5 border border-border focus:ring-success focus:border-success text-sm appearance-none"
                >
                  <option value="">None (Default)</option>
                  {paymentSources.filter(ps => ps.isActive !== false).map(ps => (
                    <option key={ps.id} value={ps.id}>{ps.name}</option>
                  ))}
                </select>
              </div>
              {/* Note */}
              <div>
                <label className="block mb-1.5 text-muted-foreground text-xs font-medium" htmlFor="settle-note">Note</label>
                <textarea
                  id="settle-note"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={2}
                  className="w-full bg-background text-foreground rounded-lg p-2.5 border border-border focus:ring-success focus:border-success text-sm"
                  placeholder="Optional info..."
                />
              </div>
            </div>
          </div>
        </div>

      </div>
    </BaseModal>
  );
};

export default SettleUpModal;
