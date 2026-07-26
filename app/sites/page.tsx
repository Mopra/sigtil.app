import Link from 'next/link';
import { redirect } from 'next/navigation';
import { destroySession, getUser, sitesForUser } from '@/lib/auth';
import { t } from '@/lib/strings';

async function logout() {
  'use server';
  await destroySession();
  redirect('/login');
}

export default async function SitesPage() {
  const user = await getUser();
  if (!user) redirect('/login');
  const sites = await sitesForUser(user);

  // Editors with exactly one site go straight to it.
  if (user.role !== 'admin' && sites.length === 1) redirect(`/edit/${sites[0].id}`);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.yourSites}</h1>
        <div className="flex items-center gap-4">
          {user.role === 'admin' && (
            <Link href="/admin" className="text-sm text-stone-500 hover:underline">
              Admin
            </Link>
          )}
          <form action={logout}>
            <button className="text-sm text-stone-500 hover:underline">{t.logout}</button>
          </form>
        </div>
      </div>
      <ul className="mt-6 space-y-3">
        {sites.map(site => (
          <li key={site.id}>
            <Link
              href={`/edit/${site.id}`}
              className="flex items-center justify-between rounded-2xl border border-stone-200 bg-white p-5 hover:border-accent"
            >
              <div>
                <div className="text-lg font-semibold">{site.name}</div>
                <div className="text-sm text-stone-500">{site.productionUrl}</div>
              </div>
              <span className="rounded-full bg-accent-soft px-4 py-1.5 text-sm font-medium text-accent">
                {t.openEditor}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
