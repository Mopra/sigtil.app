import { SignIn } from '@clerk/nextjs';
import { t } from '@/lib/strings';

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">{t.appName}</h1>
        <p className="mt-1 text-stone-500">{t.tagline}</p>
      </div>
      <SignIn />
    </main>
  );
}
