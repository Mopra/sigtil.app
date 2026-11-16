import { describe, expect, it } from 'vitest';
import { budgetFrom, isUsedUp, monthOf, nextMonth, USD_DKK } from '@/lib/budget';

describe('budget', () => {
  const now = new Date('2026-11-16T10:00:00Z');

  it('keeps spend by calendar month', () => {
    expect(monthOf(now)).toBe('2026-11');
    expect(monthOf(new Date('2026-12-01T00:00:00Z'))).toBe('2026-12');
    expect(nextMonth(now).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(nextMonth(new Date('2026-12-31T23:59:59Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('shows dollars spent as kroner', () => {
    const budget = budgetFrom(1.5, 70, now);
    expect(budget).toEqual({ spent: Math.round(1.5 * USD_DKK * 100) / 100, limit: 70, resets: '2026-12-01T00:00:00.000Z' });
    expect(isUsedUp(budget)).toBe(false);
  });

  it('is used up at the limit, and at once with no budget', () => {
    expect(isUsedUp(budgetFrom(70 / USD_DKK, 70, now))).toBe(true);
    expect(isUsedUp(budgetFrom(0, 0, now))).toBe(true);
  });
});
