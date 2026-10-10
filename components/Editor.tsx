'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SignOutButton } from '@clerk/nextjs';
import Chat, { type ChatPrefill } from './Chat';
import PublishBar from './PublishBar';
import { Mark } from './Logo';
import PreviewFrame, { WidthPresets, type FrameWidth } from './PreviewFrame';
import { Icon, Menu, Spinner } from './ui';
import { useInlineEdit } from './useInlineEdit';
import { t } from '@/lib/strings';

export type SiteStatus = {
  pendingChanges: number;
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
  // building deployment, or clearing it when a status poll fails would drop
  // the iframe onto a page that cannot be framed, blanking the preview.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const lastReadyUrl = useRef<string | null>(null);
  const [pages, setPages] = useState<PageLink[]>([]);
  const [page, setPage] = useState('/');
  const [prefill, setPrefill] = useState<ChatPrefill | null>(null);
  const [view, setView] = useState<'chat' | 'preview'>('chat');
  const [frameWidth, setFrameWidth] = useState<FrameWidth>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [editText, setEditText] = useState(false);
  // A newer build that waits to be shown until the editor is done with a text.
  const heldUrl = useRef<string | null>(null);
  const inlineBusy = useRef(false);

  const showPreview = useCallback((url: string) => {
    setPreviewUrl(url);
    setIframeKey(k => k + 1);
  }, []);

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
        // Reloading now would throw away a text being typed in the preview.
        if (inlineBusy.current) heldUrl.current = url;
        else showPreview(url);
      }
    } catch {
      // transient, the next poll will recover
    }
  }, [siteId, showPreview]);

  useEffect(() => {
    refreshStatus();
    const id = setInterval(refreshStatus, 5000);
    return () => clearInterval(id);
  }, [refreshStatus]);

  const onEdited = useCallback(() => {
    refreshStatus();
    refreshPages();
  }, [refreshStatus, refreshPages]);

  const inline = useInlineEdit({
    siteId,
    frameRef,
    frameKey: iframeKey,
    origin: previewUrl ? new URL(previewUrl).origin : null,
    on: editText,
    onSaved: onEdited,
    onHandOff: (from, to) => {
      setPrefill({ text: t.inlineEditHandOff(from, to), send: true, id: Date.now() });
      setView('chat');
    },
  });

  useEffect(() => {
    inlineBusy.current = inline.busy;
    if (!inline.busy && heldUrl.current) {
      showPreview(heldUrl.current);
      heldUrl.current = null;
    }
  }, [inline.busy, showPreview]);

  const pagePath = page === '/' ? '' : page;
  const currentLabel = pages.find(p => p.route === page)?.label ?? page;
  const ask = (text: string, hint: string) => {
    setPrefill({ text, hint, id: Date.now() });
    setView('chat');
  };
  const host = productionUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

  const previewBuilding =
    (status?.preview && !status.preview.upToDate) ||
    status?.preview?.state === 'BUILDING' ||
    status?.preview?.state === 'QUEUED';

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          {showSitesLink ? (
            <a
              href="/sites"
              title={t.yourSites}
              aria-label={t.yourSites}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-soft transition hover:bg-surface hover:text-ink"
            >
              <Icon name="back" size={20} />
            </a>
          ) : (
            <span className="ml-1 shrink-0">
              <Mark size={28} />
            </span>
          )}
          <div className="min-w-0 pl-1">
            <h1 className="truncate text-[17px] font-semibold leading-tight tracking-tight">{siteName}</h1>
            <a
              href={productionUrl}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-[13px] text-ink-faint transition hover:text-accent"
            >
              {host}
            </a>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <PublishBar siteId={siteId} status={status} onChanged={onEdited} />
          <SignOutButton redirectUrl="/sign-in">
            <button
              title={t.logout}
              aria-label={t.logout}
              className="flex h-10 w-10 items-center justify-center rounded-full text-ink-faint transition hover:bg-surface hover:text-ink"
            >
              <Icon name="logout" size={18} />
            </button>
          </SignOutButton>
        </div>
      </header>

      {/* Small screens show one pane at a time. */}
      <div className="px-3 pb-2 md:hidden">
        <div className="grid grid-cols-2 rounded-full bg-line/70 p-1 text-sm font-medium">
          {(['chat', 'preview'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-full py-1.5 transition ${view === v ? 'bg-surface text-ink shadow-float' : 'text-ink-soft'}`}
            >
              {v === 'chat' ? t.chatTab : t.previewTab}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3">
        <section
          className={`${view === 'chat' ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col overflow-hidden rounded-panel bg-surface shadow-float md:flex md:w-[400px] md:flex-none`}
        >
          <Chat siteId={siteId} page={page} prefill={prefill} onEdited={onEdited} />
        </section>

        <section
          className={`${view === 'preview' ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col overflow-hidden rounded-panel bg-surface shadow-window md:flex`}
        >
          <div className="relative z-20 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
            {pages.length > 0 ? (
              <div className="flex min-w-0 items-center gap-1">
                <div className="relative min-w-0">
                  <select
                    value={page}
                    onChange={e => setPage(e.target.value)}
                    aria-label={t.pagePicker}
                    className="max-w-56 cursor-pointer appearance-none truncate rounded-full bg-canvas py-1.5 pl-3.5 pr-8 text-sm font-medium text-ink outline-none transition hover:bg-line/70"
                  >
                    {pages.map(p => (
                      <option key={p.route} value={p.route}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <Icon
                    name="chevronDown"
                    size={14}
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-soft"
                  />
                </div>
                <button
                  onClick={() => ask(t.pageNewPrompt, t.pageNewHint)}
                  title={t.pageNew}
                  aria-label={t.pageNew}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition hover:bg-canvas hover:text-accent"
                >
                  <Icon name="plus" size={18} />
                </button>
                <Menu
                  label={t.pageMore}
                  align="left"
                  trigger={<Icon name="more" size={18} />}
                  triggerClassName="flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition hover:bg-canvas hover:text-ink"
                  items={[
                    { label: t.pageNew, onSelect: () => ask(t.pageNewPrompt, t.pageNewHint) },
                    {
                      label: t.pageRename,
                      onSelect: () => ask(t.pageRenamePrompt(currentLabel), t.pageRenameHint),
                    },
                    ...(page !== '/'
                      ? [
                          {
                            label: t.pageDelete,
                            danger: true,
                            onSelect: () => ask(t.pageDeletePrompt(currentLabel), t.pageDeleteHint),
                          },
                        ]
                      : []),
                  ]}
                />
              </div>
            ) : (
              <span className="px-1 text-sm text-ink-soft">{t.previewTitle}</span>
            )}
            <div className="flex shrink-0 items-center gap-1">
              {inline.ready && (
                <button
                  type="button"
                  onClick={() => setEditText(on => !on)}
                  title={t.inlineEditTitle}
                  aria-pressed={editText}
                  className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition disabled:opacity-40 ${
                    editText ? 'bg-accent text-white hover:bg-accent-hover' : 'text-ink-soft hover:bg-canvas hover:text-ink'
                  }`}
                >
                  <Icon name="pencil" size={15} />
                  {t.inlineEdit}
                </button>
              )}
              {previewUrl && <WidthPresets width={frameWidth} onChange={setFrameWidth} />}
              {previewBuilding && (
                <span className="flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-[13px] font-medium text-accent">
                  <Spinner className="h-3 w-3" />
                  {t.previewUpdating}
                </span>
              )}
              {previewUrl && (
                <a
                  href={previewUrl + pagePath}
                  target="_blank"
                  rel="noreferrer"
                  title={t.previewOpenNew}
                  aria-label={t.previewOpenNew}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition hover:bg-canvas hover:text-ink"
                >
                  <Icon name="external" size={16} />
                </a>
              )}
            </div>
          </div>
          {previewUrl && inline.ready && editText && (
            <div
              role="status"
              className={`flex shrink-0 items-center justify-center gap-2 px-4 py-2 text-[13px] font-medium ${
                inline.failed ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'
              }`}
            >
              <Icon name={inline.failed ? 'warning' : 'pencil'} size={14} />
              {inline.failed ? t.inlineEditFailed : t.inlineEditHint}
            </div>
          )}
          {previewUrl ? (
            <PreviewFrame
              key={iframeKey}
              frameRef={frameRef}
              src={previewUrl + pagePath}
              width={frameWidth}
              onWidthChange={setFrameWidth}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
              <Mark size={40} />
              <p className="max-w-xs text-ink-soft">{t.previewNone}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
