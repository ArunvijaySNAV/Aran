/** Aran mark: three concentric arches, the innermost solid. Single colour (currentColor). No glow, no gradient, no shield. */
export function AranMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className={className}>
      <path d="M5 36V19a15 15 0 0 1 30 0v17" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M11 36V20a9 9 0 0 1 18 0v16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M17 36V21a3 3 0 0 1 6 0v15" fill="currentColor" />
    </svg>
  );
}

/** Tessera Bank mark: two small gold squares (mosaic tiles) before the wordmark. */
export function TesseraTiles({ className = "" }: { className?: string }) {
  return (
    <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true" className={className}>
      <rect x="0" y="1" width="14" height="14" rx="2" fill="var(--bank-gold)" />
      <rect x="9" y="4" width="11" height="11" rx="2" fill="var(--bank-gold-2)" />
    </svg>
  );
}
