import React, { useState } from 'react';
import { Person, Filter, SortOption, TAGS } from '../types';
import { CalendarIcon } from './icons/Icons';
import { ListFilter } from 'lucide-react';

interface FilterBarProps {
  filters: Filter;
  onFilterChange: React.Dispatch<React.SetStateAction<Filter>>;
  sortOption: SortOption;
  onSortChange: React.Dispatch<React.SetStateAction<SortOption>>;
  searchQuery: string;
  onSearchChange: React.Dispatch<React.SetStateAction<string>>;
  onDateFilterClick: () => void;
}

const FilterBar: React.FC<FilterBarProps> = ({
  filters,
  onFilterChange,
  sortOption,
  onSortChange,
  searchQuery,
  onSearchChange,
  onDateFilterClick,
}) => {
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  const handleTagChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onFilterChange((prev) => ({ ...prev, tag: e.target.value }));
  };

  return (
    <div className="bg-card/60 border border-border p-2 rounded-lg mb-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex-grow">
          <input
            type="text"
            placeholder="Search expenses..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-muted text-foreground rounded-md p-2 border border-border placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:border-ring"
          />
        </div>
        <button
          type="button"
          onClick={() => setIsFiltersOpen(!isFiltersOpen)}
          className={`p-2 rounded-md border transition-colors ${isFiltersOpen
              ? 'bg-primary border-primary text-primary-foreground'
              : 'bg-muted border-border text-muted-foreground hover:text-foreground hover:bg-muted/80'
            }`}
          aria-label="Toggle filters"
        >
          <ListFilter size={20} />
        </button>
      </div>

      {isFiltersOpen && (
        <div className="flex flex-col md:flex-row gap-2 items-center text-sm animate-in fade-in slide-in-from-top-2 duration-200">
          <select
            value={filters.tag}
            onChange={handleTagChange}
            className="w-full md:w-auto flex-1 bg-muted text-foreground rounded-md p-2 border border-border focus:ring-2 focus:ring-ring focus:border-ring"
          >
            <option value="all">All Categories</option>
            {TAGS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={onDateFilterClick}
            className="w-full md:w-auto flex-1 p-2 bg-muted text-foreground rounded-md border border-border hover:bg-muted/80 flex items-center justify-center gap-2"
          >
            <CalendarIcon className="h-4 w-4" />
            <span>{filters.dateRange ? `${new Date(filters.dateRange.start + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${new Date(filters.dateRange.end + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Any Date'}</span>
            {filters.dateRange && (
              <span onClick={(e) => {
                e.stopPropagation();
                onFilterChange(prev => {
                  const { dateRange, ...rest } = prev;
                  return rest;
                })
              }} className="text-xs text-muted-foreground hover:text-foreground">(clear)</span>
            )}
          </button>

          <select
            value={sortOption}
            onChange={(e) => onSortChange(e.target.value as SortOption)}
            className="w-full md:w-auto flex-1 bg-overlay/30 text-foreground rounded-md p-2 border border-border focus:ring-ring focus:border-ring"
          >
            <option value="date-desc">Date (Newest)</option>
            <option value="date-asc">Date (Oldest)</option>
            <option value="amount-desc">Amount (High-Low)</option>
            <option value="amount-asc">Amount (Low-High)</option>
          </select>
        </div>
      )}
    </div>
  );
};

export default FilterBar;