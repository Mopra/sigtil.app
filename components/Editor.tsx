'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SignOutButton } from '@clerk/nextjs';
import Chat from './Chat';
import PublishBar from './PublishBar';
import { t } from '@/lib/strings';

export type SiteStatus = {
  pendingChanges: number;
  preview: { state: string; url: string | null; upToDate: boolean } | null;
  productionUrl: string;
};

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
          <PublishBar siteId={siteId} status={status} onChanged={refreshStatus} />
          <SignOutButton redirectUrl="/sign-in">
            <button className="text-sm text-stone-500 hover:underline">{t.logout}</button>
          </SignOutButton>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[420px] shrink-0 flex-col border-r border-stone-200 bg-white">
          <Chat siteId={siteId} onEdited={refreshStatus} />
        </div>

        <div className="relative flex-1 bg-stone-100">
          <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-4 py-2 text-sm text-stone-500">
            <span>{t.previewTitle}</span>
            <span className="flex items-center gap-3">
              {previewBuilding && (
                <span className="flex items-center gap-2 text-accent">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                  {t.previewUpdating}
                </span>
              )}
              {previewUrl && (
                <a href={previewUrl} target="_blank" rel="noreferrer" className="hover:underline">
                  {t.previewOpenNew}
                </a>
              )}
            </span>
          </div>
          {previewUrl ? (
            <iframe
              key={iframeKey}
              src={previewUrl}
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
