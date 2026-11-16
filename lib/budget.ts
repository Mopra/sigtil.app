/**
 * What the AI has cost a site this month, against the site's monthly budget.
 * The model provider bills in dollars; editors see Danish kroner.
 */

/** Kroner per dollar. Set a little high by default, so the bar never shows less than was spent. */
export const USD_DKK = Number(process.env.SIGTIL_USD_DKK) || 7;

export type Budget = {
  /** Kroner spent on the AI this month. */
  spent: number;
  /** Kroner the site may spend in a month. */
  limit: number;
  /** When the month, and with it the spend, starts over (ISO date). */
  resets: string;
};

/** The month a date falls in, as it is saved: "2026-11". Months turn at midnight UTC. */
export function monthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** The first moment of the month after `date`. */
export function nextMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

export function budgetFrom(spentUsd: number, limitDkk: number, now: Date): Budget {
  return { spent: Math.round(spentUsd * USD_DKK * 100) / 100, limit: limitDkk, resets: nextMonth(now).toISOString() };
}

/** Nothing left to spend: the chat waits for next month, editing in place carries on. */
export function isUsedUp(budget: Budget): boolean {
  return budget.spent >= budget.limit;
}
