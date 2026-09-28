import React from 'react';

export function ButtonGroup({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="group" className={`inline-flex items-stretch ${className}`}>
      {children}
    </div>
  );
}

export function ButtonGroupItem({
  children,
  onClick,
  active = false,
  disabled = false,
  className = '',
  ariaLabel,
  type = 'button',
}: {
  children: React.ReactNode;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={active || undefined}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 h-9 px-3 text-sm font-medium border border-border -ml-px first:ml-0 first:rounded-l-md last:rounded-r-md focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
        active
          ? 'relative z-10 bg-primary text-primary-foreground border-primary hover:bg-primary/90'
          : 'bg-card text-foreground hover:bg-muted'
      } ${className}`}
    >
      {children}
    </button>
  );
}
