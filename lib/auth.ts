import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { db, siteMembers, sites, users, type Site, type User } from './db';

const COOKIE = 'sigtil_session';
const SESSION_DAYS = 90;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set');
  return s;
}

export function hashCode(code: string) {
  return createHash('sha256').update(code.trim()).digest('hex');
}

function sign(payload: string) {
  return createHmac('sha256', secret()).update(payload).digest('hex');
}

export async function createSession(userId: string) {
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${userId}.${expires}`;
  const token = `${payload}.${sign(payload)}`;
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: new Date(expires),
    path: '/',
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function getUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expires, sig] = parts;
  const expected = sign(`${userId}.${expires}`);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(expires) < Date.now()) return null;
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  return user ?? null;
}

/** Login with a personal code; returns the user or null. */
export async function loginWithCode(code: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.codeHash, hashCode(code)));
  if (!user) return null;
  await createSession(user.id);
  return user;
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
