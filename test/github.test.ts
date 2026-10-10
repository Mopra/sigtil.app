import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Site } from '@/lib/db';
import { FakeGitHub } from './fake-github';
import { resetLocks } from './fake-db';

vi.mock('@/lib/db', () => import('./fake-db'));

const {
  changesOf, dropChange, dropTurn, ensureWorkBranch, publishWork, turnOf, withTurn, syncWorkBranch, undoLastCommit, unpublishedCommits, updateFile, writeFile,
} = await import('@/lib/github');

const site = {
  id: 'site-1',
  name: 'Test',
  repoOwner: 'acme',
  repoName: 'web',
  defaultBranch: 'main',
  workBranch: 'sigtil-edits-anna',
  githubToken: 'token',
} as Site;

let gh: FakeGitHub;

beforeEach(() => {
  resetLocks();
  gh = new FakeGitHub();
  vi.stubGlobal('fetch', gh.fetch);
  gh.push('main', {
    'content/home.md': 'title\nintro\nbody\nfooter\n',
    'content/about.md': 'about\n',
    'public/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]),
  }, 'initial');
});

/** Unpublished editor commits, then a developer pushing to main. */
function editorCommits(...changes: Array<Record<string, string | Buffer | null>>) {
  changes.forEach((files, i) => gh.push(site.workBranch, files, `edit ${i + 1}`, 'main'));
}

const isOnLive = () => gh.ancestors(gh.refs.get(site.workBranch)!).has(gh.refs.get('main')!);

const writes = () => gh.calls.filter(c => !c.startsWith('GET'));

describe('syncWorkBranch', () => {
  it('does nothing when the live site has not moved', async () => {
    editorCommits({ 'content/about.md': 'about us\n' });
    const head = gh.refs.get(site.workBranch);
    const { pending } = await syncWorkBranch(site);
    expect(pending.map(c => c.message)).toEqual(['edit 1']);
    expect(gh.refs.get(site.workBranch)).toBe(head);
    expect(writes()).toEqual([]);
  });

  it('fast-forwards onto live when nothing is unpublished', async () => {
    gh.refs.set(site.workBranch, gh.refs.get('main')!);
    gh.push('main', { 'content/about.md': 'from developer\n' });
    const { pending } = await syncWorkBranch(site);
    expect(pending).toEqual([]);
    expect(gh.refs.get(site.workBranch)).toBe(gh.refs.get('main'));
  });

  it('creates the work branch from live the first time', async () => {
    const { pending } = await syncWorkBranch(site);
    expect(pending).toEqual([]);
    expect(gh.refs.get(site.workBranch)).toBe(gh.refs.get('main'));
  });

  it('replays unpublished commits on top of live, one each, keeping messages', async () => {
    editorCommits({ 'content/about.md': 'about us\n' }, { 'content/new.md': 'new page\n' });
    gh.push('main', { 'content/home.md': 'title\nintro\nbody\ndeveloper footer\n' }, 'developer');

    const { pending } = await syncWorkBranch(site);

    expect(pending.map(c => c.message)).toEqual(['edit 1', 'edit 2']);
    expect(gh.log(site.workBranch, 'main')).toEqual(['edit 1', 'edit 2']);
    expect(isOnLive()).toBe(true);
    expect(gh.files(site.workBranch)).toMatchObject({
      'content/home.md': 'title\nintro\nbody\ndeveloper footer\n',
      'content/about.md': 'about us\n',
      'content/new.md': 'new page\n',
    });
  });

  it('merges line by line when both changed the same file', async () => {
    editorCommits({ 'content/home.md': 'title\neditor intro\nbody\nfooter\n' });
    gh.push('main', { 'content/home.md': 'title\nintro\nbody\ndeveloper footer\n' });

    await syncWorkBranch(site);

    expect(gh.files(site.workBranch)['content/home.md']).toBe('title\neditor intro\nbody\ndeveloper footer\n');
  });

  it("keeps the editor's version where both changed the same lines", async () => {
    editorCommits({ 'content/home.md': 'title\neditor intro\nbody\nfooter\n' });
    gh.push('main', { 'content/home.md': 'title\ndeveloper intro\nbody\nfooter\n' });

    await syncWorkBranch(site);

    expect(gh.files(site.workBranch)['content/home.md']).toBe('title\neditor intro\nbody\nfooter\n');
  });

  it("keeps the editor's version of a binary file both changed", async () => {
    const mine = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 9, 9, 9]);
    editorCommits({ 'public/logo.png': mine });
    gh.push('main', { 'public/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 7, 7, 7]) });

    await syncWorkBranch(site);

    expect(gh.files(site.workBranch)['public/logo.png']).toBe(mine.toString('utf8'));
  });

  it("keeps a developer's edit to a file the editor moved", async () => {
    editorCommits({ 'content/about.md': null, 'content/om-os.md': 'about\n' });
    gh.push('main', { 'content/about.md': 'about, fixed by developer\n' });

    await syncWorkBranch(site);

    const files = gh.files(site.workBranch);
    expect(files['content/about.md']).toBeUndefined();
    expect(files['content/om-os.md']).toBe('about, fixed by developer\n');
  });

  it('removes a file the editor deleted, even if a developer changed it', async () => {
    editorCommits({ 'content/about.md': null });
    gh.push('main', { 'content/about.md': 'about, fixed by developer\n' });

    await syncWorkBranch(site);

    expect(gh.files(site.workBranch)['content/about.md']).toBeUndefined();
  });

  it('drops a commit whose change is already live', async () => {
    editorCommits({ 'content/about.md': 'about us\n' }, { 'content/new.md': 'new\n' });
    gh.push('main', { 'content/about.md': 'about us\n' }, 'same change, published by someone else');

    const { pending } = await syncWorkBranch(site);

    expect(pending.map(c => c.message)).toEqual(['edit 2']);
    expect(gh.files(site.workBranch)).toMatchObject({ 'content/about.md': 'about us\n', 'content/new.md': 'new\n' });
  });

  it('carries on correctly over several commits to the same file', async () => {
    editorCommits(
      { 'content/home.md': 'title\nintro 1\nbody\nfooter\n' },
      { 'content/home.md': 'title\nintro 2\nbody\nfooter\n' },
    );
    gh.push('main', { 'content/home.md': 'title\nintro\nbody\ndeveloper footer\n' });

    const { pending } = await syncWorkBranch(site);

    expect(pending).toHaveLength(2);
    const [first, second] = gh.between(gh.refs.get('main')!, gh.refs.get(site.workBranch)!);
    expect(gh.files(first)['content/home.md']).toBe('title\nintro 1\nbody\ndeveloper footer\n');
    expect(gh.files(second)['content/home.md']).toBe('title\nintro 2\nbody\ndeveloper footer\n');
  });

  it('skips merge commits on the work branch', async () => {
    editorCommits({ 'content/about.md': 'about us\n' });
    const developer = gh.push('main', { 'content/home.md': 'title\nintro\nbody\ndeveloper footer\n' });
    const work = gh.refs.get(site.workBranch)!;
    const tree = gh.commits.get(gh.push('scratch', { 'content/about.md': 'about us\n' }, 'x', 'main'))!.tree;
    gh.refs.set(site.workBranch, gh.commit(tree, [work, developer], 'Merge main'));
    editorCommits({ 'content/new.md': 'new\n' });
    gh.push('main', { 'content/about.md': 'about\n', 'content/other.md': 'other\n' });

    const { pending } = await syncWorkBranch(site);

    expect(pending.map(c => c.message)).toEqual(['edit 1', 'edit 1']);
    expect(gh.files(site.workBranch)).toMatchObject({ 'content/about.md': 'about us\n', 'content/new.md': 'new\n' });
  });

  it('leaves the branch alone if something outside sigtil moved it meanwhile', async () => {
    editorCommits({ 'content/about.md': 'about us\n' });
    gh.push('main', { 'content/other.md': 'other\n' });
    let moved: string | undefined;
    gh.intercept = (method, path) => {
      if (method === 'POST' && path === '/git/commits' && !moved) {
        moved = gh.push(site.workBranch, { 'content/hotfix.md': 'pushed by a developer\n' }, 'hotfix');
      }
    };

    await syncWorkBranch(site);

    expect(gh.refs.get(site.workBranch)).toBe(moved);
  });

  it('with wait: false, reports the branch as is while another sync holds the lock', async () => {
    editorCommits({ 'content/about.md': 'about us\n' });
    gh.push('main', { 'content/other.md': 'other\n' });
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    gh.intercept = async (method, path) => {
      if (method === 'GET' && path.startsWith('/git/commits/')) await gate;
    };

    const first = syncWorkBranch(site);
    await vi.waitFor(() => expect(gh.calls.some(c => c.startsWith('GET /git/commits/'))).toBe(true));
    const quick = await syncWorkBranch(site, { wait: false }).finally(release);
    expect(quick.pending.map(c => c.message)).toEqual(['edit 1']);
    expect(isOnLive()).toBe(false); // the quick call did not sync

    await first;
    expect(isOnLive()).toBe(true);
    expect(gh.log(site.workBranch, 'main')).toEqual(['edit 1']);
  });

  it('never loses an edit made while a sync is running', async () => {
    editorCommits({ 'content/about.md': 'about us\n' });
    gh.push('main', { 'content/other.md': 'other\n' });
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    gh.intercept = async (method, path) => {
      if (method === 'GET' && path.startsWith('/git/commits/')) await gate;
    };

    const sync = syncWorkBranch(site);
    await vi.waitFor(() => expect(gh.calls.some(c => c.startsWith('GET /git/commits/'))).toBe(true));
    const edit = updateFile(site, 'content/home.md', c => c.replace('intro', 'chat intro'), 'chat edit');
    release();
    await Promise.all([sync, edit]);

    expect(gh.log(site.workBranch, 'main')).toEqual(['edit 1', 'chat edit']);
    expect(gh.files(site.workBranch)).toMatchObject({
      'content/about.md': 'about us\n',
      'content/other.md': 'other\n',
      'content/home.md': 'title\nchat intro\nbody\nfooter\n',
    });
  });
});

describe('ensureWorkBranch', () => {
  it("takes over the old shared branch's unpublished changes, then deletes it", async () => {
    gh.push('sigtil-edits', { 'content/about.md': 'old shared edit\n' }, 'old edit', 'main');
    await ensureWorkBranch({ ...site, legacyBranch: 'sigtil-edits' });
    expect(gh.files(site.workBranch)['content/about.md']).toBe('old shared edit\n');
    expect(gh.refs.has('sigtil-edits')).toBe(false);
  });

  it('starts from live when the old shared branch has nothing unpublished', async () => {
    gh.refs.set('sigtil-edits', gh.refs.get('main')!);
    gh.push('main', { 'content/other.md': 'other\n' });
    await ensureWorkBranch({ ...site, legacyBranch: 'sigtil-edits' });
    expect(gh.refs.get(site.workBranch)).toBe(gh.refs.get('main'));
  });
});

describe('publishWork', () => {
  it('returns null when there is nothing to publish', async () => {
    expect(await publishWork(site)).toBeNull();
    expect(gh.calls).not.toContain('POST /merges');
  });

  it("syncs first, then merges exactly the editor's synced version", async () => {
    editorCommits({ 'content/home.md': 'title\neditor intro\nbody\nfooter\n' });
    gh.push('main', { 'content/home.md': 'title\nintro\nbody\ndeveloper footer\n' });

    const sha = await publishWork(site);

    expect(sha).toBe(gh.refs.get('main'));
    expect(gh.files('main')['content/home.md']).toBe('title\neditor intro\nbody\ndeveloper footer\n');
    expect(await unpublishedCommits(site)).toEqual([]);
  });

  it('syncs again and retries when the live site moves during publish', async () => {
    editorCommits({ 'content/about.md': 'about us\n' });
    let merges = 0;
    gh.intercept = (method, path) => {
      if (method === 'POST' && path === '/merges' && merges++ === 0) {
        gh.push('main', { 'content/other.md': 'published by someone else\n' });
      }
    };

    const sha = await publishWork(site);

    expect(merges).toBe(2);
    expect(sha).toBe(gh.refs.get('main'));
    expect(gh.files('main')).toMatchObject({ 'content/about.md': 'about us\n', 'content/other.md': 'published by someone else\n' });
  });

  it('keeps two editors\' changes to the same file when both publish', async () => {
    const bo = { ...site, workBranch: 'sigtil-edits-bo' };
    gh.push(site.workBranch, { 'content/home.md': 'title\nAnna intro\nbody\nfooter\n' }, 'anna', 'main');
    gh.push(bo.workBranch, { 'content/home.md': 'title\nintro\nbody\nBo footer\n' }, 'bo', 'main');

    await publishWork(site);
    await publishWork(bo);

    expect(gh.files('main')['content/home.md']).toBe('title\nAnna intro\nbody\nBo footer\n');
  });
});

describe('writing to the work branch', () => {
  it('writeFile creates and replaces files, one commit each', async () => {
    await writeFile(site, 'content/new.md', 'one\n', 'add');
    await writeFile(site, 'content/new.md', 'two\n', 'change');
    expect(gh.log(site.workBranch, 'main')).toEqual(['add', 'change']);
    expect(gh.files(site.workBranch)['content/new.md']).toBe('two\n');
  });

  it('updateFile leaves the branch alone when the edit returns null', async () => {
    expect(await updateFile(site, 'content/about.md', () => null, 'nothing')).toBe(false);
    expect(gh.log(site.workBranch, 'main')).toEqual([]);
  });

  it('two concurrent updateFile calls both land', async () => {
    await Promise.all([
      updateFile(site, 'content/home.md', c => c.replace('intro', 'new intro'), 'a'),
      updateFile(site, 'content/home.md', c => c.replace('footer', 'new footer'), 'b'),
    ]);
    expect(gh.files(site.workBranch)['content/home.md']).toBe('title\nnew intro\nbody\nnew footer\n');
  });

  it('undoLastCommit drops only the newest unpublished commit', async () => {
    editorCommits({ 'content/about.md': 'one\n' }, { 'content/about.md': 'two\n' });
    expect(await undoLastCommit(site)).toBe(true);
    expect(gh.files(site.workBranch)['content/about.md']).toBe('one\n');
    expect(await undoLastCommit(site)).toBe(true);
    expect(await undoLastCommit(site)).toBe(false);
  });
});

describe('taking out a chat turn that broke the preview', () => {
  const head = () => gh.refs.get(site.workBranch)!;
  const push = (files: Record<string, string>, message: string) => gh.push(site.workBranch, files, message, 'main');

  it('marks commits with the turn and reads it back', () => {
    expect(turnOf(withTurn('sigtil: x', { id: 't1' }))).toEqual({ id: 't1', repair: false });
    expect(turnOf(withTurn('sigtil: x', { id: 't1', repair: true }))).toEqual({ id: 't1', repair: true });
    expect(turnOf('sigtil: x')).toBeNull();
    expect(withTurn('sigtil: x')).toBe('sigtil: x');
  });

  it('drops the turn and its repair, keeping changes before and after it', async () => {
    push({ 'content/about.md': 'about us\n' }, withTurn('earlier', { id: 'old' }));
    push({ 'content/home.md': 'title\nbroken\nbody\nfooter\n' }, withTurn('broke it', { id: 'bad' }));
    push({ 'content/new.md': 'typed in preview\n' }, 'inline edit');
    push({ 'content/home.md': 'title\nstill broken\nbody\nfooter\n' }, withTurn('repair', { id: 'bad', repair: true }));

    expect(await dropTurn(site, 'bad', head())).toBe(true);

    expect(gh.log(site.workBranch, 'main').map(m => m.split('\n')[0])).toEqual(['earlier', 'inline edit']);
    expect(gh.files(site.workBranch)).toMatchObject({
      'content/home.md': 'title\nintro\nbody\nfooter\n',
      'content/about.md': 'about us\n',
      'content/new.md': 'typed in preview\n',
    });
  });

  it('without a turn, drops only the newest change', async () => {
    push({ 'content/about.md': 'one\n' }, 'a');
    push({ 'content/about.md': 'two\n' }, 'b');
    expect(await dropTurn(site, null, head())).toBe(true);
    expect(gh.log(site.workBranch, 'main')).toEqual(['a']);
  });

  it('does nothing if the branch moved on since the failure was seen', async () => {
    const seen = push({ 'content/about.md': 'one\n' }, withTurn('a', { id: 'bad' }));
    push({ 'content/about.md': 'two\n' }, 'newer');
    const now = head();
    expect(await dropTurn(site, 'bad', seen)).toBe(false);
    expect(head()).toBe(now);
  });
});

describe('the what-changed list before publishing', () => {
  const head = () => gh.refs.get(site.workBranch)!;
  const push = (files: Record<string, string>, message: string) => gh.push(site.workBranch, files, message, 'main');

  it('shows one line per chat turn, without its repair, and one per other change', async () => {
    push({ 'content/about.md': 'about us\n' }, withTurn('sigtil: Opdaterede Om os', { id: 't1' }));
    push({ 'content/new.md': 'new\n' }, withTurn('sigtil: Lavede siden Nyt', { id: 't1' }));
    push({ 'content/home.md': 'title\nhej\nbody\nfooter\n' }, 'sigtil: Rettede teksten “intro” til “hej”');
    push({ 'content/new.md': 'fixed\n' }, withTurn('sigtil: Rettede en fejl', { id: 't1', repair: true }));

    const changes = changesOf(await unpublishedCommits(site));

    expect(changes.map(c => c.labels)).toEqual([
      ['Opdaterede Om os', 'Lavede siden Nyt'],
      ['Rettede teksten “intro” til “hej”'],
    ]);
    expect(changes.map(c => c.shas.length)).toEqual([3, 1]);
  });

  it('undoes one item, keeping the changes before and after it', async () => {
    push({ 'content/about.md': 'about us\n' }, withTurn('a', { id: 't1' }));
    push({ 'content/new.md': 'new\n' }, withTurn('b', { id: 't2' }));
    push({ 'content/home.md': 'title\nhej\nbody\nfooter\n' }, 'c');
    const [, middle] = changesOf(await unpublishedCommits(site));

    expect(await dropChange(site, middle.shas, head())).toBe(true);

    expect(gh.log(site.workBranch, 'main').map(m => m.split('\n')[0])).toEqual(['a', 'c']);
    const files = gh.files(site.workBranch);
    expect(files['content/new.md']).toBeUndefined();
    expect(files['content/about.md']).toBe('about us\n');
    expect(files['content/home.md']).toBe('title\nhej\nbody\nfooter\n');
  });

  it('does nothing when the list shown is out of date', async () => {
    push({ 'content/about.md': 'about us\n' }, 'a');
    const shown = head();
    const [first] = changesOf(await unpublishedCommits(site));
    push({ 'content/about.md': 'newer\n' }, 'b');
    const now = head();

    expect(await dropChange(site, first.shas, shown)).toBe(false);
    expect(head()).toBe(now);
  });
});
