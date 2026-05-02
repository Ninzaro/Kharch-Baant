import React from 'react';

interface ThemeToggleProps {
  theme: 'light' | 'dark' | 'system';
  onChange: (theme: 'light' | 'dark' | 'system') => void;
}

const ThemeToggle: React.FC<ThemeToggleProps> = ({ theme, onChange }) => (
  <div className="flex flex-col gap-2">
    <label className="text-slate-300 text-sm font-medium">Theme</label>
    <div className="flex gap-2">
      <button
        className={`px-3 py-1 rounded ${theme === 'light' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'}`}
        onClick={() => onChange('light')}
      >
        Light
      </button>
      <button
        className={`px-3 py-1 rounded ${theme === 'dark' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'}`}
        onClick={() => onChange('dark')}
      >
        Dark
      </button>
      <button
        className={`px-3 py-1 rounded ${theme === 'system' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'}`}
        onClick={() => onChange('system')}
      >
        System
      </button>
    </div>
  </div>
);

export default ThemeToggle;
