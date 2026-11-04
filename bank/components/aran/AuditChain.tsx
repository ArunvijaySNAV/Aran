import type { ReactNode } from "react";

/** Vertical chain of short hashes joined by lines. Fed by the audit rows a page already loads. */
export function AuditChain({ entries, intact }: { entries: { id: string | number; hash: string; label: ReactNode; meta?: ReactNode }[]; intact?: boolean }) {
  return (
    <ol aria-label="Audit chain" className="relative">
      {entries.map((e, i) => (
        <li key={e.id} className="relative flex gap-4 pb-5 last:pb-0">
          {i < entries.length - 1 ? <span aria-hidden="true" className="absolute left-[7px] top-4 h-full w-[2px] bg-rule" /> : null}
          <span aria-hidden="true" className={`relative mt-1.5 size-4 shrink-0 rounded-full border-2 border-ink ${intact ? "bg-seal" : "bg-bond"}`} />
          <div className="min-w-0"><code className="font-mono text-[12px] text-token">{e.hash.slice(0, 12)}</code><div className="text-[15px]">{e.label}</div>{e.meta ? <div className="text-[13px] text-ink2">{e.meta}</div> : null}</div>
        </li>
      ))}
    </ol>
  );
}
