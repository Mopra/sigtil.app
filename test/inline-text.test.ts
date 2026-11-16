import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Site } from '@/lib/db';
import { FakeGitHub } from './fake-github';
import { resetLocks } from './fake-db';

vi.mock('@/lib/db', () => import('./fake-db'));

const { languageTwins, onlyNumbersChanged, removeText, replaceText, withoutText } = await import('@/lib/inline-edit');
const { changesOf, unpublishedCommits } = await import('@/lib/github');

const site = {
  id: 'site-1',
  name: 'Test',
  repoOwner: 'acme',
  repoName: 'web',
  defaultBranch: 'main',
  workBranch: 'sigtil-edits-anna',
  githubToken: 'token',
  editablePaths: ['app/', 'content/', 'messages/'],
} as unknown as Site;

let gh: FakeGitHub;
function start(files: Record<string, string>) {
  resetLocks();
  gh = new FakeGitHub();
  vi.stubGlobal('fetch', gh.fetch);
  gh.push('main', files, 'initial');
}
const work = () => gh.files(site.workBranch);

describe('languageTwins', () => {
  it('pairs the language versions of the same content', () => {
    expect(languageTwins('messages/da.json', 'messages/en.json')).toBe(true);
    expect(languageTwins('content/pages/om.da.md', 'content/pages/om.en.md')).toBe(true);
    expect(languageTwins('app/da/page.tsx', 'app/en/page.tsx')).toBe(true);
  });

  it('does not pair other files', () => {
    expect(languageTwins('content/om.da.md', 'content/menu.en.md')).toBe(false);
    expect(languageTwins('content/a.md', 'content/a.ts')).toBe(false);
    expect(languageTwins('app/om/page.tsx', 'app/vi/page.tsx')).toBe(false);
    expect(languageTwins('messages/da.json', 'messages/da.json')).toBe(false);
  });
});

describe('onlyNumbersChanged', () => {
  it('tells a new number from new words', () => {
    expect(onlyNumbersChanged('495,00 kr.', '525,50 kr.')).toBe(true);
    expect(onlyNumbersChanged('16:00 – 22:00', '17:00 – 23:30')).toBe(true);
    expect(onlyNumbersChanged('Menu', 'Spisekort')).toBe(false);
    expect(onlyNumbersChanged('495 kr.', '495 kr. pr. person')).toBe(false);
  });
});

describe('replaceText in every language', () => {
  beforeEach(() =>
    start({
      'messages/da.json': '{\n  "price": "495 kr.",\n  "menu": "Menu",\n  "open": "Åbent"\n}\n',
      'messages/en.json': '{\n  "price": "495 kr.",\n  "menu": "Menu",\n  "open": "Open"\n}\n',
    }),
  );

  it('changes a number that reads the same in both, as one change', async () => {
    expect((await replaceText(site, '495 kr.', '525 kr.')).status).toBe('saved');
    expect(work()['messages/da.json']).toContain('"price": "525 kr."');
    expect(work()['messages/en.json']).toContain('"price": "525 kr."');
    expect(changesOf(await unpublishedCommits(site))).toHaveLength(1);
  });

  it('leaves new words for the AI, which can translate them', async () => {
    expect((await replaceText(site, 'Menu', 'Spisekort')).status).toBe('unclear');
    expect(await unpublishedCommits(site)).toHaveLength(0);
  });

  it('still changes a text found in one place', async () => {
    expect((await replaceText(site, 'Åbent', 'Vi har åbent')).status).toBe('saved');
    expect(work()['messages/da.json']).toContain('"open": "Vi har åbent"');
    expect(work()['messages/en.json']).toContain('"open": "Open"');
  });
});

describe('withoutText', () => {
  const cut = (path: string, content: string, text: string) =>
    withoutText(path, content, content.indexOf(text), text.length);

  it('takes a paragraph, a heading or a list item out of markdown', () => {
    expect(cut('a.md', '# Titel\n\nFørste.\n\nAnden.\n', 'Første.')).toBe('# Titel\n\nAnden.\n');
    expect(cut('a.md', 'Før.\n\n## Overskrift\n\nEfter.\n', 'Overskrift')).toBe('Før.\n\nEfter.\n');
    expect(cut('a.md', '- Sild\n- Rejer\n- Brie\n', 'Rejer')).toBe('- Sild\n- Brie\n');
    expect(cut('a.md', 'Sidste linje', 'Sidste linje')).toBe('');
  });

  it('leaves markdown text that shares its line', () => {
    expect(cut('a.md', 'Pris: **495 kr.** pr. person\n', '495 kr.')).toBeNull();
  });

  it('takes an element that holds only the text out of JSX', () => {
    const page = '<main>\n  <h1>Titel</h1>\n  <p className="lead">\n    Hold jeres fest hos os.\n  </p>\n  <Footer />\n</main>\n';
    expect(cut('page.tsx', page, 'Hold jeres fest hos os.')).toBe('<main>\n  <h1>Titel</h1>\n  <Footer />\n</main>\n');
  });

  it('leaves JSX where an expression would be left half written', () => {
    expect(cut('p.tsx', '{open && (\n  <p>Vi har åbent.</p>\n)}\n', 'Vi har åbent.')).toBeNull();
    expect(cut('p.tsx', 'return (\n  <p>Vi har åbent.</p>\n);\n', 'Vi har åbent.')).toBeNull();
    expect(cut('p.tsx', '<ul>\n  {items.map(i =>\n  <li>Fast tekst</li>\n  )}\n</ul>\n', 'Fast tekst')).toBeNull();
    expect(cut('p.tsx', '<div>\n  <p>En</p><p>To</p>\n</div>\n', 'En')).toBeNull();
    expect(cut('p.tsx', '<div>\n  <p>En <b>fed</b></p>\n</div>\n', 'fed')).toBeNull();
  });

  it('leaves markdown where the line means more than its text', () => {
    expect(cut('a.md', 'Titel\n---\n\nBrødtekst.\n', 'Titel')).toBeNull();
    expect(cut('a.md', 'Titel\n=====\n', 'Titel')).toBeNull();
    expect(cut('a.md', '---\ntitle: Om\ntags:\n  - Mad\n---\n\nTekst.\n', 'Mad')).toBeNull();
    expect(cut('a.md', '- Frugt\n  - Æble\n- Grønt\n', 'Frugt')).toBeNull();
    expect(cut('a.md', 'Før.\n\n```\nkode\n```\n', 'kode')).toBeNull();
    expect(cut('a.md', '---\ntitle: Om\n---\n\nTekst.\n\nMere.\n', 'Tekst.')).toBe('---\ntitle: Om\n---\n\nMere.\n');
  });

  it('leaves an element that is all its parent holds', () => {
    expect(cut('p.tsx', '<main>\n  <Card>\n    <p>Vi elsker mad.</p>\n  </Card>\n</main>\n', 'Vi elsker mad.')).toBeNull();
    expect(cut('p.tsx', '<Card>\n  <Icon />\n  <p>Vi elsker mad.</p>\n</Card>\n', 'Vi elsker mad.')).toBe('<Card>\n  <Icon />\n</Card>\n');
    expect(cut('p.tsx', '<Card>\n  <p>Vi elsker mad.</p>\n  <Icon />\n</Card>\n', 'Vi elsker mad.')).toBe('<Card>\n  <Icon />\n</Card>\n');
  });

  it('never takes a text out of JSON or a string', () => {
    expect(cut('da.json', '{ "a": "Tekst" }', 'Tekst')).toBeNull();
    expect(cut('page.tsx', "const t = 'Tekst';\n", 'Tekst')).toBeNull();
  });
});

describe('removeText', () => {
  it('takes a text out where there is one language', async () => {
    start({ 'content/om.md': '# Om os\n\nVi elsker mad.\n\nKom forbi.\n' });
    expect((await removeText(site, 'Vi elsker mad.')).status).toBe('saved');
    expect(work()['content/om.md']).toBe('# Om os\n\nKom forbi.\n');
  });

  it('leaves it for the AI where there is another language version', async () => {
    start({
      'content/om.da.md': '# Om os\n\nVi elsker mad.\n',
      'content/om.en.md': '# About\n\nWe love food.\n',
    });
    expect((await removeText(site, 'Vi elsker mad.')).status).toBe('unclear');
    expect(await unpublishedCommits(site)).toHaveLength(0);
  });

  it('leaves it for the AI where it cannot be taken out safely', async () => {
    start({ 'messages/dk.json': '{\n  "lead": "Vi elsker mad."\n}\n' });
    expect((await removeText(site, 'Vi elsker mad.')).status).toBe('unclear');
    expect(await unpublishedCommits(site)).toHaveLength(0);
  });
});
