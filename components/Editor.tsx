'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SignOutButton } from '@clerk/nextjs';
import Chat, { type ChatPrefill } from './Chat';
import PublishBar from './PublishBar';
import { t } from '@/lib/strings';

export type SiteStatus = {
  pendingChanges: number;
  conflict: boolean;
  preview: { state: string; url: string | null; upToDate: boolean } | null;
  productionUrl: string;
};

type PageLink = { route: string; label: string };

export default function Editor({
  siteId,
  siteName,
  productionUrl,
  showSitesLink = false,
}: {
  siteId: string;
  siteName: string;
  productionUrl: string;
  showSitesLink?: boolean;
}) {
  const [status, setStatus] = useState<SiteStatus | null>(null);
  // Sticky: only ever advances to a newer build that is live. Swapping it for a
  // building deployment — or clearing it when a status poll fails — would drop
  // the iframe onto a page that cannot be framed, blanking the preview.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const lastReadyUrl = useRef<string | null>(null);
  const [pages, setPages] = useState<PageLink[]>([]);
  const [page, setPage] = useState('/');
  const [prefill, setPrefill] = useState<ChatPrefill | null>(null);

  const refreshPages = useCallback(async () => {
    try {
      const res = await fetch(`/api/sites/${siteId}/pages`);
      if (!res.ok) return;
      const next: { pages: PageLink[] } = await res.json();
      setPages(next.pages);
      // The open page was removed or renamed: fall back to the front page.
      setPage(current => (next.pages.some(p => p.route === current) ? current : '/'));
    } catch {
      // keep the last list
    }
  }, [siteId]);

  useEffect(() => {
    refreshPages();
  }, [refreshPages]);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/sites/${siteId}/status`);
      if (!res.ok) return;
      const next: SiteStatus = await res.json();
      setStatus(next);
      // Reload the preview iframe when a fresh build becomes ready.
      const url = next.preview?.url ?? null;
      if (url && url !== lastReadyUrl.current) {
        lastReadyUrl.current = url;
        setPreviewUrl(url);
        setIframeKey(k => k + 1);
      }
    } catch {
      // transient — next poll will recover
    }
  }, [siteId]);

  useEffect(() => {
    refreshStatus();
    const id = setInterval(refreshStatus, 5000);
    return () => clearInterval(id);
  }, [refreshStatus]);

  const onEdited = useCallback(() => {
    refreshStatus();
    refreshPages();
  }, [refreshStatus, refreshPages]);

  const pagePath = page === '/' ? '' : page;
  const currentLabel = pages.find(p => p.route === page)?.label ?? page;
  const ask = (text: string) => setPrefill({ text, id: Date.now() });

  const previewBuilding =
    (status?.preview && !status.preview.upToDate) ||
    status?.preview?.state === 'BUILDING' ||
    status?.preview?.state === 'QUEUED';

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-stone-200 bg-white px-5 py-3">
        <div>
          {showSitesLink && (
            <a href="/sites" className="text-sm text-stone-400 hover:underline">
              ← {t.yourSites}
            </a>
          )}
          <h1 className="text-lg font-bold leading-tight">{siteName}</h1>
        </div>
        <div className="flex items-center gap-5">
          <PublishBar siteId={siteId} status={status} onChanged={onEdited} />
          <SignOutButton redirectUrl="/sign-in">
            <button className="text-sm text-stone-500 hover:underline">{t.logout}</button>
          </SignOutButton>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[420px] shrink-0 flex-col border-r border-stone-200 bg-white">
          <Chat siteId={siteId} page={page} prefill={prefill} locked={status?.conflict ?? false} onEdited={onEdited} />
        </div>

        <div className="relative flex-1 bg-stone-100">
          <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-4 py-2 text-sm text-stone-500">
            {pages.length > 0 ? (
              <span className="flex items-center gap-3">
                <select
                  value={page}
                  onChange={e => setPage(e.target.value)}
                  aria-label={t.pagePicker}
                  className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-stone-700 outline-none focus:border-accent"
                >
                  {pages.map(p => (
                    <option key={p.route} value={p.route}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <button onClick={() => ask(t.pageNewPrompt)} className="hover:text-accent hover:underline">
                  {t.pageNew}
                </button>
                <button onClick={() => ask(t.pageRenamePrompt(currentLabel))} className="hover:text-accent hover:underline">
                  {t.pageRename}
                </button>
                {page !== '/' && (
                  <button onClick={() => ask(t.pageDeletePrompt(currentLabel))} className="hover:text-red-600 hover:underline">
                    {t.pageDelete}
                  </button>
                )}
              </span>
            ) : (
              <span>{t.previewTitle}</span>
            )}
            <span className="flex items-center gap-3">
              {previewBuilding && (
                <span className="flex items-center gap-2 text-accent">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                  {t.previewUpdating}
                </span>
              )}
              {previewUrl && (
                <a href={previewUrl + pagePath} target="_blank" rel="noreferrer" className="hover:underline">
                  {t.previewOpenNew}
                </a>
              )}
            </span>
          </div>
          {previewUrl ? (
            <iframe
              key={iframeKey}
              src={previewUrl + pagePath}
              className="h-[calc(100%-37px)] w-full border-0 bg-white"
              title={t.previewTitle}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-stone-400">
              {t.previewNone}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
