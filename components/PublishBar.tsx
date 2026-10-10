'use client';

import { useEffect, useState } from 'react';
import { t } from '@/lib/strings';
import type { SiteStatus } from './Editor';
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

  const pending = status?.pendingChanges ?? 0;

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

  return (
    <div className="flex items-center gap-2">
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
        <span className="hidden text-sm text-ink-soft sm:inline">
          <span className="font-medium text-ink">{t.publishPending(pending)}</span> {t.publishPendingHint}
        </span>
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
          onClick={publish}
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
    </div>
  );
}
