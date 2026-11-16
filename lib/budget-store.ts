import { and, eq, sql } from 'drizzle-orm';
import { db, usage, type Site } from './db';
import { budgetFrom, monthOf, type Budget } from './budget';

/** This month's AI spend and budget for a site. */
export async function budgetOf(site: Pick<Site, 'id' | 'monthlyBudgetDkk'>, now = new Date()): Promise<Budget> {
  const [row] = await db
    .select({ costUsd: usage.costUsd })
    .from(usage)
    .where(and(eq(usage.siteId, site.id), eq(usage.month, monthOf(now))));
  return budgetFrom(row?.costUsd ?? 0, site.monthlyBudgetDkk, now);
}

/** Add what a chat turn cost to the site's spend this month. */
export async function addSpend(siteId: string, costUsd: number, now = new Date()) {
  if (!(costUsd > 0)) return;
  await db
    .insert(usage)
    .values({ siteId, month: monthOf(now), costUsd })
    // Added in the database, so two turns ending at once both count.
    .onConflictDoUpdate({ target: [usage.siteId, usage.month], set: { costUsd: sql`${usage.costUsd} + ${costUsd}` } });
}
