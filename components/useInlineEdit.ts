'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

type FrameMessage =
  | { sigtil: 'ready' }
  | { sigtil: 'editing'; on: boolean }
  | { sigtil: 'edit'; id: string; oldText: string; newText: string; path: string };

/**
 * Talk to the sigtil script inside the preview (public/inline-edit.js): switch
 * click-to-edit on and off, and save the texts the editor changes in place.
 *
 * A text found in exactly one place is saved directly. Anything less certain
 * is handed to the AI via `onHandOff`.
 */
export function useInlineEdit({
  siteId,
  frameRef,
  frameKey,
  origin,
  on,
  onSaved,
  onHandOff,
}: {
  siteId: string;
  frameRef: RefObject<HTMLIFrameElement | null>;
  /** Changes whenever the iframe is replaced, so the handshake starts over. */
  frameKey: number;
  /** Origin of the page in the preview; messages from anywhere else are ignored. */
  origin: string | null;
  on: boolean;
  onSaved: () => void;
  onHandOff: (oldText: string, newText: string) => void;
}) {
  // The site in the preview has the script, so click-to-edit is possible.
  const [ready, setReady] = useState(false);
  // A text is open for editing or still saving; the preview must not reload under it.
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const editing = useRef(false);
  const saving = useRef(0);
  const onRef = useRef(on);
  const callbacks = useRef({ onSaved, onHandOff });
  callbacks.current = { onSaved, onHandOff };

  const post = useCallback(
    (msg: object) => {
      if (origin) frameRef.current?.contentWindow?.postMessage(msg, origin);
    },
    [frameRef, origin],
  );

  useEffect(() => {
    setReady(false);
    editing.current = false;
    setBusy(saving.current > 0);
  }, [frameKey]);

  useEffect(() => {
    onRef.current = on;
    if (ready) post({ sigtil: 'mode', on });
    if (!on) setFailed(false);
  }, [on, ready, post]);

  useEffect(() => {
    const updateBusy = () => setBusy(editing.current || saving.current > 0);

    async function save(msg: Extract<FrameMessage, { sigtil: 'edit' }>) {
      saving.current++;
      updateBusy();
      setFailed(false);
      let ok = false;
      try {
        const res = await fetch(`/api/sites/${siteId}/text`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldText: msg.oldText, newText: msg.newText }),
        });
        const data = res.ok ? await res.json() : null;
        if (data?.status === 'saved') {
          ok = true;
          callbacks.current.onSaved();
        } else if (data?.status === 'unclear') {
          // The AI takes it from here; the new text stays shown meanwhile.
          ok = true;
          callbacks.current.onHandOff(msg.oldText, msg.newText);
        }
      } catch {
        // reported below
      }
      if (!ok) setFailed(true);
      post({ sigtil: 'result', id: msg.id, ok });
      saving.current--;
      updateBusy();
    }

    function onMessage(e: MessageEvent) {
      if (!origin || e.origin !== origin || e.source !== frameRef.current?.contentWindow) return;
      const msg = e.data as FrameMessage;
      if (!msg || typeof msg !== 'object' || typeof msg.sigtil !== 'string') return;
      if (msg.sigtil === 'ready') {
        setReady(true);
        // Also covers a page change inside the preview, which loads the script afresh.
        post({ sigtil: 'mode', on: onRef.current });
      } else if (msg.sigtil === 'editing') {
        editing.current = msg.on;
        updateBusy();
      } else if (msg.sigtil === 'edit' && typeof msg.oldText === 'string' && typeof msg.newText === 'string') {
        save(msg);
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [siteId, origin, frameRef, post]);

  return { ready, busy, failed };
}
