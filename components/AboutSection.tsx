import React from 'react';

const AboutSection: React.FC = () => (
  <div className="flex flex-col gap-2 mt-4 border-t border-border pt-4">
    <label className="text-muted-foreground text-sm font-medium">About</label>
    <div className="text-muted-foreground text-xs">
      <div>Kharch Baant Shared Expense Tracker</div>
      <div>Version: 1.0.0</div>
      <div>© {new Date().getFullYear()} Kharch Baant</div>
      <div className="flex flex-col gap-1 mt-1">
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="text-primary underline">Privacy Policy</a>
        <a href="/account-deletion.html" target="_blank" rel="noopener noreferrer" className="text-primary underline">Delete your account</a>
      </div>
    </div>
  </div>
);

export default AboutSection;
