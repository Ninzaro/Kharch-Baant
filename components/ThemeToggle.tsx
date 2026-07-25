import React from 'react';

interface ThemeToggleProps {
  theme: 'light' | 'dark' | 'system';
  onChange: (theme: 'light' | 'dark' | 'system') => void;
}

const ThemeToggle: React.FC<ThemeToggleProps> = ({ theme, onChange }) => (
  <div className="flex flex-col gap-2">
    <label className="text-muted-foreground text-sm font-medium">Theme</label>
    <div className="flex gap-2">
      <button
        className={`px-3 py-1 rounded ${theme === 'light' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground bg-muted text-muted-foreground'}`}
        onClick={() => onChange('light')}
      >
        Light
      </button>
      <button
        className={`px-3 py-1 rounded ${theme === 'dark' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground bg-muted text-muted-foreground'}`}
        onClick={() => onChange('dark')}
      >
        Dark
      </button>
      <button
        className={`px-3 py-1 rounded ${theme === 'system' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground bg-muted text-muted-foreground'}`}
        onClick={() => onChange('system')}
      >
        System
      </button>
    </div>
  </div>
);

export default ThemeToggle;
