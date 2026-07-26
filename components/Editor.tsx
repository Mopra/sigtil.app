'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
}: {
  siteId: string;
  siteName: string;
  productionUrl: string;
}) {
  const [status, setStatus] = useState<SiteStatus | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const lastReadyUrl = useRef<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/sites/${siteId}/status`);
      if (!res.ok) return;
      const next: SiteStatus = await res.json();
      setStatus(next);
      // Reload the preview iframe when a fresh build becomes ready.
      if (next.preview?.state === 'READY' && next.preview.upToDate) {
        const url = next.preview.url;
        if (url && url !== lastReadyUrl.current) {
          lastReadyUrl.current = url;
          setIframeKey(k => k + 1);
        }
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

  const previewUrl = status?.preview?.url ?? null;
  const previewBuilding =
    (status?.preview && !status.preview.upToDate) ||
    status?.preview?.state === 'BUILDING' ||
    status?.preview?.state === 'QUEUED';

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-stone-200 bg-white px-5 py-3">
        <div>
          <a href="/sites" className="text-sm text-stone-400 hover:underline">
            ← {t.yourSites}
          </a>
          <h1 className="text-lg font-bold leading-tight">{siteName}</h1>
        </div>
        <PublishBar siteId={siteId} status={status} onChanged={refreshStatus} />
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
