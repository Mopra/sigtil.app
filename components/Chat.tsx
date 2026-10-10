'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { t } from '@/lib/strings';
import { Icon, Spinner } from './ui';

/** `hint` tells the editor what to do with the filled-in text, shown above the input. */
export type ChatPrefill = { text: string; hint?: string; id: number };

export default function Chat({
  siteId,
  page,
  prefill,
  locked = false,
  onEdited,
}: {
  siteId: string;
  /** Page open in the preview, sent along so "denne side" means something. */
  page: string;
  /** Text to drop into the input for the editor to finish, e.g. from the page buttons. */
  prefill: ChatPrefill | null;
  /** The site changed elsewhere in a way that clashes with unpublished edits; no editing until resolved. */
  locked?: boolean;
  onEdited: () => void;
}) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hint, setHint] = useState<{ text: string; id: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: { siteId },
    }),
    onFinish: () => onEdited(),
  });

  const busy = status === 'submitted' || status === 'streaming';
  const lastIsAssistantText =
    messages.at(-1)?.role === 'assistant' && messages.at(-1)!.parts.some(p => p.type === 'text' && p.text);

  // Grow the input with its text, up to the max height set in CSS.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  function fill(text: string) {
    setInput(text);
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // Wait for the value to land, then put the cursor after it.
    requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
  }

  useEffect(() => {
    if (!prefill) return;
    fill(prefill.text);
    setHint(prefill.hint ? { text: prefill.hint, id: prefill.id } : null);
    // Pulse the input so the eye lands on it, restarting if it is already pulsing.
    const box = boxRef.current;
    if (!box) return;
    box.classList.remove('animate-beckon');
    void box.offsetWidth;
    box.classList.add('animate-beckon');
  }, [prefill]);

  function submit(text: string) {
    if (!text.trim() || locked) return;
    sendMessage({ text, metadata: { page } });
    setInput('');
    setHint(null);
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

  const canAttach = !busy && !uploading && !locked;

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={e => {
        if (!canAttach || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={e => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f && canAttach) handleFile(f);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-[1.25rem] border-2 border-dashed border-accent bg-accent-soft/90 text-lg font-medium text-accent">
          {t.dropHere}
        </div>
      )}

      <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-4 pt-6">
        {messages.length === 0 && (
          <div className="animate-rise pt-4">
            <h2 className="text-[26px] font-semibold leading-tight tracking-tight">{t.chatHello}</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{t.chatEmpty}</p>
            <div className="mt-6 flex flex-col items-start gap-2">
              {t.chatSuggestions.map(s => (
                <button
                  key={s}
                  type="button"
                  disabled={locked}
                  onClick={() => fill(s)}
                  className="rounded-full border border-line px-4 py-2 text-left text-[15px] text-ink transition hover:border-accent/40 hover:bg-accent-soft hover:text-accent disabled:opacity-40"
                >
                  {s.endsWith(' ') ? `${s.trim()}…` : s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(message => {
          const text = message.parts.map(part => (part.type === 'text' ? part.text : '')).join('');
          if (!text) return null;
          return message.role === 'user' ? (
            <div key={message.id} className="flex animate-rise justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-[1.25rem] rounded-br-md bg-accent px-4 py-2.5 text-[15px] leading-snug text-white">
                {text}
              </div>
            </div>
          ) : (
            <div key={message.id} className="max-w-[95%] whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
              {text}
            </div>
          );
        })}

        {busy && !lastIsAssistantText && (
          <div className="flex items-center gap-2.5 text-sm text-ink-faint" role="status">
            <span className="dots flex items-center gap-1 text-accent">
              <span />
              <span />
              <span />
            </span>
            {t.thinking}
          </div>
        )}
        {error && !busy && <Notice tone="danger">{t.chatFailed}</Notice>}
        {locked && <Notice tone="danger">{t.conflict}</Notice>}
        {uploading && (
          <div className="flex items-center gap-2 text-sm text-ink-faint">
            <Spinner className="text-accent" />
            {t.uploading}
          </div>
        )}
        {uploadError && <Notice tone="danger">{uploadError}</Notice>}
        <div ref={bottomRef} />
      </div>

      <form
        className="p-3 pt-0"
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
        {hint && (
          <div
            key={hint.id}
            role="status"
            className="mb-2 flex animate-rise items-center gap-2 rounded-2xl bg-accent-soft py-2 pl-3.5 pr-1.5 text-[14px] font-medium leading-snug text-accent"
          >
            <span className="flex-1">{hint.text}</span>
            <button
              type="button"
              title={t.hintDismiss}
              aria-label={t.hintDismiss}
              onClick={() => setHint(null)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition hover:bg-accent/10"
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        )}
        <div
          ref={boxRef}
          className="flex items-end gap-1 rounded-[1.5rem] border border-line bg-surface p-1.5 transition focus-within:border-accent/50 focus-within:ring-4 focus-within:ring-accent-soft"
        >
          <button
            type="button"
            title={t.attach}
            aria-label={t.attach}
            disabled={!canAttach}
            onClick={() => fileRef.current?.click()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-soft transition hover:bg-canvas hover:text-accent disabled:opacity-40"
          >
            <Icon name="paperclip" size={19} />
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            placeholder={t.chatPlaceholder}
            disabled={locked}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-1 py-[7px] text-[15px] leading-[22px] outline-none placeholder:text-ink-faint focus-visible:outline-none"
          />
          <button
            type="submit"
            title={t.send}
            aria-label={t.send}
            disabled={busy || locked || !input.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition hover:bg-accent-hover active:scale-90 disabled:bg-line disabled:text-ink-faint"
          >
            <Icon name="arrowUp" size={18} />
          </button>
        </div>
      </form>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'danger'; children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className={`flex gap-3 rounded-2xl p-4 text-[15px] leading-relaxed ${tone === 'danger' ? 'bg-danger-soft text-danger' : ''}`}
    >
      <Icon name="warning" size={18} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
