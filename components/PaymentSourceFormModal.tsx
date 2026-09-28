import React, { useState } from 'react';
import { PaymentSource, PaymentSourceType, UPIDetails } from '../types';

interface PaymentSourceFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (source: Omit<PaymentSource, 'id'>) => void;
}

const PaymentSourceFormModal: React.FC<PaymentSourceFormModalProps> = ({ isOpen, onClose, onSave }) => {
    const [type, setType] = useState<PaymentSourceType>('Credit Card');
    const [name, setName] = useState('');

    const resetForm = () => {
        setType('Credit Card');
        setName('');
    };

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        const details: UPIDetails | undefined = type === 'UPI' ? { appName: trimmed } : undefined;
        onSave({ name: trimmed, type, details, isActive: true });
        resetForm();
    };

    const handleClose = () => {
        resetForm();
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-overlay/70 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="payment-source-modal-title">
            <div className="bg-card text-card-foreground backdrop-blur-xl border border-border rounded-2xl shadow-2xl p-8 w-full max-w-lg">
                <h2 id="payment-source-modal-title" className="text-2xl font-bold text-foreground mb-2">Add New Payment Source</h2>
                <p className="text-sm text-muted-foreground mb-6 bg-primary/10 p-3 rounded-md border border-primary/30">
                    <strong className="text-foreground">Privacy notice:</strong> Only the name you type is stored. Never enter a full card number, CVV, PIN, or UPI ID.
                </p>
                <form onSubmit={handleSave} className="space-y-4">
                    <div>
                        <label htmlFor="source-name" className="block text-sm font-medium text-muted-foreground mb-1">Source Name</label>
                        <input
                            type="text"
                            id="source-name"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder={type === 'UPI' ? 'e.g. Personal GPay, Salary account' : 'e.g. HDFC credit card'}
                            className="w-full bg-overlay/30 text-foreground rounded-md p-2 border-border focus:ring-ring focus:border-ring"
                            required
                        />
                    </div>
                    
                    <div>
                        <label htmlFor="source-type" className="block text-sm font-medium text-muted-foreground mb-1">Type</label>
                        <select
                            id="source-type"
                            value={type}
                            onChange={e => setType(e.target.value as PaymentSourceType)}
                            className="w-full bg-overlay/30 text-foreground rounded-md p-2 border-border focus:ring-ring focus:border-ring"
                        >
                            <option value="Credit Card">Credit Card</option>
                            <option value="Debit Card">Debit Card</option>
                            <option value="UPI">UPI</option>
                            <option value="Other">Other</option>
                        </select>
                    </div>

                    <div className="flex justify-end gap-4 pt-4">
                        <button type="button" onClick={handleClose} className="px-4 py-2 bg-foreground/10 text-foreground rounded-md hover:bg-foreground/20">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-gradient-to-br from-primary to-accent text-foreground rounded-md hover:from-primary/90 hover:to-accent/90">Add Source</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default PaymentSourceFormModal;
