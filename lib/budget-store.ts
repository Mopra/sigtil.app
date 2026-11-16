import { eq, sql } from 'drizzle-orm';
import { db, usage, type Site } from './db';
import { budgetFrom, monthOf, type Budget } from './budget';

/** A site's AI spend so far and its budget. */
export async function budgetOf(site: Pick<Site, 'id' | 'budgetDkk'>): Promise<Budget> {
  const [row] = await db
    .select({ costUsd: sql<number>`coalesce(sum(${usage.costUsd}), 0)`.mapWith(Number) })
    .from(usage)
    .where(eq(usage.siteId, site.id));
  return budgetFrom(row?.costUsd ?? 0, site.budgetDkk);
}

/** Add what a chat turn cost to the site's spend. Kept per month, so admin can see when it was spent. */
export async function addSpend(siteId: string, costUsd: number, now = new Date()) {
  if (!(costUsd > 0)) return;
  await db
    .insert(usage)
    .values({ siteId, month: monthOf(now), costUsd })
    // Added in the database, so two turns ending at once both count.
    .onConflictDoUpdate({ target: [usage.siteId, usage.month], set: { costUsd: sql`${usage.costUsd} + ${costUsd}` } });
}
