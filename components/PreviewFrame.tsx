'use client';

import { useEffect, useRef, useState } from 'react';
import { t } from '@/lib/strings';
import { Icon } from './ui';

/** Preview width in CSS px, or null for the full panel. */
export type FrameWidth = number | null;

const MIN_WIDTH = 320;
const PRESETS = [
  { width: 390, label: t.previewWidthMobile, icon: 'phone' },
  { width: 820, label: t.previewWidthTablet, icon: 'tablet' },
  { width: null, label: t.previewWidthFull, icon: 'monitor' },
] as const;

/** Mobile, tablet and full width buttons for the preview toolbar. */
export function WidthPresets({ width, onChange }: { width: FrameWidth; onChange: (w: FrameWidth) => void }) {
  return (
    <div className="hidden items-center rounded-full bg-canvas p-0.5 md:flex" role="group" aria-label={t.previewWidth}>
      {PRESETS.map(p => {
        const active = width === p.width;
        return (
          <button
            key={p.label}
            type="button"
            title={p.label}
            aria-label={p.label}
            aria-pressed={active}
            onClick={() => onChange(p.width)}
            className={`flex h-7 w-8 items-center justify-center rounded-full transition ${
              active ? 'bg-surface text-ink shadow-float' : 'text-ink-faint hover:text-ink'
            }`}
          >
            <Icon name={p.icon} size={15} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * The preview iframe, centered at a chosen width with a drag handle on each
 * side. Dragging is symmetric, so the page stays centered while it resizes.
 */
export default function PreviewFrame({
  src,
  width,
  onWidthChange,
  frameRef,
}: {
  src: string;
  width: FrameWidth;
  onWidthChange: (w: FrameWidth) => void;
  frameRef?: React.Ref<HTMLIFrameElement>;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Room for the handles on both sides when the frame is narrower than the panel.
  const maxWidth = Math.max(MIN_WIDTH, boxWidth - 48);
  const shown = width === null ? null : Math.min(width, maxWidth);
  const constrained = shown !== null && shown < maxWidth;

  function set(next: number) {
    const clamped = Math.max(MIN_WIDTH, Math.round(next));
    // Dragged all the way out: snap back to full width.
    onWidthChange(clamped >= maxWidth - 4 ? null : clamped);
  }

  function startDrag(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const center = box.left + box.width / 2;
    setDragging(true);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    const move = (ev: PointerEvent) => set(Math.abs(ev.clientX - center) * 2);
    const end = () => {
      setDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    // On window, so a fast drag that leaves the handle keeps tracking.
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  function onKey(e: React.KeyboardEvent, side: 'left' | 'right') {
    const step = e.shiftKey ? 50 : 10;
    const current = shown ?? maxWidth;
    const grow = side === 'right' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = side === 'right' ? 'ArrowLeft' : 'ArrowRight';
    if (e.key === grow) set(current + step * 2);
    else if (e.key === shrink) set(current - step * 2);
    else return;
    e.preventDefault();
  }

  const handle = (side: 'left' | 'right') => (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t.previewResize}
      aria-valuenow={Math.round(shown ?? maxWidth)}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={Math.round(maxWidth)}
      title={t.previewResize}
      tabIndex={0}
      onPointerDown={startDrag}
      onDoubleClick={() => onWidthChange(null)}
      onKeyDown={e => onKey(e, side)}
      className="group hidden w-6 shrink-0 cursor-ew-resize touch-none items-center justify-center outline-none md:flex"
    >
      <span
        className={`h-10 w-1.5 rounded-full transition group-hover:h-14 group-hover:bg-ink-faint group-focus-visible:bg-accent ${
          dragging ? 'h-14 bg-accent' : 'bg-ink-faint/40'
        }`}
      />
    </div>
  );

  return (
    <div
      ref={boxRef}
      className={`relative z-0 flex min-h-0 flex-1 justify-center transition-colors ${constrained || dragging ? 'bg-canvas' : ''}`}
    >
      {(constrained || dragging) && handle('left')}
      <div
        className={`relative min-h-0 ${shown === null ? 'flex-1' : ''} ${
          constrained || dragging ? 'my-3 overflow-hidden rounded-2xl shadow-window' : ''
        }`}
        style={shown !== null ? { width: shown } : undefined}
      >
        <iframe
          ref={frameRef}
          src={src}
          className={`h-full w-full border-0 bg-white ${dragging ? 'pointer-events-none' : ''}`}
          title={t.previewTitle}
        />
        {dragging && (
          <span className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-ink/85 px-3 py-1 text-[13px] font-medium tabular-nums text-white">
            {Math.round(shown ?? maxWidth)} px
          </span>
        )}
      </div>
      {(constrained || dragging) && handle('right')}
      {/* At full width the handle sits in its own gutter on the right edge, ready
          to drag inward. A gutter rather than an overlay, so it never covers the
          page's scrollbar. */}
      {!constrained && !dragging && (
        <div className="hidden w-2 shrink-0 md:block">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t.previewResize}
            title={t.previewResize}
            tabIndex={0}
            onPointerDown={startDrag}
            onKeyDown={e => onKey(e, 'right')}
            className="group flex h-full cursor-ew-resize touch-none items-center justify-center outline-none"
          >
            <span className="h-10 w-1 rounded-full bg-transparent transition group-hover:bg-ink-faint group-focus-visible:bg-accent" />
          </div>
        </div>
      )}
    </div>
  );
}
