/**
 * Works out a site's pages (URLs) from its file listing, so editors and the
 * agent can talk about "siden Om os" instead of files.
 *
 * Understands Next.js App Router (`app/**\/page.tsx`), Pages Router and Astro
 * (`pages/**`), and falls back to plain `.html` files for static sites.
 */

export type SitePage = {
  /** URL path, e.g. "/" or "/om-os". Dynamic segments stay as "[slug]". */
  route: string;
  /** Friendly name derived from the URL, e.g. "Om os". */
  label: string;
  /** The file that renders the page. */
  file: string;
  /** True when the URL has a placeholder segment and can't be opened as-is. */
  dynamic: boolean;
};

const APP_PAGE = /^(?:src\/)?app\/(?:(.*)\/)?page\.(?:tsx|jsx|ts|js|mdx|md)$/;
const PAGES_PAGE = /^(?:src\/)?pages\/(.+)\.(?:tsx|jsx|ts|js|mdx|md|astro)$/;
const HTML_PAGE = /^(?:public\/)?(.+)\.html$/;
const IGNORED_DIRS = /(^|\/)(node_modules|\.next|dist|build|out)\//;

export function pagesFromFiles(paths: string[]): SitePage[] {
  const pages: SitePage[] = [];

  for (const file of paths) {
    if (IGNORED_DIRS.test(file)) continue;

    const app = APP_PAGE.exec(file);
    if (app) {
      const segments = (app[1] ?? '').split('/').filter(Boolean);
      // Private folders and parallel-route slots never map to a URL of their own.
      if (segments.some(s => s.startsWith('_') || s.startsWith('@'))) continue;
      // Route groups "(marketing)" are folders only, not part of the URL.
      addPage(pages, segments.filter(s => !/^\(.*\)$/.test(s)), file);
      continue;
    }

    const legacy = PAGES_PAGE.exec(file);
    if (legacy) {
      const segments = legacy[1].split('/');
      if (segments[0] === 'api' || segments.some(s => s.startsWith('_'))) continue;
      if (segments[segments.length - 1] === 'index') segments.pop();
      addPage(pages, segments, file);
    }
  }

  if (pages.length === 0) {
    for (const file of paths) {
      if (IGNORED_DIRS.test(file)) continue;
      const html = HTML_PAGE.exec(file);
      if (!html) continue;
      const segments = html[1].split('/');
      if (segments[segments.length - 1] === 'index') segments.pop();
      addPage(pages, segments, file);
    }
  }

  return pages.sort((a, b) => (a.route === '/' ? -1 : b.route === '/' ? 1 : a.route.localeCompare(b.route)));
}

function addPage(pages: SitePage[], segments: string[], file: string) {
  const route = '/' + segments.join('/');
  if (pages.some(p => p.route === route)) return; // e.g. a route in both app/ and pages/
  pages.push({
    route,
    label: labelFor(segments),
    file,
    dynamic: segments.some(s => s.startsWith('[')),
  });
}

function labelFor(segments: string[]): string {
  const last = segments.filter(s => !s.startsWith('[')).pop();
  if (!last) return segments.length === 0 ? 'Forside' : segments.join('/');
  const words = decodeURIComponent(last).replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
