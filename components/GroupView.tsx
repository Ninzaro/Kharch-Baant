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
import { ButtonGroup, ButtonGroupItem } from './ui/button-group';

interface GroupViewProps {
  group: Group;
  transactions: Transaction[];
  people: Person[];
  currentUserId: string;
  onAddExpense: () => void;
  onSettleUp: () => void;
  onSettlePair?: (payerId: string, receiverId: string, amount: number) => void;
  onEditTransaction: (transaction: Transaction) => void;
  onDeleteTransaction: (id: string) => void;
  onEditGroup: () => void;
  onGoHome: () => void;
  onViewDetails: (transaction: Transaction) => void;
}

const GroupView: React.FC<GroupViewProps> = ({
  group,
  transactions,
  people,
  currentUserId,
  onAddExpense,
  onSettleUp,
  onSettlePair,
  onEditTransaction,
  onDeleteTransaction,
  onEditGroup,
  onGoHome,
  onViewDetails,
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

  if (!group) {
    return (
      <div className="flex-1 w-full h-full flex items-center justify-center bg-background text-foreground">
        <p className="text-muted-foreground">Loading...</p>
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
    const start = new Date(group.tripStartDate + 'T00:00:00');
    const end = new Date(group.tripEndDate + 'T00:00:00');
    const sameYear = start.getFullYear() === end.getFullYear();
    const sameMonth = sameYear && start.getMonth() === end.getMonth();
    const monthDay = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (sameMonth) return `${monthDay(start)}–${end.getDate()}, ${end.getFullYear()}`;
    if (sameYear) return `${monthDay(start)} – ${monthDay(end)}, ${end.getFullYear()}`;
    return `${monthDay(start)}, ${start.getFullYear()} – ${monthDay(end)}, ${end.getFullYear()}`;
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
      elementToCapture.classList.add('bg-background', 'p-4');
      const canvas = await html2canvas(elementToCapture, {
        backgroundColor: (() => {
          const raw = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
          return raw ? `hsl(${raw})` : undefined;
        })(),
        useCORS: true,
      });
      elementToCapture.classList.remove('bg-background', 'p-4');
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
    <div className="flex-1 w-full h-full flex flex-col circuit-grid text-foreground">
      <header className="bg-card/80 backdrop-blur-lg border-b border-border sticky top-0 z-10 p-page flex justify-between items-center flex-shrink-0 safe-area-top">
        <div className="flex items-center gap-4 min-w-0">
          <button
            type="button"
            onClick={onGoHome}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full transition-colors md:hidden shrink-0"
            aria-label="Back to dashboard"
          >
            <HomeIcon />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-bold text-foreground truncate">{group.name}</h1>
            <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
              <span>{groupTypeLabel}</span>
              {tripRange && (
                <span className="mt-1 block normal-case tracking-normal whitespace-nowrap">{tripRange}</span>
              )}
            </div>
            <div className="flex items-center -space-x-2 mt-1">
              {groupMembers.slice(0, 5).map((member) => (
                <Avatar key={member.id} id={member.id} name={member.name} avatarUrl={member.avatarUrl} size="sm" />
              ))}
              {groupMembers.length > 5 && (
                <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground ring-2 ring-background">
                  +{groupMembers.length - 5}
                </div>
              )}
            </div>
          </div>
        </div>
        <ButtonGroup className="shrink-0">
          <ButtonGroupItem onClick={() => setIsSummaryModalOpen(true)} ariaLabel="Group summary" className="w-9 px-0 text-muted-foreground">
            <ChartIcon />
          </ButtonGroupItem>
          <ButtonGroupItem onClick={() => { onEditGroup(); }} ariaLabel="Group settings" className="w-9 px-0 text-muted-foreground">
            <SettingsIcon />
          </ButtonGroupItem>
          <ButtonGroupItem onClick={handleShare} ariaLabel="Share group summary" className="w-9 px-0 text-muted-foreground">
            <ShareIcon />
          </ButtonGroupItem>
        </ButtonGroup>
      </header>

      <main className="flex-1 overflow-y-auto p-page md:p-section">
        {/* Actions container just below group information */}
        <ButtonGroup className="mb-4">
          <ButtonGroupItem onClick={onAddExpense}>Add Expense</ButtonGroupItem>
          <ButtonGroupItem onClick={() => setIsBalancesModalOpen(true)}>Balances</ButtonGroupItem>
          <ButtonGroupItem onClick={onSettleUp}>Settle Up</ButtonGroupItem>
        </ButtonGroup>
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
            <div className="absolute left-0 top-3 bottom-0 w-0.5 bg-gradient-to-b from-primary via-accent to-transparent shadow-[0_0_15px_hsl(var(--primary)/0.6)] rounded-full opacity-70" aria-hidden="true">
              <div className="absolute -top-1 -left-[3px] w-2 h-2 rounded-full bg-primary shadow-[0_0_10px_hsl(var(--primary))] animate-pulse"></div>
            </div>

            <h2 className="text-xl font-semibold mb-4 text-foreground">Transactions</h2>
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
              onEdit={onEditTransaction}
              onDelete={onDeleteTransaction}
              onViewDetails={onViewDetails}
            />
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4 text-foreground">Balances</h2>
            <MemberBalances
              transactions={transactions}
              people={groupMembers}
              currency={group.currency}
              currentUserId={currentUserId}
              onSettlePair={onSettlePair}
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
