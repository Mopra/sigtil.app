'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

type FrameMessage =
  | { sigtil: 'ready' }
  | { sigtil: 'editing'; on: boolean }
  | { sigtil: 'edit'; id: string; oldText: string; newText: string; path: string }
  | { sigtil: 'image'; id: string; src: string; alt: string; file: Blob; path: string };

// Vercel takes at most 4.5 MB per request, and a phone photo is often more.
const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;
const SHRUNK_SIDE = 2400;

/**
 * A picture small enough to send: as it is when it already fits, otherwise
 * scaled down in the browser. The server scales and compresses it again, so
 * nothing visible is lost. A picture the browser cannot read is sent as it is.
 */
async function sendable(file: Blob): Promise<Blob> {
  if (file.size <= MAX_UPLOAD_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, SHRUNK_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    // JPEG has no see-through parts: a logo or cut-out would get a black background.
    const type = /png|webp|gif/.test(file.type) ? 'image/webp' : 'image/jpeg';
    const blob = await new Promise<Blob | null>(done => canvas.toBlob(done, type, 0.9));
    return blob ?? file;
  } catch {
    return file;
  }
}

/**
 * Talk to the sigtil script inside the preview (public/inline-edit.js): switch
 * editing in place on and off, and save the texts the editor changes and the
 * pictures they replace.
 *
 * A text found in exactly one place, or a picture whose path the site's
 * content names, is saved directly, with no AI. Anything less certain is
 * handed to the AI via `onHandOff` or `onImageHandOff`.
 */
export function useInlineEdit({
  siteId,
  frameRef,
  frameKey,
  origin,
  on,
  onSaved,
  onHandOff,
  onImageHandOff,
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
  /** The new picture is saved at `ref`, but the AI has to put it in place of the one described by `alt`. */
  onImageHandOff: (ref: string, alt: string) => void;
}) {
  // The site in the preview has the script, so click-to-edit is possible.
  const [ready, setReady] = useState(false);
  // A text is open for editing or still saving; the preview must not reload under it.
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const editing = useRef(false);
  const saving = useRef(0);
  const onRef = useRef(on);
  const callbacks = useRef({ onSaved, onHandOff, onImageHandOff });
  callbacks.current = { onSaved, onHandOff, onImageHandOff };

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

    async function saveImage(msg: Extract<FrameMessage, { sigtil: 'image' }>) {
      saving.current++;
      updateBusy();
      setFailed(false);
      let ok = false;
      try {
        const form = new FormData();
        form.append('file', await sendable(msg.file), msg.file instanceof File ? msg.file.name : 'billede');
        form.append('src', msg.src);
        const res = await fetch(`/api/sites/${siteId}/image`, { method: 'POST', body: form });
        const data = res.ok ? await res.json() : null;
        if (data?.status === 'saved') {
          ok = true;
          callbacks.current.onSaved();
        } else if (data?.status === 'unclear' && typeof data.ref === 'string') {
          // The AI takes it from here; the new picture stays shown meanwhile.
          ok = true;
          callbacks.current.onImageHandOff(data.ref, typeof msg.alt === 'string' ? msg.alt : '');
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
      } else if (msg.sigtil === 'image' && msg.file instanceof Blob && typeof msg.src === 'string') {
        saveImage(msg);
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [siteId, origin, frameRef, post]);

  return { ready, busy, failed };
}
