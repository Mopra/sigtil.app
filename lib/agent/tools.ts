import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { Site } from '@/lib/db';
import { listFiles, readFile, writeFile } from '@/lib/github';

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

export function createSiteTools(site: Site) {
  return {
    listFiles: tool({
      description:
        'List all files in the website project. Use this first to find where content lives. Optionally filter by a path prefix.',
      inputSchema: z.object({
        prefix: z.string().optional().describe('Only list files under this path prefix, e.g. "app/"'),
      }),
      execute: async ({ prefix }) => {
        const files = await listFiles(site);
        const filtered = prefix ? files.filter(f => f.startsWith(prefix)) : files;
        return filtered.slice(0, 500).join('\n') || '(no files)';
      },
    }),

    readFile: tool({
      description: 'Read the current content of a file in the website project.',
      inputSchema: z.object({
        path: z.string().describe('File path, e.g. "lib/menu.ts"'),
      }),
      execute: async ({ path }) => {
        const { content } = await readFile(site, path);
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
  } satisfies ToolSet;
}
