import { createHash } from 'node:crypto';

/**
 * An in-memory GitHub repository behind the REST endpoints lib/github.ts
 * calls. Blobs, trees and commits are content addressed like real git, so
 * equal content gets equal shas. Trees are flat (path → entry).
 */
type Entry = { sha: string; mode: string; type: string };
type Commit = { tree: string; parents: string[]; message: string; author?: unknown };

const hash = (s: string | Buffer) => createHash('sha1').update(s).digest('hex');

export class FakeGitHub {
  blobs = new Map<string, Buffer>();
  trees = new Map<string, Map<string, Entry>>();
  commits = new Map<string, Commit>();
  refs = new Map<string, string>();
  /** Every request, as "METHOD path". */
  calls: string[] = [];
  /** Runs before a request is answered; return a Response to answer it instead. */
  intercept?: (method: string, path: string, body: any) => Response | void | Promise<Response | void>;
  private clock = 0;

  // ---- building history from tests ----

  blob(content: string | Buffer): string {
    const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    const sha = hash(Buffer.concat([Buffer.from('blob'), bytes]));
    this.blobs.set(sha, bytes);
    return sha;
  }

  tree(files: Map<string, Entry>): string {
    const sorted = [...files].sort(([a], [b]) => a.localeCompare(b));
    const sha = hash('tree' + JSON.stringify(sorted));
    this.trees.set(sha, new Map(sorted));
    return sha;
  }

  commit(tree: string, parents: string[], message: string, author?: unknown): string {
    // Unique per call, like a real commit's timestamp.
    const sha = hash(JSON.stringify({ tree, parents, message, n: this.clock++ }));
    this.commits.set(sha, { tree, parents, message, author });
    return sha;
  }

  /** Commit file changes on a branch (null deletes). Creates the branch from `from` if needed. */
  push(branch: string, files: Record<string, string | Buffer | null>, message = 'change', from?: string): string {
    const parent = this.refs.get(branch) ?? (from ? this.refs.get(from) : undefined);
    const current = parent ? new Map(this.trees.get(this.commits.get(parent)!.tree)!) : new Map<string, Entry>();
    for (const [path, content] of Object.entries(files)) {
      if (content === null) current.delete(path);
      else current.set(path, { sha: this.blob(content), mode: '100644', type: 'blob' });
    }
    const sha = this.commit(this.tree(current), parent ? [parent] : [], message);
    this.refs.set(branch, sha);
    return sha;
  }

  /** Files on a branch (or commit) as text. */
  files(branchOrSha: string): Record<string, string> {
    const sha = this.refs.get(branchOrSha) ?? branchOrSha;
    const tree = this.trees.get(this.commits.get(sha)!.tree)!;
    return Object.fromEntries([...tree].map(([p, e]) => [p, this.blobs.get(e.sha)!.toString('utf8')]));
  }

  /** Commit messages from `base` (exclusive) to `head`, oldest first. */
  log(head: string, base: string): string[] {
    return this.between(this.refs.get(base)!, this.refs.get(head) ?? head).map(s => this.commits.get(s)!.message);
  }

  // ---- graph ----

  ancestors(sha: string): Set<string> {
    const seen = new Set<string>();
    const stack = [sha];
    while (stack.length) {
      const s = stack.pop()!;
      if (seen.has(s)) continue;
      seen.add(s);
      stack.push(...this.commits.get(s)!.parents);
    }
    return seen;
  }

  /** Commits reachable from `head` but not `base`, parents before children. */
  between(base: string, head: string): string[] {
    const exclude = this.ancestors(base);
    const out: string[] = [];
    const visit = (s: string) => {
      if (exclude.has(s) || out.includes(s)) return;
      for (const p of this.commits.get(s)!.parents) visit(p);
      out.push(s);
    };
    visit(head);
    return out;
  }

  // ---- REST ----

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const prefix = url.pathname.match(/^\/repos\/[^/]+\/[^/]+/)![0];
    const path = url.pathname.slice(prefix.length);
    this.calls.push(`${method} ${path}`);
    const intercepted = await this.intercept?.(method, path, body);
    if (intercepted) return intercepted;
    try {
      const result = this.route(method, path, url.searchParams, body);
      if (result === null) return new Response(null, { status: 204 });
      return json(result.status ?? 200, result.body);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { message: e.message });
      throw e;
    }
  };

  private route(method: string, path: string, query: URLSearchParams, body: any): { status?: number; body: any } | null {
    let m: RegExpMatchArray | null;
    const ref = (s: string) => decodeURIComponent(s).replace(/^heads\//, '');

    if (method === 'GET' && (m = path.match(/^\/git\/ref\/(.+)$/))) {
      const sha = this.refs.get(ref(m[1]));
      if (!sha) throw new HttpError(404, 'Not Found');
      return { body: { object: { sha } } };
    }
    if (method === 'POST' && path === '/git/refs') {
      const name = body.ref.replace(/^refs\/heads\//, '');
      if (this.refs.has(name)) throw new HttpError(422, 'Reference already exists');
      this.refs.set(name, body.sha);
      return { status: 201, body: {} };
    }
    if ((m = path.match(/^\/git\/refs\/(.+)$/))) {
      const name = ref(m[1]);
      if (!this.refs.has(name)) throw new HttpError(422, 'Reference does not exist');
      if (method === 'DELETE') {
        this.refs.delete(name);
        return null;
      }
      if (method === 'PATCH') {
        const current = this.refs.get(name)!;
        if (!body.force && !this.ancestors(body.sha).has(current)) throw new HttpError(422, 'Update is not a fast forward');
        this.refs.set(name, body.sha);
        return { body: {} };
      }
    }
    if (method === 'GET' && (m = path.match(/^\/compare\/(.+)\.\.\.(.+)$/))) {
      const base = this.resolveRef(decodeURIComponent(m[1]));
      const head = this.resolveRef(decodeURIComponent(m[2]));
      const ahead = this.between(base, head);
      const behind = this.between(head, base);
      const status = ahead.length && behind.length ? 'diverged' : ahead.length ? 'ahead' : behind.length ? 'behind' : 'identical';
      return {
        body: {
          status,
          ahead_by: ahead.length,
          behind_by: behind.length,
          commits: ahead.map(sha => this.commitJson(sha)),
        },
      };
    }
    if (method === 'GET' && (m = path.match(/^\/(?:git\/)?commits\/([0-9a-f]+)$/))) {
      if (!this.commits.has(m[1])) throw new HttpError(404, 'Not Found');
      const c = this.commits.get(m[1])!;
      return { body: { sha: m[1], tree: { sha: c.tree }, parents: c.parents.map(sha => ({ sha })), message: c.message } };
    }
    if (method === 'POST' && path === '/git/commits') {
      return { status: 201, body: { sha: this.commit(body.tree, body.parents, body.message, body.author) } };
    }
    if (method === 'GET' && (m = path.match(/^\/git\/trees\/([0-9a-f]+)$/))) {
      const tree = this.trees.get(m[1]);
      if (!tree) throw new HttpError(404, 'Not Found');
      return {
        body: {
          sha: m[1],
          truncated: false,
          tree: [...tree].map(([p, e]) => ({ path: p, ...e, size: this.blobs.get(e.sha)?.length ?? 0 })),
        },
      };
    }
    if (method === 'POST' && path === '/git/trees') {
      const files = new Map(body.base_tree ? this.trees.get(body.base_tree)! : []);
      for (const t of body.tree) {
        if (t.sha === null) files.delete(t.path);
        else files.set(t.path, { sha: t.sha, mode: t.mode, type: t.type });
      }
      return { status: 201, body: { sha: this.tree(files) } };
    }
    if (method === 'GET' && (m = path.match(/^\/git\/blobs\/([0-9a-f]+)$/))) {
      const bytes = this.blobs.get(m[1]);
      if (!bytes) throw new HttpError(404, 'Not Found');
      return { body: { sha: m[1], content: bytes.toString('base64'), encoding: 'base64' } };
    }
    if (method === 'POST' && path === '/git/blobs') {
      return { status: 201, body: { sha: this.blob(Buffer.from(body.content, 'base64')) } };
    }
    if ((m = path.match(/^\/contents\/(.+)$/))) {
      const file = m[1].split('/').map(decodeURIComponent).join('/');
      const branch = method === 'GET' ? query.get('ref')! : body.branch;
      const head = this.refs.get(branch);
      if (!head) throw new HttpError(404, 'No commit found for the ref');
      const entry = this.trees.get(this.commits.get(head)!.tree)!.get(file);
      if (method === 'GET') {
        if (!entry) throw new HttpError(404, 'Not Found');
        return { body: { sha: entry.sha, content: this.blobs.get(entry.sha)!.toString('base64') } };
      }
      if (method === 'PUT') {
        if (entry && body.sha !== entry.sha) throw new HttpError(409, `${file} does not match ${body.sha}`);
        this.push(branch, { [file]: Buffer.from(body.content, 'base64') }, body.message);
        return { status: 201, body: {} };
      }
    }
    if (method === 'POST' && path === '/merges') {
      const base = this.refs.get(body.base)!;
      const head = this.resolveRef(body.head);
      if (this.ancestors(base).has(head)) return null; // already merged
      // Enough for sigtil, which only merges what is synced on top of live.
      if (!this.ancestors(head).has(base)) throw new HttpError(409, 'Merge conflict');
      const sha = this.commit(this.commits.get(head)!.tree, [base, head], body.commit_message);
      this.refs.set(body.base, sha);
      return { status: 201, body: { sha } };
    }
    throw new Error(`FakeGitHub: no route for ${method} ${path}`);
  }

  private resolveRef(s: string): string {
    if (this.commits.has(s)) return s;
    const sha = this.refs.get(s);
    if (!sha) throw new HttpError(404, `No ref ${s}`);
    return sha;
  }

  private commitJson(sha: string) {
    const c = this.commits.get(sha)!;
    return { sha, parents: c.parents.map(p => ({ sha: p })), commit: { message: c.message, author: c.author ?? null } };
  }
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
