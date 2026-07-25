import React from 'react';

interface CurrencySelectorProps {
  value: string;
  onChange: (currency: string) => void;
  options: string[];
}

const CurrencySelector: React.FC<CurrencySelectorProps> = ({ value, onChange, options }) => (
  <div className="flex flex-col gap-2">
    <label className="text-muted-foreground text-sm font-medium">Default Currency</label>
    <select
      className="bg-card text-foreground rounded px-3 py-2"
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      {options.map(opt => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  </div>
);

export default CurrencySelector;
