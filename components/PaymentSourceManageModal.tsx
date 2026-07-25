import React, { useState, useMemo } from 'react';
import BaseModal from './BaseModal';
import { PaymentSource } from '../types';

interface PaymentSourceManageModalProps {
  isOpen: boolean;
  onClose: () => void;
  paymentSources: PaymentSource[];
  usageCounts: Record<string, number>; // map paymentSourceId -> transaction count
  lastUsedMap: Record<string, string | undefined>; // map paymentSourceId -> last used date
  onAddNew: () => void; // opens PaymentSourceFormModal
  onRequestDelete: (id: string) => void; // triggers ConfirmDeleteModal in parent
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
  onAddNew,
  onRequestDelete,
  onArchive,
}) => {
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
        onClick={onAddNew}
        className="px-3 py-2 bg-primary/90 hover:bg-primary/90 text-primary-foreground text-sm rounded-md"
      >
        + Add New Source
      </button>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 bg-foreground/10 text-foreground rounded-md hover:bg-foreground/20"
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
      description={<span className="text-muted-foreground text-sm">Add or remove payment methods. These are optional metadata to help you track who paid with what.</span>}
      footer={footer}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-3">
          <input
            type="text"
            placeholder="Search sources..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="flex-1 bg-overlay/30 text-foreground rounded-md p-2 border border-border focus:ring-ring focus:border-ring text-sm"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
          )}
        </div>
        <ul className="divide-y divide-border rounded-md border border-border overflow-hidden mb-4">
          {active.length === 0 && archived.length === 0 && (
            <li className="p-4 text-muted-foreground text-sm">No payment sources yet. Add one using the button below.</li>
          )}
          {active.map(ps => {
            const isCash = ps.type === 'Cash';
            const detailsLabel = ps.details && 'issuer' in ps.details
              ? `•••• ${ps.details.last4}`
              : (ps.details && 'upiId' in ps.details && ps.details.upiId) ? ps.details.upiId : '';
            const count = usageCounts[ps.id] || 0;
            const lastUsed = lastUsedMap[ps.id];
            return (
              <li key={ps.id} className="flex items-center justify-between p-3 hover:bg-card/60 transition-colors">
                <div className="min-w-0 pr-3">
                  <p className="text-foreground text-sm font-medium truncate">{ps.name}</p>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                    <span>{ps.type}{detailsLabel ? ` • ${detailsLabel}` : ''}</span>
                    <span className={`px-1.5 py-0.5 rounded bg-muted/60 ${count > 0 ? 'text-primary' : 'text-muted-foreground'}`}>{count} tx</span>
                    {lastUsed && (
                      <span className="px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground">Last {lastUsed}</span>
                    )}
                  </div>
                </div>
                {!isCash && (
                  <div className="flex gap-2">
                    {count === 0 && (
                      <button
                        onClick={() => onRequestDelete(ps.id)}
                        className="text-destructive hover:text-destructive text-xs px-2 py-1 rounded-md border border-destructive/30 hover:border-destructive/50"
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
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Default</span>
                )}
              </li>
            );
          })}
        </ul>
        {archived.length > 0 && (
          <div>
            <h5 className="text-xs tracking-wide uppercase text-muted-foreground mb-2">Archived</h5>
            <ul className="divide-y divide-border rounded-md border border-border overflow-hidden mb-4">
              {archived.map(ps => (
                <li key={ps.id} className="flex items-center justify-between p-2 bg-overlay/40">
                  <div className="pr-3 min-w-0">
                    <p className="text-muted-foreground text-xs truncate">{ps.name}</p>
                    <p className="text-muted-foreground text-[10px]">{ps.type}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground">Archived</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-muted-foreground leading-relaxed">
          Sources in use (tx count &gt; 0) can be archived (hidden from selection) instead of deleted. Archived sources remain linked historically. Last used date reflects the most recent transaction referencing that source.
        </p>
      </div>
    </BaseModal>
  );
};

export default PaymentSourceManageModal;
