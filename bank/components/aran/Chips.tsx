import type { ReactNode } from "react";

/** Token chip: Martian Mono 12, 4px radius, 1.5px outline. Seal blue on light, periwinkle on Night. Blue means protected. */
export function TokenChip({ children, title, className = "" }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <code title={title} translate="no" className={`inline-block max-w-full rounded-[4px] bg-tokenbg px-2 py-[3px] align-middle font-mono text-[12px] font-medium leading-snug text-token shadow-[inset_0_0_0_1.5px_var(--token)] [overflow-wrap:break-word] ${className}`}>
      {children}
    </code>
  );
}

/** Raw chip: red, only for a real raw value on screen (a Reveal, a comparison, a scan hit). Always pair with a countdown or Hide control. */
export function RawChip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <code className={`inline-block max-w-full break-all rounded-[4px] bg-rawbg px-2 py-[3px] align-middle font-mono text-[12px] font-medium leading-snug text-raw shadow-[inset_0_0_0_1.5px_var(--raw)] ${className}`}>
      {children}
    </code>
  );
}

/** Sink pill: 999px, 1.5px rule outline; selected = ink fill. Sinks: kyc-archive, log-platform, crm, loan-vendor, ai-gateway. */
export function SinkPill({ children, selected = false, onClick, className = "" }: { children: ReactNode; selected?: boolean; onClick?: () => void; className?: string }) {
  const base = `inline-flex min-h-8 items-center rounded-full px-3.5 py-1 text-[14px] font-semibold shadow-[inset_0_0_0_1.5px_var(--rule)] ${selected ? "bg-ink text-white shadow-none" : "text-ink"} ${className}`;
  return onClick ? <button type="button" aria-pressed={selected} onClick={onClick} className={base}>{children}</button> : <span className={base}>{children}</span>;
}
