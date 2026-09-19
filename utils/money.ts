import type { Payer } from '../types';

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Half-up to 2 decimal places via string exponent (not n * 100). */
export function roundToCents(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Number(Math.round(Number(`${n}e2`)) + 'e-2');
}

/** Convert a display-unit amount to an integer number of minor units. */
export function toMinorUnits(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(Number(`${n}e2`));
}

/** True when an amount is finite and already represents whole minor units. */
export function isCentExact(n: number): boolean {
  return Number.isFinite(n) && Number.isInteger(Number(`${n}e2`));
}

/** Reject, rather than silently round, transaction and payer amounts. */
export function assertExactMoneyFields(
  amount: number,
  payers?: Payer[]
): { amount: number; payers?: Payer[] } {
  if (!isCentExact(amount)) {
    throw new Error('Amount must use no more than 2 decimal places.');
  }
  if (!payers || payers.length === 0) {
    return { amount, payers };
  }

  if (payers.some((payer) => !isCentExact(payer.amount))) {
    throw new Error('Payer amounts must use no more than 2 decimal places.');
  }

  const payerTotalMinor = payers.reduce((sum, payer) => sum + toMinorUnits(payer.amount), 0);
  if (payerTotalMinor !== toMinorUnits(amount)) {
    throw new Error('Payer amounts must sum exactly to the transaction amount.');
  }

  return { amount, payers };
}
