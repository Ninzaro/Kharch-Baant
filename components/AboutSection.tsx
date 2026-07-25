import React from 'react';

const AboutSection: React.FC = () => (
  <div className="flex flex-col gap-2 mt-4 border-t border-border pt-4">
    <label className="text-muted-foreground text-sm font-medium">About</label>
    <div className="text-muted-foreground text-xs">
      <div>Kharch Baant Shared Expense Tracker</div>
      <div>Version: 1.0.0</div>
      <div>© 2025 Kodanda10</div>
      <a href="https://github.com/Kodanda10/Kharch-Baant" target="_blank" rel="noopener noreferrer" className="text-primary underline">GitHub Repo</a>
    </div>
  </div>
);

export default AboutSection;
