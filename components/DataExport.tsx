import React from 'react';

interface DataExportProps {
  onExport: () => void;
  onImport: (file: File) => void;
}

const DataExport: React.FC<DataExportProps> = ({ onExport, onImport }) => (
  <div className="flex flex-col gap-2">
    <label className="text-muted-foreground text-sm font-medium">Data Management</label>
    <div className="flex gap-2">
      <button
        type="button"
        className="px-3 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm rounded-md"
        onClick={onExport}
      >
        Export Data
      </button>
      <label className="px-3 py-2 bg-secondary text-secondary-foreground border border-border text-sm rounded-md cursor-pointer hover:bg-secondary/80">
        Import Data
        <input
          type="file"
          accept=".json,.csv"
          className="hidden"
          onChange={e => e.target.files && e.target.files[0] && onImport(e.target.files[0])}
        />
      </label>
    </div>
  </div>
);

export default DataExport;
