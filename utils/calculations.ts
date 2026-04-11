import { Transaction, SplitMode, SplitParticipant } from '../types';

// Net balance per person across all transactions. Positive = is owed money, negative = owes money.
export function calculateGroupBalances(transactions: Transaction[]): Map<string, number> {
    const balances = new Map<string, number>();

    for (const t of transactions) {
        if (t.payers && t.payers.length > 0) {
            for (const payer of t.payers) {
                balances.set(payer.personId, (balances.get(payer.personId) ?? 0) + payer.amount);
            }
        } else {
            balances.set(t.paidById, (balances.get(t.paidById) ?? 0) + t.amount);
        }

        const shares = calculateShares(t);
        shares.forEach((shareAmount, personId) => {
            balances.set(personId, (balances.get(personId) ?? 0) - shareAmount);
        });
    }

    return balances;
}

/**
 * Calculates the amount each person owes for a given transaction based on its split mode.
 * @param transaction The transaction object.
 * @returns A Map where keys are person IDs and values are the amounts they owe.
 */
export const calculateShares = (transaction: Transaction): Map<string, number> => {
    const shares = new Map<string, number>();
    const { amount, split } = transaction;
    const { mode, participants } = split;

    if (participants.length === 0 || amount === 0) {
        return shares;
    }

    switch (mode) {
        case 'equal': {
            const shareAmount = amount / participants.length;
            participants.forEach(p => {
                shares.set(p.personId, shareAmount);
            });
            break;
        }
        case 'unequal': {
            participants.forEach(p => {
                shares.set(p.personId, p.value);
            });
            break;
        }
        case 'percentage': {
            participants.forEach(p => {
                const shareAmount = amount * (p.value / 100);
                shares.set(p.personId, shareAmount);
            });
            break;
        }
        case 'shares': {
            const totalShares = participants.reduce((sum, p) => sum + p.value, 0);
            if (totalShares === 0) break;
            const valuePerShare = amount / totalShares;
            participants.forEach(p => {
                shares.set(p.personId, p.value * valuePerShare);
            });
            break;
        }
    }
    return shares;
};

/**
 * Round a list of fractional amounts so their sum equals the original total.
 * Uses largest remainder method; stable for up to a few hundred participants.
 */
export const distributeRounding = (rawShares: number[], total: number): number[] => {
    const scale = 100; // work in cents (2 decimal places)
    const floored = rawShares.map(v => Math.floor(v * scale));
    const remainderTotal = Math.round(total * scale) - floored.reduce((a,b)=>a+b,0);
    if (remainderTotal === 0) return floored.map(v => v / scale);
    // Pair each remainder with index
    const remainders = rawShares.map((v,i) => ({ i, frac: (v * scale) - Math.floor(v * scale) }));
    remainders.sort((a,b) => b.frac - a.frac); // largest fractional parts first
    for (let k = 0; k < remainderTotal; k++) {
        floored[remainders[k].i] += 1;
    }
    return floored.map(v => v / scale);
};

/** Validate split integrity based on mode and participants */
export function validateSplit(mode: SplitMode, amount: number, participants: SplitParticipant[]): { valid: boolean; reason?: string } {
    if (!amount || amount <= 0) return { valid: false, reason: 'Amount must be > 0' };
    if (participants.length === 0) return { valid: false, reason: 'At least one participant required' };
    switch (mode) {
        case 'equal':
            return { valid: true };
        case 'unequal': {
            const sum = participants.reduce((s,p)=> s + p.value, 0);
            if (Math.abs(sum - amount) > 0.01) return { valid: false, reason: `Unequal shares (${sum.toFixed(2)}) must total amount (${amount.toFixed(2)})` };
            return { valid: true };
        }
        case 'percentage': {
            const sumPct = participants.reduce((s,p)=> s + p.value, 0);
            if (Math.abs(sumPct - 100) > 0.01) return { valid: false, reason: `Percentages (${sumPct.toFixed(2)}%) must total 100%` };
            return { valid: true };
        }
        case 'shares': {
            const totalShares = participants.reduce((s,p)=> s + p.value, 0);
            if (totalShares <= 0) return { valid: false, reason: 'Total shares must be > 0' };
            return { valid: true };
        }
    }
}

/** Normalize equal/shares splits to concrete monetary amounts (rounded) */
export function materializeSplit(mode: SplitMode, amount: number, participants: SplitParticipant[]): Map<string, number> {
    const map = new Map<string, number>();
    if (participants.length === 0) return map;
    if (mode === 'equal') {
        const raw = participants.map(()=> amount / participants.length);
        const rounded = distributeRounding(raw, amount);
        rounded.forEach((v, idx) => map.set(participants[idx].personId, v));
        return map;
    }
    if (mode === 'shares') {
        const totalShares = participants.reduce((s,p)=> s + p.value, 0);
        if (totalShares === 0) return map;
        const raw = participants.map(p => amount * (p.value / totalShares));
        const rounded = distributeRounding(raw, amount);
        rounded.forEach((v, idx) => map.set(participants[idx].personId, v));
        return map;
    }
    if (mode === 'percentage') {
        const raw = participants.map(p => amount * (p.value / 100));
        const rounded = distributeRounding(raw, amount);
        rounded.forEach((v, idx) => map.set(participants[idx].personId, v));
        return map;
    }
    // unequal already concrete values; small normalization for rounding mismatch
    if (mode === 'unequal') {
        const sum = participants.reduce((s,p)=> s + p.value, 0);
        const adjust = amount - sum;
        participants.forEach(p => map.set(p.personId, p.value));
        if (Math.abs(adjust) >= 0.01) {
            // Shift adjustment to first participant
            const firstId = participants[0].personId;
            map.set(firstId, (map.get(firstId) || 0) + adjust);
        }
        return map;
    }
    return map;
}

