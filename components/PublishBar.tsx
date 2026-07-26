'use client';

import { useState } from 'react';
import { t } from '@/lib/strings';
import type { SiteStatus } from './Editor';

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
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const pending = status?.pendingChanges ?? 0;

  async function publish() {
    setPublishing(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/publish`, { method: 'POST' });
      const body = await res.json();
      setMessage(body.live ? { text: t.publishDone, ok: true } : { text: t.publishFailed, ok: false });
    } catch {
      setMessage({ text: t.publishFailed, ok: false });
    } finally {
      setPublishing(false);
      onChanged();
    }
  }

  async function undo(all: boolean) {
    const res = await fetch(`/api/sites/${siteId}/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all }),
    });
    const body = await res.json().catch(() => ({ undone: false }));
    setMessage({ text: body.undone ? t.undoDone : t.undoNothing, ok: true });
    onChanged();
  }

  return (
    <div className="flex items-center gap-3">
      {message && (
        <span className={`text-sm ${message.ok ? 'text-accent' : 'text-red-600'}`}>{message.text}</span>
      )}
      {pending > 0 && !publishing && (
        <>
          <span className="text-sm text-stone-500">{t.publishPending(pending)}</span>
          <button onClick={() => undo(false)} className="text-sm text-stone-500 hover:underline">
            {t.undo}
          </button>
        </>
      )}
      {publishing ? (
        <span className="flex items-center gap-2 text-sm font-medium text-accent">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          {t.publishWorking}
        </span>
      ) : pending > 0 ? (
        <button
          onClick={publish}
          className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-white hover:opacity-90"
        >
          {t.publishButton}
        </button>
      ) : (
        <span className="rounded-xl bg-accent-soft px-4 py-2 text-sm font-medium text-accent">
          {t.publishAllLive}
        </span>
      )}
    </div>
  );
}
