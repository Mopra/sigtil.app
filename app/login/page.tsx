import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db, users } from '@/lib/db';
import { getUser, hashCode, loginWithCode, createSession } from '@/lib/auth';
import { t } from '@/lib/strings';

async function login(formData: FormData) {
  'use server';
  const code = String(formData.get('code') ?? '');

  // Bootstrap: if no users exist yet, the SIGTIL_BOOTSTRAP_CODE creates the first admin.
  const bootstrap = process.env.SIGTIL_BOOTSTRAP_CODE;
  if (bootstrap && code === bootstrap) {
    const existing = await db.select({ id: users.id }).from(users).limit(1);
    if (existing.length === 0) {
      const [admin] = await db
        .insert(users)
        .values({ name: 'Admin', codeHash: hashCode(code), role: 'admin' })
        .returning();
      await createSession(admin.id);
      redirect('/admin');
    }
  }

  const user = await loginWithCode(code);
  if (!user) redirect('/login?error=1');
  redirect(user.role === 'admin' ? '/admin' : '/sites');
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getUser()) redirect('/sites');
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-bold tracking-tight">{t.appName}</h1>
        <p className="mt-1 text-stone-500">{t.tagline}</p>
        <form action={login} className="mt-8 space-y-3">
          <label className="block text-sm font-medium" htmlFor="code">
            {t.loginHint}
          </label>
          <input
            id="code"
            name="code"
            type="password"
            autoFocus
            autoComplete="current-password"
            className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-lg outline-none focus:border-accent"
          />
          {error && <p className="text-sm text-red-600">{t.loginError}</p>}
          <button
            type="submit"
            className="w-full rounded-xl bg-accent px-4 py-3 text-lg font-semibold text-white hover:opacity-90"
          >
            {t.loginButton}
          </button>
        </form>
      </div>
    </main>
  );
}
