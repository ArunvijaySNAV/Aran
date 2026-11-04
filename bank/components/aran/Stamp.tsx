import type { ReactNode } from "react";

/** Verdict stamp: outlined, slightly rotated, icon + sentence. exposed = red (passes the checksum), protected = blue (fails it). */
export function Stamp({ tone, children, className = "" }: { tone: "exposed" | "protected"; children: ReactNode; className?: string }) {
  const exposed = tone === "exposed";
  return (
    <span role="status" className={`inline-flex items-center gap-2 rounded-[6px] border-2 px-3 py-1 text-[15px] font-extrabold ${exposed ? "-rotate-[2.5deg] border-stamp bg-stampsoft text-stamp" : "rotate-[1.5deg] border-seal bg-sealsoft text-seal"} ${className}`}>
      {exposed
        ? <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
        : <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      {children}
    </span>
  );
}
