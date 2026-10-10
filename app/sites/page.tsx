import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SignOutButton } from '@clerk/nextjs';
import { getUser, sitesForUser } from '@/lib/auth';
import { t } from '@/lib/strings';
import Logo, { Mark } from '@/components/Logo';

const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

export default async function SitesPage() {
  const user = await getUser();

  // Signed in with Clerk but not invited to sigtil.
  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm animate-rise text-center">
          <div className="flex justify-center">
            <Mark size={44} />
          </div>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">{t.noAccessTitle}</h1>
          <p className="mt-2 leading-relaxed text-ink-soft">{t.noAccessBody}</p>
          <SignOutButton redirectUrl="/sign-in">
            <button className="mt-8 rounded-full bg-surface px-5 py-2.5 text-sm font-medium shadow-float transition hover:text-accent">
              {t.logout}
            </button>
          </SignOutButton>
        </div>
      </main>
    );
  }

  const sites = await sitesForUser(user);

  // Editors with exactly one site go straight to it.
  if (user.role !== 'admin' && sites.length === 1) redirect(`/edit/${sites[0].id}`);

  const firstName = user.name.split(' ')[0];

  return (
    <main className="mx-auto max-w-2xl px-6 pb-16">
      <header className="flex items-center justify-between py-6">
        <Logo size={26} />
        <nav className="flex items-center gap-1 text-sm text-ink-soft">
          {user.role === 'admin' && (
            <Link href="/admin" className="rounded-full px-3 py-1.5 transition hover:bg-surface hover:text-ink">
              {t.admin}
            </Link>
          )}
          <SignOutButton redirectUrl="/sign-in">
            <button className="rounded-full px-3 py-1.5 transition hover:bg-surface hover:text-ink">{t.logout}</button>
          </SignOutButton>
        </nav>
      </header>

      <div className="mt-10 animate-rise">
        <h1 className="text-4xl font-semibold tracking-tight">{t.greeting(firstName)}</h1>
        <p className="mt-2 text-lg text-ink-soft">{t.sitesIntro}</p>
      </div>

      {sites.length === 0 ? (
        <p className="mt-10 rounded-panel bg-surface p-6 text-ink-soft shadow-float">{t.noSites}</p>
      ) : (
        <ul className="mt-10 space-y-3">
          {sites.map(site => (
            <li key={site.id}>
              <Link
                href={`/edit/${site.id}`}
                className="group flex items-center gap-4 rounded-panel bg-surface p-4 pr-5 shadow-float transition hover:-translate-y-px hover:shadow-window"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-lg font-semibold text-accent">
                  {site.name.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[17px] font-semibold">{site.name}</span>
                  <span className="block truncate text-sm text-ink-faint">{hostOf(site.productionUrl)}</span>
                </span>
                <span className="text-sm font-medium text-accent opacity-80 transition group-hover:opacity-100">
                  {t.openEditor}
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-accent transition group-hover:translate-x-0.5" aria-hidden="true">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
