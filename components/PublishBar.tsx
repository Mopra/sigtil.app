'use client';

import { useEffect, useRef, useState } from 'react';
import { t } from '@/lib/strings';
import type { PendingChange, SiteStatus } from './Editor';
import { Icon, Menu, Spinner } from './ui';

export default function PublishBar({
  siteId,
  status,
  onChanged,
}: {
  siteId: string;
  status: SiteStatus | null;
  onChanged: () => void;
}) {
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean; id: number } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [undoing, setUndoing] = useState<string | null>(null);
  const reviewRef = useRef<HTMLDivElement>(null);

  const changes = status?.changes ?? [];
  // A chat turn counts as one change, however many steps it took.
  const pending = changes.length || (status?.pendingChanges ?? 0);

  useEffect(() => {
    if (pending === 0) setReviewing(false);
  }, [pending]);

  useEffect(() => {
    if (!reviewing) return;
    const onDown = (e: MouseEvent) => {
      if (!reviewRef.current?.contains(e.target as Node)) setReviewing(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setReviewing(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [reviewing]);

  // Toasts fade on their own; failures stay a little longer so they can be read.
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), message.ok ? 4000 : 9000);
    return () => clearTimeout(id);
  }, [message]);

  useEffect(() => {
    if (!confirmAll) return;
    const id = setTimeout(() => setConfirmAll(false), 4000);
    return () => clearTimeout(id);
  }, [confirmAll]);

  const say = (text: string, ok: boolean) => setMessage({ text, ok, id: Date.now() });

  async function publish() {
    setReviewing(false);
    setPublishing(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/publish`, { method: 'POST' });
      const body = await res.json();
      say(body.live ? t.publishDone : t.publishFailed, !!body.live);
    } catch {
      say(t.publishFailed, false);
    } finally {
      setPublishing(false);
      onChanged();
    }
  }

  async function undo(all: boolean) {
    setConfirmAll(false);
    const res = await fetch(`/api/sites/${siteId}/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all }),
    });
    const body = await res.json().catch(() => ({ undone: false }));
    say(body.undone ? t.undoDone : t.undoNothing, true);
    onChanged();
  }

  async function undoChange(change: PendingChange) {
    if (!status?.head) return;
    const key = change.shas[0];
    setUndoing(key);
    try {
      const res = await fetch(`/api/sites/${siteId}/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ change: { shas: change.shas, head: status.head } }),
      });
      const body = await res.json().catch(() => ({ undone: false }));
      say(body.undone ? t.undoDone : t.changeUndoStale, !!body.undone);
    } catch {
      say(t.changeUndoStale, false);
    } finally {
      setUndoing(null);
      onChanged();
    }
  }

  return (
    <div ref={reviewRef} className="relative flex items-center gap-2">
      {message && (
        <div
          key={message.id}
          role="status"
          className={`fixed left-1/2 top-4 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 animate-toast items-center gap-2.5 rounded-full px-5 py-3 text-[15px] font-medium shadow-window backdrop-blur-xl ${
            message.ok ? 'bg-ink/90 text-white' : 'bg-danger text-white'
          }`}
        >
          <Icon name={message.ok ? 'check' : 'warning'} size={18} />
          {message.text}
        </div>
      )}

      {pending > 0 && !publishing && (
        <button
          type="button"
          onClick={() => setReviewing(r => !r)}
          title={t.publishReview}
          aria-expanded={reviewing}
          className="hidden rounded-full px-2 py-1 text-sm text-ink-soft transition hover:bg-surface sm:inline"
        >
          <span className="font-medium text-ink underline decoration-line underline-offset-4">{t.publishPending(pending)}</span>{' '}
          {t.publishPendingHint}
        </button>
      )}

      {pending > 0 && !publishing && (
        <Menu
          label={t.undoMenu}
          trigger={<Icon name="undo" size={18} />}
          triggerClassName="flex h-10 w-10 items-center justify-center rounded-full text-ink-soft transition hover:bg-surface hover:text-ink"
          items={[
            { label: t.undo, onSelect: () => undo(false) },
            confirmAll
              ? { label: t.undoAllConfirm, danger: true, onSelect: () => undo(true) }
              : { label: t.undoAll, danger: true, keepOpen: true, onSelect: () => setConfirmAll(true) },
          ]}
        />
      )}

      {publishing ? (
        <span className="flex h-10 items-center gap-2 rounded-full bg-accent-soft px-5 text-[15px] font-medium text-accent">
          <Spinner />
          {t.publishWorking}
        </span>
      ) : pending > 0 ? (
        <button
          onClick={() => setReviewing(r => !r)}
          aria-expanded={reviewing}
          className="h-10 rounded-full bg-accent px-6 text-[15px] font-semibold text-white shadow-[0_6px_16px_-6px_rgb(46_107_82/0.6)] transition hover:bg-accent-hover active:scale-[0.97] disabled:opacity-40"
        >
          {t.publishButton}
        </button>
      ) : (
        <span className="flex h-10 items-center gap-1.5 px-3 text-sm text-ink-soft">
          <Icon name="check" size={16} className="text-accent" />
          {t.publishAllLive}
        </span>
      )}

      {reviewing && !publishing && (
        <div
          role="dialog"
          aria-label={t.publishReviewTitle}
          className="absolute right-0 top-full z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] origin-top animate-toast rounded-2xl border border-line bg-surface p-4 shadow-window"
        >
          <h2 className="text-[15px] font-semibold text-ink">{t.publishReviewTitle}</h2>
          <p className="mt-0.5 text-sm text-ink-soft">{t.publishReviewHint}</p>
          <ul className="-mx-1 mt-3 max-h-[50vh] space-y-0.5 overflow-y-auto">
            {changes.map(change => (
              <li key={change.shas[0]} className="flex items-start gap-2 rounded-xl px-1 py-1.5 hover:bg-canvas">
                <Icon name="check" size={16} className="mt-0.5 shrink-0 text-accent" />
                <span className="min-w-0 flex-1 text-[15px] leading-snug text-ink">
                  {(change.labels.length ? change.labels : [t.changeUnnamed]).map((label, i) => (
                    <span key={i} className={i ? 'block text-sm text-ink-soft' : 'block'}>
                      {label}
                    </span>
                  ))}
                </span>
                <button
                  type="button"
                  onClick={() => undoChange(change)}
                  disabled={undoing !== null}
                  title={t.changeUndo}
                  aria-label={t.changeUndo}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint transition hover:bg-surface hover:text-ink disabled:opacity-40"
                >
                  {undoing === change.shas[0] ? <Spinner /> : <Icon name="undo" size={16} />}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setReviewing(false)}
              className="h-10 rounded-full px-4 text-[15px] font-medium text-ink-soft transition hover:bg-canvas hover:text-ink"
            >
              {t.publishCancel}
            </button>
            <button
              type="button"
              onClick={publish}
              disabled={undoing !== null}
              className="h-10 rounded-full bg-accent px-6 text-[15px] font-semibold text-white transition hover:bg-accent-hover active:scale-[0.97] disabled:opacity-40"
            >
              {t.publishConfirm}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
