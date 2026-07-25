import React, { useMemo, useRef, useState } from 'react';
import BaseModal from './BaseModal';
import { Transaction, Person, Currency, Tag } from '../types';
import html2canvas from 'html2canvas';

interface GroupSummaryModalProps {
    isOpen: boolean;
    onClose: () => void;
    groupName: string;
    transactions: Transaction[];
    people: Person[];
    currency: Currency;
}

/** Chart series from design tokens (resolved at use time for light/dark). */
const chartTokenVars = [
  '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--chart-7',
] as const;

function resolveChartColors(): string[] {
  if (typeof document === 'undefined') {
    return chartTokenVars.map(() => 'hsl(239 84% 67%)');
  }
  const styles = getComputedStyle(document.documentElement);
  return chartTokenVars.map((v) => {
    const raw = styles.getPropertyValue(v).trim();
    return raw ? `hsl(${raw})` : 'hsl(239 84% 67%)';
  });
}

function resolveCssColor(token: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return raw ? `hsl(${raw})` : fallback;
}

const GroupSummaryModal: React.FC<GroupSummaryModalProps> = ({ isOpen, onClose, groupName, transactions, people, currency }) => {
    const summaryRef = useRef<HTMLDivElement>(null);
    const [isSharing, setIsSharing] = useState(false);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency }).format(amount);
    };

    // Calculate Totals
    const { totalSpent, byPayer, byCategory } = useMemo(() => {
        let total = 0;
        const payerMap = new Map<string, number>();
        const categoryMap = new Map<Tag, number>();

        transactions.forEach(t => {
            if (t.type === 'settlement') return; // Exclude settlements from spending

            total += t.amount;

            // Payer (handle multiple payers if implemented, or fallback)
            // Existing logic: "paidById" is primary, "payers" is detailed
            if (t.payers && t.payers.length > 0) {
                t.payers.forEach(p => {
                    payerMap.set(p.personId, (payerMap.get(p.personId) || 0) + p.amount);
                });
            } else {
                payerMap.set(t.paidById, (payerMap.get(t.paidById) || 0) + t.amount);
            }

            // Category
            categoryMap.set(t.tag, (categoryMap.get(t.tag) || 0) + t.amount);
        });

        // Convert to arrays for charts
        const payers = Array.from(payerMap.entries())
            .map(([id, amount]) => ({
                id,
                name: people.find(p => p.id === id)?.name || 'Unknown',
                amount
            }))
            .sort((a, b) => b.amount - a.amount);

        const categories = Array.from(categoryMap.entries())
            .map(([tag, amount]) => ({ tag, amount }))
            .sort((a, b) => b.amount - a.amount);

        return { totalSpent: total, byPayer: payers, byCategory: categories };
    }, [transactions, people]);

    const handleShare = async () => {
        if (!summaryRef.current) return;
        setIsSharing(true);
        try {
            const canvas = await html2canvas(summaryRef.current, {
                backgroundColor: resolveCssColor('--card', 'hsl(217 33% 14%)'),
                scale: 2 // High res
            });

            canvas.toBlob(async (blob) => {
                if (!blob) return;

                // Try native share
                const file = new File([blob], `summary-${groupName.replace(/\s+/g, '-').toLowerCase()}.png`, { type: 'image/png' });
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({
                            files: [file],
                            title: `${groupName} Expense Summary`,
                            text: `Here's the expense summary for ${groupName}. Total Spent: ${formatCurrency(totalSpent)}`
                        });
                    } catch (err) {
                        console.error('Share failed', err);
                        // Fallback to download
                        saveAsImage(canvas);
                    }
                } else {
                    saveAsImage(canvas);
                }
            });
        } catch (err) {
            console.error('Generation failed', err);
        } finally {
            setIsSharing(false);
        }
    };

    const saveAsImage = (canvas: HTMLCanvasElement) => {
        const link = document.createElement('a');
        link.download = `summary-${groupName}.png`;
        link.href = canvas.toDataURL();
        link.click();
    };

    const maxPayerAmount = byPayer.length > 0 ? byPayer[0].amount : 0;

    // Helper for donut (simple CSS conic gradient from design tokens)
    const donutGradient = useMemo(() => {
        const muted = resolveCssColor('--muted', 'hsl(217 33% 17%)');
        if (totalSpent === 0) return `conic-gradient(${muted} 0% 100%)`;

        const colors = resolveChartColors();
        let gradientStr = 'conic-gradient(';
        let currentDeg = 0;

        byCategory.forEach((cat, index) => {
            const deg = (cat.amount / totalSpent) * 360;
            const color = colors[index % colors.length];
            gradientStr += `${color} ${currentDeg}deg ${currentDeg + deg}deg, `;
            currentDeg += deg;
        });

        return gradientStr.slice(0, -2) + ')';
    }, [byCategory, totalSpent]);

    return (
        <BaseModal
            open={isOpen}
            onClose={onClose}
            title={`${groupName} Summary`}
            description={<span className="text-muted-foreground">Expense analysis and breakdown</span>}
            size="lg"
            footer={
                <div className="flex justify-between w-full">
                    <button onClick={onClose} className="px-4 py-2 text-muted-foreground hover:bg-foreground/5 rounded-lg transition-colors">
                        Close
                    </button>
                    <button
                        onClick={handleShare}
                        disabled={isSharing}
                        className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors font-medium shadow-lg shadow-primary/20"
                    >
                        {isSharing ? 'Generating...' : (
                            <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                                </svg>
                                Share Summary
                            </>
                        )}
                    </button>
                </div>
            }
        >
            <div ref={summaryRef} className="p-6 bg-background rounded-xl space-y-8">
                {/* Header for Image Capture */}
                <div className="text-center space-y-1 mb-6">
                    <p className="text-muted-foreground uppercase tracking-widest text-xs font-bold">Total Group Spending</p>
                    <h2 className="text-4xl font-bold text-foreground tracking-tight">{formatCurrency(totalSpent)}</h2>
                    <p className="text-muted-foreground text-sm">across {transactions.filter(t => t.type !== 'settlement').length} transactions</p>
                </div>

                <div className="grid md:grid-cols-2 gap-8">
                    {/* Visual 1: Who Paid (Bar) */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                            <span className="p-1.5 bg-primary/20 rounded-md text-primary">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                            </span>
                            Who Paid What
                        </h3>
                        <div className="space-y-3">
                            {byPayer.map((payer, idx) => (
                                <div key={payer.id} className="group">
                                    <div className="flex justify-between text-sm mb-1">
                                        <span className="text-muted-foreground font-medium">{payer.name}</span>
                                        <span className="text-muted-foreground">{formatCurrency(payer.amount)}</span>
                                    </div>
                                    <div className="h-2.5 bg-card rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-500"
                                            style={{ width: `${maxPayerAmount > 0 ? (payer.amount / maxPayerAmount) * 100 : 0}%` }}
                                        ></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Visual 2: Categories (Donut & List) */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                            <span className="p-1.5 bg-success/20 rounded-md text-success">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
                            </span>
                            Category Breakdown
                        </h3>
                        {totalSpent > 0 ? (
                            <div className="flex items-start gap-6">
                                {/* Donut Chart */}
                                <div className="relative w-32 h-32 flex-shrink-0">
                                    <div
                                        className="w-full h-full rounded-full"
                                        style={{ background: donutGradient }}
                                    ></div>
                                    <div className="absolute inset-4 bg-background rounded-full flex items-center justify-center">
                                        <span className="text-xs text-muted-foreground font-medium">Top categories</span>
                                    </div>
                                </div>

                                {/* Legend */}
                                <div className="flex-1 space-y-2 min-w-0">
                                    {byCategory.slice(0, 5).map((cat, idx) => (
                                        <div key={cat.tag} className="flex items-center justify-between text-sm">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: resolveChartColors()[idx % chartTokenVars.length] }}></div>
                                                <span className="text-muted-foreground capitalize truncate">{cat.tag}</span>
                                            </div>
                                            <span className="text-muted-foreground ml-2">{getPercentage(cat.amount, totalSpent)}</span>
                                        </div>
                                    ))}
                                    {byCategory.length > 5 && (
                                        <p className="text-xs text-muted-foreground pl-4.5 pt-1 italic">
                                            + {byCategory.length - 5} more...
                                        </p>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <p className="text-muted-foreground text-sm italic py-8 text-center">No expenses yet.</p>
                        )}
                    </div>
                </div>

                <div className="pt-6 border-t border-border flex justify-center">
                    <p className="text-xs text-muted-foreground font-mono">Generated by Kharch Baant</p>
                </div>
            </div>
        </BaseModal>
    );
};

// Helper
const getPercentage = (val: number, total: number) => {
    if (total === 0) return '0%';
    return Math.round((val / total) * 100) + '%';
};

export default GroupSummaryModal;
