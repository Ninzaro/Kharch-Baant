
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Transaction, Person, TAGS, Tag, PaymentSource, SplitMode, Split, SplitParticipant, Payer } from '../types';
import { suggestTagForDescription, getIconForCategory } from '../services/geminiService';
import CalendarModal from './CalendarModal';
import Avatar from './Avatar';
import { CalendarIcon, ChevronRightIcon, DeleteIcon, CheckIcon } from './icons/Icons'; // Assuming CheckIcon exists or I'll implement it

// --- Types & Constants ---

interface TransactionFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (transaction: Omit<Transaction, 'id' | 'groupId'>) => void;
    transaction: Transaction | null;
    people: Person[];
    currentUserId: string;
    paymentSources: PaymentSource[];
    onAddNewPaymentSource: () => void;
    enableCuteIcons: boolean;
}

const splitModes: { id: SplitMode, label: string }[] = [
    { id: 'equal', label: 'Equally' },
    { id: 'unequal', label: 'Unequally' },
    { id: 'percentage', label: 'By %' },
    { id: 'shares', label: 'By Shares' },
];

type StepId = 'amount' | 'description' | 'paidBy' | 'split' | 'category' | 'date' | 'advanced';

// --- Helper Components ---

// 1. Timeline Node & Connector
interface TimelineNodeProps {
    state: 'idle' | 'active' | 'completed' | 'error';
    isLast?: boolean;
    onClick?: () => void;
}

const TimelineNode: React.FC<TimelineNodeProps> = ({ state, isLast, onClick }) => {
    return (
        <div className="flex flex-col items-center mr-4 self-stretch relative">
            {/* The Node */}
            <div
                onClick={onClick}
                className={`
                    w-4 h-4 rounded-full border-2 flex items-center justify-center z-10 transition-all duration-500 cursor-pointer
                    ${state === 'active' ? 'bg-slate-900 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.6)] scale-125' : ''}
                    ${state === 'completed' ? 'bg-indigo-500 border-indigo-500 scale-100' : ''}
                    ${state === 'error' ? 'bg-slate-900 border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.6)] scale-125' : ''}
                    ${state === 'idle' ? 'bg-slate-800 border-slate-600' : ''}
                `}
            >
                {state === 'completed' && <div className="w-1 h-1 bg-white rounded-full" />}
            </div>

            {/* The Line segment below the node */}
            {!isLast && (
                <div className="flex-1 w-0.5 my-1 relative bg-slate-800/50 rounded-full overflow-hidden">
                    <div className={`
                        absolute top-0 left-0 w-full bg-indigo-500 transition-all duration-700 ease-in-out
                        ${state === 'completed' ? 'h-full' : 'h-0'}
                        ${state === 'active' ? 'h-1/3 bg-gradient-to-b from-indigo-500 to-transparent' : ''}
                    `} />
                </div>
            )}
        </div>
    );
};

// --- Main Component ---

const TransactionFormModal: React.FC<TransactionFormModalProps> = ({
    isOpen, onClose, onSave, transaction, people, currentUserId, paymentSources, onAddNewPaymentSource, enableCuteIcons
}) => {
    // --- State ---
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState<number | ''>('');
    const [paidById, setPaidById] = useState(currentUserId);
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [tag, setTag] = useState<Tag>(TAGS[0]);
    const [paymentSourceId, setPaymentSourceId] = useState<string | undefined>(undefined);
    const [comment, setComment] = useState('');

    // UI State
    const [isSuggestingTag, setIsSuggestingTag] = useState(false);
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [activeStep, setActiveStep] = useState<StepId>('amount');
    const [touchedSteps, setTouchedSteps] = useState<Set<StepId>>(new Set());

    // Split State
    const [splitMode, setSplitMode] = useState<SplitMode>('equal');
    const [splitParticipants, setSplitParticipants] = useState<string[]>([]);
    const [customSplitValues, setCustomSplitValues] = useState<Map<string, number>>(new Map());

    // Multiple Payers State
    const [payerMode, setPayerMode] = useState<'single' | 'multiple'>('single');
    const [customPayerValues, setCustomPayerValues] = useState<Map<string, number>>(new Map());


    // Refs
    const amountRef = useRef<HTMLInputElement>(null);
    const descRef = useRef<HTMLInputElement>(null);

    // --- Initialization & Reset ---
    const resetForm = useCallback(() => {
        setDescription('');
        setAmount('');
        setPaidById(currentUserId);
        setDate(new Date().toISOString().split('T')[0]);
        setTag(TAGS[0]);
        const defaultCash = paymentSources.find(p => p.type === 'Cash' && p.isActive !== false);
        setPaymentSourceId(defaultCash?.id);
        setComment('');
        setSplitMode('equal');
        setSplitParticipants(people.map(p => p.id));
        setCustomSplitValues(new Map());
        setPayerMode('single');
        setCustomPayerValues(new Map());
        setActiveStep('amount');
        setTouchedSteps(new Set());
    }, [currentUserId, people, paymentSources]);

    useEffect(() => {
        if (isOpen) {
            if (transaction) {
                // Edit Mode
                setDescription(transaction.description);
                setAmount(transaction.amount);
                setPaidById(transaction.paidById);
                setDate(transaction.date);
                setTag(transaction.tag);
                setPaymentSourceId(transaction.paymentSourceId);
                setComment(transaction.comment || '');
                setSplitMode(transaction.split.mode);
                setSplitParticipants(transaction.split.participants.map(p => p.personId));
                setCustomSplitValues(new Map(transaction.split.participants.map(p => [p.personId, p.value])));

                // Handle Payers
                if (transaction.payers && transaction.payers.length > 0) {
                    setPayerMode('multiple');
                    const pValues = new Map();
                    transaction.payers.forEach(p => pValues.set(p.personId, p.amount));
                    setCustomPayerValues(pValues);
                } else {
                    setPayerMode('single');
                    setCustomPayerValues(new Map());
                }

                setActiveStep('amount'); // Start at top for edits too
                setTouchedSteps(new Set(['amount', 'description', 'split', 'paidBy', 'category', 'date'])); // Assume all touched if Editing
            } else {
                // Create Mode
                resetForm();
                setTimeout(() => amountRef.current?.focus(), 100);
            }
        }
    }, [isOpen, transaction]);

    // Update default payment source when paymentSources change (independent of reset)
    useEffect(() => {
        if (isOpen && !transaction && !paymentSourceId) {
            const cashSource = paymentSources.find(p => p.type === 'Cash' && p.isActive !== false);
            if (cashSource) setPaymentSourceId(cashSource.id);
        }
    }, [paymentSources, isOpen, transaction, paymentSourceId]);


    // --- Logic & Validation ---

    const handleStepFocus = (step: StepId) => {
        setActiveStep(step);
        setTouchedSteps(prev => new Set(prev).add(step));
    };

    const { splitTotal, isSplitValid, validationReason } = useMemo(() => {
        if (splitMode === 'equal' || !amount) {
            return { splitTotal: amount || 0, isSplitValid: splitParticipants.length > 0, validationReason: splitParticipants.length > 0 ? undefined : 'Select participants' };
        }

        const total = Array.from(customSplitValues.entries())
            .filter(([personId]) => splitParticipants.includes(personId))
            .reduce((sum: number, [, value]) => sum + value, 0);

        const numericAmount = Number(amount);

        if (splitMode === 'unequal') {
            const ok = Math.abs(total - numericAmount) < 0.01;
            return { splitTotal: total, isSplitValid: ok, validationReason: ok ? undefined : `Total: ${total.toFixed(2)} / ${numericAmount.toFixed(2)}` };
        }
        if (splitMode === 'percentage') {
            const ok = Math.abs(total - 100) < 0.01;
            return { splitTotal: total, isSplitValid: ok, validationReason: ok ? undefined : `Total: ${total.toFixed(0)}% / 100%` };
        }
        if (splitMode === 'shares') {
            const ok = total > 0;
            return { splitTotal: total, isSplitValid: ok, validationReason: ok ? undefined : 'Must have shares' };
        }
        return { splitTotal: 0, isSplitValid: false, validationReason: 'Invalid' };
    }, [splitMode, customSplitValues, amount, splitParticipants]);

    const { payersTotal, isPayerValid, payerValidationReason } = useMemo(() => {
        if (payerMode === 'single') return { payersTotal: Number(amount), isPayerValid: !!paidById, payerValidationReason: undefined };

        const total = Array.from(customPayerValues.values()).reduce((sum: number, val) => sum + val, 0);
        const numericAmount = Number(amount);
        const isValid = Math.abs(total - numericAmount) < 0.01 && total > 0;

        return {
            payersTotal: total,
            isPayerValid: isValid,
            payerValidationReason: isValid ? undefined : `Total: ${total.toFixed(2)} / ${numericAmount.toFixed(2)}`
        };
    }, [payerMode, paidById, customPayerValues, amount]);

    // Helpers to determine step state
    const getStepState = (step: StepId): 'idle' | 'active' | 'completed' | 'error' => {
        if (activeStep === step) return 'active';

        // Error Conditions
        if (step === 'split' && !isSplitValid && touchedSteps.has('split')) return 'error';

        // Completion Conditions
        if (step === 'amount' && Number(amount) > 0) return 'completed';
        if (step === 'description' && description.trim().length > 0) return 'completed';
        if (step === 'split' && isSplitValid) return 'completed';
        if (step === 'paidBy' && paidById) return 'completed';
        if (step === 'category' && tag) return 'completed';
        if (step === 'date' && date) return 'completed';

        return 'idle';
    };

    // Auto-advance logic
    const handleAmountSubmit = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && Number(amount) > 0) {
            e.preventDefault();
            descRef.current?.focus();
        }
    };

    const handleDescriptionBlur = async () => {
        if (description.trim().length > 3 && !transaction && !tag) {
            setIsSuggestingTag(true);
            const suggestedTag = await suggestTagForDescription(description);
            if (suggestedTag) setTag(suggestedTag as Tag);
            setIsSuggestingTag(false);
        }
        // If we just finished description, split is next logically
        if (activeStep === 'description') handleStepFocus('split');
    };

    // Split Handlers
    const handleParticipantToggle = (personId: string) => {
        setSplitParticipants(prev => {
            const newParticipants = prev.includes(personId) ? prev.filter(id => id !== personId) : [...prev, personId];
            if (splitMode !== 'equal') setCustomSplitValues(new Map()); // Reset custom values on participant change for simplicity
            return newParticipants;
        });
    };
    const handleCustomSplitChange = (personId: string, val: string) => {
        setCustomSplitValues(prev => new Map(prev).set(personId, parseFloat(val) || 0));
    };


    // Submit
    const handleSubmit = (e?: React.FormEvent) => {
        if (e) e.preventDefault();

        if (!isSplitValid || !description || !(Number(amount) > 0) || !paidById || splitParticipants.length === 0) return;

        const baseParticipants = splitParticipants.map(personId => ({
            personId,
            value: customSplitValues.get(personId) || 0,
        }));

        let participants: SplitParticipant[];
        if (splitMode === 'equal') {
            participants = splitParticipants.map(personId => ({ personId, value: 1 }));
        } else if (splitMode === 'shares') {
            participants = baseParticipants.map(p => ({ ...p, value: p.value || 1 }));
        } else {
            participants = baseParticipants;
        }

        // Handle Payers
        let payers: Payer[] | undefined = undefined;
        let finalPaidById = paidById;

        if (payerMode === 'multiple') {
            const activePayers: Payer[] = [];
            people.forEach(p => {
                const val = customPayerValues.get(p.id);
                if (val && val > 0) {
                    activePayers.push({ personId: p.id, amount: val });
                }
            });

            if (activePayers.length === 0) return; // Must have payers

            payers = activePayers;
            // Set primary payer for BC to the one who paid the most or first
            activePayers.sort((a, b) => b.amount - a.amount);
            finalPaidById = activePayers[0].personId;
        } else {
            // Single mode validation
            if (!paidById) return;
        }

        // Cute Icons
        let finalDescription = description.trim();
        if (enableCuteIcons && !transaction) {
            const icon = getIconForCategory(tag);
            if (!/\p{Emoji}$/u.test(finalDescription)) {
                finalDescription = `${finalDescription} ${icon}`;
            }
        }

        onSave({
            description: finalDescription,
            amount: Number(amount),
            paidById: finalPaidById,
            payers,
            date,
            tag,
            paymentSourceId,
            split: { mode: splitMode, participants },
            comment,
            type: transaction?.type ?? 'expense',
        });
    };

    if (!isOpen) return null;

    // --- Render ---

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-lg max-h-[95vh] flex flex-col overflow-hidden">

                {/* Header */}
                <div className="px-6 py-4 border-b border-white/5 bg-white/5 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-white tracking-tight">{transaction ? 'Edit Expense' : 'Add Expense'}</h2>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-white rounded-full hover:bg-white/10 transition-colors">
                        <DeleteIcon className="w-5 h-5" />
                    </button>
                </div>

                {/* Body - Timeline */}
                <div className="flex-1 overflow-y-auto p-6 scroll-smooth">

                    {/* STEP 1: AMOUNT */}
                    <div className="flex group mb-2" onClick={() => handleStepFocus('amount')}>
                        <TimelineNode state={getStepState('amount')} />
                        <div className="flex-1 pb-8">
                            <label className={`block text-xs font-bold uppercase tracking-wider mb-1 transition-colors ${activeStep === 'amount' ? 'text-indigo-400' : 'text-slate-500'}`}>Amount</label>
                            <div className="relative">
                                <span className={`absolute left-0 top-1/2 -translate-y-1/2 text-3xl font-light transition-colors ${activeStep === 'amount' ? 'text-indigo-300' : 'text-slate-600'}`}>₹</span>
                                <input
                                    ref={amountRef}
                                    type="number"
                                    value={amount}
                                    onChange={e => setAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
                                    onFocus={() => handleStepFocus('amount')}
                                    onKeyDown={handleAmountSubmit}
                                    className="w-full bg-transparent text-5xl font-bold p-0 pl-10 border-none focus:ring-0 placeholder-slate-800 outline-none text-white transition-all"
                                    placeholder="0"
                                    autoFocus
                                />
                            </div>
                        </div>
                    </div>

                    {/* STEP 2: DESCRIPTION */}
                    <div className="flex group mb-2" onClick={() => handleStepFocus('description')}>
                        <TimelineNode state={getStepState('description')} />
                        <div className="flex-1 pb-8">
                            <label className={`block text-xs font-bold uppercase tracking-wider mb-1 transition-colors ${activeStep === 'description' ? 'text-indigo-400' : 'text-slate-500'}`}>What's this for?</label>
                            <input
                                ref={descRef}
                                type="text"
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                onFocus={() => handleStepFocus('description')}
                                onBlur={handleDescriptionBlur}
                                className={`w-full bg-black/20 text-lg rounded-xl p-3 border transition-all ${activeStep === 'description' ? 'border-indigo-500 ring-1 ring-indigo-500/50' : 'border-slate-800 text-slate-300'}`}
                                placeholder="e.g. Train Tickets, Dinner..."
                            />
                        </div>
                    </div>

                    {/* STEP 3: PAID BY */}
                    <div className="flex group mb-2" onClick={() => handleStepFocus('paidBy')}>
                        <TimelineNode state={getStepState('paidBy')} />
                        <div className="flex-1 pb-8">
                            <div className="flex justify-between items-center mb-2">
                                <label className={`block text-xs font-bold uppercase tracking-wider transition-colors ${activeStep === 'paidBy' ? 'text-indigo-400' : 'text-slate-500'}`}>Who Paid?</label>
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setPayerMode(m => m === 'single' ? 'multiple' : 'single'); handleStepFocus('paidBy'); }}
                                    className="text-[10px] px-2 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-full hover:bg-indigo-500/20 transition-colors"
                                >
                                    {payerMode === 'single' ? 'Multiple Payers?' : 'Single Payer'}
                                </button>
                            </div>

                            <div className={`bg-black/20 rounded-xl p-3 border transition-all ${activeStep === 'paidBy' ? 'border-indigo-500/50' : 'border-slate-800'}`}>
                                {payerMode === 'single' ? (
                                    <div className="grid grid-cols-2 gap-2">
                                        {people.map(p => {
                                            const isSelected = paidById === p.id;
                                            return (
                                                <button
                                                    key={p.id}
                                                    type="button"
                                                    onClick={() => { setPaidById(p.id); handleStepFocus('split'); }}
                                                    className={`flex items-center gap-2 p-2 rounded-lg border transition-all ${isSelected ? 'bg-indigo-600/20 border-indigo-500 ring-1 ring-indigo-500/50' : 'bg-slate-800/50 border-transparent hover:bg-white/5 text-slate-400'}`}
                                                >
                                                    <Avatar person={p} size="xs" />
                                                    <span className={`text-xs font-medium truncate ${isSelected ? 'text-white' : ''}`}>{p.name}</span>
                                                    {isSelected && <CheckIcon className="w-3 h-3 ml-auto text-indigo-400" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        <div className={`text-[10px] font-bold uppercase tracking-tight mb-2 ${isPayerValid ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {isPayerValid ? `Total: ₹${payersTotal.toFixed(2)}` : payerValidationReason || 'Total must match amount'}
                                        </div>
                                        {people.map(p => {
                                            const val = customPayerValues.get(p.id) || 0;
                                            return (
                                                <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg bg-white/5 border border-transparent">
                                                    <Avatar person={p} size="xs" />
                                                    <span className="flex-1 text-xs text-slate-300 truncate">{p.name}</span>
                                                    <div className="relative w-24">
                                                        <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">₹</span>
                                                        <input
                                                            type="number"
                                                            value={val || ''}
                                                            placeholder="0"
                                                            onChange={e => {
                                                                const v = parseFloat(e.target.value) || 0;
                                                                setCustomPayerValues(prev => new Map(prev).set(p.id, v));
                                                            }}
                                                            className="w-full bg-black/40 text-right text-xs text-white rounded p-1 pl-4 border border-slate-700 focus:border-indigo-500 outline-none"
                                                        />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* STEP 4: SPLIT */}
                    <div className="flex group mb-2" onClick={() => handleStepFocus('split')}>
                        <TimelineNode state={getStepState('split')} />
                        <div className="flex-1 pb-8">
                            <div className="flex justify-between items-center mb-2">
                                <label className={`block text-xs font-bold uppercase tracking-wider transition-colors ${activeStep === 'split' ? 'text-indigo-400' : 'text-slate-500'}`}>Split With</label>
                                {!isSplitValid && amount && touchedSteps.has('split') && (
                                    <span className="text-xs font-bold text-rose-500 animate-pulse">{validationReason}</span>
                                )}
                                {isSplitValid && splitMode === 'unequal' && amount && (
                                    <span className="text-xs font-medium text-emerald-400">All allocated</span>
                                )}
                            </div>

                            <div className={`bg-black/20 rounded-xl p-3 border transition-all ${activeStep === 'split' ? 'border-indigo-500/50' : 'border-slate-800'}`}>
                                {/* Mode Selector */}
                                <div className="flex flex-wrap gap-2 mb-4">
                                    {splitModes.map(mode => (
                                        <button
                                            key={mode.id}
                                            onClick={(e) => { e.stopPropagation(); setSplitMode(mode.id); handleStepFocus('split'); }}
                                            type="button"
                                            className={`px-3 py-1.5 text-[10px] uppercase font-bold tracking-wider rounded-lg transition-all ${splitMode === mode.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                                        >
                                            {mode.label}
                                        </button>
                                    ))}
                                </div>

                                {/* Participants & Inputs */}
                                <div className="space-y-1.5">
                                    {people.map(p => {
                                        const isSelected = splitParticipants.includes(p.id);
                                        const inputType = splitMode === 'unequal' ? 'number' : 'text';
                                        const showInput = splitMode !== 'equal';

                                        return (
                                            <div
                                                key={p.id}
                                                className={`flex items-center gap-3 p-2 rounded-lg transition-colors cursor-pointer ${isSelected ? 'bg-indigo-900/20' : 'hover:bg-white/5'}`}
                                                onClick={() => handleParticipantToggle(p.id)}
                                            >
                                                {/* Checkbox (Visual) */}
                                                <div className={`w-4 h-4 rounded flex items-center justify-center border transition-colors ${isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-slate-600'}`}>
                                                    {isSelected && <CheckIcon className="w-2.5 h-2.5 text-white" />}
                                                </div>

                                                <Avatar person={p} size="xs" />
                                                <span className={`flex-1 text-xs font-medium ${isSelected ? 'text-white' : 'text-slate-500'}`}>{p.name}</span>

                                                {/* Inline Input for Advanced Splits */}
                                                {showInput && isSelected && (
                                                    <div className="relative w-24">
                                                        <input
                                                            type={inputType}
                                                            value={customSplitValues.get(p.id) || ''}
                                                            onChange={e => handleCustomSplitChange(p.id, e.target.value)}
                                                            onClick={e => e.stopPropagation()}
                                                            className="w-full bg-black/40 text-right text-xs text-white rounded p-1 border border-slate-700 focus:border-indigo-500 outline-none"
                                                            placeholder={splitMode === 'shares' ? "1" : "0"}
                                                        />
                                                        {splitMode === 'percentage' && <span className="absolute right-7 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">%</span>}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* STEP 5: DETAILS (Category + Date) */}
                    <div className="flex group mb-2">
                        {/* Shared Node based on composite state */}
                        <TimelineNode state={
                            (activeStep === 'category' || activeStep === 'date') ? 'active' :
                                (tag && date) ? 'completed' : 'idle'
                        } />

                        <div className="flex-1 pb-8 grid grid-cols-2 gap-4">
                            {/* Category */}
                            <div onClick={() => handleStepFocus('category')}>
                                <div className="flex justify-between mb-1">
                                    <label className={`block text-[10px] font-bold uppercase tracking-wider ${activeStep === 'category' ? 'text-indigo-400' : 'text-slate-500'}`}>Category</label>
                                    {isSuggestingTag && <span className="text-[10px] text-indigo-400 animate-pulse">AI suggestion...</span>}
                                </div>
                                <select
                                    value={tag}
                                    onChange={e => { setTag(e.target.value as Tag); handleStepFocus('category'); }}
                                    className={`w-full bg-black/20 text-xs rounded-xl p-2.5 border transition-all appearance-none ${activeStep === 'category' ? 'border-indigo-500' : 'border-slate-800'}`}
                                >
                                    {TAGS.map(t => <option key={t} value={t} className="bg-slate-900 text-white">{t}</option>)}
                                </select>
                            </div>

                            {/* Date */}
                            <div onClick={() => handleStepFocus('date')}>
                                <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${activeStep === 'date' ? 'text-indigo-400' : 'text-slate-500'}`}>Date</label>
                                <button
                                    type="button"
                                    onClick={() => { setIsCalendarOpen(true); handleStepFocus('date'); }}
                                    className={`w-full text-left bg-black/20 text-xs rounded-xl p-2.5 border transition-all flex justify-between items-center ${activeStep === 'date' ? 'border-indigo-500' : 'border-slate-800 text-slate-300'}`}
                                >
                                    <span className="truncate">{new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                    <CalendarIcon className="w-3.5 h-3.5 text-slate-500 shrink-0 ml-1" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* STEP 6: ADVANCED (Last Node) */}
                    <div className="flex group mb-2" onClick={() => handleStepFocus('advanced')}>
                        <TimelineNode state={activeStep === 'advanced' ? 'active' : 'idle'} isLast={true} />
                        <div className="flex-1">
                            <div
                                className="flex items-center gap-2 cursor-pointer mb-4"
                                onClick={() => handleStepFocus('advanced')}
                            >
                                <label className={`cursor-pointer text-xs font-bold uppercase tracking-wider transition-colors ${activeStep === 'advanced' ? 'text-indigo-400' : 'text-slate-500'}`}>Advanced Options</label>
                                <ChevronRightIcon className={`w-4 h-4 text-slate-500 transition-transform ${activeStep === 'advanced' ? 'rotate-90' : ''}`} />
                            </div>

                            {activeStep === 'advanced' && (
                                <div className="space-y-4 animate-in slide-in-from-top-2">
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Note / Comment</label>
                                        <textarea
                                            value={comment}
                                            onChange={e => setComment(e.target.value)}
                                            className="w-full bg-black/20 text-sm rounded-xl p-3 border border-slate-800 focus:border-indigo-500 outline-none"
                                            rows={2}
                                            placeholder="Details..."
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Payment Method</label>
                                        <select
                                            value={paymentSourceId || ''}
                                            onChange={e => e.target.value === 'add_new' ? onAddNewPaymentSource() : setPaymentSourceId(e.target.value || undefined)}
                                            className="w-full bg-black/20 text-sm rounded-xl p-3 border border-slate-800 focus:border-indigo-500 outline-none"
                                        >
                                            <option value="">None</option>
                                            {paymentSources.map(ps => <option key={ps.id} value={ps.id}>{ps.name}</option>)}
                                            <option value="add_new" className="text-indigo-400 font-semibold">+ Add New</option>
                                        </select>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                </div>

                {/* Footer */}
                <div className="p-4 border-t border-white/5 bg-slate-900/80 backdrop-blur-xl flex justify-between items-center z-20">
                    <div className="text-sm">
                        {amount && paidById === currentUserId ? (
                            <span className="text-slate-400">You paid <span className="text-white font-bold">₹{Number(amount).toFixed(0)}</span></span>
                        ) : (
                            <span className="text-slate-500 italic">Draft Expense</span>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <button onClick={onClose} className="px-5 py-2.5 text-sm font-medium text-slate-400 hover:text-white transition-colors">Cancel</button>
                        <button
                            onClick={() => handleSubmit()}
                            disabled={!isSplitValid || !description || !amount}
                            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-xl shadow-lg shadow-indigo-500/20 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 disabled:shadow-none"
                        >
                            Save
                        </button>
                    </div>
                </div>

            </div>
            <CalendarModal isOpen={isCalendarOpen} onClose={() => setIsCalendarOpen(false)} selectedDate={date} onDateSelect={(d) => { setDate(d); setIsCalendarOpen(false); }} />
        </div>
    );
};

export default TransactionFormModal;