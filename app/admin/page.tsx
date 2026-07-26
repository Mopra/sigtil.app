import { redirect } from 'next/navigation';
import { db, siteMembers, sites, users } from '@/lib/db';
import { getUser } from '@/lib/auth';
import { addMember, createSite, createUser } from './actions';

export default async function AdminPage() {
  const user = await getUser();
  if (!user || user.role !== 'admin') redirect('/sites');

  const [allSites, allUsers, memberships] = await Promise.all([
    db.select().from(sites),
    db.select().from(users),
    db.select().from(siteMembers),
  ]);

  const input = 'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm';
  const label = 'block text-xs font-medium text-stone-500 mt-3 mb-1';
  const button = 'mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white';

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin</h1>
        <a href="/sites" className="text-sm text-stone-500 hover:underline">
          ← Sites
        </a>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section className="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="font-semibold">Connect a site</h2>
          <form action={createSite}>
            <label className={label}>Display name (shown to editors)</label>
            <input name="name" required className={input} placeholder="Sankt Knuds Brasseri & Bar" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Repo owner</label>
                <input name="repoOwner" required className={input} placeholder="mortenpg" />
              </div>
              <div>
                <label className={label}>Repo name</label>
                <input name="repoName" required className={input} placeholder="sanktknuds.website" />
              </div>
            </div>
            <label className={label}>GitHub token (fine-grained, this repo only, Contents read/write)</label>
            <input name="githubToken" required type="password" className={input} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Vercel project ID</label>
                <input name="vercelProjectId" required className={input} placeholder="prj_..." />
              </div>
              <div>
                <label className={label}>Vercel team ID (optional)</label>
                <input name="vercelTeamId" className={input} placeholder="team_..." />
              </div>
            </div>
            <label className={label}>Production URL</label>
            <input name="productionUrl" required className={input} placeholder="https://sanktknuds.dk" />
            <label className={label}>Site notes for the AI (where content lives, tone, languages)</label>
            <textarea name="siteNotes" rows={3} className={input} placeholder="Menu data lives in lib/menu.ts. Site is Danish + English." />
            <button className={button}>Connect site</button>
          </form>
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="font-semibold">Invite a user</h2>
          <form action={createUser}>
            <label className={label}>Name</label>
            <input name="name" required className={input} placeholder="Onkel Jens" />
            <label className={label}>Email (they sign in with this via Clerk)</label>
            <input name="email" required type="email" className={input} placeholder="jens@example.com" />
            <label className={label}>Role</label>
            <select name="role" className={input} defaultValue="editor">
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </select>
            <button className={button}>Create user</button>
          </form>

          <h2 className="mt-8 font-semibold">Give a user access to a site</h2>
          <form action={addMember}>
            <label className={label}>User</label>
            <select name="userId" className={input}>
              {allUsers.map(u => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </select>
            <label className={label}>Site</label>
            <select name="siteId" className={input}>
              {allSites.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button className={button}>Give access</button>
          </form>
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="font-semibold">Overview</h2>
        <div className="mt-3 grid gap-6 text-sm md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase text-stone-400">Sites</h3>
            {allSites.map(s => (
              <div key={s.id} className="border-t border-stone-100 py-2">
                <span className="font-medium">{s.name}</span>{' '}
                <span className="text-stone-400">
                  {s.repoOwner}/{s.repoName} · editors:{' '}
                  {memberships
                    .filter(m => m.siteId === s.id)
                    .map(m => allUsers.find(u => u.id === m.userId)?.name)
                    .filter(Boolean)
                    .join(', ') || 'none'}
                </span>
              </div>
            ))}
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase text-stone-400">Users</h3>
            {allUsers.map(u => (
              <div key={u.id} className="border-t border-stone-100 py-2">
                <span className="font-medium">{u.name}</span>{' '}
                <span className="text-stone-400">
                  {u.email} · {u.role}
                  {!u.clerkId && ' · har ikke logget ind endnu'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
