import { describe, it, expect } from 'vitest';
import { assertExactMoneyFields, isCentExact, roundToCents, toMinorUnits } from '../../../utils/money';

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

describe('exact minor-unit validation', () => {
  it('identifies values that are already cent-exact', () => {
    expect(isCentExact(10.01)).toBe(true);
    expect(isCentExact(33.334)).toBe(false);
  });

  it('rejects sub-cent transaction and payer amounts instead of rounding them', () => {
    expect(() => assertExactMoneyFields(0.005)).toThrow(/2 decimal places/);
    expect(() => assertExactMoneyFields(100, [
      { personId: 'a', amount: 33.334 },
      { personId: 'b', amount: 66.666 },
    ])).toThrow(/Payer amounts/);
  });

  it('requires payer minor units to sum exactly to the transaction amount', () => {
    expect(() => assertExactMoneyFields(10.01, [
      { personId: 'a', amount: 5 },
      { personId: 'b', amount: 5 },
    ])).toThrow(/sum exactly/);

    expect(assertExactMoneyFields(10.01, [
      { personId: 'a', amount: 5 },
      { personId: 'b', amount: 5.01 },
    ])).toEqual({
      amount: 10.01,
      payers: [
        { personId: 'a', amount: 5 },
        { personId: 'b', amount: 5.01 },
      ],
    });
  });
});
