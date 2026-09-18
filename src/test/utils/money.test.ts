import { describe, it, expect } from 'vitest';
import { roundToCents, roundMoneyFields, toMinorUnits } from '../../../utils/money';

describe('roundToCents', () => {
  it('rounds 1.005 up to 1.01 (not 1.00 from IEEE * 100)', () => {
    expect(roundToCents(1.005)).toBe(1.01);
  });

  it('rounds 0.005 up to 0.01', () => {
    expect(roundToCents(0.005)).toBe(0.01);
  });

  it('rounds 0.004 down to 0', () => {
    expect(roundToCents(0.004)).toBe(0);
  });
});

describe('toMinorUnits', () => {
  it('uses the same half-up boundary as transaction rounding', () => {
    expect(toMinorUnits(1.005)).toBe(101);
    expect(toMinorUnits(25.5)).toBe(2550);
  });
});

describe('roundMoneyFields', () => {
  it('puts remainder on the last payer so 10.01 with three equal pays still sums', () => {
    const share = 10.01 / 3;
    const { amount, payers } = roundMoneyFields(10.01, [
      { personId: 'a', amount: share },
      { personId: 'b', amount: share },
      { personId: 'c', amount: share },
    ]);
    expect(amount).toBe(10.01);
    const sum = payers!.reduce((s, p) => s + p.amount, 0);
    expect(roundToCents(sum)).toBe(10.01);
  });
});
