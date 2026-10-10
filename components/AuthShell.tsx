import { Mark } from './Logo';
import { t } from '@/lib/strings';

/** Calm, centered frame shared by sign-in and sign-up. */
export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 px-6 py-12">
      <div className="flex animate-rise flex-col items-center text-center">
        <Mark size={52} />
        <h1 className="mt-5 text-4xl font-semibold tracking-tight">{t.appName}</h1>
        <p className="mt-2 max-w-xs text-lg text-ink-soft">{t.tagline}</p>
      </div>
      {children}
    </main>
  );
}
