import React from 'react';

interface DataExportProps {
  onExport: () => void;
}

const DataExport: React.FC<DataExportProps> = ({ onExport }) => (
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
    </div>
  </div>
);

export default DataExport;
