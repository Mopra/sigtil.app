import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Site } from '@/lib/db';
import { FakeGitHub } from './fake-github';
import { resetLocks } from './fake-db';

vi.mock('@/lib/db', () => import('./fake-db'));

const { isSitePath, replaceImage, swapPath } = await import('@/lib/inline-edit');
const { changesOf, unpublishedCommits, withTurn, writeFile } = await import('@/lib/github');

describe('swapPath', () => {
  it('swaps a path in code, markdown and front matter', () => {
    const content = [
      "src: '/uploads/a.webp',",
      '<Image src="/uploads/a.webp" alt="" />',
      '![Mad](/uploads/a.webp)',
      'image: /uploads/a.webp',
    ].join('\n');
    const out = swapPath(content, '/uploads/a.webp', '/uploads/b.webp');
    expect(out.count).toBe(4);
    expect(out.content).not.toContain('a.webp');
    expect(out.content.split('/uploads/b.webp')).toHaveLength(5);
  });

  it('leaves a longer path that only contains it', () => {
    const content = '"/old/uploads/a.webp" "/uploads/a.webp.bak" "/uploads/a.webp"';
    const out = swapPath(content, '/uploads/a.webp', '/n.webp');
    expect(out.count).toBe(1);
    expect(out.content).toBe('"/old/uploads/a.webp" "/uploads/a.webp.bak" "/n.webp"');
  });

  it('changes nothing when the path is not there', () => {
    expect(swapPath('hej', '/a.webp', '/b.webp')).toEqual({ content: 'hej', count: 0 });
  });
});

describe('isSitePath', () => {
  it('takes paths in the site, not built or outside ones', () => {
    expect(isSitePath('/uploads/a.webp')).toBe(true);
    expect(isSitePath('/images/hero 1.jpg')).toBe(false);
    expect(isSitePath('/_next/static/media/hero.abc.jpg')).toBe(false);
    expect(isSitePath('https://example.com/a.jpg')).toBe(false);
    expect(isSitePath('/a/../b.jpg')).toBe(false);
  });
});

describe('replaceImage', () => {
  const site = {
    id: 'site-1',
    name: 'Test',
    repoOwner: 'acme',
    repoName: 'web',
    defaultBranch: 'main',
    workBranch: 'sigtil-edits-anna',
    githubToken: 'token',
    editablePaths: ['app/', 'content/', 'public/'],
  } as unknown as Site;

  let gh: FakeGitHub;
  beforeEach(() => {
    resetLocks();
    gh = new FakeGitHub();
    vi.stubGlobal('fetch', gh.fetch);
    gh.push(
      'main',
      {
        'app/page.tsx': "const da = { src: '/uploads/a.webp' };\nconst en = { src: '/uploads/a.webp' };\n",
        'content/om.da.md': '![Baren](/uploads/a.webp)\n',
        'content/menu.md': '![Mad](/uploads/mad.webp)\n',
      },
      'initial',
    );
  });

  it('swaps the picture everywhere it is shown, as one change', async () => {
    const turn = { id: 't1' };
    await writeFile(site, 'public/uploads/b.webp', Buffer.from([1, 2, 3]), withTurn('sigtil: Tilføjede billedet b', turn));
    const result = await replaceImage(
      site,
      '/uploads/a.webp',
      '/uploads/b.webp',
      withTurn('sigtil: Skiftede et billede på siden', turn),
    );
    expect(result.status).toBe('saved');
    const files = gh.files(site.workBranch);
    expect(files['app/page.tsx']).toBe("const da = { src: '/uploads/b.webp' };\nconst en = { src: '/uploads/b.webp' };\n");
    expect(files['content/om.da.md']).toBe('![Baren](/uploads/b.webp)\n');
    expect(files['content/menu.md']).toBe('![Mad](/uploads/mad.webp)\n');
    expect(changesOf(await unpublishedCommits(site))).toHaveLength(1);
  });

  it('leaves a picture the content does not name for the AI', async () => {
    const result = await replaceImage(site, '/images/hero.jpg', '/uploads/b.webp', 'sigtil: x');
    expect(result.status).toBe('unclear');
    expect(await unpublishedCommits(site)).toHaveLength(0);
  });
});
