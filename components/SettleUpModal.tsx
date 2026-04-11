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
  const isSelfSelect = payerId && receiverId && payerId === receiverId;
  const isValid = payerId && receiverId && !isSelfSelect && amountNumber > 0 && !submitting;

  // --- CALCULATIONS (Live Preview) ---
  const groupBalances = useMemo(() => calculateGroupBalances(transactions), [transactions]);
  const { currentPayerBalance, currentReceiverBalance } = useMemo(() => ({
    currentPayerBalance: groupBalances.get(payerId) ?? 0,
    currentReceiverBalance: groupBalances.get(receiverId) ?? 0,
  }), [groupBalances, payerId, receiverId]);

  const projected = useMemo(() => {
    return {
      // So: Payer Balance INCREASES (becomes more positive/less negative).
      // Receiver Balance DECREASES (becomes less positive/more negative).

      payerAfter: currentPayerBalance + amountNumber,
      receiverAfter: currentReceiverBalance - amountNumber,
    };
  }, [currentPayerBalance, currentReceiverBalance, amountNumber]);

  const format = (v: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v);
  };

  const formatDiff = (v: number) => {
    const s = format(v);
    return v > 0 ? `+${s}` : s; // Currency format handles negative sign usually
  };

  const getColor = (val: number) => {
    if (Math.abs(val) < 0.01) return 'text-slate-400';
    return val > 0 ? 'text-emerald-400' : 'text-rose-400';
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
      title="Record Settlement"
      size="md"
      description={<span className="text-slate-400">This directly updates balances. No expense will be added.</span>}
      footer={
        <div className="flex w-full gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 px-4 py-3 bg-slate-800 text-slate-300 rounded-xl hover:bg-slate-700 transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid}
            className="flex-[2] px-4 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-500 transition-colors font-bold shadow-lg shadow-emerald-900/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-slate-500">
              {currency === 'INR' ? '₹' : (currency === 'USD' ? '$' : currency)}
            </span>
            <input
              ref={amountInputRef}
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              min="1"
              className="w-full bg-transparent text-center text-5xl font-bold text-white placeholder-slate-700 focus:outline-none p-2 pl-8"
              aria-label="Settlement Amount"
            />
          </div>
        </div>

        {/* 2. PAYER -> RECEIVER FLOW */}
        <div className="bg-slate-800/50 rounded-xl p-4 flex flex-col sm:flex-row items-center gap-4 relative">
          {/* Payer */}
          <div className="flex-1 w-full space-y-1.5">
            <label className="text-[10px] uppercase tracking-wider font-bold text-slate-400 pl-1">Who is paying</label>
            <div className="relative">
              <select
                value={payerId}
                onChange={e => setPayerId(e.target.value)}
                className="w-full appearance-none bg-slate-700 hover:bg-slate-600 text-white p-3 rounded-lg border border-transparent focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all font-medium"
              >
                <option value="" disabled>Select payer</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              {/* Tiny Chevron for select */}
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                <ChevronDownIcon width="14" height="14" />
              </div>
            </div>
          </div>

          {/* Arrow visual */}
          <div className="text-slate-500 flex-shrink-0 pt-4">
            <div className="p-2 bg-slate-800 rounded-full border border-slate-700">
              <ArrowRightIcon className="text-emerald-500" />
            </div>
          </div>

          {/* Receiver */}
          <div className="flex-1 w-full space-y-1.5">
            <label className="text-[10px] uppercase tracking-wider font-bold text-slate-400 pl-1">Who is receiving</label>
            <div className="relative">
              <select
                value={receiverId}
                onChange={e => setReceiverId(e.target.value)}
                className="w-full appearance-none bg-slate-700 hover:bg-slate-600 text-white p-3 rounded-lg border border-transparent focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all font-medium"
              >
                <option value="" disabled>Select receiver</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                <ChevronDownIcon width="14" height="14" />
              </div>
            </div>
          </div>
        </div>

        {/* Validation Errors */}
        {isSelfSelect && (
          <div className="text-center p-2 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-300 text-xs font-medium animate-pulse">
            Payer and receiver cannot be the same person.
          </div>
        )}

        {/* 3. LIVE BALANCE PREVIEW */}
        {payerId && receiverId && amountNumber > 0 && !isSelfSelect && (
          <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-2">
              <div className="h-px bg-slate-800 flex-1"></div>
              <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">After this settlement</span>
              <div className="h-px bg-slate-800 flex-1"></div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Payer Impact */}
              <div className="bg-slate-800/30 rounded-lg p-3 border border-dashed border-slate-700 text-center space-y-1">
                <p className="text-xs text-slate-400">{members.find(m => m.id === payerId)?.name}'s Balance</p>
                <div className="flex items-center justify-center gap-2 text-sm">
                  <span className={`${getColor(currentPayerBalance)} line-through opacity-50`}>{format(currentPayerBalance)}</span>
                  <ArrowRightIcon width="12" height="12" className="text-slate-600" />
                  <span className={`font-bold ${getColor(projected.payerAfter)}`}>{format(projected.payerAfter)}</span>
                </div>
              </div>

              {/* Receiver Impact */}
              <div className="bg-slate-800/30 rounded-lg p-3 border border-dashed border-slate-700 text-center space-y-1">
                <p className="text-xs text-slate-400">{members.find(m => m.id === receiverId)?.name}'s Balance</p>
                <div className="flex items-center justify-center gap-2 text-sm">
                  <span className={`${getColor(currentReceiverBalance)} line-through opacity-50`}>{format(currentReceiverBalance)}</span>
                  <ArrowRightIcon width="12" height="12" className="text-slate-600" />
                  <span className={`font-bold ${getColor(projected.receiverAfter)}`}>{format(projected.receiverAfter)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 4. ADVANCED OPTIONS (Progressive Disclosure) */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
            className="flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-white transition-colors"
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
            <div className="min-h-0 space-y-4 bg-slate-800/30 p-4 rounded-xl border border-white/5">
              {/* Date */}
              <div>
                <label className="block mb-1.5 text-slate-300 text-xs font-medium" htmlFor="settle-date">Date</label>
                <div className="relative">
                  <input
                    id="settle-date"
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="w-full bg-slate-900 text-white rounded-lg p-2.5 border border-slate-700 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
                  />
                  <CalendarIcon className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" width="16" />
                </div>
              </div>
              {/* Payment Source */}
              <div>
                <label className="block mb-1.5 text-slate-300 text-xs font-medium" htmlFor="settle-ps">Payment Source</label>
                <select
                  id="settle-ps"
                  value={paymentSourceId || ''}
                  onChange={e => setPaymentSourceId(e.target.value || undefined)}
                  className="w-full bg-slate-900 text-white rounded-lg p-2.5 border border-slate-700 focus:ring-emerald-500 focus:border-emerald-500 text-sm appearance-none"
                >
                  <option value="">None (Default)</option>
                  {paymentSources.filter(ps => ps.isActive !== false).map(ps => (
                    <option key={ps.id} value={ps.id}>{ps.name}</option>
                  ))}
                </select>
              </div>
              {/* Note */}
              <div>
                <label className="block mb-1.5 text-slate-300 text-xs font-medium" htmlFor="settle-note">Note</label>
                <textarea
                  id="settle-note"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={2}
                  className="w-full bg-slate-900 text-white rounded-lg p-2.5 border border-slate-700 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
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
