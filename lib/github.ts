import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import { db, type Site } from './db';
import { decryptSecret } from './db/crypto';
import { isBinary, mergeText } from './merge';

const API = 'https://api.github.com';

class GitHubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function gh(site: Site, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API}/repos/${site.repoOwner}/${site.repoName}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${decryptSecret(site.githubToken)}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new GitHubError(res.status, body?.message ?? `GitHub ${res.status} on ${path}`);
  }
  return body;
}

/**
 * A site as one person edits it. Each editor has a work branch of their own,
 * so nobody previews, publishes or undoes someone else's unpublished changes.
 * `legacyBranch` is the branch all editors shared before that: whoever opens
 * the editor first carries its unpublished changes on.
 */
export type Workspace = Site & { legacyBranch?: string };

// Everything that moves a work branch runs under a lock per branch, so two
// requests (a chat edit and a sync, or two tabs) never write over each other.
// A Postgres advisory lock, since requests run in separate function instances.
const heldLocks = new AsyncLocalStorage<Set<string>>();

function lockKey(site: Site) {
  return `sigtil:${site.repoOwner}/${site.repoName}:${site.workBranch}`;
}

async function withBranchLock<T>(site: Site, fn: () => Promise<T>): Promise<T> {
  const key = lockKey(site);
  const held = heldLocks.getStore();
  if (held?.has(key)) return fn();
  return db.transaction(async tx => {
    await tx.execute(sql`set local lock_timeout = '120s'`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    return heldLocks.run(new Set([...(held ?? []), key]), fn);
  });
}

/** Like withBranchLock, but gives up at once (null) if someone else holds it. */
async function tryBranchLock<T>(site: Site, fn: () => Promise<T>): Promise<{ value: T } | null> {
  const key = lockKey(site);
  const held = heldLocks.getStore();
  if (held?.has(key)) return { value: await fn() };
  return db.transaction(async tx => {
    const [row] = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext(${key})) as ok`);
    if (!row?.ok) return null;
    return { value: await heldLocks.run(new Set([...(held ?? []), key]), fn) };
  });
}

function refPath(branch: string) {
  return `/git/refs/${encodeURIComponent(`heads/${branch}`)}`;
}

export async function getBranchSha(site: Site, branch: string): Promise<string | null> {
  try {
    const ref = await gh(site, `/git/ref/${encodeURIComponent(`heads/${branch}`)}`);
    return ref.object.sha;
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return null;
    throw e;
  }
}

/** Make sure the working branch exists; create it from the default branch if not. */
export async function ensureWorkBranch(site: Workspace): Promise<string> {
  const existing = await getBranchSha(site, site.workBranch);
  if (existing) return existing;
  const base = await getBranchSha(site, site.defaultBranch);
  if (!base) throw new Error(`Default branch ${site.defaultBranch} not found`);

  let start = base;
  const legacy = site.legacyBranch && site.legacyBranch !== site.workBranch
    ? await getBranchSha(site, site.legacyBranch)
    : null;
  if (legacy) {
    const cmp = await gh(site, `/compare/${base}...${legacy}`);
    if (cmp.ahead_by > 0) start = legacy;
  }

  try {
    await gh(site, '/git/refs', {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${site.workBranch}`, sha: start }),
    });
  } catch (e) {
    // Another request created it a moment ago.
    if (!(e instanceof GitHubError && e.status === 422)) throw e;
    return (await getBranchSha(site, site.workBranch)) ?? start;
  }
  // Its changes now live on in this branch; don't hand them to anyone else.
  if (legacy) await gh(site, refPath(site.legacyBranch!), { method: 'DELETE' }).catch(() => {});
  return start;
}

export type TreeEntry = { path: string; size: number; sha: string; mode: string };

/** Recursive listing of the working branch, with blob sizes. One API call. */
export async function listTree(site: Site): Promise<TreeEntry[]> {
  const sha = await ensureWorkBranch(site);
  const tree = await gh(site, `/git/trees/${sha}?recursive=1`);
  return (tree.tree as Array<{ path: string; type: string; size?: number; sha: string; mode: string }>)
    .filter(t => t.type === 'blob')
    .map(t => ({ path: t.path, size: t.size ?? 0, sha: t.sha, mode: t.mode }));
}

/** A tree entry change: point `path` at an existing blob, or delete it (`sha: null`). */
export type TreeChange = { path: string; mode: string; sha: string | null };

/**
 * Apply several file changes to the working branch as ONE commit, so a page
 * rename or deletion is a single step for "Fortryd seneste ændring". `build`
 * works out the changes from the branch as it is right now, under the lock,
 * so they can't be based on an older version. It returns a reason instead to
 * refuse; that reason is passed back.
 */
export async function commitTreeChanges(
  site: Site,
  build: (tree: TreeEntry[]) => TreeChange[] | string,
  message: string,
): Promise<string | null> {
  return withBranchLock(site, async () => {
    const head = await ensureWorkBranch(site);
    const changes = build(await listTree(site));
    if (typeof changes === 'string') return changes;
    const commit = await gh(site, `/git/commits/${head}`);
    const tree = await gh(site, '/git/trees', {
      method: 'POST',
      body: JSON.stringify({
        base_tree: commit.tree.sha,
        tree: changes.map(c => ({ path: c.path, mode: c.mode, type: 'blob', sha: c.sha })),
      }),
    });
    const next = await gh(site, '/git/commits', {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [head] }),
    });
    await gh(site, refPath(site.workBranch), { method: 'PATCH', body: JSON.stringify({ sha: next.sha }) });
    return null;
  });
}

/** Recursive file listing of the working branch. */
export async function listFiles(site: Site): Promise<string[]> {
  return (await listTree(site)).map(t => t.path);
}

export async function readFile(site: Site, path: string): Promise<{ content: string; sha: string }> {
  await ensureWorkBranch(site);
  const file = await gh(site, `/contents/${encodePath(path)}?ref=${encodeURIComponent(site.workBranch)}`);
  if (Array.isArray(file)) throw new Error(`${path} is a directory`);
  return { content: Buffer.from(file.content, 'base64').toString('utf8'), sha: file.sha };
}

// A blob's content never changes for its sha, so a cache needs no invalidation.
const blobCache = new Map<string, string>();
const BLOB_CACHE_MAX = 2000;

/** Text of a file by its blob sha (from listTree). Cached across requests. */
export async function readBlob(site: Site, sha: string): Promise<string> {
  const cached = blobCache.get(sha);
  if (cached !== undefined) return cached;
  const content = (await blobBytes(site, sha)).toString('utf8');
  if (blobCache.size >= BLOB_CACHE_MAX) blobCache.delete(blobCache.keys().next().value!);
  blobCache.set(sha, content);
  return content;
}

async function blobBytes(site: Site, sha: string): Promise<Buffer> {
  const blob = await gh(site, `/git/blobs/${sha}`);
  return Buffer.from(blob.content, 'base64');
}

/** PUT a file. With `sha` GitHub refuses if the file changed since that version was read. */
async function putFile(site: Site, path: string, content: Buffer | string, message: string, sha?: string) {
  await gh(site, `/contents/${encodePath(path)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      branch: site.workBranch,
      content: (typeof content === 'string' ? Buffer.from(content, 'utf8') : content).toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  });
}

/** Create or replace a file on the working branch (one commit per call). */
export async function writeFile(site: Site, path: string, content: Buffer | string, message: string) {
  await withBranchLock(site, async () => {
    await ensureWorkBranch(site);
    let sha: string | undefined;
    try {
      const existing = await gh(site, `/contents/${encodePath(path)}?ref=${encodeURIComponent(site.workBranch)}`);
      if (!Array.isArray(existing)) sha = existing.sha;
    } catch (e) {
      if (!(e instanceof GitHubError && e.status === 404)) throw e;
    }
    await putFile(site, path, content, message, sha);
  });
}

/**
 * Change a file from its current content, read and written in one go so no
 * other edit can land in between and be lost. `edit` returns the new content,
 * or null to leave the file alone. Returns whether it was written.
 */
export async function updateFile(
  site: Site,
  path: string,
  edit: (content: string) => string | null,
  message: string,
): Promise<boolean> {
  return withBranchLock(site, async () => {
    const { content, sha } = await readFile(site, path);
    const next = edit(content);
    if (next === null) return false;
    if (next !== content) await putFile(site, path, next, message, sha);
    return true;
  });
}

function encodePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

type Commit = { sha: string; message: string };

/**
 * Every commit a chat turn makes carries the turn's id in its message, so a
 * turn that broke the preview can be taken out again as a whole. A turn that
 * tries to repair a broken build reuses the id and is marked as the repair.
 */
const TURN = 'Sigtil-Turn';
const REPAIR = 'Sigtil-Repair';

export type Turn = { id: string; repair?: boolean };

export function withTurn(message: string, turn?: Turn): string {
  if (!turn) return message;
  return `${message}\n\n${TURN}: ${turn.id}${turn.repair ? `\n${REPAIR}: yes` : ''}`;
}

export function turnOf(message: string): Turn | null {
  const id = message.match(/^Sigtil-Turn: (\S+)$/m)?.[1];
  if (!id) return null;
  return { id, repair: /^Sigtil-Repair: yes$/m.test(message) };
}

async function compareWork(site: Site) {
  await ensureWorkBranch(site);
  const cmp = await gh(
    site,
    `/compare/${encodeURIComponent(site.defaultBranch)}...${encodeURIComponent(site.workBranch)}`,
  );
  const pending: Commit[] = (cmp.commits as any[]).map(c => ({ sha: c.sha, message: c.commit.message }));
  return { cmp, pending };
}

/** Commits on the working branch that are not yet on the default branch. */
export async function unpublishedCommits(site: Site): Promise<Commit[]> {
  return (await compareWork(site)).pending;
}

export type SyncResult = {
  /** Unpublished changes, oldest first, after syncing. */
  pending: Commit[];
};

/**
 * Bring the working branch up to date with the live site, so nobody ever edits
 * (or previews) an older version than what is public. The live branch moves
 * without this editor, when someone else publishes or a developer pushes.
 *
 * - Nothing unpublished: fast-forward onto the live branch.
 * - Unpublished changes: replay them on top of the live branch, one commit
 *   each, so the pending count and "Fortryd seneste ændring" keep working.
 *   When both sides changed the same file, the changes are merged line by
 *   line, and where they changed the same lines the editor's version wins.
 *   It never stops and asks: editors can't be expected to resolve anything.
 *
 * With `wait: false` it skips syncing (and reports the branch as it is) when
 * another request is already at it, so status polls never queue up.
 */
export async function syncWorkBranch(site: Site, { wait = true } = {}): Promise<SyncResult> {
  const { cmp, pending } = await compareWork(site);
  if (cmp.behind_by === 0) return { pending };
  if (wait) return withBranchLock(site, () => rebaseOntoLive(site));
  return (await tryBranchLock(site, () => rebaseOntoLive(site)))?.value ?? { pending };
}

type Entry = { sha: string; mode: string; type: string };

/** Every file in a commit, by path. */
async function snapshot(site: Site, commitSha: string): Promise<{ tree: string; files: Map<string, Entry> }> {
  const commit = await gh(site, `/git/commits/${commitSha}`);
  const tree = await gh(site, `/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated) throw new Error('The site has too many files to bring up to date');
  const files = new Map<string, Entry>();
  for (const t of tree.tree as any[]) {
    if (t.type !== 'tree') files.set(t.path, { sha: t.sha, mode: t.mode, type: t.type });
  }
  return { tree: commit.tree.sha, files };
}

async function rebaseOntoLive(site: Site): Promise<SyncResult> {
  // Again under the lock: the branch may have moved while we waited for it.
  const { cmp, pending } = await compareWork(site);
  if (cmp.behind_by === 0) return { pending };
  const liveSha = await getBranchSha(site, site.defaultBranch);
  if (!liveSha) throw new Error(`Default branch ${site.defaultBranch} not found`);

  if (cmp.ahead_by === 0) {
    await gh(site, refPath(site.workBranch), { method: 'PATCH', body: JSON.stringify({ sha: liveSha }) });
    return { pending: [] };
  }

  const tipSha = await replayCommits(site, cmp.commits as any[], liveSha);

  // Only something outside sigtil can have moved the branch while we held the
  // lock. Leave it; the next sync starts over from what is there.
  if ((await getBranchSha(site, site.workBranch)) !== pending[pending.length - 1].sha) return { pending };
  await gh(site, refPath(site.workBranch), { method: 'PATCH', body: JSON.stringify({ sha: tipSha, force: true }) });
  return { pending: await unpublishedCommits(site) };
}

/**
 * Replay commits, oldest first, on top of `ontoSha`, one new commit each with
 * the same message. Returns the new tip. Nothing points at it yet.
 */
async function replayCommits(site: Site, commits: any[], ontoSha: string): Promise<string> {
  const onto = await snapshot(site, ontoSha);
  const tip = onto.files;
  let tipTree = onto.tree;
  let tipSha = ontoSha;
  let prev: { sha: string; files: Map<string, Entry> } | null = null;

  // Merge commits carry nothing of the editor's own; skip them.
  for (const c of commits.filter(c => c.parents.length === 1)) {
    const parentSha = c.parents[0].sha as string;
    const base = prev?.sha === parentSha ? prev.files : (await snapshot(site, parentSha)).files;
    const ours = (await snapshot(site, c.sha)).files;
    prev = { sha: c.sha, files: ours };

    const entries = await replayChanges(site, base, ours, tip);
    // Already there (someone made the same change): nothing left of it.
    if (entries.length === 0) continue;
    tipTree = (await gh(site, '/git/trees', {
      method: 'POST',
      body: JSON.stringify({ base_tree: tipTree, tree: entries }),
    })).sha;
    tipSha = (await gh(site, '/git/commits', {
      method: 'POST',
      body: JSON.stringify({ message: c.commit.message, author: c.commit.author, tree: tipTree, parents: [tipSha] }),
    })).sha;
  }
  return tipSha;
}

/**
 * The tree entries that put one commit's changes (`base` → `ours`) on top of
 * `tip`, which is updated to match.
 */
async function replayChanges(
  site: Site,
  base: Map<string, Entry>,
  ours: Map<string, Entry>,
  tip: Map<string, Entry>,
) {
  const changed = [...new Set([...base.keys(), ...ours.keys()])].filter(p => {
    const b = base.get(p);
    const o = ours.get(p);
    return b?.sha !== o?.sha || b?.mode !== o?.mode;
  });

  // A moved file keeps its blob, so pair each new path with a removed one
  // holding the same content. Changes made to it elsewhere then follow it.
  const removed = changed.filter(p => !ours.has(p));
  const movedFrom = new Map<string, string>();
  for (const p of changed) {
    if (base.has(p)) continue;
    const from = removed.find(r => base.get(r)!.sha === ours.get(p)!.sha && ![...movedFrom.values()].includes(r));
    if (from) movedFrom.set(p, from);
  }

  // Their side as it was before this commit, since removing a moved file's
  // old path below must not hide it from the new path.
  const theirs = new Map(tip);
  const entries: Array<{ path: string; mode: string; type: string; sha: string | null }> = [];
  for (const path of changed) {
    const from = movedFrom.get(path) ?? path;
    const current = tip.get(path) ?? null;
    const next = await resolve(site, base.get(from) ?? null, ours.get(path) ?? null, theirs.get(path) ?? theirs.get(from) ?? null);
    if (next?.sha === current?.sha && next?.mode === current?.mode) continue;
    if (next) tip.set(path, next);
    else tip.delete(path);
    const kind = (next ?? current)!;
    entries.push({ path, mode: kind.mode, type: kind.type, sha: next?.sha ?? null });
  }
  return entries;
}

/** One file after replaying the editor's change (`base` → `ours`) onto `theirs`. null = removed. */
async function resolve(site: Site, base: Entry | null, ours: Entry | null, theirs: Entry | null): Promise<Entry | null> {
  if (!ours) return null; // the editor removed it
  if (!theirs || theirs.sha === base?.sha) return ours; // only the editor changed it
  if (theirs.sha === ours.sha) return theirs;
  if (ours.type !== 'blob' || theirs.type !== 'blob') return ours;

  const [b, o, t] = await Promise.all([
    base?.type === 'blob' ? blobBytes(site, base.sha) : Buffer.alloc(0),
    blobBytes(site, ours.sha),
    blobBytes(site, theirs.sha),
  ]);
  const text = (bytes: Buffer) => {
    if (isBinary(bytes)) return null;
    const s = bytes.toString('utf8');
    return Buffer.from(s, 'utf8').equals(bytes) ? s : null;
  };
  const [bt, ot, tt] = [text(b), text(o), text(t)];
  // Images and the like can't be combined: the editor's version wins.
  if (bt === null || ot === null || tt === null) return ours;

  const merged = mergeText(bt, ot, tt);
  if (merged === ot) return ours;
  if (merged === tt) return theirs;
  const blob = await gh(site, '/git/blobs', {
    method: 'POST',
    body: JSON.stringify({ content: Buffer.from(merged, 'utf8').toString('base64'), encoding: 'base64' }),
  });
  return { sha: blob.sha, mode: ours.mode, type: 'blob' };
}

/**
 * Publish the editor's changes: bring them up to date with the live site, then
 * merge exactly that version into the default branch. If the live site moves
 * in between, it syncs and tries again. Returns the merge commit sha, or null
 * if there was nothing to publish.
 */
export async function publishWork(site: Site): Promise<string | null> {
  for (let attempt = 0; ; attempt++) {
    const result = await withBranchLock(site, async () => {
      const { pending } = await syncWorkBranch(site);
      if (pending.length === 0) return { sha: null };
      try {
        const merge = await gh(site, '/merges', {
          method: 'POST',
          body: JSON.stringify({
            base: site.defaultBranch,
            head: pending[pending.length - 1].sha,
            commit_message: `sigtil: publish changes from ${site.workBranch}`,
          }),
        });
        return { sha: (merge?.sha ?? null) as string | null }; // 204 (already merged) → null
      } catch (e) {
        if (e instanceof GitHubError && e.status === 409 && attempt < 3) return 'retry' as const;
        throw e;
      }
    });
    if (result !== 'retry') return result.sha;
  }
}

/** Whether `commitSha` already contains `ancestor`, e.g. a later push on top of a publish. */
export async function containsCommit(site: Site, commitSha: string, ancestor: string): Promise<boolean> {
  if (commitSha === ancestor) return true;
  const cmp = await gh(site, `/compare/${ancestor}...${commitSha}`).catch(() => null);
  return cmp?.status === 'ahead' || cmp?.status === 'identical';
}

/** Force the working branch back onto the default branch (fresh start / undo all). */
export async function resetWorkBranch(site: Site) {
  await withBranchLock(site, async () => {
    const base = await getBranchSha(site, site.defaultBranch);
    if (!base) throw new Error(`Default branch ${site.defaultBranch} not found`);
    const existing = await getBranchSha(site, site.workBranch);
    if (!existing) {
      await ensureWorkBranch(site);
      return;
    }
    await gh(site, refPath(site.workBranch), { method: 'PATCH', body: JSON.stringify({ sha: base, force: true }) });
  });
}

/** Undo the most recent unpublished commit on the working branch. Returns false if there was nothing to undo. */
export async function undoLastCommit(site: Site): Promise<boolean> {
  return withBranchLock(site, async () => {
    const pending = await unpublishedCommits(site);
    if (pending.length === 0) return false;
    const head = pending[pending.length - 1].sha;
    const commit = await gh(site, `/commits/${head}`);
    const parent = commit.parents?.[0]?.sha;
    if (!parent) return false;
    await gh(site, refPath(site.workBranch), { method: 'PATCH', body: JSON.stringify({ sha: parent, force: true }) });
    return true;
  });
}

/**
 * Take a chat turn's changes out of the working branch, keeping every change
 * made before or after it. With no turn id, only the newest change goes.
 * Does nothing (false) if the branch no longer ends at `headSha`, since then
 * something new happened that the caller has not seen.
 */
export async function dropTurn(site: Site, turnId: string | null, headSha: string): Promise<boolean> {
  return dropCommits(site, (c, last) => (turnId === null ? last : turnOf(c.message)?.id === turnId), headSha);
}

/** Take one item of the what-changed list out again, like dropTurn. */
export async function dropChange(site: Site, shas: string[], headSha: string): Promise<boolean> {
  const set = new Set(shas);
  return dropCommits(site, c => set.has(c.sha), headSha);
}

async function dropCommits(site: Site, dropped: (c: Commit, last: boolean) => boolean, headSha: string): Promise<boolean> {
  return withBranchLock(site, async () => {
    const { cmp, pending } = await compareWork(site);
    if (pending.length === 0 || pending[pending.length - 1].sha !== headSha) return false;
    const commits = cmp.commits as any[];
    const drop = (i: number) => dropped(pending[i], i === commits.length - 1);
    const first = commits.findIndex((_, i) => drop(i));
    if (first === -1 || !commits[first].parents[0]) return false;
    const kept = commits.slice(first).filter((_, i) => !drop(first + i));
    const tipSha = await replayCommits(site, kept, commits[first].parents[0].sha);
    await gh(site, refPath(site.workBranch), { method: 'PATCH', body: JSON.stringify({ sha: tipSha, force: true }) });
    return true;
  });
}

/** One line of the what-changed list shown before publishing. */
export type Change = { labels: string[]; shas: string[] };

/**
 * The unpublished changes as the editor thinks of them: one item per chat
 * turn (however many steps it took), and one per other change, oldest first.
 * The labels are the short Danish summaries the commits were made with.
 */
export function changesOf(pending: Commit[]): Change[] {
  const changes: Change[] = [];
  const byTurn = new Map<string, Change>();
  for (const c of pending) {
    const turn = turnOf(c.message);
    let change = turn ? byTurn.get(turn.id) : undefined;
    if (!change) {
      change = { labels: [], shas: [] };
      changes.push(change);
      if (turn) byTurn.set(turn.id, change);
    }
    change.shas.push(c.sha);
    // A repair only fixes the turn's own mistake; it is not news to the editor.
    const label = c.message.split('\n')[0].replace(/^sigtil:\s*/, '').trim();
    if (!turn?.repair && label && !change.labels.includes(label)) change.labels.push(label);
  }
  return changes;
}
