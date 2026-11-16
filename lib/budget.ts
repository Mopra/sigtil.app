/**
 * What the AI has cost a site, against the site's budget. The budget is a
 * fixed amount that does not start over: when it is spent, the chat waits
 * until the budget is raised in admin. The model provider bills in dollars;
 * editors see Danish kroner.
 */

/** Kroner per dollar. Set a little high by default, so the bar never shows less than was spent. */
export const USD_DKK = Number(process.env.SIGTIL_USD_DKK) || 7;

export type Budget = {
  /** Kroner spent on the AI so far. */
  spent: number;
  /** Kroner the site may spend in all. */
  limit: number;
};

/** The month a date falls in, as spend is saved: "2026-11". Months turn at midnight UTC. */
export function monthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export function budgetFrom(spentUsd: number, limitDkk: number): Budget {
  return { spent: Math.round(spentUsd * USD_DKK * 100) / 100, limit: limitDkk };
}

/** Nothing left to spend: the chat waits for a larger budget, editing in place carries on. */
export function isUsedUp(budget: Budget): boolean {
  return budget.spent >= budget.limit;
}
