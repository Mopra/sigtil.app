'use client';

import { useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { t } from '@/lib/strings';

export type ChatPrefill = { text: string; id: number };

export default function Chat({
  siteId,
  page,
  prefill,
  onEdited,
}: {
  siteId: string;
  /** Page open in the preview, sent along so "denne side" means something. */
  page: string;
  /** Text to drop into the input for the editor to finish, e.g. from the page buttons. */
  prefill: ChatPrefill | null;
  onEdited: () => void;
}) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: { siteId },
    }),
    onFinish: () => onEdited(),
  });

  const busy = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    if (!prefill) return;
    setInput(prefill.text);
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // Wait for the value to land, then put the cursor after it.
    requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
  }, [prefill]);

  function submit(text: string) {
    if (!text.trim()) return;
    sendMessage({ text, metadata: { page } });
    setInput('');
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }

  async function handleFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append('siteId', siteId);
      form.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 413) setUploadError(t.uploadTooLarge(data?.limitMb ?? 10));
        else if (res.status === 415) setUploadError(t.uploadUnsupported);
        else setUploadError(t.uploadFailed);
        return;
      }
      const prefix = t.uploadedMessage(t.uploadedLabel[data.kind] ?? t.uploadedLabel.image, data.ref);
      submit(prefix + (input.trim() || t.uploadedWhere));
    } catch {
      setUploadError(t.uploadFailed);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="rounded-2xl bg-accent-soft p-4 text-[15px] leading-relaxed text-stone-700">
            {t.chatEmpty}
          </p>
        )}
        {messages.map(message => (
          <div key={message.id} className={message.role === 'user' ? 'flex justify-end' : ''}>
            <div
              className={
                message.role === 'user'
                  ? 'max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[15px] text-white'
                  : 'max-w-[95%] text-[15px] leading-relaxed text-stone-800'
              }
            >
              {message.parts.map((part, i) =>
                part.type === 'text' ? <span key={i}>{part.text}</span> : null,
              )}
            </div>
          </div>
        ))}
        {busy && <p className="text-sm text-stone-400">{t.thinking}</p>}
        {uploading && <p className="text-sm text-stone-400">{t.uploading}</p>}
        {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
        <div ref={bottomRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t border-stone-200 p-3"
        onSubmit={e => {
          e.preventDefault();
          submit(input);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*,application/pdf"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <button
          type="button"
          title={t.attach}
          aria-label={t.attach}
          disabled={busy || uploading}
          onClick={() => fileRef.current?.click()}
          className="rounded-xl border border-stone-300 p-2.5 text-stone-500 hover:border-accent hover:text-accent disabled:opacity-40"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder={t.chatPlaceholder}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(input);
            }
          }}
          className="max-h-40 flex-1 resize-none rounded-xl border border-stone-300 px-4 py-2.5 text-[15px] outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-xl bg-accent px-4 py-2.5 font-semibold text-white disabled:opacity-40"
        >
          →
        </button>
      </form>
    </>
  );
}
