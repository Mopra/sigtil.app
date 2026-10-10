import type { Site } from './db';
import { readTextFiles } from './agent/tools';
import { readFile, writeFile } from './github';

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
  // Re-read the file at the branch tip so the write cannot undo a newer edit.
  const { content } = await readFile(site, m.path);
  if (content.slice(m.index, m.index + m.found.length) !== m.found) return { status: 'unclear', matches: 1 };
  const next = content.slice(0, m.index) + m.replacement + content.slice(m.index + m.found.length);
  await writeFile(site, m.path, next, `sigtil: Rettede teksten “${short(oldText)}” til “${short(newText)}”`);
  return { status: 'saved' };
}

function short(s: string) {
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}
