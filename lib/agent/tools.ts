import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { Site } from '@/lib/db';
import { commitTreeChanges, listTree, readFile, writeFile, type TreeEntry } from '@/lib/github';
import { pagesFromFiles } from '@/lib/pages';

const ALWAYS_BLOCKED = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'next.config',
  'vercel.json',
  'vercel.ts',
  'tsconfig.json',
  '.github/',
  '.env',
  'node_modules/',
];

export function isEditable(site: Site, path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.includes('..')) return false;
  if (ALWAYS_BLOCKED.some(b => normalized === b || normalized.startsWith(b))) return false;
  return site.editablePaths.some(prefix => normalized.startsWith(prefix));
}

const MAX_FILE_CHARS = 60_000;

/** Extensions worth grepping — everything else is a binary or a build artefact. */
const SEARCHABLE = /\.(tsx?|jsx?|mdx?|json|ya?ml|css|scss|html|txt|svg)$/i;
/** Skip blobs this large when searching; they are never hand-written content. */
const MAX_SEARCHABLE_BYTES = 200_000;
const MAX_SEARCHED_FILES = 80;
const MAX_MATCHES = 50;

/** Files the agent is allowed to touch — the only ones worth listing or searching. */
function editableTree(site: Site, tree: Array<{ path: string; size: number }>) {
  return tree.filter(t => isEditable(site, t.path));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  }
  return out;
}

function normalize(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

/** Files at `path`, or under it when it names a folder. */
function filesAt(tree: TreeEntry[], path: string) {
  const p = normalize(path);
  return tree.filter(t => t.path === p || t.path.startsWith(p + '/'));
}

/** The file(s) rendering the front page; deleting those would leave the site without a home. */
function isFrontPage(path: string) {
  return pagesFromFiles([path]).some(p => p.route === '/');
}

export function createSiteTools(site: Site) {
  return {
    listFiles: tool({
      description:
        'List the editable content files in the website project. Use this to find where content lives. Optionally filter by a path prefix.',
      inputSchema: z.object({
        prefix: z.string().optional().describe('Only list files under this path prefix, e.g. "app/"'),
      }),
      execute: async ({ prefix }) => {
        const files = editableTree(site, await listTree(site)).map(t => t.path);
        const filtered = prefix ? files.filter(f => f.startsWith(prefix)) : files;
        return filtered.slice(0, 500).join('\n') || '(no files)';
      },
    }),

    searchFiles: tool({
      description:
        'Search the text of all editable files for a string, and get back the matching lines with their file paths and line numbers. Prefer this over reading whole files when you are looking for specific wording (e.g. opening hours, a dish name, a headline) — it is much faster and finds every language version of a text at once.',
      inputSchema: z.object({
        query: z.string().describe('Text to search for, e.g. "Åbningstider" or "16:00"'),
        caseSensitive: z.boolean().optional().describe('Defaults to false'),
      }),
      execute: async ({ query, caseSensitive }) => {
        if (!query.trim()) return 'Provide a non-empty search string.';
        const candidates = editableTree(site, await listTree(site))
          .filter(t => SEARCHABLE.test(t.path) && t.size <= MAX_SEARCHABLE_BYTES)
          .slice(0, MAX_SEARCHED_FILES);

        const needle = caseSensitive ? query : query.toLowerCase();
        const results = await mapLimit(candidates, 8, async ({ path }) => {
          let content: string;
          try {
            ({ content } = await readFile(site, path));
          } catch {
            return []; // unreadable blob — skip rather than fail the whole search
          }
          return content
            .split('\n')
            .map((line, i) => ({ path, line: i + 1, text: line }))
            .filter(m => (caseSensitive ? m.text : m.text.toLowerCase()).includes(needle));
        });

        const matches = results.flat();
        if (matches.length === 0) return `No matches for "${query}".`;
        const shown = matches.slice(0, MAX_MATCHES);
        const lines = shown.map(m => `${m.path}:${m.line}: ${m.text.trim().slice(0, 200)}`);
        if (matches.length > shown.length) {
          lines.push(`[${matches.length - shown.length} more matches — narrow the search]`);
        }
        return lines.join('\n');
      },
    }),

    listPages: tool({
      description:
        'List the pages of the website: each URL with the file that renders it. Use this first for anything about whole pages (adding, renaming, removing, or "the page about X"). Placeholder segments like [slug] mean one file renders many pages.',
      inputSchema: z.object({}),
      execute: async () => {
        const pages = pagesFromFiles((await listTree(site)).map(t => t.path));
        if (pages.length === 0) return '(no pages found, look at the files instead)';
        return pages
          .map(p => `${p.route}  →  ${p.file}${isEditable(site, p.file) ? '' : '  (not editable)'}`)
          .join('\n');
      },
    }),

    readFile: tool({
      description:
        'Read the current content of a file in the website project. Pass startLine/endLine to read just part of a large file — use the line numbers from searchFiles.',
      inputSchema: z.object({
        path: z.string().describe('File path, e.g. "lib/menu.ts"'),
        startLine: z.number().int().min(1).optional().describe('First line to read (1-based, inclusive)'),
        endLine: z.number().int().min(1).optional().describe('Last line to read (inclusive)'),
      }),
      execute: async ({ path, startLine, endLine }) => {
        const { content } = await readFile(site, path);

        if (startLine != null || endLine != null) {
          const all = content.split('\n');
          const from = Math.max(1, startLine ?? 1);
          const to = Math.min(all.length, endLine ?? all.length);
          if (from > all.length) return `File has only ${all.length} lines.`;
          const slice = all.slice(from - 1, to).join('\n');
          return `[lines ${from}-${to} of ${all.length}]\n${slice}`;
        }

        if (content.length > MAX_FILE_CHARS) {
          return content.slice(0, MAX_FILE_CHARS) + `\n\n[truncated — file is ${content.length} characters]`;
        }
        return content;
      },
    }),

    editFile: tool({
      description:
        'Edit a file by replacing an exact text snippet with new text. The snippet must appear exactly once in the file — include enough surrounding lines to make it unique. This saves the change immediately.',
      inputSchema: z.object({
        path: z.string(),
        oldText: z.string().describe('Exact existing text to replace (must be unique in the file)'),
        newText: z.string().describe('Replacement text'),
        summary: z.string().describe('Very short description of the change, in Danish, e.g. "Opdaterede åbningstider"'),
      }),
      execute: async ({ path, oldText, newText, summary }) => {
        if (!isEditable(site, path)) {
          return `Refused: ${path} is not an editable file on this site. Only content files may be changed.`;
        }
        const { content } = await readFile(site, path);
        const occurrences = content.split(oldText).length - 1;
        if (occurrences === 0) return 'The text to replace was not found. Read the file again and retry with the exact current text.';
        if (occurrences > 1) return `The text to replace appears ${occurrences} times. Include more surrounding context to make it unique.`;
        await writeFile(site, path, content.replace(oldText, newText), `sigtil: ${summary}`);
        return `Saved. ${path} updated.`;
      },
    }),

    createFile: tool({
      description: 'Create a new file with the given content. Only for new content files (pages, data, text).',
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
        summary: z.string().describe('Very short description in Danish'),
      }),
      execute: async ({ path, content, summary }) => {
        if (!isEditable(site, path)) {
          return `Refused: ${path} is not an editable location on this site.`;
        }
        await writeFile(site, path, content, `sigtil: ${summary}`);
        return `Created ${path}.`;
      },
    }),

    moveFiles: tool({
      description:
        'Move or rename files or whole folders, all in one saved step. Use it to rename a page (e.g. move folder "app/om-os" to "app/kontakt" changes its URL). Afterwards, update every link that pointed to the old URL.',
      inputSchema: z.object({
        moves: z.array(z.object({
          from: z.string().describe('Existing file or folder path'),
          to: z.string().describe('New file or folder path'),
        })).min(1),
        summary: z.string().describe('Very short description in Danish, e.g. "Omdøbte siden Om os til Kontakt"'),
      }),
      execute: async ({ moves, summary }) => {
        const tree = await listTree(site);
        const existing = new Set(tree.map(t => t.path));
        const changes = [];
        for (const { from, to } of moves) {
          const src = normalize(from);
          const dest = normalize(to);
          const files = filesAt(tree, src);
          if (files.length === 0) return `Nothing found at ${from}.`;
          for (const f of files) {
            const target = dest + f.path.slice(src.length);
            if (!isEditable(site, f.path) || !isEditable(site, target)) {
              return `Refused: moving ${f.path} to ${target} is outside the editable content of this site.`;
            }
            if (existing.has(target)) return `Refused: ${target} already exists.`;
            if (isFrontPage(f.path)) return 'Refused: the front page cannot be moved.';
            changes.push({ path: target, mode: f.mode, sha: f.sha }, { path: f.path, mode: f.mode, sha: null });
          }
        }
        await commitTreeChanges(site, changes, `sigtil: ${summary}`);
        return `Moved ${changes.length / 2} file(s). Now update links to the old location.`;
      },
    }),

    deleteFiles: tool({
      description:
        'Delete files or whole folders, all in one saved step. Use it to remove a page (delete its folder or file). Only after the user has confirmed, and remove links to the page first.',
      inputSchema: z.object({
        paths: z.array(z.string()).min(1).describe('Files or folders to delete'),
        summary: z.string().describe('Very short description in Danish, e.g. "Fjernede siden Nyheder"'),
      }),
      execute: async ({ paths, summary }) => {
        const tree = await listTree(site);
        const files = [...new Set(paths.flatMap(p => filesAt(tree, p)))];
        if (files.length === 0) return `Nothing found at ${paths.join(', ')}.`;
        for (const f of files) {
          if (!isEditable(site, f.path)) return `Refused: ${f.path} is not an editable file on this site.`;
          if (isFrontPage(f.path)) return 'Refused: the front page cannot be deleted.';
        }
        await commitTreeChanges(site, files.map(f => ({ path: f.path, mode: f.mode, sha: null })), `sigtil: ${summary}`);
        return `Deleted ${files.length} file(s).`;
      },
    }),
  } satisfies ToolSet;
}
