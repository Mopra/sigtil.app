import type { Site } from './db';
import { readTextFiles } from './agent/tools';
import { updateFile, withTurn } from './github';

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

// Languages a small site is likely to come in. A list, not "any two letters",
// so that pages called /om and /vi are not taken for language versions.
const LOCALES = new Set(['da', 'en', 'de', 'sv', 'no', 'nb', 'fi', 'fr', 'es', 'it', 'nl', 'pl']);

/**
 * Whether two files are the same content in two languages: their paths differ
 * in one part only, and that part is a language code on both sides, as in
 * messages/da.json and messages/en.json, or om.da.md and om.en.md.
 */
export function languageTwins(a: string, b: string): boolean {
  const pa = a.split(/[/.]/);
  const pb = b.split(/[/.]/);
  if (pa.length !== pb.length) return false;
  const differing = pa.flatMap((part, i) => (part === pb[i] ? [] : [i]));
  if (differing.length !== 1) return false;
  const [i] = differing;
  // Never the last part: that is the file type, and "md" and "ts" are not languages.
  return i < pa.length - 1 && LOCALES.has(pa[i]) && LOCALES.has(pb[i]);
}

/** One match per file, in files that are each other's language versions. */
function inEveryLanguage(matches: Match[]): boolean {
  return matches.length > 1 && matches.every((m, i) => matches.every((n, j) => i === j || languageTwins(m.path, n.path)));
}

/** The words are the same and only numbers differ, as in "495 kr." and "525 kr.". */
export function onlyNumbersChanged(a: string, b: string): boolean {
  const words = (s: string) => s.replace(/\d+/g, '0');
  return words(a) === words(b);
}

/** Write one match's replacement, unless the file changed under it. */
function applyMatch(site: Site, m: Match, message: string) {
  // Checked against the file as it is when writing, so the write cannot undo a newer edit.
  return updateFile(
    site,
    m.path,
    content =>
      content.slice(m.index, m.index + m.found.length) === m.found
        ? content.slice(0, m.index) + m.replacement + content.slice(m.index + m.found.length)
        : null,
    message,
  );
}

/**
 * Replace a text the editor changed in place in the preview. It is changed
 * here when it appears exactly once as a whole text in the site's content.
 * A text that reads the same in every language version (a price, an opening
 * hour, a phone number) is changed in all of them, but only when just its
 * numbers changed: new words may need translating, and that is the AI's job.
 * Anything less certain is left for the AI too.
 */
export async function replaceText(site: Site, oldText: string, newText: string): Promise<TextEditResult> {
  const files = await readTextFiles(site);
  const matches = files.flatMap(f => findWhole(f.path, f.content, oldText, newText));
  const everyLanguage = onlyNumbersChanged(oldText, newText) && inEveryLanguage(matches);
  if (matches.length !== 1 && !everyLanguage) return { status: 'unclear', matches: matches.length };

  // The language versions are one change to the editor: one line before Udgiv, taken out together.
  const label = `sigtil: Rettede teksten “${short(oldText)}” til “${short(newText)}”`;
  const message = matches.length > 1 ? withTurn(label, { id: crypto.randomUUID() }) : label;
  let saved = 0;
  for (const m of matches) {
    if (await applyMatch(site, m, message)) saved++;
  }
  return saved === matches.length ? { status: 'saved' } : { status: 'unclear', matches: matches.length };
}

/** Position of the neighbouring character that is not white space, line breaks included. */
function beyondSpace(content: string, from: number, step: 1 | -1) {
  let i = from;
  while (i >= 0 && i < content.length && /\s/.test(content[i])) i += step;
  return i;
}

/**
 * `content` without the text at `index`, when taking it out is sure to leave
 * the file sound; null when it is not, and the AI has to do it.
 *
 * In markdown that is a text filling a line of its own: a paragraph, a
 * heading or a list item. In JSX it is a text that is all an element holds,
 * where the element fills its own lines and sits among other elements, so no
 * expression around it is left half written. A text in JSON or in a string is
 * never taken out here: the page would still show the empty spot.
 */
export function withoutText(path: string, content: string, index: number, length: number): string | null {
  if (isMarkdown(path)) {
    const lineStart = content.lastIndexOf('\n', index - 1) + 1;
    const nextBreak = content.indexOf('\n', index + length);
    const lineEnd = nextBreak === -1 ? content.length : nextBreak;
    const line = content.slice(lineStart, lineEnd).trim();
    if (line.replace(/^(#{1,6}|[-*+]|\d+\.)\s+/, '') !== content.slice(index, index + length)) return null;
    const before = content.slice(0, lineStart);
    let after = content.slice(Math.min(content.length, lineEnd + 1));
    // Settings at the top of the file and code samples are not text on the page.
    const settings = content.match(/^---\r?\n[\s\S]*?\n---[ \t]*(\r?\n|$)/);
    if (settings && index < settings[0].length) return null;
    if ((before.match(/^\s*(```|~~~)/gm) ?? []).length % 2 === 1) return null;
    // What follows belongs to this line: the underline of a heading written
    // that way, or the items under a list item. Alone they would mean something else.
    const indent = content.slice(lineStart).match(/^[ \t]*/)![0].length;
    const following = after.match(/^(?:[ \t]*\r?\n)*([ \t]*)(\S[^\n]*)?/);
    if (/^[ \t]*(=+|-+)[ \t]*\r?(\n|$)/.test(after)) return null;
    if (following?.[2] && following[1].length > indent) return null;
    // A paragraph leaves the empty lines on both its sides behind: keep one.
    if (/\n\n$/.test(before) && after.startsWith('\n')) after = after.slice(1);
    return before + after;
  }

  if (/\.[jt]sx$/i.test(path)) {
    const tagEnd = beyondSpace(content, index - 1, -1);
    if (at(content, tagEnd) !== '>') return null;
    const open = content.lastIndexOf('<', tagEnd);
    if (open === -1) return null;
    const tag = content.slice(open, tagEnd + 1).match(/^<([A-Za-z][\w.]*)(\s[^<]*)?>$/);
    // A ">" among the attributes other than an arrow's means this is not one plain opening tag.
    if (!tag || tag[0].endsWith('/>') || (tag[2] ?? '').slice(0, -1).replace(/=>/g, '').includes('>')) return null;
    const closeAt = beyondSpace(content, index + length, 1);
    const close = `</${tag[1]}>`;
    if (!content.startsWith(close, closeAt)) return null;
    const end = closeAt + close.length;

    // Among other elements: after the end of a tag and before the start of one.
    const prev = beyondSpace(content, open - 1, -1);
    if (at(content, prev) !== '>' || at(content, prev - 1) === '=') return null;
    const next = beyondSpace(content, end, 1);
    if (at(content, next) !== '<') return null;
    // Not the only thing its parent holds: a component may require something inside it.
    const parentOpens = at(content, prev - 1) !== '/' && at(content, content.lastIndexOf('<', prev) + 1) !== '/';
    if (parentOpens && at(content, next + 1) === '/') return null;

    // On lines of its own, so whole lines go and nothing else on them is touched.
    const lineStart = content.lastIndexOf('\n', open - 1) + 1;
    const nextBreak = content.indexOf('\n', end);
    const lineEnd = nextBreak === -1 ? content.length : nextBreak;
    if (content.slice(lineStart, open).trim() || content.slice(end, lineEnd).trim()) return null;
    return content.slice(0, lineStart) + content.slice(Math.min(content.length, lineEnd + 1));
  }

  return null;
}

/**
 * Take out a text the editor removed in place in the preview. Only when it
 * appears exactly once, can be taken out safely (see withoutText), and the
 * content has no other language version: there the same text is worded
 * differently, and only the AI can find and remove it too.
 */
export async function removeText(site: Site, oldText: string): Promise<TextEditResult> {
  const files = await readTextFiles(site);
  const matches = files.flatMap(f => findWhole(f.path, f.content, oldText, ''));
  if (matches.length !== 1) return { status: 'unclear', matches: matches.length };

  const [m] = matches;
  if (files.some(f => languageTwins(f.path, m.path))) return { status: 'unclear', matches: 1 };
  const saved = await updateFile(
    site,
    m.path,
    content =>
      content.slice(m.index, m.index + m.found.length) === m.found
        ? withoutText(m.path, content, m.index, m.found.length)
        : null,
    `sigtil: Fjernede teksten “${short(oldText)}”`,
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
  return (
    /^\/[\w\-./%@+~]{3,300}$/.test(src) &&
    /\.(jpe?g|png|webp|gif|avif|svg)$/i.test(src) &&
    !src.startsWith('/_next/') &&
    !src.includes('..')
  );
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
