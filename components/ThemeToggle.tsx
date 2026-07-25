import React from 'react';

interface ThemeToggleProps {
  theme: 'light' | 'dark' | 'system';
  onChange: (theme: 'light' | 'dark' | 'system') => void;
}

const ThemeToggle: React.FC<ThemeToggleProps> = ({ theme, onChange }) => {
  const btn = (active: boolean) =>
    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors border ${
      active
        ? 'bg-primary text-primary-foreground border-primary'
        : 'bg-secondary text-secondary-foreground border-border hover:bg-muted'
    }`;

  return (
    <div className="flex flex-col gap-2">
      <label className="text-muted-foreground text-sm font-medium">Theme</label>
      <div className="flex gap-2">
        <button type="button" className={btn(theme === 'light')} onClick={() => onChange('light')}>
          Light
        </button>
        <button type="button" className={btn(theme === 'dark')} onClick={() => onChange('dark')}>
          Dark
        </button>
        <button type="button" className={btn(theme === 'system')} onClick={() => onChange('system')}>
          System
        </button>
      </div>
    </div>
  );
};

export default ThemeToggle;
