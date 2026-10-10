import type { Site } from './db';

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
      Authorization: `Bearer ${site.githubToken}`,
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
export async function ensureWorkBranch(site: Site): Promise<string> {
  const existing = await getBranchSha(site, site.workBranch);
  if (existing) return existing;
  const base = await getBranchSha(site, site.defaultBranch);
  if (!base) throw new Error(`Default branch ${site.defaultBranch} not found`);
  await gh(site, '/git/refs', {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${site.workBranch}`, sha: base }),
  });
  return base;
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
 * rename or deletion is a single step for "Fortryd seneste ændring".
 */
export async function commitTreeChanges(site: Site, changes: TreeChange[], message: string) {
  const head = await ensureWorkBranch(site);
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
  // Not forced: if another edit landed meanwhile, fail rather than drop it.
  await gh(site, `/git/refs/${encodeURIComponent(`heads/${site.workBranch}`)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: next.sha }),
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

/** Create or update a file on the working branch (one commit per call). */
export async function writeFile(site: Site, path: string, content: Buffer | string, message: string) {
  await ensureWorkBranch(site);
  let sha: string | undefined;
  try {
    const existing = await gh(site, `/contents/${encodePath(path)}?ref=${encodeURIComponent(site.workBranch)}`);
    if (!Array.isArray(existing)) sha = existing.sha;
  } catch (e) {
    if (!(e instanceof GitHubError && e.status === 404)) throw e;
  }
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

function encodePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** Commits on the working branch that are not yet on the default branch. */
export async function unpublishedCommits(site: Site): Promise<Array<{ sha: string; message: string }>> {
  await ensureWorkBranch(site);
  const cmp = await gh(
    site,
    `/compare/${encodeURIComponent(site.defaultBranch)}...${encodeURIComponent(site.workBranch)}`,
  );
  return (cmp.commits as any[]).map(c => ({ sha: c.sha, message: c.commit.message }));
}

/** Merge the working branch into the default branch. Returns the merge commit sha, or null if nothing to merge. */
export async function mergeWorkIntoDefault(site: Site): Promise<string | null> {
  try {
    const merge = await gh(site, '/merges', {
      method: 'POST',
      body: JSON.stringify({
        base: site.defaultBranch,
        head: site.workBranch,
        commit_message: `sigtil: publish changes from ${site.workBranch}`,
      }),
    });
    return merge?.sha ?? null; // 204 (already merged) → null
  } catch (e) {
    if (e instanceof GitHubError && e.status === 409) {
      throw new Error(
        'The working branch conflicts with the live site. Reset the working branch (undo all) and redo the change.',
      );
    }
    throw e;
  }
}

/** Force the working branch back onto the default branch (fresh start / undo all). */
export async function resetWorkBranch(site: Site) {
  const base = await getBranchSha(site, site.defaultBranch);
  if (!base) throw new Error(`Default branch ${site.defaultBranch} not found`);
  const existing = await getBranchSha(site, site.workBranch);
  if (!existing) {
    await ensureWorkBranch(site);
    return;
  }
  await gh(site, `/git/refs/${encodeURIComponent(`heads/${site.workBranch}`)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: base, force: true }),
  });
}

/** Undo the most recent unpublished commit on the working branch. Returns false if there was nothing to undo. */
export async function undoLastCommit(site: Site): Promise<boolean> {
  const pending = await unpublishedCommits(site);
  if (pending.length === 0) return false;
  const head = await getBranchSha(site, site.workBranch);
  const commit = await gh(site, `/commits/${head}`);
  const parent = commit.parents?.[0]?.sha;
  if (!parent) return false;
  await gh(site, `/git/refs/${encodeURIComponent(`heads/${site.workBranch}`)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: parent, force: true }),
  });
  return true;
}
