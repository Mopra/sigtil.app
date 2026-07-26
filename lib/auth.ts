import { auth, currentUser } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { db, siteMembers, sites, users, type Site, type User } from './db';

/**
 * Resolve the signed-in Clerk account to a sigtil user.
 *
 * Access is invite-only: admins add users by email in /admin, and the first
 * Clerk sign-in with that email links the account (clerkId) to the invited
 * row. A Clerk session without an invited row returns null.
 *
 * Bootstrap: while the users table is empty, the email in SIGTIL_ADMIN_EMAIL
 * becomes the admin on first sign-in.
 */
export async function getUser(): Promise<User | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const [linked] = await db.select().from(users).where(eq(users.clerkId, userId));
  if (linked) return linked;

  const clerkUser = await currentUser();
  const email = clerkUser?.primaryEmailAddress?.emailAddress.toLowerCase();
  if (!email) return null;

  const [invited] = await db.select().from(users).where(eq(users.email, email));
  if (invited && !invited.clerkId) {
    const [linkedNow] = await db
      .update(users)
      .set({ clerkId: userId })
      .where(eq(users.id, invited.id))
      .returning();
    return linkedNow;
  }

  const adminEmail = process.env.SIGTIL_ADMIN_EMAIL?.toLowerCase();
  if (adminEmail && email === adminEmail) {
    const existing = await db.select({ id: users.id }).from(users).limit(1);
    if (existing.length === 0) {
      const name =
        [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ') || 'Admin';
      const [admin] = await db
        .insert(users)
        .values({ name, email, clerkId: userId, role: 'admin' })
        .returning();
      return admin;
    }
  }

  return null;
}

/** Sites the user may edit (admins see all active sites). */
export async function sitesForUser(user: User): Promise<Site[]> {
  if (user.role === 'admin') {
    return db.select().from(sites).where(eq(sites.active, true));
  }
  const rows = await db
    .select({ site: sites })
    .from(siteMembers)
    .innerJoin(sites, eq(siteMembers.siteId, sites.id))
    .where(and(eq(siteMembers.userId, user.id), eq(sites.active, true)));
  return rows.map(r => r.site);
}

/** Load a site only if the user has access to it. */
export async function siteForUser(user: User, siteId: string): Promise<Site | null> {
  const all = await sitesForUser(user);
  return all.find(s => s.id === siteId) ?? null;
}
