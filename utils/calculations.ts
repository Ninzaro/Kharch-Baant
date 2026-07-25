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
        default:
            return { valid: false, reason: 'Unknown split mode' };
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

const BALANCE_EPS = 0.01;

export type SimplifiedTransfer = {
    /** Person who should pay (owes money) */
    from: string;
    /** Person who should receive (is owed) */
    to: string;
    amount: number;
};

/**
 * Greedy min-cash-flow: turn net balances into a minimal set of transfers.
 * Positive balance = is owed money; negative = owes money.
 */
export function simplifyGroupDebts(balances: Map<string, number>): SimplifiedTransfer[] {
    const debtors: { id: string; amount: number }[] = [];
    const creditors: { id: string; amount: number }[] = [];

    balances.forEach((bal, id) => {
        if (bal < -BALANCE_EPS) debtors.push({ id, amount: -bal });
        else if (bal > BALANCE_EPS) creditors.push({ id, amount: bal });
    });

    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    const transfers: SimplifiedTransfer[] = [];
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
        const pay = Math.min(debtors[i].amount, creditors[j].amount);
        if (pay > BALANCE_EPS) {
            transfers.push({
                from: debtors[i].id,
                to: creditors[j].id,
                amount: Math.round(pay * 100) / 100,
            });
        }
        debtors[i].amount -= pay;
        creditors[j].amount -= pay;
        if (debtors[i].amount <= BALANCE_EPS) i += 1;
        if (creditors[j].amount <= BALANCE_EPS) j += 1;
    }
    return transfers;
}

export type UserDebtLine = {
    personId: string;
    groupId: string;
    amount: number;
};

export type UserFacingDebts = {
    /** People who owe the current user (one line per person per group, netted) */
    owedToUser: UserDebtLine[];
    /** People the current user owes (one line per person per group, netted) */
    userOwes: UserDebtLine[];
    totalOwedToUser: number;
    totalUserOwes: number;
    /** totalOwedToUser - totalUserOwes */
    netBalance: number;
};

/**
 * Per-group net balances → simplified transfers → lines involving `currentUserId`.
 * Cards and breakdown modals must use this so totals match.
 */
export function getUserFacingDebts(
    currentUserId: string,
    groups: Array<{ id: string; isArchived?: boolean }>,
    transactions: Transaction[],
): UserFacingDebts {
    const owedToUser: UserDebtLine[] = [];
    const userOwes: UserDebtLine[] = [];

    if (!currentUserId) {
        return {
            owedToUser,
            userOwes,
            totalOwedToUser: 0,
            totalUserOwes: 0,
            netBalance: 0,
        };
    }

    const activeGroups = groups.filter(g => !g.isArchived);
    const txsByGroup = new Map<string, Transaction[]>();
    for (const t of transactions) {
        if (!txsByGroup.has(t.groupId)) txsByGroup.set(t.groupId, []);
        txsByGroup.get(t.groupId)!.push(t);
    }

    for (const group of activeGroups) {
        const groupTxs = txsByGroup.get(group.id) || [];
        if (groupTxs.length === 0) continue;

        const balances = calculateGroupBalances(groupTxs);
        const transfers = simplifyGroupDebts(balances);

        for (const transfer of transfers) {
            if (transfer.to === currentUserId && transfer.amount > BALANCE_EPS) {
                owedToUser.push({
                    personId: transfer.from,
                    groupId: group.id,
                    amount: transfer.amount,
                });
            } else if (transfer.from === currentUserId && transfer.amount > BALANCE_EPS) {
                userOwes.push({
                    personId: transfer.to,
                    groupId: group.id,
                    amount: transfer.amount,
                });
            }
        }
    }

    owedToUser.sort((a, b) => b.amount - a.amount);
    userOwes.sort((a, b) => b.amount - a.amount);

    const totalOwedToUser = owedToUser.reduce((s, x) => s + x.amount, 0);
    const totalUserOwes = userOwes.reduce((s, x) => s + x.amount, 0);

    return {
        owedToUser,
        userOwes,
        totalOwedToUser: Math.round(totalOwedToUser * 100) / 100,
        totalUserOwes: Math.round(totalUserOwes * 100) / 100,
        netBalance: Math.round((totalOwedToUser - totalUserOwes) * 100) / 100,
    };
}

