'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db, siteMembers, sites, users } from '@/lib/db';
import { encryptSecret } from '@/lib/db/crypto';
import { getUser } from '@/lib/auth';

async function requireAdmin() {
  const user = await getUser();
  if (!user || user.role !== 'admin') redirect('/sign-in');
  return user;
}

export async function createSite(formData: FormData) {
  await requireAdmin();
  await db.insert(sites).values({
    name: String(formData.get('name')),
    repoOwner: String(formData.get('repoOwner')).trim(),
    repoName: String(formData.get('repoName')).trim(),
    githubToken: encryptSecret(String(formData.get('githubToken')).trim()),
    vercelProjectId: String(formData.get('vercelProjectId')).trim(),
    vercelTeamId: String(formData.get('vercelTeamId') ?? '').trim() || null,
    productionUrl: String(formData.get('productionUrl')).trim().replace(/\/$/, ''),
    siteNotes: String(formData.get('siteNotes') ?? ''),
  });
  revalidatePath('/admin');
}

export async function createUser(formData: FormData) {
  await requireAdmin();
  const role = String(formData.get('role')) === 'admin' ? 'admin' : 'editor';
  await db.insert(users).values({
    name: String(formData.get('name')),
    email: String(formData.get('email')).trim().toLowerCase(),
    role,
  });
  revalidatePath('/admin');
}

export async function addMember(formData: FormData) {
  await requireAdmin();
  await db
    .insert(siteMembers)
    .values({
      siteId: String(formData.get('siteId')),
      userId: String(formData.get('userId')),
    })
    .onConflictDoNothing();
  revalidatePath('/admin');
}
