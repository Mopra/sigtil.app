import type { Site } from './db';
import { readTextFiles } from './agent/tools';
import { updateFile } from './github';

export type TextEditResult =
  /** Changed straight in the one place the text lives. */
  | { status: 'saved' }
  /** Not found as a whole text, or found in several places; the AI has to work it out. */
  | { status: 'unclear'; matches: number };

type Match = { path: string; index: number; found: string; replacement: string };

// A text counts as a whole value when it fills a string, a JSX text, a JSON
// value or a markdown line: only quotes, tags, line breaks or markdown marks
// may sit next to it, never other words. That keeps "Besøg" from matching
// inside "Besøg os i dag".
const OPEN = new Set(['"', "'", '`', '>', '\n', '']);
const CLOSE = new Set(['"', "'", '`', '<', '\n', '', '\r']);
const MD_OPEN = new Set(['#', '-', '*', '+', ':']);

function isMarkdown(path: string) {
  return /\.mdx?$/i.test(path);
}

/** Position of the neighbouring character, skipping spaces and tabs but not line breaks. */
function neighbour(content: string, from: number, step: 1 | -1) {
  let i = from;
  while (i >= 0 && i < content.length && (content[i] === ' ' || content[i] === '\t')) i += step;
  return i;
}

/** The character at a position, or '' past either end. */
function at(content: string, i: number) {
  return i >= 0 && i < content.length ? content[i] : '';
}

/** The ways a text can be written in a file, paired with how its replacement is written the same way. */
function spellings(path: string, oldText: string, newText: string): Array<[string, string]> {
  const out: Array<[string, string]> = [[oldText, newText]];
  // Inside a JSON value or a JS string in double quotes: " and \ are escaped.
  const esc = (s: string) => JSON.stringify(s).slice(1, -1);
  if (esc(oldText) !== oldText) out.push([esc(oldText), esc(newText)]);
  // JSX text with HTML entities for quotes and ampersands.
  if (/\.[jt]sx$/i.test(path)) {
    const ent = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&apos;').replace(/"/g, '&quot;');
    if (ent(oldText) !== oldText) out.push([ent(oldText), ent(newText)]);
  }
  return out;
}

function findWhole(path: string, content: string, oldText: string, newText: string): Match[] {
  const matches: Match[] = [];
  for (const [found, replacement] of spellings(path, oldText, newText)) {
    for (let i = content.indexOf(found); i !== -1; i = content.indexOf(found, i + found.length)) {
      const before = at(content, neighbour(content, i - 1, -1));
      const afterAt = neighbour(content, i + found.length, 1);
      const after = at(content, afterAt);
      const opens = OPEN.has(before) || (isMarkdown(path) && MD_OPEN.has(before));
      // A quoted text followed by a colon is a key in JSON or code, not visible text.
      const isKey = (after === '"' || after === "'") && at(content, neighbour(content, afterAt + 1, 1)) === ':';
      if (opens && CLOSE.has(after) && !isKey) matches.push({ path, index: i, found, replacement });
    }
  }
  return matches;
}

/**
 * Replace a text the editor changed in place in the preview. Only when it
 * appears exactly once as a whole text in the site's content is it changed
 * here; anything less certain is left for the AI.
 */
export async function replaceText(site: Site, oldText: string, newText: string): Promise<TextEditResult> {
  const files = await readTextFiles(site);
  const matches = files.flatMap(f => findWhole(f.path, f.content, oldText, newText));
  if (matches.length !== 1) return { status: 'unclear', matches: matches.length };

  const [m] = matches;
  // Checked against the file as it is when writing, so the write cannot undo a newer edit.
  const saved = await updateFile(
    site,
    m.path,
    content =>
      content.slice(m.index, m.index + m.found.length) === m.found
        ? content.slice(0, m.index) + m.replacement + content.slice(m.index + m.found.length)
        : null,
    `sigtil: Rettede teksten “${short(oldText)}” til “${short(newText)}”`,
  );
  return saved ? { status: 'saved' } : { status: 'unclear', matches: 1 };
}

// A picture's path counts when it stands alone: in quotes, in a markdown
// link, or as a value on its own. That keeps "/a/b.jpg" from matching inside
// "/x/a/b.jpg" or "/a/b.jpg.bak".
const PATH_BEFORE = new Set(['"', "'", '`', '(', '=', ' ', '\t', '\n', '']);
const PATH_AFTER = new Set(['"', "'", '`', ')', '?', '#', ' ', '\t', '\n', '\r', '']);

/** `content` with every standalone `oldPath` swapped for `newPath`, and how many there were. */
export function swapPath(content: string, oldPath: string, newPath: string): { content: string; count: number } {
  let out = '';
  let from = 0;
  let count = 0;
  for (let i = content.indexOf(oldPath); i !== -1; i = content.indexOf(oldPath, i + oldPath.length)) {
    if (!PATH_BEFORE.has(at(content, i - 1)) || !PATH_AFTER.has(at(content, i + oldPath.length))) continue;
    out += content.slice(from, i) + newPath;
    from = i + oldPath.length;
    count++;
  }
  return { content: out + content.slice(from), count };
}

/** A picture path as the site's own files would name it; anything else is left for the AI. */
export function isSitePath(src: string) {
  return /^\/[\w\-./%@+~]{3,300}$/.test(src) && !src.startsWith('/_next/') && !src.includes('..');
}

/**
 * Show `newPath` everywhere the site shows the picture at `oldPath`: both
 * language versions, and every page that uses the same picture. When the
 * path is not written anywhere in the site's content (a picture the code
 * imports, say), nothing changes and the AI has to place it.
 */
export async function replaceImage(
  site: Site,
  oldPath: string,
  newPath: string,
  message: string,
): Promise<TextEditResult> {
  const files = (await readTextFiles(site)).filter(f => swapPath(f.content, oldPath, newPath).count > 0);
  let saved = 0;
  for (const f of files) {
    // Swapped in the file as it is when writing, so the write cannot undo a newer edit.
    const done = await updateFile(
      site,
      f.path,
      content => {
        const next = swapPath(content, oldPath, newPath);
        return next.count > 0 ? next.content : null;
      },
      message,
    );
    if (done) saved++;
  }
  return saved > 0 ? { status: 'saved' } : { status: 'unclear', matches: 0 };
}

function short(s: string) {
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}
