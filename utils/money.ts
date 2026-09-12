import type { Payer } from '../types';

/** Half-up to 2 decimal places via string exponent (not n * 100). */
export function roundToCents(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Number(Math.round(Number(`${n}e2`)) + 'e-2');
}

/**
 * Round a transaction total and each payer amount to cents.
 * Put leftover drift on the last payer so rounded payers still sum to the total.
 */
export function roundMoneyFields(
  amount: number,
  payers?: Payer[]
): { amount: number; payers?: Payer[] } {
  const roundedAmount = roundToCents(amount);
  if (!payers || payers.length === 0) {
    return { amount: roundedAmount, payers };
  }
  const roundedPayers = payers.map((p) => ({
    ...p,
    amount: roundToCents(p.amount),
  }));
  const sum = roundedPayers.reduce((s, p) => s + p.amount, 0);
  const drift = roundToCents(roundedAmount - sum);
  if (drift !== 0) {
    const last = roundedPayers[roundedPayers.length - 1];
    last.amount = roundToCents(last.amount + drift);
  }
  return { amount: roundedAmount, payers: roundedPayers };
}
