import React from 'react';
import { createPortal } from 'react-dom';

/**
 * ModalShell — lightweight Suspense fallback for lazy-loaded modals.
 * Renders the backdrop + centered spinner immediately while the modal
 * JS chunk is downloading. Stays in the main bundle.
 */
const ModalShell: React.FC = () =>
    createPortal(
        <div className="fixed inset-0 bg-overlay/50 flex items-center justify-center z-50">
            <div className="bg-card rounded-xl p-8 flex items-center justify-center">
                <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
        </div>,
        document.body
    );

export default ModalShell;
