import { describe, expect, it } from 'vitest';
import { budgetFrom, isUsedUp, monthOf, USD_DKK } from '@/lib/budget';

describe('budget', () => {
  it('saves spend by calendar month', () => {
    expect(monthOf(new Date('2026-11-16T10:00:00Z'))).toBe('2026-11');
    expect(monthOf(new Date('2026-12-01T00:00:00Z'))).toBe('2026-12');
  });

  it('shows dollars spent as kroner', () => {
    const budget = budgetFrom(1.5, 70);
    expect(budget).toEqual({ spent: Math.round(1.5 * USD_DKK * 100) / 100, limit: 70 });
    expect(isUsedUp(budget)).toBe(false);
  });

  it('is used up at the limit, and at once with no budget', () => {
    expect(isUsedUp(budgetFrom(70 / USD_DKK, 70))).toBe(true);
    expect(isUsedUp(budgetFrom(0, 0))).toBe(true);
  });
});
