/** The sigtil mark: a speech bubble with a leaf-green fill, and the wordmark. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M16 3C8.8 3 3 8.2 3 14.6c0 3.6 1.8 6.8 4.7 8.9L6.6 28.4c-.1.5.4.9.9.6l5.6-3c1 .2 1.9.3 2.9.3 7.2 0 13-5.2 13-11.7S23.2 3 16 3Z"
        fill="var(--color-accent)"
      />
      <circle cx="11" cy="14.6" r="1.6" fill="#fff" />
      <circle cx="16" cy="14.6" r="1.6" fill="#fff" opacity="0.8" />
      <circle cx="21" cy="14.6" r="1.6" fill="#fff" opacity="0.6" />
    </svg>
  );
}

export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Mark size={size} />
      <span className="font-semibold tracking-tight text-ink" style={{ fontSize: size * 0.72 }}>
        sigtil
      </span>
    </span>
  );
}
