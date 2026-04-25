import React, { useState, useMemo, useRef } from 'react';
import { Group, Transaction, Person, Filter, SortOption, GROUP_TYPES } from '../types';
import { calculateShares } from '../utils/calculations';
import Dashboard from './Dashboard';
import MemberBalances from './MemberBalances';
import TransactionList from './TransactionList';
import FilterBar from './FilterBar';
import html2canvas from 'html2canvas';
import ShareModal from './ShareModal';
import Avatar from './Avatar';
import DateFilterModal from './DateFilterModal';
import GroupBalancesModal from './GroupBalancesModal';
import GroupSummaryModal from './GroupSummaryModal';
import { SettingsIcon, HomeIcon, ShareIcon, ChartIcon } from './icons/Icons';
import { useModalContext } from '../contexts/ModalContext';

interface GroupViewProps {
  group: Group;
  transactions: Transaction[];
  people: Person[];
  currentUserId: string;
  onEditGroup: () => void;
  onGoHome: () => void;
}

const GroupView: React.FC<GroupViewProps> = ({
  group,
  transactions,
  people,
  currentUserId,
  onEditGroup,
  onGoHome,
}) => {
  const [filters, setFilters] = useState<Filter>({ tag: 'all' });
  const [sortOption, setSortOption] = useState<SortOption>('date-desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareImageDataUrl, setShareImageDataUrl] = useState('');
  const summaryRef = useRef<HTMLDivElement>(null);
  const [isDateFilterOpen, setIsDateFilterOpen] = useState(false);
  const [isBalancesModalOpen, setIsBalancesModalOpen] = useState(false);
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);

  const { actions } = useModalContext();

  const handleEditTransaction = (transaction: Transaction) => {
    if (transaction.type === 'settlement') {
      actions.openSettleUp({ initialTransaction: transaction });
    } else {
      actions.openTransactionForm(transaction);
    }
  };

  const handleDeleteTransaction = (id: string) => {
    const tx = transactions.find(t => t.id === id);
    if (tx) actions.requestDeleteTransaction(tx);
  };

  if (!group) {
    return (
      <div className="flex-1 w-full h-full flex items-center justify-center bg-slate-900">
        <p className="text-slate-400">Loading...</p>
      </div>
    );
  }

  const groupMembers = useMemo(
    () => people.filter((p) => group.members.includes(p.id)),
    [people, group.members]
  );

  const groupTypeLabel = useMemo(() => {
    return GROUP_TYPES.find(option => option.value === group.groupType)?.label || 'Other';
  }, [group.groupType]);

  const tripRange = useMemo(() => {
    if (!group.tripStartDate || !group.tripEndDate) return '';
    const start = new Date(group.tripStartDate + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    const end = new Date(group.tripEndDate + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    return `${start} - ${end}`;
  }, [group.tripStartDate, group.tripEndDate]);

  const filteredTransactions = useMemo(() => {
    let filtered = [...transactions];

    // --- CATEGORY/TAG FILTER ---
    if (filters.tag !== 'all') {
      filtered = filtered.filter((t) => t.tag === filters.tag);
    }

    // --- DATE RANGE FILTER ---
    if (filters.dateRange?.start && filters.dateRange?.end) {
      const startDate = new Date(filters.dateRange.start);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(filters.dateRange.end);
      endDate.setHours(23, 59, 59, 999);

      filtered = filtered.filter((t) => {
        const d = new Date(t.date);
        return d >= startDate && d <= endDate;
      });
    }

    // --- TEXT SEARCH (safe if description is missing) ---
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((t) => (t.description ?? '').toLowerCase().includes(q));
    }

    // --- SORTING (fixed amount sorting) ---
    filtered.sort((a, b) => {
      switch (sortOption) {
        case 'date-asc':
          return new Date(a.date).getTime() - new Date(b.date).getTime();
        case 'amount-desc':
          return (b.amount ?? 0) - (a.amount ?? 0);
        case 'amount-asc':
          return (a.amount ?? 0) - (b.amount ?? 0);
        case 'date-desc':
        default:
          return new Date(b.date).getTime() - new Date(a.date).getTime();
      }
    });

    return filtered;
  }, [transactions, filters, sortOption, searchQuery]);

  const handleShare = async () => {
    const elementToCapture = summaryRef.current;
    if (elementToCapture) {
      elementToCapture.classList.add('bg-slate-900', 'p-4');
      const canvas = await html2canvas(elementToCapture, {
        backgroundColor: '#0f172a',
        useCORS: true,
      });
      elementToCapture.classList.remove('bg-slate-900', 'p-4');
      const dataUrl = canvas.toDataURL('image/png');
      setShareImageDataUrl(dataUrl);
      setIsShareModalOpen(true);
    }
  };

  const handleApplyDateFilter = (range: { start: string; end: string }) => {
    setFilters((prev) => ({ ...prev, dateRange: range }));
    setIsDateFilterOpen(false);
  };

  return (
    <div className="flex-1 w-full h-full flex flex-col bg-slate-900">
      <header className="bg-black/30 backdrop-blur-lg border-b border-white/10 sticky top-0 z-10 p-4 flex justify-between items-center flex-shrink-0 safe-area-top">
        <div className="flex items-center gap-4">
          <button
            onClick={onGoHome}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-full transition-colors md:hidden"
          >
            <HomeIcon />
          </button>
          <div>
            <h1 className="text-xl md:text-2xl font-bold">{group.name}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs uppercase tracking-wide text-slate-400">
              <span>{groupTypeLabel}</span>
              {tripRange && (
                <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10">{tripRange}</span>
              )}
            </div>
            <div className="flex items-center -space-x-2 mt-1">
              {groupMembers.slice(0, 5).map((member) => (
                <Avatar key={member.id} id={member.id} name={member.name} avatarUrl={member.avatarUrl} size="sm" />
              ))}
              {groupMembers.length > 5 && (
                <div className="h-6 w-6 rounded-full bg-slate-600 flex items-center justify-center text-xs font-bold text-slate-300 ring-2 ring-slate-800">
                  +{groupMembers.length - 5}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsSummaryModalOpen(true)}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-full transition-colors"
            title="Group Summary"
          >
            <ChartIcon />
          </button>
          <button
            onClick={() => {
              console.log('Edit group button clicked');
              onEditGroup();
            }}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-full transition-colors"
          >
            <SettingsIcon />
          </button>
          <button
            onClick={handleShare}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-full transition-colors"
          >
            <ShareIcon />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        {/* Actions container just below group information */}
        <div className="mb-4 flex flex-wrap gap-3">
          <button
            onClick={() => actions.openTransactionForm()}
            className="px-4 py-2 rounded-md bg-gradient-to-br from-indigo-500 to-purple-600 text-white hover:from-indigo-600 hover:to-purple-700 text-sm font-medium shadow"
          >
            Add Expense
          </button>
          <button
            onClick={() => setIsBalancesModalOpen(true)}
            className="px-4 py-2 rounded-md bg-gradient-to-br from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700 text-sm font-medium shadow"
          >
            Balances
          </button>
          <button
            onClick={() => actions.openSettleUp()}
            className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium shadow"
          >
            Settle Up
          </button>
        </div>
        <div ref={summaryRef}>
          <Dashboard
            transactions={transactions}
            people={people}
            currentUserId={currentUserId}
            currency={group.currency}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
          <div className="lg:col-span-2 relative pl-6">
            {/* Decorative Circuit Line */}
            <div className="absolute left-0 top-3 bottom-0 w-0.5 bg-gradient-to-b from-indigo-500 via-purple-500 to-transparent shadow-[0_0_15px_rgba(99,102,241,0.6)] rounded-full opacity-70" aria-hidden="true">
              <div className="absolute -top-1 -left-[3px] w-2 h-2 rounded-full bg-indigo-400 shadow-[0_0_10px_rgba(99,102,241,1)] animate-pulse"></div>
            </div>

            <h2 className="text-xl font-semibold mb-4 text-slate-300">Transactions</h2>
            <FilterBar
              filters={filters}
              onFilterChange={setFilters}
              sortOption={sortOption}
              onSortChange={setSortOption}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onDateFilterClick={() => setIsDateFilterOpen(true)}
            />
            <TransactionList
              transactions={filteredTransactions}
              people={people}
              currentUserId={currentUserId}
              currency={group.currency}
              onEdit={handleEditTransaction}
              onDelete={handleDeleteTransaction}
              onViewDetails={(tx) => actions.openTransactionDetail(tx)}
            />
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4 text-slate-300">Balances</h2>
            <MemberBalances
              transactions={transactions}
              people={groupMembers}
              currency={group.currency}
              currentUserId={currentUserId}
            />
          </div>
        </div>
      </main>

      <ShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        imageDataUrl={shareImageDataUrl}
        groupName={group.name}
      />

      <DateFilterModal
        isOpen={isDateFilterOpen}
        onClose={() => setIsDateFilterOpen(false)}
        onApply={handleApplyDateFilter}
        currentRange={filters.dateRange}
      />

      <GroupBalancesModal
        group={group}
        transactions={transactions}
        people={people}
        currentUserId={currentUserId}
        isOpen={isBalancesModalOpen}
        onClose={() => setIsBalancesModalOpen(false)}
      />

      <GroupSummaryModal
        isOpen={isSummaryModalOpen}
        onClose={() => setIsSummaryModalOpen(false)}
        groupName={group.name}
        transactions={transactions}
        people={people}
        currency={group.currency}
      />
    </div>
  );
};

export default GroupView;
