export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-lg font-bold ${className}`}>
      <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden><rect x="3" y="3" width="11" height="11" rx="2" fill="var(--accent)" /><rect x="18" y="3" width="11" height="11" rx="2" fill="var(--accent)" opacity=".55" /><rect x="3" y="18" width="11" height="11" rx="2" fill="var(--accent)" opacity=".55" /><rect x="18" y="18" width="11" height="11" rx="2" fill="var(--accent)" /></svg>
      Tessera Bank
    </span>
  );
}
