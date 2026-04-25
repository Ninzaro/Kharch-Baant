import React, { useState, useMemo } from 'react';
import BaseModal from './BaseModal';
import { PaymentSource } from '../types';
import { useModalContext } from '../contexts/ModalContext';

interface PaymentSourceManageModalProps {
  isOpen: boolean;
  onClose: () => void;
  paymentSources: PaymentSource[];
  usageCounts: Record<string, number>; // map paymentSourceId -> transaction count
  lastUsedMap: Record<string, string | undefined>; // map paymentSourceId -> last used date
  onArchive: (id: string) => void;
}

/**
 * PaymentSourceManageModal
 * Read/manage existing payment sources in one place.
 * - Lists all sources with type and optional details snippet
 * - Prevents deletion of canonical 'Cash' source
 * - Delegates add + delete to parent (keeps data logic centralized)
 */
const PaymentSourceManageModal: React.FC<PaymentSourceManageModalProps> = ({
  isOpen,
  onClose,
  paymentSources,
  usageCounts,
  lastUsedMap,
  onArchive,
}) => {
  const { actions } = useModalContext();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    if (!query.trim()) return paymentSources;
    const q = query.toLowerCase();
    return paymentSources.filter(ps => ps.name.toLowerCase().includes(q) || ps.type.toLowerCase().includes(q));
  }, [paymentSources, query]);
  const active = filtered.filter(p => p.isActive !== false);
  const archived = filtered.filter(p => p.isActive === false);
  const footer = (
    <div className="flex items-center justify-between w-full">
      <button
        type="button"
        onClick={() => {
          actions.closePaymentSourceManage();
          actions.openPaymentSourceForm();
        }}
        className="px-3 py-2 bg-indigo-600/90 hover:bg-indigo-500 text-white text-sm rounded-md"
      >
        + Add New Source
      </button>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 bg-white/10 text-white rounded-md hover:bg-white/20"
        >
          Close
        </button>
      </div>
    </div>
  );

  return (
    <BaseModal
      open={isOpen}
      onClose={onClose}
      title="Manage Payment Sources"
      size="md"
      description={<span className="text-slate-300 text-sm">Add or remove payment methods. These are optional metadata to help you track who paid with what.</span>}
      footer={footer}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-3">
          <input
            type="text"
            placeholder="Search sources..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="flex-1 bg-black/30 text-white rounded-md p-2 border border-slate-600 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-xs text-slate-400 hover:text-slate-200">Clear</button>
          )}
        </div>
        <ul className="divide-y divide-slate-700 rounded-md border border-slate-700 overflow-hidden mb-4">
          {active.length === 0 && archived.length === 0 && (
            <li className="p-4 text-slate-400 text-sm">No payment sources yet. Add one using the button below.</li>
          )}
          {active.map(ps => {
            const isCash = ps.type === 'Cash';
            const detailsLabel = ps.details && 'issuer' in ps.details
              ? `•••• ${ps.details.last4}`
              : (ps.details && 'upiId' in ps.details && ps.details.upiId) ? ps.details.upiId : '';
            const count = usageCounts[ps.id] || 0;
            const lastUsed = lastUsedMap[ps.id];
            return (
              <li key={ps.id} className="flex items-center justify-between p-3 hover:bg-slate-800/60 transition-colors">
                <div className="min-w-0 pr-3">
                  <p className="text-slate-200 text-sm font-medium truncate">{ps.name}</p>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 flex-wrap">
                    <span>{ps.type}{detailsLabel ? ` • ${detailsLabel}` : ''}</span>
                    <span className={`px-1.5 py-0.5 rounded bg-slate-700/60 ${count > 0 ? 'text-indigo-300' : 'text-slate-400'}`}>{count} tx</span>
                    {lastUsed && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-700/40 text-slate-400">Last {lastUsed}</span>
                    )}
                  </div>
                </div>
                {!isCash && (
                  <div className="flex gap-2">
                    {count === 0 && (
                      <button
                        onClick={() => {
                          const src = paymentSources.find(p => p.id === ps.id);
                          if (src) actions.requestDeletePaymentSource(src);
                        }}
                        className="text-rose-400 hover:text-rose-300 text-xs px-2 py-1 rounded-md border border-rose-500/30 hover:border-rose-400/50"
                        aria-label={`Delete ${ps.name}`}
                      >Delete</button>
                    )}
                    {count > 0 && (
                      <button
                        onClick={() => onArchive(ps.id)}
                        className="text-amber-400 hover:text-amber-300 text-xs px-2 py-1 rounded-md border border-amber-500/30 hover:border-amber-400/50"
                        aria-label={`Archive ${ps.name}`}
                      >Archive</button>
                    )}
                  </div>
                )}
                {isCash && (
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">Default</span>
                )}
              </li>
            );
          })}
        </ul>
        {archived.length > 0 && (
          <div>
            <h5 className="text-xs tracking-wide uppercase text-slate-500 mb-2">Archived</h5>
            <ul className="divide-y divide-slate-800 rounded-md border border-slate-800 overflow-hidden mb-4">
              {archived.map(ps => (
                <li key={ps.id} className="flex items-center justify-between p-2 bg-slate-900/40">
                  <div className="pr-3 min-w-0">
                    <p className="text-slate-400 text-xs truncate">{ps.name}</p>
                    <p className="text-slate-600 text-[10px]">{ps.type}</p>
                  </div>
                  <span className="text-[10px] text-slate-500">Archived</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-slate-500 leading-relaxed">
          Sources in use (tx count &gt; 0) can be archived (hidden from selection) instead of deleted. Archived sources remain linked historically. Last used date reflects the most recent transaction referencing that source.
        </p>
      </div>
    </BaseModal>
  );
};

export default PaymentSourceManageModal;
